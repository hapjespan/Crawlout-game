import { describe, expect, it } from 'vitest';
import { ROLES, buildingTypeId } from '@crawlout/data';
import { EVENT_TYPE } from '@crawlout/protocol';
import type { LobbyPlayer, Replay } from '@crawlout/protocol';
import { ORDER_ATTACK_MOVE, createSim } from '@crawlout/sim';
import type { Sim } from '@crawlout/sim';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEnv, gameData, mapGrid } from './env.js';
import { centrePoint } from './bot.js';
import { createReplaySim, parseReplay } from './run.js';

// Eindcriterium van de sim-core-brief op de slice-map Rustbelt, met de echte data:
//  - 50 bewoners per kant verzamelen, bouwen, wisselen van rol en vechten (fixture s4-rustbelt-fifty, binnen de regels);
//  - turrets schieten en de AI onderzoekt de prereqTech van zijn bouworder (fixture s4-rustbelt-turrets);
//  - de scripted AI tegen zichzelf levert een winnaar binnen een redelijk aantal ticks;
//  - bouwers hervatten na een onderbreking, Stop houdt ze stil, vrije bouwers helpen (fixture s5-rustbelt-builder-resume);
//  - winroute B: een bot houdt drie punten (beide settlement-punten en het midden; Rustbelt XL vraagt 3 van de 5) tegen
//    de AI en wint op dominantie (fixture s6-rustbelt-dominance), met PlayerStatus.dominance zoals de HUD hem leest;
//  - de AI-legers blijven niet hangen: geen unit staat een minuut op een AttackMove zonder doel en zonder vooruit te
//    komen (de rivier over de voordes en de landbrug, via de padvinding).

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const fixture = (name: string): Replay =>
  parseReplay(JSON.parse(readFileSync(join(FIXTURES_DIR, `${name}.json`), 'utf8')));

/** Speelt een replay af en roept na elke tick `each` aan (events van die tick staan in sim.events). */
function play(r: Replay, each: (sim: Sim) => void): Sim {
  const sim = createReplaySim(r);
  const byFrame = new Map(r.bundles.map((b) => [b.frame, b]));
  const last = Math.max(...r.hashes.map((h) => h.frame));
  for (let f = 0; f <= last; f++) {
    sim.applyBundle(byFrame.get(f) ?? { frame: f, commands: [] });
    sim.tick();
    each(sim);
  }
  return sim;
}

const lobby = (ai: boolean): LobbyPlayer[] =>
  [0, 1].map((i) => ({
    playerId: i,
    name: `p${i}`,
    faction: 'dwellers',
    ready: true,
    online: !ai,
    ai,
  }));
const settings = { mode: 'skirmish' as const, delayFrames: 4 };
const role = (name: 'scavenger' | 'builder' | 'militia'): number => ROLES.indexOf(name);
const building = (key: string): number =>
  buildingTypeId(gameData().data.buildings.find((b) => b.key === key)!.id);

function unitsOf(sim: Sim, owner: number, r?: number): number[] {
  return sim.entityIds().filter((id) => {
    const u = sim.getUnit(id)!;
    return u.kind === 'unit' && u.owner === owner && (r === undefined || u.role === r);
  });
}

describe('slice: Rustbelt met echte data', () => {
  it('bouwers hervatten na een Move, Stop houdt ze stil, Build op de plaats helpt, vrije bouwers helpen (fixture s5-rustbelt-builder-resume)', () => {
    const r = fixture('s5-rustbelt-builder-resume');
    const done: { frame: number; owner: number; typeId: number }[] = [];
    const builder = [0, 1].map((p) => unitsOf(createReplaySim(r), p, role('builder'))[0]!);
    const seen: { frame: number; order: number[]; site: number[] }[] = [];
    let stoppedProgress = -1;
    const sim = play(r, (s) => {
      for (let k = 0; k < s.events.count; k++) {
        if (s.events.type[k] !== EVENT_TYPE.buildingDone) continue;
        const u = s.getUnit(s.events.a[k]!)!;
        done.push({ frame: s.frame - 1, owner: u.owner, typeId: u.typeId });
      }
      const units = builder.map((id) => s.getUnit(id)!);
      seen.push({
        frame: s.frame - 1,
        order: units.map((u) => u.order),
        site: units.map((u) => u.orderTarget),
      });
      if (s.frame - 1 >= 1400 && s.frame - 1 < 1800) {
        const site = s
          .entityIds()
          .map((id) => s.getUnit(id)!)
          .find((u) => u.kind === 'building' && u.owner === 0 && u.buildState === 1)!;
        if (stoppedProgress < 0) stoppedProgress = site.progress;
        expect(site.progress).toBe(stoppedProgress); // na Stop: niemand bouwt, ook niet vanzelf
        expect(units[0]!.order).toBe(0);
      }
    });
    // speler 0: werkplaats af na de Move-onderbreking, woning af na de rechtsklik
    expect(done.filter((d) => d.owner === 0).map((d) => d.typeId)).toEqual([
      building('werkplaats'),
      building('woning'),
    ]);
    expect(
      done.find((d) => d.owner === 0 && d.typeId === building('woning'))!.frame,
    ).toBeGreaterThan(1800);
    // de werkplaats-bouwer was aan het lopen (Move) en ging daarna zonder bevel weer bouwen
    const movedAt = seen.findIndex((x) => x.frame >= 250 && x.order[0] === 1);
    expect(seen.slice(movedAt).some((x) => x.order[0] === 5)).toBe(true);
    // speler 1: B (het laatste bouwbevel) eerst, daarna A vanzelf, ondanks de vlucht
    expect(done.filter((d) => d.owner === 1)).toHaveLength(2);
    expect(seen.some((x) => x.frame > 700 && x.order[1] === 1)).toBe(true);
    expect(sim.getUnit(builder[1]!)!.order).toBe(0);
  });

  it(
    '50 bewoners per kant verzamelen, bouwen, wisselen van rol en vechten (fixture s4-rustbelt-fifty)',
    { timeout: 60_000 },
    () => {
      const r = fixture('s4-rustbelt-fifty');
      const peak = [0, 0];
      const peakMilitia = [0, 0];
      const scrapIn = [0, 0];
      const counts = new Map<number, number>();
      play(r, (sim) => {
        for (let k = 0; k < sim.events.count; k++)
          counts.set(sim.events.type[k]!, (counts.get(sim.events.type[k]!) ?? 0) + 1);
        if (sim.frame % 20 !== 0) return;
        for (let p = 0; p < 2; p++) {
          const st = sim.playerStatus(p);
          peak[p] = Math.max(peak[p]!, st.settlers);
          expect(st.settlers).toBeLessThanOrEqual(st.popCap); // geen bewoners buiten de pop-cap om
          peakMilitia[p] = Math.max(peakMilitia[p]!, unitsOf(sim, p, role('militia')).length);
          scrapIn[p] = Math.max(scrapIn[p]!, st.scrap);
        }
      });
      // 50 bewoners per kant, alleen uit huisvestingsgroei (pop-cap 50: hoofdgebouw plus elf woningen)
      expect(peak).toEqual([50, 50]);
      // verzameld (de scrap steeg ver boven de startScrap), gebouwd (werkplaats en elf woningen per kant)
      for (let p = 0; p < 2; p++) expect(scrapIn[p]).toBeGreaterThan(1000);
      expect(counts.get(EVENT_TYPE.buildingDone) ?? 0).toBeGreaterThanOrEqual(24);
      // van rol gewisseld (bouwers en 20 militie per kant) en gevochten
      for (let p = 0; p < 2; p++) expect(peakMilitia[p]).toBeGreaterThanOrEqual(20);
      expect(counts.get(EVENT_TYPE.shotFired) ?? 0).toBeGreaterThan(200);
      expect(counts.get(EVENT_TYPE.death) ?? 0).toBeGreaterThanOrEqual(40);
    },
  );

  it(
    'turrets schieten en de AI onderzoekt voor zijn turret (fixture s4-rustbelt-turrets)',
    { timeout: 60_000 },
    () => {
      const r = fixture('s4-rustbelt-turrets');
      const turret = building('turret');
      const owner = new Map<number, number>();
      const shots = [0, 0];
      const placedAt = [-1, -1];
      const researchedAt = [-1, -1];
      const geweerrek = gameData().data.tech.find((t) => t.key === 'geweerrek')!.id;
      let zones = 0;
      const sim = play(r, (s) => {
        for (let k = 0; k < s.events.count; k++) {
          const t = s.events.type[k]!;
          const a = s.events.a[k]!;
          if (t === EVENT_TYPE.buildingPlaced && s.events.b[k] === turret) {
            const o = s.getUnit(a)!.owner;
            owner.set(a, o);
            if (placedAt[o]! < 0) placedAt[o] = s.frame;
          }
          if (t === EVENT_TYPE.shotFired && owner.has(a)) shots[owner.get(a)!]!++;
          if (t === EVENT_TYPE.abilityZone) zones++;
        }
        for (let p = 0; p < 2; p++)
          if (researchedAt[p]! < 0 && s.researched(p).includes(geweerrek))
            researchedAt[p] = s.frame;
      });
      // de AI (speler 1) onderzocht geweerrek en bouwde daarna de turret
      expect(researchedAt[1]).toBeGreaterThan(0);
      expect(placedAt[1]).toBeGreaterThanOrEqual(researchedAt[1]!);
      expect(shots[0]).toBeGreaterThan(0);
      expect(shots[1]).toBeGreaterThan(0);
      expect(zones).toBeGreaterThan(0);
      const laser = gameData().data.tech.find((t) => t.key === 'lasergeleiding')!.id;
      expect(sim.researched(0)).toContain(laser);
    },
  );

  it(
    'winroute B: de bot houdt drie punten tegen de raids van de AI en wint op dominantie (fixture s6-rustbelt-dominance)',
    { timeout: 60_000 },
    () => {
      const r = fixture('s6-rustbelt-dominance');
      const required = mapGrid('rustbelt').def.dominance.minutes * 1200;
      const centre = centrePoint(createReplaySim(r));
      let prev = 0;
      let raidShots = 0;
      let lastStatus: ReturnType<Sim['playerStatus']>[] = [];
      const sim = play(r, (s) => {
        if (s.winner() === null) {
          // de HUD-klok: elke tick een verder of terug naar 0, nooit een sprong
          const d = s.playerStatus(0).dominance!;
          expect(d.ticksHeld === prev + 1 || d.ticksHeld === 0).toBe(true);
          expect(d.ticksRequired).toBe(required);
          prev = d.ticksHeld;
          lastStatus = [0, 1].map((p) => s.playerStatus(p));
        }
        for (let k = 0; k < s.events.count; k++) {
          if (s.events.type[k] !== EVENT_TYPE.shotFired) continue;
          const u = s.getUnit(s.events.a[k]!);
          if (u?.owner === 1 && (u.x - centre.x) ** 2 + (u.y - centre.y) ** 2 < (15 * 256) ** 2)
            raidShots++;
        }
      });
      expect(sim.winner()).toMatchObject({ playerId: 0, reason: 'dominance' });
      // in de tick van de winst bereikt de klok ticksRequired; daarvoor stond hij er één onder
      const won = sim.playerStatus(0).dominance!;
      expect(won.ticksHeld).toBe(required);
      expect(won.pointsHeld).toBeGreaterThanOrEqual(won.pointsRequired);
      expect(lastStatus[0]!.dominance!.ticksHeld).toBe(required - 1);
      // de AI ziet de bot als leider, houdt zelf minder punten dan nodig en raidde het midden
      const ai = lastStatus[1]!.dominance!;
      expect(ai.pointsHeld).toBeGreaterThanOrEqual(1);
      expect(ai.pointsHeld).toBeLessThan(ai.pointsRequired);
      expect(ai.leader).toEqual({
        playerId: 0,
        pointsHeld: lastStatus[0]!.dominance!.pointsHeld,
        ticksHeld: required - 1,
      });
      expect(ai.leader!.pointsHeld).toBeGreaterThanOrEqual(ai.pointsRequired);
      expect(raidShots).toBeGreaterThan(0);
    },
  );

  // REPLAY_FAST=1 slaat dit potje over (ongeveer 9 s); CI en een gewone `pnpm test` draaien het altijd
  it.skipIf(process.env.REPLAY_FAST === '1')(
    'scripted AI tegen scripted AI levert een winnaar',
    { timeout: 60_000 },
    () => {
      const env = buildEnv('rustbelt', lobby(true), settings);
      const sim = createSim({ seed: 42, ...env });
      const limit = 42_000; // 35 minuten speeltijd (Spelfundament 2.6; de lengte per seed staat in match-length.test.ts)
      const claims = [0, 0];
      let lockdowns = 0;
      let turretShots = 0;
      const turret = building('turret');
      // geen leger dat blijft hangen: per unit op AttackMove zonder doel de laatste plek en het frame waarop hij daar
      // was; wie in een minuut geen 2 m verder komt, hangt (bijvoorbeeld voor de rivier of kop op kop met een ander)
      const still = new Map<number, { x: number; y: number; f: number }>();
      let longestStill = 0;
      for (let f = 0; f < limit && sim.winner() === null; f++) {
        sim.applyBundle({ frame: f, commands: [] });
        sim.tick();
        if (f % 100 === 0) {
          for (const id of sim.entityIds()) {
            const u = sim.getUnit(id)!;
            if (
              (u.kind !== 'unit' && u.kind !== 'hero') ||
              u.order !== ORDER_ATTACK_MOVE ||
              u.target !== 0
            ) {
              still.delete(id);
              continue;
            }
            const s = still.get(id);
            if (s === undefined || (u.x - s.x) ** 2 + (u.y - s.y) ** 2 > (2 * 256) ** 2)
              still.set(id, { x: u.x, y: u.y, f });
            else longestStill = Math.max(longestStill, f - s.f);
          }
        }
        for (let k = 0; k < sim.events.count; k++) {
          if (sim.events.type[k] === EVENT_TYPE.claimTaken && sim.events.b[k]! < 2)
            claims[sim.events.b[k]!]!++;
          if (
            sim.events.type[k] === EVENT_TYPE.shotFired &&
            sim.getUnit(sim.events.a[k]!)?.typeId === turret
          )
            turretShots++;
        }
        for (let p = 0; p < 2; p++)
          if (sim.ps.zoneTicks[p * 4] === env.config.heroes[0]!.abilities[0]!.durationTicks - 1)
            lockdowns++;
      }
      const w = sim.winner();
      expect(w).not.toBeNull();
      expect(w!.frame).toBeLessThan(limit);
      expect(longestStill).toBeLessThan(1200);
      // de AI bouwt claimpalen en zijn held gebruikt Lockdown
      expect(claims[0]! > 0 && claims[1]! > 0).toBe(true);
      expect(lockdowns).toBeGreaterThan(0);
      // beide AI's onderzoeken geweerrek en hun turrets schieten (besluit 8)
      const geweerrek = gameData().data.tech.find((t) => t.key === 'geweerrek')!.id;
      for (let p = 0; p < 2; p++) expect(sim.researched(p)).toContain(geweerrek);
      expect(turretShots).toBeGreaterThan(0);
      for (let p = 0; p < 2; p++) expect(sim.playerStatus(p).hero).not.toBeNull();
      // de AI zit in de sim: een andere seed geeft vanaf frame 0 een andere hash (sim.rng: kritieke schoten van de held
      // en de jitter op de golven van de AI)
      const other = createSim({ seed: 43, ...env });
      expect(other.hash()).not.toBe(createSim({ seed: 42, ...env }).hash());
    },
  );
});

import { describe, expect, it } from 'vitest';
import { ROLES, buildingTypeId } from '@crawlout/data';
import { EVENT_TYPE } from '@crawlout/protocol';
import type { CommandEnvelope, LobbyPlayer } from '@crawlout/protocol';
import { createSim, deserialize } from '@crawlout/sim';
import type { Sim } from '@crawlout/sim';
import { buildEnv, gameData } from './env.js';

// Eindcriterium van de sim-core-brief op de slice-map Rustbelt, met de echte data:
//  - 50 bewoners per kant verzamelen, bouwen, wisselen van rol en vechten;
//  - de scripted AI tegen zichzelf levert een winnaar binnen een redelijk aantal ticks.

const lobby = (ai: boolean): LobbyPlayer[] =>
  [0, 1].map((i) => ({ playerId: i, name: `p${i}`, faction: 'dwellers', ready: true, online: !ai, ai }));
const settings = { mode: 'skirmish' as const, delayFrames: 4 };
const cell = (cx: number, cy: number): { x: number; y: number } => ({ x: cx * 256 + 128, y: cy * 256 + 128 });
const role = (name: 'scavenger' | 'builder' | 'militia'): number => ROLES.indexOf(name);
const building = (key: string): number => buildingTypeId(gameData().data.buildings.find((b) => b.key === key)!.id);

function unitsOf(sim: Sim, owner: number, r?: number): number[] {
  return sim.entityIds().filter((id) => {
    const u = sim.getUnit(id)!;
    return u.kind === 'unit' && u.owner === owner && (r === undefined || u.role === r);
  });
}

function chunks(ids: readonly number[]): number[][] {
  const out: number[][] = [];
  for (let k = 0; k < ids.length; k += 64) out.push(ids.slice(k, k + 64));
  return out;
}

describe('slice: Rustbelt met echte data', () => {
  it('50 bewoners per kant verzamelen, bouwen, wisselen van rol en vechten', () => {
    const env = buildEnv('rustbelt', lobby(false), settings);
    const sim = createSim({ seed: 2026, ...env });
    const scavType = env.config.factions[0]!.roleTypeIds[role('scavenger')]!;
    const spawns = [cell(20, 20), cell(107, 107)];
    const dir = [1, -1];
    // aanvullen tot 50 bewoners per kant (buiten de pop-cap om; dit is een testharnas)
    for (let p = 0; p < 2; p++) {
      const have = unitsOf(sim, p).length;
      for (let k = 0; have + k < 50; k++) {
        const c = cell(20 + dir[p]! * (6 + (k % 8)), 20 + dir[p]! * (10 + Math.floor(k / 8)));
        const at = p === 0 ? c : { x: 127 * 256 - c.x, y: 127 * 256 - c.y };
        expect(sim.spawnUnit({ typeId: scavType, owner: p, ...at })).not.toBe(0);
      }
      sim.setScrap(p, 2000);
      expect(sim.playerStatus(p).settlers).toBe(50);
    }
    const nodes = sim.entityIds().filter((id) => sim.getUnit(id)!.kind === 'scrapNode');
    let seq = 0;
    const script = new Map<number, CommandEnvelope[]>();
    const add = (f: number, playerId: number, type: CommandEnvelope['type'], payload: unknown): void => {
      const list = script.get(f) ?? [];
      list.push({ frame: f, playerId, seq: seq++, type, payload });
      script.set(f, list);
    };
    for (let p = 0; p < 2; p++) {
      const scav = unitsOf(sim, p, role('scavenger'));
      // de drie nodes aan de eigen kant, verdeeld over de scavengers
      const own = nodes
        .map((id) => ({ id, u: sim.getUnit(id)! }))
        .sort((a, b) => (a.u.x - spawns[p]!.x) ** 2 + (a.u.y - spawns[p]!.y) ** 2 - ((b.u.x - spawns[p]!.x) ** 2 + (b.u.y - spawns[p]!.y) ** 2) || a.id - b.id)
        .slice(0, 3);
      for (let k = 0; k < 3; k++) add(0, p, 'Gather', { ids: scav.filter((_, j) => j % 3 === k), nodeId: own[k]!.id });
      const b = unitsOf(sim, p, role('builder'));
      add(1, p, 'Build', { ids: b, typeId: building('werkplaats'), ...(p === 0 ? cell(30, 18) : cell(97, 109)) });
      add(800, p, 'Build', { ids: b, typeId: building('woning'), ...(p === 0 ? cell(18, 30) : cell(109, 97)) });
    }

    const counts = new Map<number, number>();
    const scrapBefore = [sim.playerStatus(0).scrap, sim.playerStatus(1).scrap];
    let switched = false;
    let attacked = false;
    const run = (frames: number): void => {
      for (let n = 0; n < frames; n++) {
        const f = sim.frame;
        sim.applyBundle({ frame: f, commands: script.get(f) ?? [] });
        sim.tick();
        for (let k = 0; k < sim.events.count; k++) counts.set(sim.events.type[k]!, (counts.get(sim.events.type[k]!) ?? 0) + 1);
        // zodra de werkplaats er staat: 20 scavengers per kant worden militie
        if (!switched && [0, 1].every((p) => sim.entityIds().some((id) => {
          const u = sim.getUnit(id)!;
          return u.kind === 'building' && u.owner === p && u.typeId === building('werkplaats') && u.buildState === 2;
        }))) {
          switched = true;
          for (let p = 0; p < 2; p++) add(sim.frame, p, 'SetRole', { ids: unitsOf(sim, p, role('scavenger')).slice(0, 20), role: 'militia' });
        }
        // zodra beide kanten 20 militie hebben: aanval naar de spawn van de ander
        if (switched && !attacked && [0, 1].every((p) => unitsOf(sim, p, role('militia')).length >= 20)) {
          attacked = true;
          for (let p = 0; p < 2; p++) for (const ids of chunks(unitsOf(sim, p, role('militia')))) add(sim.frame, p, 'AttackMove', { ids, ...spawns[1 - p]! });
        }
      }
    };
    run(1500);
    expect(switched).toBe(true);
    const mid = deserialize(sim.serialize(), env);
    expect(mid.hash()).toBe(sim.hash());
    run(3000);
    expect(attacked).toBe(true);
    // verzameld: scrap kwam binnen (uitgaven aan gebouwen en omscholen terug opgeteld)
    const wp = gameData().data.buildings.find((b) => b.key === 'werkplaats')!.scrapCost;
    const wn = gameData().data.buildings.find((b) => b.key === 'woning')!.scrapCost;
    const ml = gameData().data.loadouts.find((l) => l.key === 'militie')!.scrapCost;
    for (let p = 0; p < 2; p++) expect(sim.playerStatus(p).scrap + wp + wn + 20 * ml).toBeGreaterThan(scrapBefore[p]! + 200);
    expect(counts.get(EVENT_TYPE.buildingDone) ?? 0).toBeGreaterThanOrEqual(4);
    expect(counts.get(EVENT_TYPE.shotFired) ?? 0).toBeGreaterThan(50);
    expect(counts.get(EVENT_TYPE.death) ?? 0).toBeGreaterThan(5);
  });

  it('scripted AI tegen scripted AI levert een winnaar', () => {
    const env = buildEnv('rustbelt', lobby(true), settings);
    const sim = createSim({ seed: 42, ...env });
    const limit = 36_000; // 30 minuten speeltijd
    for (let f = 0; f < limit && sim.winner() === null; f++) {
      sim.applyBundle({ frame: f, commands: [] });
      sim.tick();
    }
    const w = sim.winner();
    expect(w).not.toBeNull();
    expect(w!.frame).toBeLessThan(limit);
    // de AI zit in de sim: een andere seed geeft dezelfde partij (de sim gebruikt nog geen toeval), andere hash
    const other = createSim({ seed: 43, ...env });
    expect(other.hash()).not.toBe(createSim({ seed: 42, ...env }).hash());
  });
});

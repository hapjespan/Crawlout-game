import { describe, expect, it } from 'vitest';
import { EVENT_TYPE, OWNER_NEUTRAL } from '@crawlout/protocol';
import type { CommandEnvelope } from '@crawlout/protocol';
import { createSim, deserialize } from '../src/index.js';
import type { Sim } from '../src/index.js';
import { cellCenter, createOpenMap } from '../src/testing.js';
import {
  CONFIG,
  DATA,
  MILITIA,
  REAL_CONFIG,
  SCAV,
  bundle,
  cmd,
  envOf,
  testInit,
  typeByKey,
} from './helpers.js';

// De held (Opziener): spawn, stats uit SPECIAL, xp en levels, perks, Lockdown, dood en oplappen.

const HERO = CONFIG.heroes[0]!;
const SP = CONFIG.special;
const milType = CONFIG.unitTypes.find((u) => u.typeId === MILITIA)!;
const perkByKey = (key: string): number => DATA.perks.find((p) => p.key === key)!.id;
const idiv = (a: number, b: number): number => Math.trunc(a / b);
const S = HERO.special;

function play(
  sim: Sim,
  frames: number,
  script: Map<number, CommandEnvelope[]> = new Map(),
): { type: number; a: number; b: number }[] {
  const events: { type: number; a: number; b: number }[] = [];
  for (let n = 0; n < frames; n++) {
    const f = sim.frame;
    sim.applyBundle(bundle(f, script.get(f) ?? []));
    sim.tick();
    for (let k = 0; k < sim.events.count; k++)
      events.push({ type: sim.events.type[k]!, a: sim.events.a[k]!, b: sim.events.b[k]! });
  }
  return events;
}
const at = (frame: number, ...cmds: CommandEnvelope[]): Map<number, CommandEnvelope[]> =>
  new Map([[frame, cmds]]);
const heroOf = (sim: Sim, p: number): number =>
  sim.entityIds().find((id) => sim.getUnit(id)!.kind === 'hero' && sim.getUnit(id)!.owner === p) ??
  0;
const hqOf = (sim: Sim, p: number): number =>
  sim
    .entityIds()
    .find((id) => sim.getUnit(id)!.kind === 'building' && sim.getUnit(id)!.owner === p)!;
const open = (seed: number): Sim => createSim(testInit(seed, createOpenMap(64, 64)));

/** Laat een groep vijandelijke militie de held van p doodschieten. */
function killHero(sim: Sim, p: number): void {
  const h = sim.getUnit(heroOf(sim, p))!;
  const army = [0, 1, 2, 3, 4, 5, 6, 7].map((k) =>
    sim.spawnUnit({ typeId: MILITIA, owner: 1 - p, x: h.x + 5 * 256, y: h.y + (k - 4) * 200 }),
  );
  for (
    let n = 0;
    n < 600 && sim.playerStatus(p).hero!.revivesLeft !== undefined && heroOf(sim, p) !== 0;
    n++
  ) {
    play(
      sim,
      1,
      n === 0
        ? at(sim.frame, cmd(sim.frame, 1 - p, 'Attack', { ids: army, target: heroOf(sim, p) }))
        : new Map(),
    );
  }
  for (const id of army) sim.destroyEntity(id);
}

describe('held', () => {
  it('spawnt naast het hoofdgebouw met stats uit het militie-loadout plus SPECIAL', () => {
    const sim = open(40);
    const h = sim.getUnit(heroOf(sim, 0))!;
    expect(h).toMatchObject({ kind: 'hero', typeId: HERO.typeId, owner: 0, role: milType.role });
    const maxHp = idiv(milType.maxHp * (1000 + S[2]! * SP.enduranceHpPermille), 1000);
    expect(h).toMatchObject({ hp: maxHp, maxHp });
    expect(sim.playerStatus(0).hero).toMatchObject({
      heroId: HERO.heroId,
      level: 1,
      xp: 0,
      pendingPerks: 0,
      revivesLeft: HERO.maxRevives,
      special: [...S],
    });
    // de held telt niet als bewoner
    expect(sim.playerStatus(0).settlers).toBe(
      DATA.factions[0]!.startUnits.reduce((n, u) => n + u.count, 0),
    );
  });

  it('xp per kill en per ontdekking; een level geeft een perk-keuze en heroLevel', () => {
    const sim = open(41);
    const hero = heroOf(sim, 0);
    // alleen de held schiet: de startunits van speler 0 weg
    for (const id of sim.entityIds())
      if (sim.getUnit(id)!.kind === 'unit' && sim.getUnit(id)!.owner === 0) sim.destroyEntity(id);
    const h = sim.getUnit(hero)!;
    for (let k = 0; k < 10; k++)
      sim.spawnUnit({
        typeId: SCAV,
        owner: 1,
        x: h.x + 4 * 256 + (k % 5) * 100,
        y: h.y + (k >> 1) * 60,
      });
    const ev = play(sim, 2000);
    // de held is militie: hij kiest zelf een doel en schiet de scavengers neer
    const xp = 10 * HERO.xpPerKill;
    expect(sim.playerStatus(0).hero!.xp).toBe(xp);
    // level uit de drempels: 1 plus het aantal gehaalde drempels; elk level één perk-keuze en één heroLevel-event
    const level = 1 + HERO.xpThresholds.filter((t) => t <= xp).length;
    expect(level).toBeGreaterThan(1);
    expect(sim.playerStatus(0).hero).toMatchObject({
      level,
      pendingPerks: level - 1,
      xpNext: HERO.xpThresholds[level - 1],
    });
    const levels = Array.from({ length: level - 1 }, (_, k) => ({
      type: EVENT_TYPE.heroLevel,
      a: hero,
      b: k + 2,
    }));
    expect(ev.filter((e) => e.type === EVENT_TYPE.heroLevel)).toEqual(levels);
    // ontdekking: een claimpunt voor het eerst nemen
    const pt = sim.entityIds().find((id) => sim.getUnit(id)!.kind === 'claimPoint')!;
    const v = sim.getUnit(pt)!;
    sim.spawnBuilding(typeByKey('claimpaal'), 0, (v.x >> 8) + 1, v.y >> 8);
    play(sim, 1);
    expect(sim.getUnit(pt)!.owner).toBe(0);
    expect(sim.playerStatus(0).hero!.xp).toBe(10 * HERO.xpPerKill + HERO.xpPerDiscovery);
  });

  it('xp per assist: een vijand die een eigen unit binnen xpAssistRadius van de held doodt, verder weg niets', () => {
    const sim = open(44);
    const hero = heroOf(sim, 0);
    for (const id of sim.entityIds()) if (sim.getUnit(id)!.kind === 'unit') sim.destroyEntity(id);
    const h = sim.getUnit(hero)!;
    const r = HERO.xpAssistRadius;
    expect(r).toBeGreaterThan(CONFIG.aggroRange + 256); // anders schiet de held zelf
    // binnen de straal maar buiten het aggro-bereik van de held: de eigen militie schiet
    const near = { x: h.x + CONFIG.aggroRange + 3 * 256, y: h.y };
    expect(near.x - h.x).toBeLessThan(r);
    const a = sim.spawnUnit({ typeId: SCAV, owner: 1, ...near });
    sim.spawnUnit({ typeId: MILITIA, owner: 0, x: near.x + 3 * 256, y: near.y });
    // buiten de straal
    const far = { x: h.x, y: h.y + r + 6 * 256 };
    const b = sim.spawnUnit({ typeId: SCAV, owner: 1, ...far });
    sim.spawnUnit({ typeId: MILITIA, owner: 0, x: far.x, y: far.y + 3 * 256 });
    play(sim, 400);
    expect([sim.getUnit(a), sim.getUnit(b)]).toEqual([null, null]);
    expect(sim.playerStatus(0).hero!.xp).toBe(HERO.xpPerAssist);
  });

  it('PickPerk: alleen met een open keuze, uit de perkPool, met genoeg SPECIAL; het effect geldt meteen', () => {
    const sim = open(42);
    const hero = heroOf(sim, 0);
    const laarzen = perkByKey('zware_laarzen');
    const pick = (perkId: number, heroId = HERO.heroId): void =>
      void play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'PickPerk', { heroId, perkId })));
    pick(laarzen); // geen open keuze
    expect(sim.playerStatus(0).hero!.perks).toEqual([]);
    sim.ps.heroPending[0] = 2;
    pick(laarzen, HERO.heroId + 1); // andere held
    expect(sim.playerStatus(0).hero!.perks).toEqual([]);
    pick(laarzen);
    expect(sim.playerStatus(0).hero).toMatchObject({ perks: [laarzen], pendingPerks: 1 });
    const boosted = idiv(milType.maxHp * (1000 + S[2]! * SP.enduranceHpPermille + 100), 1000);
    expect(sim.getUnit(hero)).toMatchObject({ maxHp: boosted, hp: boosted });
    pick(laarzen); // al gekozen
    expect(sim.playerStatus(0).hero!.pendingPerks).toBe(1);
  });

  it('Lockdown: vijanden in de straal trager, eigen units meer schade, cooldown en duur uit de data', () => {
    const run = (cast: boolean): { moved: number; dealt: number; ok: boolean } => {
      const sim = open(43);
      const h = sim.getUnit(heroOf(sim, 0))!;
      const enemy = sim.spawnUnit({ typeId: SCAV, owner: 1, x: h.x + 2 * 256, y: h.y + 3 * 256 });
      // de held staat oost van het hoofdgebouw: doel en bondgenoot aan de open kant
      const target = sim.spawnUnit({
        typeId: typeByKey('scavenger'),
        owner: 1,
        x: h.x + 3 * 256,
        y: h.y - 2 * 256,
      });
      const ally = sim.spawnUnit({ typeId: MILITIA, owner: 0, x: h.x + 3 * 256, y: h.y + 256 });
      const goal = cellCenter(60, 60);
      const cmds = [
        cmd(sim.frame, 1, 'Move', { ids: [enemy], ...goal }),
        cmd(sim.frame, 0, 'Attack', { ids: [ally], target }),
      ];
      if (cast)
        cmds.push(
          cmd(sim.frame, 0, 'HeroAbility', { heroId: HERO.heroId, abilityId: 0, x: h.x, y: h.y }),
        );
      const x0 = sim.getUnit(enemy)!.x;
      const hp0 = sim.getUnit(target)!.hp;
      play(sim, 10, at(sim.frame, ...cmds));
      // de zone loopt durationTicks; een tweede cast in de cooldown doet niets
      const zoneOk = !cast || sim.ps.zoneTicks[0] === HERO.abilities[0]!.durationTicks - 10;
      const result = { moved: sim.getUnit(enemy)!.x - x0, dealt: hp0 - sim.getUnit(target)!.hp };
      if (cast)
        play(
          sim,
          1,
          at(sim.frame, cmd(sim.frame, 0, 'HeroAbility', { heroId: HERO.heroId, abilityId: 0 })),
        );
      return {
        ...result,
        ok: zoneOk && sim.ps.abCooldown[0] === (cast ? HERO.abilities[0]!.cooldownTicks - 11 : 0),
      };
    };
    const plain = run(false);
    const locked = run(true);
    expect(plain.ok && locked.ok).toBe(true);
    expect(locked.moved).toBeLessThan(plain.moved);
    expect(locked.dealt).toBeGreaterThan(plain.dealt);
    // out of rangeU (data 0.18.0): not cast on the spot; the hero walks into range first (placement.test.ts)
    const sim = open(44);
    play(
      sim,
      1,
      at(0, cmd(0, 0, 'HeroAbility', { heroId: HERO.heroId, abilityId: 0, ...cellCenter(60, 60) })),
    );
    expect(sim.ps.abCooldown[0]).toBe(0);
    expect(sim.getUnit(heroOf(sim, 0))!.moving).toBe(true);
  });

  it('dood: perks vallen weg; Recruit op het hoofdgebouw lapt hem op met revivePenalty op health en perks', () => {
    const sim = open(45);
    const kluisvet = perkByKey('kluisvet'); // turrets +10% hp
    sim.ps.heroPending[0] = 1;
    play(sim, 1, at(0, cmd(0, 0, 'PickPerk', { heroId: HERO.heroId, perkId: kluisvet })));
    sim.ps.tech[0] = 1 << CONFIG.techs.findIndex((t) => DATA.tech[t.techId]!.key === 'geweerrek');
    const turretType = CONFIG.buildingTypes.find((b) => b.typeId === typeByKey('turret'))!;
    const turret = sim.spawnBuilding(turretType.typeId, 0, 4, 30);
    play(sim, 1);
    expect(sim.getUnit(turret)!.maxHp).toBe(idiv(turretType.maxHp * 1100, 1000));
    killHero(sim, 0);
    expect(heroOf(sim, 0)).toBe(0);
    expect(sim.getUnit(turret)!.maxHp).toBe(turretType.maxHp);
    expect(sim.playerStatus(0).hero).toMatchObject({
      perks: [kluisvet],
      revivesLeft: HERO.maxRevives,
    });
    // oplappen: kosten meteen, na reviveTicks naast het hoofdgebouw
    sim.setScrap(0, HERO.reviveScrap + 5);
    const hq = hqOf(sim, 0);
    play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'Recruit', { buildingId: hq })));
    expect(sim.playerStatus(0).scrap).toBe(5);
    play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'Recruit', { buildingId: hq }))); // loopt al
    expect(sim.playerStatus(0).scrap).toBe(5);
    play(sim, HERO.reviveTicks);
    const hero = heroOf(sim, 0);
    expect(hero).not.toBe(0);
    const scale = 1000 - HERO.revivePenaltyPermille;
    const full = idiv(milType.maxHp * (1000 + S[2]! * SP.enduranceHpPermille), 1000);
    expect(sim.getUnit(hero)).toMatchObject({
      maxHp: idiv(full * scale, 1000),
      hp: idiv(full * scale, 1000),
    });
    expect(sim.playerStatus(0).hero!.revivesLeft).toBe(HERO.maxRevives - 1);
    // perks weer actief, met 20% minder effect
    expect(sim.getUnit(turret)!.maxHp).toBe(
      idiv(turretType.maxHp * (1000 + idiv(100 * scale, 1000)), 1000),
    );
  });

  it('Cancel op het hoofdgebouw stopt het oplappen met teruggave; na maxRevives is de held leeg', () => {
    const sim = open(46);
    killHero(sim, 0);
    sim.setScrap(0, HERO.reviveScrap);
    const hq = hqOf(sim, 0);
    play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'Recruit', { buildingId: hq })));
    play(sim, 5, at(sim.frame, cmd(sim.frame, 0, 'Cancel', { ids: [hq] })));
    expect(sim.playerStatus(0).scrap).toBe(
      idiv(HERO.reviveScrap * CONFIG.cancelRefundPermille, 1000),
    );
    play(sim, HERO.reviveTicks);
    expect(heroOf(sim, 0)).toBe(0);
    // laatste keer oplappen gebruikt: de volgende dood maakt hem leeg
    sim.setScrap(0, HERO.reviveScrap);
    sim.ps.heroRevives[0] = HERO.maxRevives - 1;
    play(
      sim,
      HERO.reviveTicks + 1,
      at(sim.frame, cmd(sim.frame, 0, 'Recruit', { buildingId: hq })),
    );
    expect(sim.playerStatus(0).hero!.revivesLeft).toBe(0);
    killHero(sim, 0);
    expect(sim.playerStatus(0).hero!.revivesLeft).toBe(0);
    sim.setScrap(0, 1000);
    play(
      sim,
      HERO.reviveTicks + 5,
      at(sim.frame, cmd(sim.frame, 0, 'Recruit', { buildingId: hq })),
    );
    expect(heroOf(sim, 0)).toBe(0);
    expect(sim.playerStatus(0).scrap).toBe(1000);
  });

  it('HeroStatus: state, reviveTicksLeft, entityId en abilityCooldownTicks volgen de held (besluit 1, sprint 4)', () => {
    const sim = open(48);
    const ab = HERO.abilities[0]!;
    expect(sim.playerStatus(0).hero).toMatchObject({
      state: 'alive',
      entityId: heroOf(sim, 0),
      reviveTicksLeft: 0,
      abilityCooldownTicks: [0],
    });
    play(
      sim,
      1,
      at(sim.frame, cmd(sim.frame, 0, 'HeroAbility', { heroId: HERO.heroId, abilityId: 0 })),
    );
    play(sim, 10);
    expect(sim.playerStatus(0).hero!.abilityCooldownTicks).toEqual([ab.cooldownTicks - 11]);
    killHero(sim, 0);
    expect(sim.playerStatus(0).hero).toMatchObject({
      state: 'dead',
      entityId: 0,
      reviveTicksLeft: 0,
    });
    sim.setScrap(0, HERO.reviveScrap);
    play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'Recruit', { buildingId: hqOf(sim, 0) })));
    play(sim, 5);
    expect(sim.playerStatus(0).hero).toMatchObject({
      state: 'reviving',
      entityId: 0,
      reviveTicksLeft: HERO.reviveTicks - 6,
    }); // de Recruit-tick telt al mee
    play(sim, HERO.reviveTicks);
    const back = heroOf(sim, 0);
    expect(back).not.toBe(0);
    expect(sim.playerStatus(0).hero).toMatchObject({
      state: 'alive',
      entityId: back,
      reviveTicksLeft: 0,
    });
    sim.ps.heroRevives[0] = HERO.maxRevives;
    killHero(sim, 0);
    expect(sim.playerStatus(0).hero).toMatchObject({ state: 'empty', entityId: 0, revivesLeft: 0 });
  });

  it('serialize/deserialize midden in een Lockdown en een oplap-timer: zelfde hash, zelfde vervolg', () => {
    const init = testInit(47, createOpenMap(64, 64));
    const sim = createSim(init);
    const h = sim.getUnit(heroOf(sim, 1))!;
    sim.spawnUnit({ typeId: SCAV, owner: 0, x: h.x - 3 * 256, y: h.y });
    play(sim, 1, at(0, cmd(0, 1, 'HeroAbility', { heroId: HERO.heroId, abilityId: 0 })));
    killHero(sim, 0);
    sim.setScrap(0, HERO.reviveScrap);
    play(sim, 3, at(sim.frame, cmd(sim.frame, 0, 'Recruit', { buildingId: hqOf(sim, 0) })));
    const copy = deserialize(sim.serialize(), envOf(init));
    expect(copy.hash()).toBe(sim.hash());
    for (let n = 0; n < HERO.reviveTicks + 20; n++) {
      sim.applyBundle(bundle(sim.frame));
      copy.applyBundle(bundle(copy.frame));
      expect(copy.tick()).toBe(sim.tick());
    }
    expect(heroOf(copy, 0)).not.toBe(0);
    expect(
      copy.getUnit(sim.entityIds().find((id) => sim.getUnit(id)!.kind === 'claimPoint')!)!.owner,
    ).toBe(OWNER_NEUTRAL);
  });
});

describe('HeroAbility out of range (data 0.18.0): walk into range, then cast', () => {
  const AB = HERO.abilities[0]!;
  const ORDER_CAST = 8;
  const zoneEvents = (ev: { type: number; a: number; b: number }[]) =>
    ev.filter((e) => e.type === EVENT_TYPE.abilityZone);

  it('a point: the hero walks, casts as soon as it is within rangeU, and the cooldown starts then', () => {
    const sim = open(44);
    const hero = heroOf(sim, 0);
    const goal = cellCenter(40, 40);
    const ev0 = play(
      sim,
      1,
      at(0, cmd(0, 0, 'HeroAbility', { heroId: HERO.heroId, abilityId: 0, ...goal })),
    );
    expect(zoneEvents(ev0)).toEqual([]);
    expect(sim.getUnit(hero)).toMatchObject({ order: ORDER_CAST, moving: true });
    let castAt = -1;
    for (let n = 0; n < 1200 && castAt < 0; n++) {
      if (zoneEvents(play(sim, 1)).length > 0) castAt = sim.frame;
    }
    expect(castAt).toBeGreaterThan(20);
    const h = sim.getUnit(hero)!;
    expect(Math.hypot(h.x - goal.x, h.y - goal.y)).toBeLessThanOrEqual(AB.rangeU);
    expect(Math.hypot(h.x - goal.x, h.y - goal.y)).toBeGreaterThan(AB.rangeU - 512);
    expect(h.order).toBe(0);
    expect(sim.ps.zoneX[0]).toBe(goal.x);
    expect(sim.ps.zoneY[0]).toBe(goal.y);
    expect(sim.ps.abCooldown[0]).toBe(AB.cooldownTicks - 1);
  });

  it('a target unit: the hero follows it and the zone lands where the unit is at the cast', () => {
    const sim = open(46);
    const enemy = sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(45, 30) });
    const ev = play(
      sim,
      600,
      at(
        0,
        cmd(0, 1, 'Move', { ids: [enemy], ...cellCenter(45, 50) }),
        cmd(0, 0, 'HeroAbility', { heroId: HERO.heroId, abilityId: 0, target: enemy }),
      ),
    );
    expect(zoneEvents(ev)).toHaveLength(1);
    expect(sim.ps.abCooldown[0]).toBeGreaterThan(0);
  });

  it('refused when the point lies on terrain the hero cannot walk to; a new order cancels the walk', () => {
    const map = createOpenMap(64, 64);
    const passable = new Uint8Array(map.passable);
    for (let y = 0; y < 64; y++) passable[y * 64 + 40] = 0; // a wall from edge to edge
    const sim = createSim(testInit(47, { ...map, passable }));
    const hero = heroOf(sim, 0);
    play(
      sim,
      1,
      at(0, cmd(0, 0, 'HeroAbility', { heroId: HERO.heroId, abilityId: 0, ...cellCenter(50, 20) })),
    );
    expect(sim.getUnit(hero)).toMatchObject({ order: 0, moving: false });
    // reachable: walking; then a Move replaces the cast
    const f = sim.frame;
    play(
      sim,
      1,
      at(f, cmd(f, 0, 'HeroAbility', { heroId: HERO.heroId, abilityId: 0, ...cellCenter(35, 35) })),
    );
    expect(sim.getUnit(hero)!.order).toBe(ORDER_CAST);
    const g = sim.frame;
    const ev = play(sim, 600, at(g, cmd(g, 0, 'Move', { ids: [hero], ...cellCenter(10, 30) })));
    expect(zoneEvents(ev)).toEqual([]);
    expect(sim.ps.abCooldown[0]).toBe(0);
  });

  it('the middle of a building further than rangeU from its edge: the hero gives up instead of walking on the spot', () => {
    // real footprints: the HQ is 21 x 21, so its centre lies more than 10 m from every cell next to it
    const map = { ...createOpenMap(), spawns: [cellCenter(24, 24), cellCenter(103, 103)] };
    const sim = createSim({ ...testInit(48, map), config: REAL_CONFIG });
    const hero = heroOf(sim, 0);
    const hq = sim.getUnit(hqOf(sim, 0))!;
    const ev = play(
      sim,
      60,
      at(0, cmd(0, 0, 'HeroAbility', { heroId: HERO.heroId, abilityId: 0, x: hq.x, y: hq.y })),
    );
    expect(zoneEvents(ev)).toEqual([]);
    expect(sim.getUnit(hero)).toMatchObject({ order: 0, moving: false });
    expect(sim.ps.abCooldown[0]).toBe(0);
  });
});

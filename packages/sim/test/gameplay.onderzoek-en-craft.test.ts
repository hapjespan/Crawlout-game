// Split from gameplay.test.ts to stay under the 5,000-token file limit.
import { describe, it, expect } from 'vitest';
import {
  CONFIG,
  DATA,
  typeByKey,
  testInit,
  BUILDER,
  SCAV,
  cmd,
  heroResearchCost,
  emptySim,
  MILITIA,
} from './helpers.js';
import { createSim, ORDER_CRAFT } from '../src/index.js';
import { cellCenter, createOpenMap } from '../src/testing.js';
import { EVENT_TYPE, ENTITY_NONE } from '@crawlout/protocol';
import { WERKPLAATS, at, kindOf, milType, play, scavType } from './gameplay.helpers.js';

const idivTest = (a: number, b: number): number => Math.trunc(a / b);

describe('onderzoek en craft', () => {
  const techByKey = (key: string) => CONFIG.techs[DATA.tech.find((t) => t.key === key)!.id]!;
  const GEWEERREK = techByKey('geweerrek');
  const PANTSER = techByKey('composiet_pantser');
  const PATROL_LOADOUT = DATA.loadouts.find((l) => l.key === 'patrol')!.id;
  const TURRET = typeByKey('turret');

  it('Research: kosten meteen, researchTicks in de werkplaats, daarna ontgrendelt prereqTech loadouts en gebouwen', () => {
    const sim = createSim(testInit(30));
    sim.setScrap(0, 1000);
    const builder = sim
      .entityIds()
      .find((id) => sim.getUnit(id)!.typeId === BUILDER && sim.getUnit(id)!.owner === 0)!;
    const scav = sim
      .entityIds()
      .find((id) => sim.getUnit(id)!.typeId === SCAV && sim.getUnit(id)!.owner === 0)!;
    const t = cellCenter(16, 14);
    // zonder tech: geen turret en geen patrol; zonder werkplaats: geen onderzoek
    let ev = play(
      sim,
      1,
      at(
        0,
        cmd(0, 0, 'Build', { ids: [builder], typeId: TURRET, ...t }),
        cmd(0, 0, 'Research', { techId: GEWEERREK.techId }),
      ),
    );
    expect(ev.some((e) => e.type === EVENT_TYPE.buildingPlaced)).toBe(false);
    expect(sim.playerStatus(0).scrap).toBe(1000);
    const ws = sim.spawnBuilding(WERKPLAATS, 0, 14, 4);
    play(
      sim,
      1,
      at(sim.frame, cmd(sim.frame, 0, 'Craft', { ids: [scav], loadoutId: PATROL_LOADOUT })),
    );
    expect(sim.getUnit(scav)!.order).toBe(0);
    // een tech met een onvervulde prereqTech kan niet
    play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'Research', { techId: PANTSER.techId })));
    expect(sim.playerStatus(0).scrap).toBe(1000);
    play(
      sim,
      1,
      at(
        sim.frame,
        cmd(sim.frame, 0, 'Research', { techId: GEWEERREK.techId }),
        cmd(sim.frame, 0, 'Research', { techId: GEWEERREK.techId }),
      ),
    );
    expect(sim.playerStatus(0).scrap).toBe(1000 - heroResearchCost(GEWEERREK.scrapCost));
    expect(sim.researched(0)).toEqual([]);
    play(sim, GEWEERREK.researchTicks - 1);
    expect(sim.researched(0)).toEqual([GEWEERREK.techId]);
    expect(sim.getUnit(ws)!.buildState).toBe(2);
    ev = play(
      sim,
      1,
      at(sim.frame, cmd(sim.frame, 0, 'Build', { ids: [builder], typeId: TURRET, ...t })),
    );
    expect(ev.some((e) => e.type === EVENT_TYPE.buildingPlaced && e.b === TURRET)).toBe(true);
    play(
      sim,
      1,
      at(sim.frame, cmd(sim.frame, 0, 'Craft', { ids: [scav], loadoutId: PATROL_LOADOUT })),
    );
    expect(sim.getUnit(scav)!.order).toBe(ORDER_CRAFT);
    // speler 1 heeft de tech niet
    expect(sim.researched(1)).toEqual([]);
  });

  it('PlayerStatus.queue: onderzoek op het gebouw, omscholing op de bewoner (onderweg zonder gebouw), oplopend; Cancel op de bewoner geeft terug', () => {
    const sim = createSim({ ...testInit(32), config: { ...CONFIG, cancelRefundPermille: 500 } });
    for (const id of sim.entityIds())
      if (
        sim.getUnit(id)!.kind === 'unit' &&
        sim.getUnit(id)!.owner === 0 &&
        sim.getUnit(id)!.typeId !== SCAV
      )
        sim.destroyEntity(id);
    const ws = sim.spawnBuilding(WERKPLAATS, 0, 14, 4);
    sim.setScrap(0, 1000);
    const scavs = sim
      .entityIds()
      .filter((id) => sim.getUnit(id)!.typeId === SCAV && sim.getUnit(id)!.owner === 0);
    expect(sim.playerStatus(0).queue).toEqual([]);
    play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'Research', { techId: GEWEERREK.techId })));
    let q = sim.playerStatus(0).queue!;
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({
      kind: 'research',
      buildingId: ws,
      unitId: ENTITY_NONE,
      id: GEWEERREK.techId,
    });
    expect(q[0]!.progressPermille).toBeLessThan(10); // één tick werk in het frame van het commando
    play(sim, GEWEERREK.researchTicks >> 1);
    q = sim.playerStatus(0).queue!;
    expect(q[0]!.progressPermille).toBeGreaterThan(400);
    expect(q[0]!.progressPermille).toBeLessThan(600);
    play(sim, GEWEERREK.researchTicks);
    expect(sim.playerStatus(0).queue).toEqual([]);
    // twee bewoners craften patrol: eerst onderweg (buildingId ENTITY_NONE, 0 promille), dan bij de werkplaats
    const patrol = CONFIG.unitTypes.find((u) => u.loadoutId === PATROL_LOADOUT)!;
    const [a, b] = [scavs[0]!, scavs[1]!];
    play(
      sim,
      1,
      at(sim.frame, cmd(sim.frame, 0, 'Craft', { ids: [b, a], loadoutId: PATROL_LOADOUT })),
    );
    q = sim.playerStatus(0).queue!;
    expect(q.map((x) => [x.kind, x.buildingId, x.unitId, x.id, x.progressPermille])).toEqual([
      ['craft', ENTITY_NONE, Math.min(a, b), PATROL_LOADOUT, 0],
      ['craft', ENTITY_NONE, Math.max(a, b), PATROL_LOADOUT, 0],
    ]);
    for (
      let n = 0;
      n < 400 && sim.playerStatus(0).queue!.some((x) => x.progressPermille === 0);
      n++
    )
      play(sim, 1);
    q = sim.playerStatus(0).queue!;
    expect(q.map((x) => [x.buildingId, x.unitId])).toEqual([
      [ws, Math.min(a, b)],
      [ws, Math.max(a, b)],
    ]);
    expect(q.every((x) => x.progressPermille > 0)).toBe(true);
    // Cancel op een bewoner stopt zijn omscholing met teruggave (cancelRefundPermille)
    const before = sim.playerStatus(0).scrap;
    play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'Cancel', { ids: [a] })));
    expect(sim.playerStatus(0).scrap).toBe(before + (patrol.scrapCost >> 1));
    expect(sim.playerStatus(0).queue!.map((x) => x.unitId)).toEqual([b]);
    play(sim, patrol.craftTicks);
    expect(sim.playerStatus(0).queue).toEqual([]);
    expect(sim.getUnit(b)!.typeId).toBe(patrol.typeId);
    expect(sim.getUnit(a)!.typeId).toBe(SCAV);
  });

  it('tech-effecten: hpPct op militie verhoogt maxHp en hp van bestaande en nieuwe units; Cancel stopt onderzoek met teruggave', () => {
    const sim = emptySim(31);
    sim.spawnBuilding(WERKPLAATS, 0, 14, 4);
    sim.setScrap(0, 1000);
    const m = sim.spawnUnit({ typeId: MILITIA, owner: 0, ...cellCenter(10, 20) });
    const enemy = sim.spawnUnit({ typeId: MILITIA, owner: 1, ...cellCenter(50, 50) });
    play(sim, 1, at(0, cmd(0, 0, 'Research', { techId: GEWEERREK.techId })));
    play(sim, GEWEERREK.researchTicks);
    // Cancel halverwege: teruggave volgens cancelRefundPermille, geen tech
    const ws = kindOf(sim, 'building')[0]!;
    play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'Research', { techId: PANTSER.techId })));
    play(sim, 10);
    const before = sim.playerStatus(0).scrap;
    play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'Cancel', { ids: [ws] })));
    expect(sim.playerStatus(0).scrap).toBe(
      before + idivTest(PANTSER.scrapCost * CONFIG.cancelRefundPermille, 1000),
    );
    play(sim, PANTSER.researchTicks + 10);
    expect(sim.researched(0)).toEqual([GEWEERREK.techId]);
    // opnieuw, nu tot het eind
    play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'Research', { techId: PANTSER.techId })));
    play(sim, PANTSER.researchTicks);
    expect(sim.researched(0)).toEqual([PANTSER.techId, GEWEERREK.techId].sort((a, b) => a - b));
    const boosted = idivTest(milType.maxHp * (1000 + PANTSER.effects[0]!.delta), 1000);
    expect(sim.getUnit(m)).toMatchObject({ maxHp: boosted, hp: boosted });
    expect(sim.getUnit(enemy)).toMatchObject({ maxHp: milType.maxHp });
    const fresh = sim.spawnUnit({ typeId: MILITIA, owner: 0, ...cellCenter(11, 20) });
    expect(sim.getUnit(fresh)).toMatchObject({ maxHp: boosted, hp: boosted });
  });
});

describe('gevecht', () => {
  it('Attack: schade maal de damage-matrix, cooldown, dood wordt een lijk en verdwijnt; events shotFired, hit, death', () => {
    const sim = emptySim(5, createOpenMap(64, 64));
    const a = sim.spawnUnit({ typeId: MILITIA, owner: 0, ...cellCenter(10, 10) });
    const b = sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(14, 10) });
    const ev = play(sim, 1, at(0, cmd(0, 0, 'Attack', { ids: [a], target: b })));
    const dmg = Math.trunc(
      (milType.damage * CONFIG.damageMatrix[milType.damageType]![scavType.armorType]!) / 1000,
    );
    expect(ev.filter((e) => e.type === EVENT_TYPE.shotFired)).toEqual([
      { type: EVENT_TYPE.shotFired, a, b },
    ]);
    expect(ev.filter((e) => e.type === EVENT_TYPE.hit)).toEqual([
      { type: EVENT_TYPE.hit, a: b, b: a },
    ]);
    expect(sim.getUnit(b)!.hp).toBe(scavType.maxHp - dmg);
    // de scavenger vecht niet terug (geen militie, geen order)
    const all = play(sim, milType.cooldown * 10);
    const shots = all.filter((e) => e.type === EVENT_TYPE.shotFired);
    expect(shots.every((e) => e.a === a)).toBe(true);
    const death = all.find((e) => e.type === EVENT_TYPE.death)!;
    expect(death).toEqual({ type: EVENT_TYPE.death, a: b, b: SCAV });
    expect(shots.length + 1).toBe(Math.ceil(scavType.maxHp / dmg));
    const corpse = sim.getUnit(b);
    if (CONFIG.corpseTicks > 0 && corpse !== null) expect(corpse.kind).toBe('corpse');
    play(sim, CONFIG.corpseTicks + 1);
    expect(sim.getUnit(b)).toBeNull();
    expect(sim.getUnit(a)!.order).toBe(0);
  });

  it('militie zonder order kiest zelf een doel binnen aggroRange; buiten bereik niet', () => {
    const sim = emptySim(6, createOpenMap(64, 64));
    const far = Math.floor(CONFIG.aggroRange / 256) + 3;
    const a = sim.spawnUnit({ typeId: MILITIA, owner: 0, ...cellCenter(10, 10) });
    const b = sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(10 + far, 10) });
    play(sim, 20);
    expect(sim.getUnit(b)!.hp).toBe(scavType.maxHp);
    play(sim, 1, at(sim.frame, cmd(sim.frame, 1, 'Move', { ids: [b], ...cellCenter(14, 10) })));
    play(sim, 60);
    expect(sim.getUnit(b)!.hp).toBeLessThan(scavType.maxHp);
    expect(sim.getUnit(a)!.target).toBe(b);
  });

  it('AttackMove: onderweg vechten, daarna doorlopen naar het punt', () => {
    const sim = emptySim(7, createOpenMap(64, 64));
    const a = [0, 1, 2].map((k) =>
      sim.spawnUnit({ typeId: MILITIA, owner: 0, ...cellCenter(5, 10 + k) }),
    );
    const b = sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(25, 11) });
    const goal = cellCenter(50, 11);
    play(sim, 1, at(0, cmd(0, 0, 'AttackMove', { ids: a, ...goal })));
    play(sim, 900);
    expect(sim.getUnit(b) === null || sim.getUnit(b)!.kind === 'corpse').toBe(true);
    for (const id of a) {
      const u = sim.getUnit(id)!;
      expect(u.order).toBe(0);
      expect(Math.hypot(u.x - goal.x, u.y - goal.y)).toBeLessThan(3 * 256);
    }
  });

  it('gelijktijdig vuren: wie deze tick sneuvelt, schiet deze tick nog terug', () => {
    const sim = emptySim(8, createOpenMap(64, 64));
    const a = sim.spawnUnit({ typeId: MILITIA, owner: 0, ...cellCenter(10, 10) });
    const b = sim.spawnUnit({ typeId: MILITIA, owner: 1, ...cellCenter(13, 10) });
    play(sim, 400);
    // symmetrisch: beide dood in dezelfde tick
    expect(sim.getUnit(a)?.kind ?? 'weg').not.toBe('unit');
    expect(sim.getUnit(b)?.kind ?? 'weg').not.toBe('unit');
  });
});

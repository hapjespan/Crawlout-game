import { describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@crawlout/protocol';
import { createSim, type Sim, type SimConfig, type SimMap } from '../src/index.js';
import { createOpenMap, cellCenter } from '../src/testing.js';
import { DATA, CONFIG, REAL_CONFIG, bundle, cmd, typeByKey } from './helpers.js';
import { SLAVE_SLAVE } from '../src/ecs/world.js';

// Claimen met een bouwer, per factie (speltest 22 oktober, Martien: "De garde en raiders moeten in domination gewoon
// een flag kunnen claimen met een bouwer"). Elke factie heeft één gebouw met provides `claim` dat geen hoofdgebouw is
// (claimpaal 50, plunderpost 40, wachtpost 60 scrap), dus fromData kiest voor elke factie een claimTypeId en Claim
// hoort voor alle drie te werken. Deze test legt dat vast; het ontbrak op de commandokaart, niet in de sim.

const fid = (key: string): number => DATA.factions.find((f) => f.key === key)!.id;

interface Case {
  readonly faction: string;
  readonly builder: string;
  readonly post: string;
  readonly config: SimConfig;
  readonly map: SimMap;
}

/**
 * De Garde-gebouwen houden in CONFIG hun echte footprint (helpers.ts), dus het Bastion (21 x 21) past niet op de
 * spawn van de compacte testmap: voor de Garde een ruimere map met spawns die wel passen, en REAL_CONFIG.
 */
const gardeMap = (): SimMap => ({
  ...createOpenMap(160, 160),
  spawns: [cellCenter(30, 30), cellCenter(130, 130)],
});

const CASES: readonly Case[] = [
  {
    faction: 'dwellers',
    builder: 'bouwer',
    post: 'claimpaal',
    config: CONFIG,
    map: createOpenMap(64, 64),
  },
  {
    faction: 'raiders',
    builder: 'slaaf_bouwer',
    post: 'plunderpost',
    config: CONFIG,
    map: createOpenMap(64, 64),
  },
  {
    faction: 'garde',
    builder: 'initiate_bouwer',
    post: 'wachtpost',
    config: REAL_CONFIG,
    map: gardeMap(),
  },
];

function run(sim: Sim, n: number, cmds: Parameters<typeof bundle>[1] = []) {
  const out: { type: number; a: number }[] = [];
  for (let k = 0; k < n; k++) {
    sim.applyBundle(bundle(sim.frame, k === 0 ? cmds : []));
    sim.tick();
    for (let j = 0; j < sim.events.count; j++)
      out.push({ type: sim.events.type[j]!, a: sim.events.a[j]! });
  }
  return out;
}

const claimPointOf = (sim: Sim): number =>
  sim.entityIds().find((id) => sim.getUnit(id)!.kind === 'claimPoint')!;

const simFor = (c: Case): Sim =>
  createSim({
    seed: 5,
    map: c.map,
    players: [
      { factionId: fid(c.faction), ai: false },
      { factionId: 0, ai: false },
    ],
    config: c.config,
  });

describe('Claim met een bouwer werkt voor elke factie (contract 2 Claim)', () => {
  for (const c of CASES) {
    it(`${c.faction}: een ${c.builder} zet de ${c.post} bij het punt en het punt wordt van hem`, () => {
      const sim = simFor(c);
      const pt = claimPointOf(sim);
      const view = sim.getUnit(pt)!;
      sim.setScrap(0, 1000);
      const builder = sim.spawnUnit({
        typeId: typeByKey(c.builder),
        owner: 0,
        x: view.x - 10 * 256,
        y: view.y,
      });
      expect(builder).not.toBe(0);
      const postTypeId = typeByKey(c.post);
      // de factie-config kiest het goedkoopste gebouw met provides claim dat geen hoofdgebouw is
      expect(c.config.factions[fid(c.faction)]!.claimTypeId).toBe(postTypeId);

      const placed = run(sim, 1, [
        cmd(sim.frame, 0, 'Claim', { ids: [builder], pointId: pt }),
      ]).filter((e) => e.type === EVENT_TYPE.buildingPlaced);
      expect(placed).toHaveLength(1);
      expect(sim.getUnit(placed[0]!.a)).toMatchObject({ typeId: postTypeId, owner: 0 });

      const bt = c.config.buildingTypes.find((t) => t.typeId === postTypeId)!;
      run(sim, bt.buildTicks + 400);
      expect(sim.getUnit(placed[0]!.a)!.buildState).toBe(2);
      expect(sim.getUnit(pt)!.owner).toBe(0);
    });
  }

  it('raiders: een slaaf-bouwer claimt ook buiten de werkstraal van zijn Kooi (data 0.21.0)', () => {
    const c = CASES[1]!;
    const sim = simFor(c);
    const pt = claimPointOf(sim);
    const view = sim.getUnit(pt)!;
    sim.setScrap(0, 1000);
    // een Kooi in de verre hoek: het claimpunt ligt ruim buiten cage.workRadius (45 m)
    const cage = sim.spawnBuilding(typeByKey('kooi'), 0, 4, 4, true);
    const builder = sim.spawnUnit({
      typeId: typeByKey(c.builder),
      owner: 0,
      x: view.x - 10 * 256,
      y: view.y,
    });
    const i = sim.world.resolve(builder);
    sim.world.slaveState[i] = SLAVE_SLAVE;
    sim.world.slaveCage[i] = cage;

    const placed = run(sim, 1, [cmd(sim.frame, 0, 'Claim', { ids: [builder], pointId: pt })]).filter(
      (e) => e.type === EVENT_TYPE.buildingPlaced,
    );
    expect(placed).toHaveLength(1);
    expect(sim.getUnit(placed[0]!.a)).toMatchObject({ typeId: typeByKey(c.post), owner: 0 });
  });
});

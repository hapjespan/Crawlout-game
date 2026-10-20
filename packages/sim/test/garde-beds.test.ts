import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../src/index.js';
import { createOpenMap } from '../src/testing.js';
import { grantTech } from '../src/techBits.js';
import { DATA, REAL_CONFIG, bundle, cmd, typeByKey } from './helpers.js';

// Sim 0.34.0 (data 0.41.0; Martien: "de garde heeft geen opties om bedden te maken hoe zit dit?"): only bodyType
// human sleeps in a bed. A frame counts for popCapMax only, and the Slaapzaal gives the Garde cheap beds.
const GARDE = DATA.factions.find((f) => f.key === 'garde')!.id;
const DWELLERS = DATA.factions.find((f) => f.key === 'dwellers')!.id;
const loadoutId = (key: string) => DATA.loadouts.find((l) => l.key === key)!.id;
const tech = (key: string) => DATA.tech.find((t) => t.key === key)!.id;

function gardeSim(): Sim {
  return createSim(
    {
      seed: 11,
      map: createOpenMap(),
      players: [
        { factionId: GARDE, ai: false },
        { factionId: DWELLERS, ai: false },
      ],
      config: REAL_CONFIG,
    },
    { start: false },
  );
}

/** A Bastion (6 beds) with six Initiates in it: every bed taken, as at the start of a match. */
function fullBastion(sim: Sim): void {
  sim.spawnBuilding(typeByKey('bastion'), 0, 20, 20, true);
  for (let k = 0; k < 6; k++)
    sim.spawnUnit({ typeId: typeByKey('initiate_zoeker'), owner: 0, x: (50 + k) * 256, y: 50 * 256 });
}

const run = (sim: Sim, n: number, cmds: Parameters<typeof bundle>[1] = []) => {
  for (let k = 0; k < n; k++) {
    sim.applyBundle(bundle(sim.frame, k === 0 ? cmds : []));
    sim.tick();
  }
};

describe('Garde: frames need no bed (sim 0.34.0)', () => {
  it('a krachtpantser is produced with every bed taken and takes pop but no bed', () => {
    const sim = gardeSim();
    fullBastion(sim);
    const s0 = sim.playerStatus(0);
    expect(s0.pop).toBe(s0.beds); // the six start units fill the six Bastion beds
    const smederij = sim.spawnBuilding(typeByKey('smederij'), 0, 80, 80, true);
    grantTech(sim.ps, 0, tech('fusiekernen'));
    sim.garde.cores[0] = 2;
    sim.setScrap(0, 1000);
    const kp = DATA.loadouts.find((l) => l.key === 'krachtpantser')!;
    run(sim, 1, [
      cmd(sim.frame, 0, 'Produce', { buildingId: smederij, loadoutId: loadoutId('krachtpantser') }),
    ]);
    expect(sim.world.job[sim.world.resolve(smederij)]).not.toBe(0);
    run(sim, kp.craftTicks + 40);
    const s1 = sim.playerStatus(0);
    expect(s1.settlers).toBe(s0.settlers); // the frame is no settler
    expect(s1.pop).toBe(s0.pop); // and takes no bed
    expect(s1.popCap).toBe(s0.popCap); // the beds are still full, the frame only uses popCapMax room
  });
});

describe('Garde: the Slaapzaal and housing growth (sim 0.34.0)', () => {
  it('without free beds nobody grows; a Slaapzaal adds 6 beds and growth 1 per minute fills them', () => {
    const sim = gardeSim();
    fullBastion(sim);
    const minute = REAL_CONFIG.ticksPerMinute;
    const s0 = sim.playerStatus(0);
    run(sim, minute + 20);
    expect(sim.playerStatus(0).settlers).toBe(s0.settlers); // full beds: no growth
    const zaal = DATA.buildings.find((b) => b.key === 'slaapzaal')!;
    expect(zaal.beds).toBe(6);
    sim.spawnBuilding(typeByKey('slaapzaal'), 0, 80, 80, true);
    expect(sim.playerStatus(0).beds).toBe(s0.beds + 6);
    run(sim, minute + 20);
    expect(sim.playerStatus(0).settlers).toBeGreaterThan(s0.settlers);
  });
});

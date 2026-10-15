// Benchmark: 200 units met gevecht en economie, 10.000 ticks, gemiddelde ms per tick (doel: onder 5 ms).
// `pnpm bench` draait de standaardvariant, `pnpm bench -- --xl` de XL-variant (bench/bench-xl.ts: 384 bij 384 m met
// rivier, bosrand en bosjes, lange routes van hoek tot hoek, vertrektijd en geheugen van de padvinding).
// Echte data (data/), open map van 128 bij 128 m. Per kant 50 scavengers die verzamelen en 50 militie die elkaar
// met AttackMove opzoeken; elke 100 ticks vult het harnas gesneuvelde militie aan en stuurt die opnieuw, zodat er
// de hele run ongeveer 200 units zijn. Flow fields, separatie, gevecht, verzamelen en hash worden allemaal belast.
// De klok komt uit host/clock.ts, buiten de sim.
import { fileURLToPath } from 'node:url';
import { ROLES } from '@crawlout/data';
import { loadGameDataFromDir } from '@crawlout/data/node';
import { EVENT_TYPE } from '@crawlout/protocol';
import type { CommandEnvelope } from '@crawlout/protocol';
import { now, reportBench } from '../host/clock.js';
import { createSim, simConfigFromGameData } from '../src/index.js';
import type { Sim } from '../src/index.js';
import { cellCenter, createOpenMap, testPlayers } from '../src/testing.js';

const PER_SIDE = 50;
const TICKS = 10_000;
const TOP_UP_EVERY = 100;
const MAP_SIDE = 128;

export interface BenchResult {
  units: number;
  ticks: number;
  totalMs: number;
  maxMs: number;
  finalHash: number;
  /** Wat er gebeurde: schoten, doden en afgeleverde scrap, zodat de bench aantoonbaar gevecht en economie belast. */
  shots: number;
  deaths: number;
  scrapIn: number;
}

function chunks(ids: readonly number[]): number[][] {
  const out: number[][] = [];
  for (let k = 0; k < ids.length; k += 64) out.push(ids.slice(k, k + 64));
  return out;
}

function unitsOf(sim: Sim, owner: number, role: number): number[] {
  return sim.entityIds().filter((id) => {
    const u = sim.getUnit(id)!;
    return u.kind === 'unit' && u.owner === owner && u.role === role;
  });
}

export function runBench(clock: () => number): BenchResult {
  const data = loadGameDataFromDir(fileURLToPath(new URL('../../../data', import.meta.url)));
  const config = simConfigFromGameData(data);
  const faction = config.factions[0]!;
  const scavType = faction.roleTypeIds[ROLES.indexOf('scavenger')]!;
  const milType = faction.roleTypeIds[ROLES.indexOf('militia')]!;
  // Nodes met ruim genoeg voorraad, zodat de scavengers de hele run blijven pendelen.
  const open = createOpenMap(MAP_SIDE, MAP_SIDE);
  const map = { ...open, scrapNodes: open.scrapNodes.map((n) => ({ ...n, amount: 1_000_000 })) };
  const sim = createSim({ seed: 12345, players: testPlayers(2), map, config });
  const nodes = sim.entityIds().filter((id) => sim.getUnit(id)!.kind === 'scrapNode');
  const home = [cellCenter(20, 30), cellCenter(MAP_SIDE - 21, MAP_SIDE - 31)];
  for (let side = 0; side < 2; side++) {
    for (let k = 0; k < PER_SIDE; k++) {
      const c = cellCenter(
        10 + (k % 10) + side * (MAP_SIDE - 30),
        14 + Math.floor(k / 10) + side * (MAP_SIDE - 30),
      );
      sim.spawnUnit({ typeId: scavType, owner: side, x: c.x, y: c.y });
    }
  }
  let seq = 0;
  const topUp = (f: number): CommandEnvelope[] => {
    const cmds: CommandEnvelope[] = [];
    for (let side = 0; side < 2; side++) {
      const mil = unitsOf(sim, side, ROLES.indexOf('militia'));
      for (let k = mil.length; k < PER_SIDE; k++) {
        const h = home[side]!;
        sim.spawnUnit({
          typeId: milType,
          owner: side,
          x: h.x + (k % 8) * 256,
          y: h.y + Math.floor(k / 8) * 256,
        });
      }
      const all = unitsOf(sim, side, ROLES.indexOf('militia'));
      const t = home[1 - side]!;
      for (const ids of chunks(all))
        cmds.push({
          frame: f,
          playerId: side,
          seq: seq++,
          type: 'AttackMove',
          payload: { ids, x: t.x, y: t.y },
        });
      if (f > 0) continue; // verzamelen loopt vanzelf door; opnieuw geven zou de rit afbreken
      const scav = unitsOf(sim, side, ROLES.indexOf('scavenger'));
      for (const ids of chunks(scav))
        cmds.push({
          frame: f,
          playerId: side,
          seq: seq++,
          type: 'Gather',
          payload: { ids, nodeId: nodes[side]! },
        });
    }
    return cmds;
  };

  let total = 0;
  let max = 0;
  let units = 0;
  let shots = 0;
  let deaths = 0;
  let scrapIn = 0;
  for (let f = 0; f < TICKS; f++) {
    const before = sim.playerStatus(0).scrap + sim.playerStatus(1).scrap;
    sim.applyBundle({ frame: f, commands: f % TOP_UP_EVERY === 0 ? topUp(f) : [] });
    const t0 = clock();
    sim.tick();
    const dt = clock() - t0;
    total += dt;
    if (dt > max) max = dt;
    for (let k = 0; k < sim.events.count; k++) {
      if (sim.events.type[k] === EVENT_TYPE.shotFired) shots++;
      else if (sim.events.type[k] === EVENT_TYPE.death) deaths++;
    }
    scrapIn += sim.playerStatus(0).scrap + sim.playerStatus(1).scrap - before;
    if (f === TICKS - 1)
      units = sim.entityIds().filter((id) => sim.getUnit(id)!.kind === 'unit').length;
  }
  return {
    units,
    ticks: TICKS,
    totalMs: total,
    maxMs: max,
    finalHash: sim.hash(),
    shots,
    deaths,
    scrapIn,
  };
}

if (process.argv.includes('--xl')) {
  const { runBenchXl, reportBenchXl, runAiXl } = await import('./bench-xl.js');
  reportBenchXl(runBenchXl(now));
  const ai = runAiXl(now);
  const avg = ai.totalMs / ai.ticks;
  console.log(
    `bench-xl AI tegen AI: ${ai.ticks} ticks, gemiddeld ${avg.toFixed(3)} ms/tick, max ${ai.maxMs.toFixed(2)} ms, ` +
      `${ai.units} units en ${ai.buildings} gebouwen aan het eind, eindhash 0x${ai.finalHash.toString(16).padStart(8, '0')} ` +
      `(budget 5 ms: ${avg < 5 ? 'binnen' : 'BOVEN'})`,
  );
} else reportBench(runBench(now));

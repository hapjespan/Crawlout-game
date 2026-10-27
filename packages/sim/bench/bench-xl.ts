// XL-benchmark (pnpm bench -- --xl): de sim op de maat van de grote map, 384 bij 384 m (147.456 cellen), op de
// synthetische XL-testmap uit src/testing.ts (rivier met drie oversteken, dichte bosrand, bosjes en blokken).
// Per kant 50 plunderaars die verzamelen bij een node aan de overkant van de rivier (heen en terug naar het eigen
// hoofdgebouw: twee lange routes) en 50 militie die met AttackMove van hoek tot hoek naar de vijand lopen; elke
// TOP_UP_EVERY ticks vult het harnas gesneuvelde militie aan en stuurt ze opnieuw. Elke BUILD_EVERY ticks zet het harnas
// een woning bij een oversteek (begaanbaarheid verandert, de padvinding moet invalideren en opnieuw rekenen).
//
// Gemeten: gemiddelde en maximale tick-tijd, de vertrektijd (ticks tussen een bevel en het moment dat het veld de cel
// van de unit kent, zodat hij geleid vertrekt in plaats van recht op zijn doel af), het geheugen van de padvinding en
// of er ooit een unit op een onbegaanbare cel staat. De klok komt uit host/clock.ts, buiten de sim.
import { fileURLToPath } from 'node:url';
import { ROLES } from '@crawlout/data';
import { loadGameDataFromDir } from '@crawlout/data/node';
import { EVENT_TYPE } from '@crawlout/protocol';
import type { CommandEnvelope } from '@crawlout/protocol';
import { createSim, simConfigFromGameData } from '../src/index.js';
import type { Sim } from '../src/index.js';
import { NO_FIELD } from '../src/ecs/world.js';
import type { BenchHooks } from './profile.js';
import {
  XL_CROSSINGS,
  cellCenter,
  createXlTestMap,
  testPlayers,
  xlRiverX,
} from '../src/testing.js';

const PER_SIDE = 50;
const TICKS = 10_000;
const TOP_UP_EVERY = 400;
const BUILD_EVERY = 600;
/** Een unit die na zoveel ticks nog niet geleid wordt, telt als "niet vertrokken". */
const DEPART_CAP = 400;

export interface BenchXlResult {
  /** createSim inclusief de padgraaf over de hele map (buiten de ticks). */
  buildMs: number;
  mapCells: number;
  units: number;
  ticks: number;
  /** Som en maximum van tick 1 en verder. */
  totalMs: number;
  maxMs: number;
  /** Tick van het maximum. */
  maxAt: number;
  /** Tick 0 apart: koude JIT plus de eerste zoekopdrachten van alle bevelen op frame 0. */
  firstMs: number;
  finalHash: number;
  shots: number;
  deaths: number;
  scrapIn: number;
  buildings: number;
  /** Vertrektijd in ticks over alle bevelen: gemiddeld, maximaal, aantal metingen en hoeveel er niet binnen DEPART_CAP vertrokken. */
  departAvg: number;
  departMax: number;
  departCount: number;
  departMissed: number;
  /** Bevelen waarbij de unit geen veld kreeg (alle slots bezet). */
  noField: number;
  /** Vertrektijd van de eerste lange route (frame 0, hoek tot hoek). */
  firstDepartMax: number;
  memoryBytes: number;
  /** Unit-ticks op een onbegaanbare cel (moet 0 zijn). */
  blockedTicks: number;
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

/** De k-de begaanbare cel in een spiraal rond (cx, cy) (harnas, mag floats). */
function freeCells(sim: Sim, cx: number, cy: number, n: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const { w, h, passable } = sim.map;
  for (let r = 0; out.length < n && r < 40; r++) {
    for (let y = cy - r; y <= cy + r && out.length < n; y++) {
      for (let x = cx - r; x <= cx + r && out.length < n; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
        if (x < 0 || y < 0 || x >= w || y >= h || passable[y * w + x] !== 1) continue;
        out.push(cellCenter(x, y));
      }
    }
  }
  return out;
}

export function runBenchXl(clock: () => number, hooks: BenchHooks = {}): BenchXlResult {
  const data = loadGameDataFromDir(fileURLToPath(new URL('../../../data', import.meta.url)));
  const config = simConfigFromGameData(data);
  const faction = config.factions[0]!;
  const scavType = faction.roleTypeIds[ROLES.indexOf('scavenger')]!;
  const milType = faction.roleTypeIds[ROLES.indexOf('militia')]!;
  const xl = createXlTestMap();
  const map = { ...xl, scrapNodes: xl.scrapNodes.map((n) => ({ ...n, amount: 1_000_000 })) };
  const W = map.w;
  const t0Build = clock();
  const sim = createSim({ seed: 4242, players: testPlayers(2), map, config });
  const buildMs = clock() - t0Build;
  const nodes = sim.entityIds().filter((id) => sim.getUnit(id)!.kind === 'scrapNode');
  // node 2 ligt rechtsboven (over de rivier voor speler 0), node 3 linksonder (over de rivier voor speler 1)
  const farNode = [nodes[2]!, nodes[3]!];
  const homeCell = [
    { x: 58, y: 52 },
    { x: W - 59, y: map.h - 53 },
  ];
  // het huisvestingsgebouw (bedden, geen hoofdgebouw): de woning, sinds data 0.14.0 op echte schaal (13 x 19)
  const housing = config.buildingTypes
    .filter((b) => b.beds > 0 && b.scrapCost > 0)
    .sort(
      (a, b) => a.footprintW * a.footprintH - b.footprintW * b.footprintH || a.typeId - b.typeId,
    )[0]!;
  for (let side = 0; side < 2; side++) {
    const spots = freeCells(sim, homeCell[side]!.x - 8, homeCell[side]!.y + 10, PER_SIDE);
    for (const c of spots) sim.spawnUnit({ typeId: scavType, owner: side, x: c.x, y: c.y });
  }

  // vertrektijd: per unit het frame van het laatste bevel, tot het veld hem kent
  const pending = new Map<number, number>();
  let departSum = 0;
  let departMax = 0;
  let departCount = 0;
  let departMissed = 0;
  let firstDepartMax = 0;
  let noField = 0;

  let seq = 0;
  const topUp = (f: number): CommandEnvelope[] => {
    const cmds: CommandEnvelope[] = [];
    for (let side = 0; side < 2; side++) {
      const mil = unitsOf(sim, side, ROLES.indexOf('militia'));
      const spots = freeCells(sim, homeCell[side]!.x, homeCell[side]!.y, PER_SIDE + 20);
      for (let k = mil.length, s = 0; k < PER_SIDE && s < spots.length; k++, s++) {
        const c = spots[s]!;
        sim.spawnUnit({ typeId: milType, owner: side, x: c.x, y: c.y });
      }
      const all = unitsOf(sim, side, ROLES.indexOf('militia'));
      const t = cellCenter(homeCell[1 - side]!.x, homeCell[1 - side]!.y);
      for (const ids of chunks(all)) {
        cmds.push({
          frame: f,
          playerId: side,
          seq: seq++,
          type: 'AttackMove',
          payload: { ids, x: t.x, y: t.y },
        });
        for (const id of ids) if (!pending.has(id)) pending.set(id, f);
      }
      if (f > 0) continue;
      const scav = unitsOf(sim, side, ROLES.indexOf('scavenger'));
      for (const ids of chunks(scav)) {
        cmds.push({
          frame: f,
          playerId: side,
          seq: seq++,
          type: 'Gather',
          payload: { ids, nodeId: farNode[side]! },
        });
        for (const id of ids) pending.set(id, f);
      }
    }
    return cmds;
  };

  // bouwplekken bij de oversteken, aan beide oevers, net naast de looproute
  const buildSpots: { fx: number; fy: number }[] = [];
  for (const y0 of XL_CROSSINGS) {
    const rx = xlRiverX(W, y0 + 2);
    for (const dx of [-12, 10, -16, 14]) buildSpots.push({ fx: rx + dx, fy: y0 - 3 });
  }
  let builds = 0;

  let total = 0;
  let max = 0;
  let maxAt = 0;
  let firstMs = 0;
  let units = 0;
  let shots = 0;
  let deaths = 0;
  let scrapIn = 0;
  let blockedTicks = 0;
  let memoryBytes = 0;
  for (let f = 0; f < TICKS; f++) {
    if (f > 0 && f % BUILD_EVERY === 0 && builds < buildSpots.length) {
      const b = buildSpots[builds++]!;
      sim.spawnBuilding(housing.typeId, (f / BUILD_EVERY) % 2, b.fx, b.fy, true);
    }
    const before = sim.playerStatus(0).scrap + sim.playerStatus(1).scrap;
    sim.applyBundle({ frame: f, commands: f % TOP_UP_EVERY === 0 ? topUp(f) : [] });
    const t0 = clock();
    sim.tick(hooks.probe?.(f));
    const dt = clock() - t0;
    hooks.onTick?.(f, dt);
    if (f === 0) firstMs = dt;
    else {
      total += dt;
      if (dt > max) {
        max = dt;
        maxAt = f;
      }
    }
    for (let k = 0; k < sim.events.count; k++) {
      if (sim.events.type[k] === EVENT_TYPE.shotFired) shots++;
      else if (sim.events.type[k] === EVENT_TYPE.death) deaths++;
    }
    scrapIn += sim.playerStatus(0).scrap + sim.playerStatus(1).scrap - before;
    // meten buiten de klok
    for (const [id, at] of pending) {
      const u = sim.getUnit(id);
      if (u === null || u.kind !== 'unit') {
        pending.delete(id);
        continue;
      }
      const cell = (u.y >> 8) * W + (u.x >> 8);
      const waited = f + 1 - at;
      const known = u.flowField !== NO_FIELD && sim.flow.guides(u.flowField, cell);
      if (known || !u.moving || waited >= DEPART_CAP) {
        pending.delete(id);
        if (u.moving && u.flowField === NO_FIELD) noField++;
        if (!known && u.moving && waited >= DEPART_CAP) departMissed++;
        else if (known) {
          departSum += waited;
          departCount++;
          if (waited > departMax) departMax = waited;
          if (at === 0 && waited > firstDepartMax) firstDepartMax = waited;
        }
      }
    }
    for (const id of sim.entityIds()) {
      const u = sim.getUnit(id)!;
      if (u.kind !== 'unit') continue;
      if (sim.terrain.walk[(u.y >> 8) * W + (u.x >> 8)] !== 1) blockedTicks++;
    }
    if (f % 500 === 0) memoryBytes = Math.max(memoryBytes, sim.flow.memoryBytes());
    if (f === TICKS - 1)
      units = sim.entityIds().filter((id) => sim.getUnit(id)!.kind === 'unit').length;
  }
  memoryBytes = Math.max(memoryBytes, sim.flow.memoryBytes());
  return {
    buildMs,
    mapCells: map.w * map.h,
    units,
    ticks: TICKS,
    totalMs: total,
    maxMs: max,
    maxAt,
    firstMs,
    finalHash: sim.hash(),
    shots,
    deaths,
    scrapIn,
    buildings: builds,
    departAvg: departCount > 0 ? departSum / departCount : 0,
    departMax,
    departCount,
    departMissed,
    noField,
    firstDepartMax,
    memoryBytes,
    blockedTicks,
  };
}

export interface BenchXlAiResult {
  ticks: number;
  totalMs: number;
  maxMs: number;
  /** Tick van het maximum. */
  maxAt: number;
  firstMs: number;
  units: number;
  buildings: number;
  finalHash: number;
}

/** Tweede deel: de scripted AI tegen zichzelf op de XL-testmap (zoekfuncties over de hele map, bouwen, golven). */
export function runAiXl(
  clock: () => number,
  ticks = 12_000,
  hooks: BenchHooks = {},
): BenchXlAiResult {
  const data = loadGameDataFromDir(fileURLToPath(new URL('../../../data', import.meta.url)));
  const config = simConfigFromGameData(data);
  const sim = createSim({
    seed: 99,
    players: testPlayers(2, true),
    map: createXlTestMap(),
    config,
  });
  let total = 0;
  let max = 0;
  let maxAt = 0;
  let firstMs = 0;
  for (let f = 0; f < ticks; f++) {
    sim.applyBundle({ frame: f, commands: [] });
    const t0 = clock();
    sim.tick(hooks.probe?.(f));
    const dt = clock() - t0;
    hooks.onTick?.(f, dt);
    if (f === 0) firstMs = dt;
    else {
      total += dt;
      if (dt > max) {
        max = dt;
        maxAt = f;
      }
    }
  }
  let units = 0;
  let buildings = 0;
  for (const id of sim.entityIds()) {
    const k = sim.getUnit(id)!.kind;
    if (k === 'unit' || k === 'hero') units++;
    else if (k === 'building') buildings++;
  }
  return {
    ticks,
    totalMs: total,
    maxMs: max,
    maxAt,
    firstMs,
    units,
    buildings,
    finalHash: sim.hash(),
  };
}

export function reportBenchXl(r: BenchXlResult): void {
  const avg = r.totalMs / (r.ticks - 1);
  console.log(
    `bench-xl: ${r.mapCells} cellen, ${r.units} units, ${r.ticks} ticks, gemiddeld ${avg.toFixed(3)} ms/tick, ` +
      `max ${r.maxMs.toFixed(2)} ms in tick ${r.maxAt} (zonder tick 0; tick 0 apart: ${r.firstMs.toFixed(2)} ms), eindhash 0x${r.finalHash.toString(16).padStart(8, '0')} ` +
      `(budget 5 ms: ${avg < 5 ? 'binnen' : 'BOVEN'})`,
  );
  console.log(
    `bench-xl: vertrektijd gemiddeld ${r.departAvg.toFixed(1)} ticks, max ${r.departMax} ticks over ${r.departCount} ` +
      `bevelen (eerste lange route max ${r.firstDepartMax} ticks; doel 10), ${r.departMissed} niet vertrokken binnen ` +
      `${DEPART_CAP} ticks, ${r.noField} zonder veld (${r.departMax <= 10 && r.departMissed === 0 ? 'binnen' : 'BOVEN'} doel)`,
  );
  console.log(`bench-xl: createSim met padgraaf ${r.buildMs.toFixed(1)} ms (buiten de ticks)`);
  console.log(
    `bench-xl: geheugen padvinding ${(r.memoryBytes / 1048576).toFixed(2)} MB, ${r.buildings} woningen geplaatst, ` +
      `${r.shots} schoten, ${r.deaths} doden, ${r.scrapIn} scrap afgeleverd, ${r.blockedTicks} unit-ticks op een ` +
      `onbegaanbare cel`,
  );
}

import { fileURLToPath } from 'node:url';
import { ROLES } from '@crawlout/data';
import { loadGameDataFromDir } from '@crawlout/data/node';
import type { CommandEnvelope, FrameBundle } from '@crawlout/protocol';
import { createSim, simConfigFromGameData } from '../src/index.js';
import type { Sim, SimInit, SimMap, SimPlayer } from '../src/index.js';
import { cellCenter, createTestMap, testPlayers } from '../src/testing.js';

/** Echte data uit data/, zoals de client en de replay die laden. */
export const DATA = loadGameDataFromDir(fileURLToPath(new URL('../../../data', import.meta.url)));
export const CONFIG = simConfigFromGameData(DATA);
const roles = CONFIG.factions[0]!.roleTypeIds;
export const SCAV = roles[ROLES.indexOf('scavenger')]!;
export const BUILDER = roles[ROLES.indexOf('builder')]!;
export const MILITIA = roles[ROLES.indexOf('militia')]!;
export const typeByKey = (key: string): number => {
  const l = DATA.loadouts.find((x) => x.key === key);
  if (l !== undefined) return CONFIG.unitTypes.find((u) => u.loadoutId === l.id)!.typeId;
  const b = DATA.buildings.find((x) => x.key === key)!;
  return CONFIG.buildingTypes.find((t) => t.buildingId === b.id)!.typeId;
};

export function testInit(
  seed = 1,
  map: SimMap = createTestMap(),
  players: SimPlayer[] = testPlayers(2),
): SimInit {
  return { seed, players, map, config: CONFIG };
}

/** Sim zonder startopstelling (alleen de map), voor tests die zelf spawnen. */
export function emptySim(
  seed = 1,
  map: SimMap = createTestMap(),
  players: SimPlayer[] = testPlayers(2),
): Sim {
  return createSim(testInit(seed, map, players), { start: false });
}

export const envOf = (init: SimInit) => ({
  players: init.players,
  map: init.map,
  config: init.config,
});

let seq = 0;
export function cmd(
  frame: number,
  playerId: number,
  type: CommandEnvelope['type'],
  payload: unknown,
): CommandEnvelope {
  return { frame, playerId, seq: seq++, type, payload };
}

export const bundle = (frame: number, commands: CommandEnvelope[] = []): FrameBundle => ({
  frame,
  commands,
});

/** Spawnt een blok units van één speler rond cel (cx, cy). */
export function spawnBlock(
  sim: Sim,
  owner: number,
  cx: number,
  cy: number,
  count: number,
  cols = 5,
  typeId = SCAV,
): number[] {
  const ids: number[] = [];
  for (let k = 0; k < count; k++) {
    const c = cellCenter(cx + (k % cols), cy + Math.floor(k / cols));
    const id = sim.spawnUnit({ typeId, owner, x: c.x, y: c.y });
    if (id === 0) throw new Error(`spawn mislukt op ${c.x},${c.y}`);
    ids.push(id);
  }
  return ids;
}

/** Een vast script met Move- en Stop-commando's voor twee spelers. */
export function scriptedBundles(a: number[], b: number[]): Map<number, CommandEnvelope[]> {
  const m = new Map<number, CommandEnvelope[]>();
  const add = (c: CommandEnvelope): void => {
    const list = m.get(c.frame) ?? [];
    list.push(c);
    m.set(c.frame, list);
  };
  const t1 = cellCenter(50, 40);
  const t2 = cellCenter(10, 50);
  add(cmd(2, 0, 'Move', { ids: a, x: t1.x, y: t1.y }));
  add(cmd(3, 1, 'Move', { ids: b, x: t2.x, y: t2.y }));
  add(cmd(60, 0, 'Stop', { ids: a.slice(0, 3) }));
  add(cmd(80, 1, 'Move', { ids: b.slice(0, 5), x: t1.x, y: t1.y }));
  add(cmd(81, 0, 'Move', { ids: b, x: t1.x, y: t1.y })); // ongeldig: niet van speler 0
  add(cmd(120, 0, 'Move', { ids: a, x: t2.x, y: t2.y }));
  return m;
}

/** Draait `frames` ticks en geeft de hash per tick. */
export function runFrames(
  sim: Sim,
  frames: number,
  script: Map<number, CommandEnvelope[]> = new Map(),
): number[] {
  const out: number[] = [];
  for (let f = sim.frame; out.length < frames; f++) {
    sim.applyBundle(bundle(f, script.get(f) ?? []));
    out.push(sim.tick());
  }
  return out;
}

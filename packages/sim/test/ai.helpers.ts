// Split from ai.test.ts to stay under the 5,000-token file limit.
import { typeByKey, DATA, CONFIG, bundle } from './helpers.js';
import {
  type SimAiScript,
  type SimMap,
  type Sim,
  type SimConfig,
  createSim,
} from '../src/index.js';
import { createOpenMap, testPlayers } from '../src/testing.js';

// De scripted AI na de speltest van 14 oktober (ai/*.json): bijbouwen bij de pop-cap, onderzoek uit het script,
// plunderaars verdelen over nodes (exclusief eerst), raids op claimpunten en pushes op het hoofdgebouw, en sparen
// voor het oplappen van de held. Elke test zet de rest van het script uit, zodat hij één regel toetst.

export const WONING = typeByKey('woning');

export const WERKPLAATS = typeByKey('werkplaats');

export const CLAIMPAAL = typeByKey('claimpaal');

export const techId = (key: string): number => DATA.tech.find((t) => t.key === key)!.id;

const BASE = CONFIG.aiScripts[0]!;

/** Een script dat niets doet behalve wat de test aanzet. */
const quiet: SimAiScript = {
  ...BASE,
  buildOrder: [],
  attackTimersTicks: [],
  militiaPermille: 0,
  militiaPermilleMax: 0,
  militiaPermillePerMin: 0,
  threatMilitiaPermille: 0,
  builders: 1,
  housingTypeId: 0,
  research: [],
  richBuilds: [],
  claimFromTicks: 1 << 30,
  claimFarFromTicks: 1 << 30,
  waveIntervalTicks: 1 << 30,
  waveJitterTicks: 0,
  robots: null,
  reserve: null,
  training: null,
};

export function aiSim(
  script: Partial<SimAiScript>,
  map: SimMap = createOpenMap(64, 64),
  players = testPlayers(1, true),
): Sim {
  const config: SimConfig = { ...CONFIG, aiScripts: [{ ...quiet, ...script }] };
  return createSim({ seed: 5, players, map, config });
}

export function play(sim: Sim, frames: number): { type: number; a: number; b: number }[] {
  const ev: { type: number; a: number; b: number }[] = [];
  for (let n = 0; n < frames; n++) {
    sim.applyBundle(bundle(sim.frame));
    sim.tick();
    for (let k = 0; k < sim.events.count; k++)
      ev.push({ type: sim.events.type[k]!, a: sim.events.a[k]!, b: sim.events.b[k]! });
  }
  return ev;
}

export const unitsOf = (sim: Sim, owner: number) =>
  sim
    .entityIds()
    .map((id) => sim.getUnit(id)!)
    .filter((u) => u.owner === owner && u.kind === 'unit');

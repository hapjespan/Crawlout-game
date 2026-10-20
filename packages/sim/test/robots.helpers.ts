// Split from robots.test.ts to stay under the 5,000-token file limit.
import { grantTech } from '../src/techBits.js';
import { typeByKey, CONFIG, DATA, bundle, cmd, emptySim } from './helpers.js';
import type { Sim } from '../src/index.js';
import type { CommandEnvelope } from '@crawlout/protocol';
import { createOpenMap } from '../src/testing.js';

// Dwellers-content van data 0.16.0 in de sim: robotproductie, pop, de technicus-regel, het vangnet, reparatie,
// belegering, het turret-netwerk, de passieven van de held en SPECIAL-training.

export const FACTORY = typeByKey('robotfabriek');

export const WONING = typeByKey('woning');

export const SENTINEL = typeByKey('sentinel');

export const unitType = (typeId: number) => CONFIG.unitTypes.find((u) => u.typeId === typeId)!;

export const techId = (key: string): number => DATA.tech.find((t) => t.key === key)!.id;

export const idiv = (a: number, b: number): number => Math.trunc(a / b);

export function play(
  sim: Sim,
  frames: number,
  script: Map<number, CommandEnvelope[]> = new Map(),
): void {
  for (let n = 0; n < frames; n++) {
    const f = sim.frame;
    sim.applyBundle(bundle(f, script.get(f) ?? []));
    sim.tick();
  }
}

const at = (frame: number, ...cmds: CommandEnvelope[]): Map<number, CommandEnvelope[]> =>
  new Map([[frame, cmds]]);

export const now = (
  sim: Sim,
  playerId: number,
  type: CommandEnvelope['type'],
  payload: unknown,
): void => play(sim, 1, at(sim.frame, cmd(sim.frame, playerId, type, payload)));

export const open = (): Sim => emptySim(1, createOpenMap(64, 64));

export const research = (sim: Sim, p: number, ...keys: string[]): void => {
  for (const k of keys) grantTech(sim.ps, p, techId(k));
};

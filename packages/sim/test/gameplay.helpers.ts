// Split from gameplay.test.ts to stay under the 5,000-token file limit.
import { typeByKey, CONFIG, SCAV, MILITIA, bundle } from './helpers.js';
import type { Sim } from '../src/index.js';
import type { CommandEnvelope } from '@crawlout/protocol';

export const WONING = typeByKey('woning');

export const WERKPLAATS = typeByKey('werkplaats');

export const scavType = CONFIG.unitTypes.find((u) => u.typeId === SCAV)!;

export const milType = CONFIG.unitTypes.find((u) => u.typeId === MILITIA)!;

/** Draait ticks met een vaste commandolijst per frame en verzamelt alle events. */
export function play(
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

export const at = (frame: number, ...cmds: CommandEnvelope[]): Map<number, CommandEnvelope[]> =>
  new Map([[frame, cmds]]);

export const kindOf = (sim: Sim, kind: string): number[] =>
  sim.entityIds().filter((id) => sim.getUnit(id)!.kind === kind);

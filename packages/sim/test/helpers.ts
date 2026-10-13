import type { CommandEnvelope, FrameBundle } from '@crawlout/protocol';
import type { Sim } from '../src/index.js';
import { TEST_UNIT_TYPE, cellCenter } from '../src/testing.js';

let seq = 0;
export function cmd(frame: number, playerId: number, type: CommandEnvelope['type'], payload: unknown): CommandEnvelope {
  return { frame, playerId, seq: seq++, type, payload };
}

export const bundle = (frame: number, commands: CommandEnvelope[] = []): FrameBundle => ({ frame, commands });

/** Spawnt een blok units van één speler rond cel (cx, cy). */
export function spawnBlock(sim: Sim, owner: number, cx: number, cy: number, count: number, cols = 5): number[] {
  const ids: number[] = [];
  for (let k = 0; k < count; k++) {
    const c = cellCenter(cx + (k % cols), cy + Math.floor(k / cols));
    const id = sim.spawnUnit({ typeId: TEST_UNIT_TYPE, owner, x: c.x, y: c.y });
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
export function runFrames(sim: Sim, frames: number, script: Map<number, CommandEnvelope[]>): number[] {
  const out: number[] = [];
  for (let f = sim.frame; out.length < frames; f++) {
    sim.applyBundle(bundle(f, script.get(f) ?? []));
    out.push(sim.tick());
  }
  return out;
}

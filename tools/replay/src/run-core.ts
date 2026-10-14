import { HASH_INTERVAL_FRAMES } from '@crawlout/protocol';
import type { FrameBundle, Replay } from '@crawlout/protocol';
import { createSim, deserialize } from '@crawlout/sim';
import type { SimEnv } from '@crawlout/sim';

// Afspelen en vergelijken van een replay, zonder IO: de aanroeper geeft de omgeving (Node: run.ts, browser:
// browser/entry.ts).

export interface FrameHash {
  frame: number;
  hash: number;
}

export interface ReplayRun {
  /** Laatste uitgevoerde frame. */
  lastFrame: number;
  /** Hash na elk frame, index = frame. */
  hashes: number[];
}

export interface ReplayCheck {
  ok: boolean;
  frames: number;
  checked: number;
  mismatch: { frame: number; expected: number; actual: number } | null;
}

export interface RunOptions {
  /** Serialiseer en deserialiseer na dit frame en speel verder op de geladen kopie. */
  reloadAfterFrame?: number;
}

export function lastFrameOf(r: Replay): number {
  let last = -1;
  for (const b of r.bundles) last = Math.max(last, b.frame);
  for (const h of r.hashes) last = Math.max(last, h.frame);
  return last;
}

/** Speelt een replay af in de omgeving `env` en geeft de hash na elk frame. Ontbrekende bundels gelden als leeg. */
export function runReplayIn(r: Replay, env: SimEnv, opts: RunOptions = {}): ReplayRun {
  const byFrame = new Map<number, FrameBundle>();
  for (const b of r.bundles) {
    if (byFrame.has(b.frame)) throw new Error(`replay heeft twee bundels voor frame ${b.frame}`);
    byFrame.set(b.frame, b);
  }
  const last = lastFrameOf(r);
  let sim = createSim({ seed: r.seed, ...env });
  const hashes: number[] = [];
  for (let f = 0; f <= last; f++) {
    sim.applyBundle(byFrame.get(f) ?? { frame: f, commands: [] });
    hashes.push(sim.tick());
    if (opts.reloadAfterFrame === f) {
      const copy = deserialize(sim.serialize(), env);
      if (copy.hash() !== sim.hash()) throw new Error(`hash na deserialize wijkt af op frame ${f}`);
      sim = copy;
    }
  }
  return { lastFrame: last, hashes };
}

/** Vergelijkt de hashes van een run met de opgeslagen hashes van de replay. */
export function compareRun(r: Replay, run: ReplayRun): ReplayCheck {
  for (const e of r.hashes) {
    const actual = run.hashes[e.frame];
    if (actual !== e.hash)
      return {
        ok: false,
        frames: run.lastFrame + 1,
        checked: r.hashes.length,
        mismatch: { frame: e.frame, expected: e.hash, actual: actual ?? -1 },
      };
  }
  return { ok: true, frames: run.lastFrame + 1, checked: r.hashes.length, mismatch: null };
}

/** Hashes om op te slaan: elke HASH_INTERVAL_FRAMES frames plus het laatste frame. */
export function recordedHashes(run: ReplayRun): FrameHash[] {
  const out: FrameHash[] = [];
  for (let f = 0; f <= run.lastFrame; f++) {
    if (f % HASH_INTERVAL_FRAMES === 0 || f === run.lastFrame)
      out.push({ frame: f, hash: run.hashes[f]! });
  }
  return out;
}

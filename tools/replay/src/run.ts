import { HASH_INTERVAL_FRAMES, Replay } from '@crawlout/protocol';
import type { FrameBundle } from '@crawlout/protocol';
import { createSim, deserialize } from '@crawlout/sim';
import type { Sim, SimEnv } from '@crawlout/sim';
import { buildEnv, gameData } from './env.js';

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

/** Valideert een replay-JSON tegen het protocol-schema. */
export function parseReplay(json: unknown): Replay {
  return Replay.parse(json);
}

function lastFrameOf(r: Replay): number {
  let last = -1;
  for (const b of r.bundles) last = Math.max(last, b.frame);
  for (const h of r.hashes) last = Math.max(last, h.frame);
  return last;
}

/** Omgeving van een replay; gooit als de replay voor andere data is of de map niet bestaat. */
export function replayEnv(r: Replay): SimEnv {
  const { data } = gameData();
  if (data.dataVersion !== r.dataVersion) throw new Error(`replay is voor data ${r.dataVersion}, data/VERSION is ${data.dataVersion}`);
  return buildEnv(r.map, r.players, r.settings);
}

/** Maakt de sim voor een replay: omgeving uit data/ en data/maps, startopstelling in createSim. */
export function createReplaySim(r: Replay): Sim {
  return createSim({ seed: r.seed, ...replayEnv(r) });
}

/** Speelt een replay af en geeft de hash na elk frame. Ontbrekende bundels gelden als leeg. */
export function runReplay(r: Replay, opts: RunOptions = {}): ReplayRun {
  const byFrame = new Map<number, FrameBundle>();
  for (const b of r.bundles) {
    if (byFrame.has(b.frame)) throw new Error(`replay heeft twee bundels voor frame ${b.frame}`);
    byFrame.set(b.frame, b);
  }
  const last = lastFrameOf(r);
  let sim = createReplaySim(r);
  const hashes: number[] = [];
  for (let f = 0; f <= last; f++) {
    sim.applyBundle(byFrame.get(f) ?? { frame: f, commands: [] });
    hashes.push(sim.tick());
    if (opts.reloadAfterFrame === f) {
      const copy = deserialize(sim.serialize(), replayEnv(r));
      if (copy.hash() !== sim.hash()) throw new Error(`hash na deserialize wijkt af op frame ${f}`);
      sim = copy;
    }
  }
  return { lastFrame: last, hashes };
}

/** Vergelijkt de hashes van een run met de opgeslagen hashes van de replay. */
export function checkReplay(r: Replay, opts: RunOptions = {}): ReplayCheck {
  const run = runReplay(r, opts);
  for (const e of r.hashes) {
    const actual = run.hashes[e.frame];
    if (actual !== e.hash) return { ok: false, frames: run.lastFrame + 1, checked: r.hashes.length, mismatch: { frame: e.frame, expected: e.hash, actual: actual ?? -1 } };
  }
  return { ok: true, frames: run.lastFrame + 1, checked: r.hashes.length, mismatch: null };
}

/** Hashes om op te slaan: elke HASH_INTERVAL_FRAMES frames plus het laatste frame. */
export function recordedHashes(run: ReplayRun): FrameHash[] {
  const out: FrameHash[] = [];
  for (let f = 0; f <= run.lastFrame; f++) {
    if (f % HASH_INTERVAL_FRAMES === 0 || f === run.lastFrame) out.push({ frame: f, hash: run.hashes[f]! });
  }
  return out;
}

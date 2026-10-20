import { Replay } from '@crawlout/protocol';
import { createSim } from '@crawlout/sim';
import type { Sim, SimEnv } from '@crawlout/sim';
import { buildEnv, gameData } from './env.js';
import { compareRun, runReplayIn } from './run-core.js';
import type { ReplayCheck, ReplayRun, RunOptions } from './run-core.js';

export type { FrameHash, ReplayCheck, ReplayRun, RunOptions } from './run-core.js';
export { recordedHashes } from './run-core.js';

/** Valideert een replay-JSON tegen het protocol-schema. */
export function parseReplay(json: unknown): Replay {
  return Replay.parse(json);
}

/** Omgeving van een replay; gooit als de replay voor andere data is of de map niet bestaat. */
export function replayEnv(r: Replay): SimEnv {
  const { data } = gameData();
  if (data.dataVersion !== r.dataVersion)
    throw new Error(`replay is voor data ${r.dataVersion}, data/VERSION is ${data.dataVersion}`);
  return buildEnv(r.map, r.players, r.settings);
}

/**
 * A fixture of the replay set: its `dataVersion` is a recording detail, not a check (fase-0 sectie 24 besluit 4). The
 * set compares hashes only, so it runs against the current data/VERSION; the envHash covers what the sim reads field
 * by field, so a data bump that changes nothing the sim reads keeps every hash. A real replay keeps the lobby check
 * (replayEnv).
 */
export function asFixture(r: Replay): Replay {
  return { ...r, dataVersion: gameData().data.dataVersion };
}

/** Maakt de sim voor een replay: omgeving uit data/ en data/maps, startopstelling in createSim. */
export function createReplaySim(r: Replay): Sim {
  return createSim({ seed: r.seed, ...replayEnv(r) });
}

/** Speelt een replay af en geeft de hash na elk frame. Ontbrekende bundels gelden als leeg. */
export function runReplay(r: Replay, opts: RunOptions = {}): ReplayRun {
  return runReplayIn(r, replayEnv(r), opts);
}

/** Vergelijkt de hashes van een run met de opgeslagen hashes van de replay. */
export function checkReplay(r: Replay, opts: RunOptions = {}): ReplayCheck {
  return compareRun(r, runReplay(r, opts));
}

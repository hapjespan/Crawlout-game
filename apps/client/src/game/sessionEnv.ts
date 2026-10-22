// The sim environment of a match, built from a relay `start` message (split off session.ts).
// Same shape as tools/replay env-core.ts: both have to produce the identical SimEnv, or a headless replay of a live
// match would not reproduce it.
import { convertDominance, type GameData } from '@crawlout/data';
import type { ServerMessage } from '@crawlout/protocol';
import {
  simConfigFromGameData,
  simDifficulty,
  simMapFromGrid,
  simPlayersFromLobby,
  type SimEnv,
  type SimInit,
} from '@crawlout/sim';
import type { ClientMap } from './content.js';

/**
 * MatchSettings.difficulty (protocol 0.21.0) as the SimInit part: `{ difficulty }` with a level, `{}` without. Absent
 * keeps the env (and so the envHash) exactly as it was, which is what every older match and replay needs.
 */
export function difficultyOf(difficulty?: string): { difficulty?: number } {
  const level = simDifficulty(difficulty);
  return level === undefined ? {} : { difficulty: level };
}

/** The sim environment of this match from a start message; the seed travels separately. */
export function initFromStart(
  data: GameData,
  map: ClientMap,
  msg: Extract<ServerMessage, { kind: 'start' }>,
): SimInit {
  const players = msg.players.map((p) => ({
    playerId: p.playerId,
    faction: p.faction,
    ai: p.ai,
  }));
  const dominance = convertDominance({
    pointsRequired: map.dominance.pointsRequired,
    minutes: msg.settings.dominanceMinutes ?? map.dominance.minutes,
  });
  return {
    seed: msg.seed,
    players: simPlayersFromLobby(data, players),
    // win route C (data 0.31.0): the project sites only in the game type Bouwproject; survival co-op (sim 0.27.0):
    // edges and build zones only in the game type Survival (same as tools/replay env-core)
    map: simMapFromGrid(
      { ...map.grid, dominance },
      msg.settings.mode === 'project'
        ? { project: data.project }
        : msg.settings.mode === 'survival'
          ? { survival: data.survival }
          : {},
    ),
    config: simConfigFromGameData(data),
    ...difficultyOf(msg.settings.difficulty), // protocol 0.21.0
  };
}

/**
 * Everything of a SimInit except the seed: what the worker needs to load a peer's state on a resync. The difficulty has
 * to come along; without it the rebuilt sim gets another envHash and the state refuses to load.
 */
export const envOfInit = (init: SimInit): SimEnv => ({
  players: init.players,
  map: init.map,
  config: init.config,
  ...(init.difficulty === undefined ? {} : { difficulty: init.difficulty }),
});

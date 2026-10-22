import { convertDominance } from '@crawlout/data';
import type { GameData, MapDef } from '@crawlout/data';
import type { MapGrid } from '@crawlout/map';
import type { LobbyPlayer, MatchSettings } from '@crawlout/protocol';
import { simMapFromGrid, simPlayersFromLobby } from '@crawlout/sim';
import type { SimConfig, SimEnv } from '@crawlout/sim';

// De omgeving van een replay uit geladen data en een geladen map, zonder IO: Node (env.ts) en de browser-bundel
// (browser/entry.ts) bouwen hem allebei hiermee, zodat de replay-set in elke runtime dezelfde SimEnv krijgt.

/** SimEnv voor een replay of start-bericht: map, data, spelers en de lobby-override van de dominantie. */
export function envFrom(
  data: GameData,
  config: SimConfig,
  def: MapDef,
  grid: MapGrid,
  players: readonly LobbyPlayer[],
  settings: MatchSettings,
): SimEnv {
  const dominance = convertDominance({
    pointsRequired: def.dominance.pointsRequired,
    minutes: settings.dominanceMinutes ?? def.dominance.minutes,
  });
  return {
    players: simPlayersFromLobby(data, players),
    // win route C (data 0.31.0): the project sites only in the game type Bouwproject; survival co-op (sim 0.27.0):
    // edges and build zones (the spawns on the zones) only in the game type Survival
    map: simMapFromGrid(
      { ...grid, dominance },
      settings.mode === 'project'
        ? { project: data.project }
        : settings.mode === 'survival'
          ? { survival: data.survival }
          : {},
    ),
    config,
  };
}

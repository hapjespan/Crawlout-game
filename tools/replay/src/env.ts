import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MapDef } from '@crawlout/data';
import type { GameData } from '@crawlout/data';
import { loadGameDataFromDir } from '@crawlout/data/node';
import { loadMap } from '@crawlout/map';
import type { MapGrid } from '@crawlout/map';
import type { LobbyPlayer, MatchSettings } from '@crawlout/protocol';
import { simConfigFromGameData } from '@crawlout/sim';
import type { SimConfig, SimEnv } from '@crawlout/sim';
import { envFrom } from './env-core.js';

// Omgeving van een replay uit de echte bestanden: data/ via de data-loader, data/maps/<map>.json via packages/map,
// en de spelers en instellingen uit de replay. Dit is dezelfde opbouw als de client (session.ts) moet doen.

export const DATA_DIR = fileURLToPath(new URL('../../../data', import.meta.url));

let cached: { data: GameData; config: SimConfig } | null = null;
const grids = new Map<string, { def: MapDef; grid: MapGrid }>();

export function gameData(): { data: GameData; config: SimConfig } {
  if (cached === null) {
    const data = loadGameDataFromDir(DATA_DIR);
    cached = { data, config: simConfigFromGameData(data) };
  }
  return cached;
}

export function mapGrid(id: string): { def: MapDef; grid: MapGrid } {
  let g = grids.get(id);
  if (g === undefined) {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`onbekende map in replay: ${id}`);
    let text: string;
    try {
      text = readFileSync(`${DATA_DIR}/maps/${id}.json`, 'utf8');
    } catch {
      throw new Error(`onbekende map in replay: ${id}`);
    }
    const def = MapDef.parse(JSON.parse(text));
    g = { def, grid: loadMap(def, { read: (ref) => readFileSync(`${DATA_DIR}/${ref}`, 'utf8') }) };
    grids.set(id, g);
  }
  return g;
}

/** SimEnv voor een replay of start-bericht: map, data, spelers en de lobby-override van de dominantie. */
export function buildEnv(
  mapId: string,
  players: readonly LobbyPlayer[],
  settings: MatchSettings,
): SimEnv {
  const { data, config } = gameData();
  const { def, grid } = mapGrid(mapId);
  return envFrom(data, config, def, grid, players, settings);
}

/**
 * De ruwe bestanden van een map (mapdefinitie plus de bestanden waar hij naar verwijst), zoals de browser-bundel ze
 * nodig heeft om dezelfde map te laden zonder bestandssysteem.
 */
export function mapSources(id: string): { def: unknown; files: Record<string, string> } {
  const { def } = mapGrid(id);
  const files: Record<string, string> = {};
  loadMap(def, {
    read: (ref) => {
      files[ref] = readFileSync(`${DATA_DIR}/${ref}`, 'utf8');
      return files[ref]!;
    },
  });
  return { def: JSON.parse(readFileSync(`${DATA_DIR}/maps/${id}.json`, 'utf8')) as unknown, files };
}

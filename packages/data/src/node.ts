import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadGameData, type GameData, type RawGameData } from './loader.js';

// Node-only IO voor tests, replay en tools. NIET importeren vanuit de sim of de browser-bundel
// (de loader zelf is puur en staat in loader.ts). Maps (data/maps) worden hier bewust niet gelezen.

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8')) as unknown;

/** Leest data/*.json, data/ai/*.json en data/VERSION uit `dir`. Geen validatie; geef het resultaat aan loadGameData. */
export function readDataDir(dir: string): RawGameData {
  const aiDir = join(dir, 'ai');
  const aiFiles = readdirSync(aiDir)
    .filter((name) => name.endsWith('.json'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    version: readFileSync(join(dir, 'VERSION'), 'utf8'),
    factions: readJson(join(dir, 'factions.json')),
    loadouts: readJson(join(dir, 'loadouts.json')),
    buildings: readJson(join(dir, 'buildings.json')),
    tech: readJson(join(dir, 'tech.json')),
    heroes: readJson(join(dir, 'heroes.json')),
    perks: readJson(join(dir, 'perks.json')),
    training: readJson(join(dir, 'training.json')),
    damageMatrix: readJson(join(dir, 'damage-matrix.json')),
    sim: readJson(join(dir, 'sim.json')),
    ai: aiFiles.map((name) => readJson(join(aiDir, name))),
    creeps: readJson(join(dir, 'creeps.json')),
  };
}

/** Gemak: readDataDir plus loadGameData in een keer. */
export const loadGameDataFromDir = (dir: string): GameData => loadGameData(readDataDir(dir));

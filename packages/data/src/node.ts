import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadGameData, type GameData, type RawGameData } from './loader.js';

// Node-only IO voor tests, replay en tools. NIET importeren vanuit de sim of de browser-bundel
// (de loader zelf is puur en staat in loader.ts). Maps (data/maps) worden hier bewust niet gelezen.

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8')) as unknown;

/** The *.json file names in `dir`, sorted by code unit (the file-name order is part of the data). */
const jsonFilesIn = (dir: string): string[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * A list split over several files (data/loadouts/*.json, data/buildings/*.json): each file is a JSON array,
 * concatenated in file-name order, so the result equals the former single file record for record.
 */
const readJsonArrays = (dir: string): unknown[] =>
  jsonFilesIn(dir).flatMap((name) => readJson(join(dir, name)));

/**
 * Leest data/*.json en de mappen ai, loadouts en buildings plus data/VERSION uit `dir`. Geen validatie; geef het
 * resultaat aan loadGameData.
 */
export function readDataDir(dir: string): RawGameData {
  const aiDir = join(dir, 'ai');
  const aiFiles = jsonFilesIn(aiDir);
  return {
    version: readFileSync(join(dir, 'VERSION'), 'utf8'),
    factions: readJson(join(dir, 'factions.json')),
    loadouts: readJsonArrays(join(dir, 'loadouts')),
    buildings: readJsonArrays(join(dir, 'buildings')),
    tech: readJson(join(dir, 'tech.json')),
    heroes: readJson(join(dir, 'heroes.json')),
    perks: readJson(join(dir, 'perks.json')),
    training: readJson(join(dir, 'training.json')),
    damageMatrix: readJson(join(dir, 'damage-matrix.json')),
    sim: readJson(join(dir, 'sim.json')),
    ai: aiFiles.map((name) => readJson(join(aiDir, name))),
    creeps: readJson(join(dir, 'creeps.json')),
    project: readJson(join(dir, 'project.json')),
    ...(existsSync(join(dir, 'survival'))
      ? {
          survival: {
            units: readJson(join(dir, 'survival', 'units.json')),
            waves: readJson(join(dir, 'survival', 'waves.json')),
          },
        }
      : {}),
  };
}

/** Gemak: readDataDir plus loadGameData in een keer. */
export const loadGameDataFromDir = (dir: string): GameData => loadGameData(readDataDir(dir));

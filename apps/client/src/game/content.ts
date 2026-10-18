/// <reference types="vite/client" />
// Browser side of the data pipeline: Vite bundles data/ at build time, the pure loaders validate and convert.
// Node uses @crawlout/data/node instead; both end in the same loadGameData and loadMap.
import { loadGameData, MapDef, type GameData, type RawGameData } from '@crawlout/data';
import dataVersion from '../../../../data/VERSION?raw';
import {
  greyboxMesh,
  loadHeightmap,
  loadMap,
  loadProps,
  type MapGrid,
  type PropInstance,
} from '@crawlout/map';

const json = import.meta.glob('../../../../data/*.json', { eager: true, import: 'default' });
const ai = import.meta.glob('../../../../data/ai/*.json', { eager: true, import: 'default' });
const loadoutFiles = import.meta.glob('../../../../data/loadouts/*.json', {
  eager: true,
  import: 'default',
});
const buildingFiles = import.meta.glob('../../../../data/buildings/*.json', {
  eager: true,
  import: 'default',
});
const mapFiles = import.meta.glob('../../../../data/maps/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
});

const DATA_PREFIX = '../../../../data/';

function file(name: string): unknown {
  const value = json[`${DATA_PREFIX}${name}`];
  if (value === undefined) throw new Error(`data/${name} ontbreekt in de bundel`);
  return value;
}

/** A list split over data/<dir>/*.json: the arrays concatenated in file-name order (as readDataDir in Node). */
function concatSorted(files: Record<string, unknown>): unknown[] {
  return Object.keys(files)
    .sort()
    .flatMap((k) => files[k]);
}

export function loadClientGameData(): GameData {
  const raw: RawGameData = {
    version: dataVersion,
    factions: file('factions.json'),
    loadouts: concatSorted(loadoutFiles),
    buildings: concatSorted(buildingFiles),
    tech: file('tech.json'),
    heroes: file('heroes.json'),
    perks: file('perks.json'),
    training: file('training.json'),
    damageMatrix: file('damage-matrix.json'),
    sim: file('sim.json'),
    creeps: file('creeps.json'),
    project: file('project.json'),
    ai: Object.keys(ai)
      .sort()
      .map((k) => ai[k]),
  };
  return loadGameData(raw);
}

export interface ClientMap {
  grid: MapGrid;
  /** Dominance rule from maps/*.json (minutes); the session converts it with convertDominance. */
  dominance: { pointsRequired: number; minutes: number };
  terrain: { positions: Float32Array; indices: Uint32Array; colors: Uint8Array };
  /** Decorative props (render only; the sim never reads them). */
  props: PropInstance[];
}

export function loadClientMap(id: string): ClientMap {
  const read = (ref: string): string => {
    const text = mapFiles[`${DATA_PREFIX}${ref}`];
    if (typeof text !== 'string') throw new Error(`mapbestand data/${ref} ontbreekt in de bundel`);
    return text;
  };
  const def = MapDef.parse(JSON.parse(read(`maps/${id}.json`)));
  const assets = { read };
  const grid = loadMap(def, assets);
  const mesh = greyboxMesh(grid, loadHeightmap(def, assets));
  // The greybox is in sim units (Int32); the renderer wants meters as floats.
  const positions = new Float32Array(mesh.positions.length);
  for (let i = 0; i < positions.length; i++) positions[i] = mesh.positions[i]! / mesh.unitsPerMeter;
  return {
    grid,
    dominance: def.dominance,
    terrain: { positions, indices: mesh.indices, colors: mesh.colors },
    props: loadProps(def, assets),
  };
}

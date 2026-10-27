// Shared fixtures of the props tests (props.test.ts and props.*.test.ts): the committed Rustbelt map and its props,
// read once per test file at import.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MapDef } from '@crawlout/data';
import {
  decodeGrid,
  loadMap,
  parseProps,
  pathCorridor,
  PROP_INFO,
  type MapAssets,
  type PropCategory,
  type PropRecord,
  type PropsFile,
} from '../src/index.js';

export const dataDir = fileURLToPath(new URL('../../../data/', import.meta.url));
export const manifestPath = fileURLToPath(
  new URL('../../../assets/dist/manifest.json', import.meta.url),
);
export const assets: MapAssets = { read: (ref) => readFileSync(dataDir + ref, 'utf8') };
export const def = MapDef.parse(JSON.parse(assets.read('maps/rustbelt.json')));
export const map = loadMap(def, assets);
export const N = 384;
export const file: PropsFile = parseProps(assets.read(def.props as string), N, N);
export const U = 256;
export const water = decodeGrid(assets.read(def.water as string), N, N, 'u8');
export const heights = decodeGrid(assets.read(def.heightmap), N, N, 'i16') as Int16Array;
export const cellOf = (v: number): number => v >> 8;
export const onPassable = (x: number, y: number): boolean =>
  map.passable[cellOf(y) * N + cellOf(x)] === 1;
export const withoutProps = (d: MapDef): MapDef => {
  const copy: Record<string, unknown> = { ...d };
  delete copy['props'];
  return copy as MapDef;
};
export const categoryOf = (asset: string): PropCategory => PROP_INFO[asset]!.category;
export const byCategory = (c: PropCategory | PropCategory[]): PropRecord[] => {
  const set = new Set(Array.isArray(c) ? c : [c]);
  return file.props.filter((p) => set.has(categoryOf(p.asset)));
};
export const keys = [...map.spawns, ...map.scrapNodes, ...map.claimPoints, ...map.creepCamps];
export const corridor = pathCorridor(map, map.spawns, keys);
/** Afstand (m) tussen een prop en een punt in cellen (middelpunt). */
export const distM = (p: { x: number; y: number }, c: { x: number; y: number }): number =>
  Math.sqrt((p.x / U - c.x - 0.5) ** 2 + (p.y / U - c.y - 0.5) ** 2);
export const near = (
  c: { x: number; y: number },
  maxM: number,
  list: PropRecord[] = file.props,
): PropRecord[] => list.filter((p) => distM(p, c) <= maxM);
export const CAMP_ASSETS = [
  'debris_pallet_01',
  'debris_pallet_02',
  'debris_table_01',
  'debris_chair_01',
  'debris_crate_01',
  'debris_barrel_01',
  'chest_01',
  'chest_02',
  'chest_03',
  'barrel_01',
  'crate_01',
];
export const WALLS = ['wall_wood_01', 'wall_wood_02', 'wall_wood_03', 'wall_wood_04'];
/** Cellen binnen de schijf van `rM` meter rond een prop, als [cx, cy]. */
export function diskCells(p: { x: number; y: number }, rM: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const r = Math.ceil(rM);
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const cx = cellOf(p.x) + dx;
      const cy = cellOf(p.y) + dy;
      if (cx < 0 || cy < 0 || cx >= N || cy >= N) continue;
      if (((cx + 0.5) * U - p.x) ** 2 + ((cy + 0.5) * U - p.y) ** 2 > (rM * U) ** 2) continue;
      out.push([cx, cy]);
    }
  return out;
}

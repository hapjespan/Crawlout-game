// Shared fixtures and helpers of the map tests (maps.test.ts and maps.*.test.ts).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MapDef } from '@crawlout/data';
import { readDataDir } from '@crawlout/data/node';
import { isPassable, loadMap, type MapAssets } from '../src/index.js';

export const dataDir = fileURLToPath(new URL('../../../data/', import.meta.url));
export const assets: MapAssets = { read: (ref) => readFileSync(dataDir + ref, 'utf8') };
export const readDef = (name: string): MapDef =>
  MapDef.parse(JSON.parse(assets.read(`maps/${name}.json`)));
export const readDominance = (name: string): unknown => readDef(name).dominance;

export const claimRadiusM = (): number =>
  (readDataDir(dataDir).sim as { claimRadiusM: number }).claimRadiusM;
export const exclusiveRadiusM = (): number =>
  (readDataDir(dataDir).sim as { exclusiveRadiusM: number }).exclusiveRadiusM;
export const claimFootprint = (): { w: number; h: number } => {
  const b = (
    readDataDir(dataDir).buildings as Array<{ id: string; footprint: { w: number; h: number } }>
  ).find((x) => x.id === 'claimpaal');
  if (b === undefined) throw new Error('claimpaal ontbreekt in data/buildings.json');
  return b.footprint;
};

export const footprintOf = (id: string): { w: number; h: number } => {
  const b = (
    readDataDir(dataDir).buildings as Array<{ id: string; footprint: { w: number; h: number } }>
  ).find((x) => x.id === id);
  if (b === undefined) throw new Error(`${id} ontbreekt in data/buildings.json`);
  return b.footprint;
};

export const N = 384;
export const MID = N - 1; // spiegel: (x, y) -> (MID - x, MID - y)

/** BFS-afstand (4-buren) in cellen over begaanbare cellen, minus `blocked`; -1 = onbereikbaar. */
export function bfsDist(
  map: ReturnType<typeof loadMap>,
  sx: number,
  sy: number,
  blocked?: Uint8Array,
): Int32Array {
  const w = map.w;
  const d = new Int32Array(w * map.h).fill(-1);
  const q = new Int32Array(w * map.h);
  let tail = 0;
  q[tail++] = sy * w + sx;
  d[sy * w + sx] = 0;
  for (let head = 0; head < tail; head++) {
    const i = q[head]!;
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ] as const) {
      if (!isPassable(map, x + dx, y + dy)) continue;
      const j = (y + dy) * w + x + dx;
      if (d[j] !== -1 || blocked?.[j] === 1) continue;
      d[j] = d[i]! + 1;
      q[tail++] = j;
    }
  }
  return d;
}

/** Pad (celindices) van a naar b langs dalende afstand; null als b onbereikbaar is. */
export function pathTo(
  map: ReturnType<typeof loadMap>,
  a: { x: number; y: number },
  b: { x: number; y: number },
  blocked?: Uint8Array,
): number[] | null {
  const d = bfsDist(map, b.x, b.y, blocked);
  const w = map.w;
  let i = a.y * w + a.x;
  if (d[i] === -1) return null;
  const out = [i];
  while (d[i] !== 0) {
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ] as const) {
      const j = (y + dy) * w + x + dx;
      if (isPassable(map, x + dx, y + dy) && d[j] === d[i]! - 1) {
        i = j;
        break;
      }
    }
    out.push(i);
  }
  return out;
}

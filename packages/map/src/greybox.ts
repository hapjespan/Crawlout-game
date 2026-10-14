import { metersToUnits } from '@crawlout/data';
import type { Heightmap, MapGrid } from './types.js';

// Greybox-export voor de renderer: platte typed arrays, geen three.js. De renderer maakt er een BufferGeometry van.
// De determinisme-lint verbiedt Float32Array in dit package, dus posities zijn Int32 in sim-eenheden (1 m = 256);
// de renderer deelt door `unitsPerMeter` bij het vullen van zijn Float32Array.
export interface GreyboxMesh {
  /** xyz per vertex, sim-eenheden. x = cel-x, y = hoogte (omhoog), z = cel-y. */
  positions: Int32Array;
  /** rgb per vertex, 0..255 (normalized Uint8 attribuut). */
  colors: Uint8Array;
  /** Driehoekslijst, tegen de klok in gezien van boven (+y). */
  indices: Uint32Array;
  vertexCount: number;
  unitsPerMeter: number;
}

export const TILE_GROUND = 0;
export const TILE_RUIN = 1;
export const TILE_CLIFF = 2;
export type TerrainTile = typeof TILE_GROUND | typeof TILE_RUIN | typeof TILE_CLIFF;

/** Onbegaanbare cellen vanaf deze hoogte (1/256 m, ca. 3,75 m) zijn kliffen, lager zijn het ruines. */
export const CLIFF_MIN_HEIGHT = 960;

export function terrainTile(map: MapGrid, heights: Heightmap, x: number, y: number): TerrainTile {
  const i = y * map.w + x;
  if (map.passable[i] === 1) return TILE_GROUND;
  return (heights.data[i] as number) >= CLIFF_MIN_HEIGHT ? TILE_CLIFF : TILE_RUIN;
}

/** Markeringskleuren voor cellen met een scrap-node of claimpunt (zichtbaar op het terrein; heeft voorrang op de terreinkleur). */
export const MARK_SCRAP_RGB: readonly [number, number, number] = [235, 190, 40];
export const MARK_CLAIM_RGB: readonly [number, number, number] = [60, 150, 230];

const TILE_RGB: ReadonlyArray<readonly [number, number, number]> = [
  [150, 128, 94], // grond: woestijnzand
  [112, 96, 90], // ruine: rood-bruin beton
  [78, 72, 68], // klif: donker gesteente
];

// Reciproken (16 bit) om het gemiddelde van 1 tot 4 buurcellen te nemen zonder deling.
const RECIP = [0, 65536, 32768, 21845, 16384];

/** Gemiddelde hoogte van de cellen die hoekpunt (cx, cy) delen, in sim-eenheden. */
function cornerHeight(heights: Heightmap, cx: number, cy: number): number {
  let sum = 0;
  let n = 0;
  for (let dy = -1; dy <= 0; dy++) {
    for (let dx = -1; dx <= 0; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= heights.w || y >= heights.h) continue;
      sum += heights.data[y * heights.w + x] as number;
      n++;
    }
  }
  return (sum * (RECIP[n] as number)) >> 16;
}

/**
 * Eén quad per cel (4 vertices, vlakke kleur per cel zodat passability zichtbaar is), met hoekhoogtes die over
 * celgrenzen heen gemiddeld zijn zodat het oppervlak aansluit. Kliffen en ruines zijn verhoogd in de heightmap.
 */
export function greyboxMesh(map: MapGrid, heights: Heightmap): GreyboxMesh {
  if (heights.w !== map.w || heights.h !== map.h)
    throw new Error('greyboxMesh: heightmap past niet bij de map');
  const { w, h } = map;
  const cells = w * h;
  const positions = new Int32Array(cells * 4 * 3);
  const colors = new Uint8Array(cells * 4 * 3);
  const indices = new Uint32Array(cells * 6);
  // Hoekhoogtes eenmalig: (w+1) x (h+1).
  const corner = new Int32Array((w + 1) * (h + 1));
  for (let cy = 0; cy <= h; cy++)
    for (let cx = 0; cx <= w; cx++) corner[cy * (w + 1) + cx] = cornerHeight(heights, cx, cy);

  // Markering per cel: 0 = geen, 1 = scrap-node, 2 = claimpunt (claim wint bij overlap).
  const marks = new Uint8Array(cells);
  for (const n of map.scrapNodes) marks[n.y * w + n.x] = 1;
  for (const c of map.claimPoints) marks[c.y * w + c.x] = 2;

  let v = 0;
  let ii = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tile = terrainTile(map, heights, x, y);
      const mark = marks[y * w + x] as number;
      const rgb =
        mark === 2
          ? MARK_CLAIM_RGB
          : mark === 1
            ? MARK_SCRAP_RGB
            : (TILE_RGB[tile] as readonly [number, number, number]);
      // Lichte hoogte-arcering: 0..31 extra helderheid per ca. 2 m (alleen visuele hulp).
      const shade =
        mark !== 0 ? 0 : Math.min(31, Math.max(0, (heights.data[y * w + x] as number) >> 4));
      const base = v;
      const quad: ReadonlyArray<readonly [number, number]> = [
        [x, y],
        [x + 1, y],
        [x, y + 1],
        [x + 1, y + 1],
      ];
      for (const [qx, qy] of quad) {
        const o = v * 3;
        positions[o] = metersToUnits(qx);
        positions[o + 1] = corner[qy * (w + 1) + qx] as number;
        positions[o + 2] = metersToUnits(qy);
        colors[o] = Math.min(255, rgb[0] + shade);
        colors[o + 1] = Math.min(255, rgb[1] + shade);
        colors[o + 2] = Math.min(255, rgb[2] + shade);
        v++;
      }
      // Bovenaanzicht met +z naar beneden: (x,y)->(x,y+1)->(x+1,y) is tegen de klok in gezien vanaf +y.
      indices[ii++] = base;
      indices[ii++] = base + 2;
      indices[ii++] = base + 1;
      indices[ii++] = base + 1;
      indices[ii++] = base + 2;
      indices[ii++] = base + 3;
    }
  }
  return { positions, colors, indices, vertexCount: v, unitsPerMeter: metersToUnits(1) };
}

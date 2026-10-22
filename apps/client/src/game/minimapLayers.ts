// Static minimap layers from the map: water from the water mask, and blocked cells split into forest (a tree prop
// stands on or next to the cell) and rock (cliffs, ruins). Built once; the HUD caches by array identity.
import type { PropInstance } from '@crawlout/map';

const TREE = /^tree|^bush/;

export interface MinimapLayers {
  water?: Uint8Array;
  terrain: Uint8Array;
}

export function minimapLayers(
  w: number,
  h: number,
  passable: Uint8Array,
  props: readonly PropInstance[],
  water: { w: number; h: number; data: Uint8Array } | null,
): MinimapLayers {
  const nearTree = new Uint8Array(w * h);
  for (const p of props) {
    if (!TREE.test(p.asset)) continue;
    const cx = Math.floor(p.x);
    const cy = Math.floor(p.y);
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && y >= 0 && x < w && y < h) nearTree[y * w + x] = 1;
      }
  }
  const wet = water && water.w === w && water.h === h ? water.data : null;
  const terrain = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (passable[i] === 1 || (wet && wet[i] !== 0)) continue;
    terrain[i] = nearTree[i] ? 1 : 2;
  }
  return { ...(wet ? { water: wet } : {}), terrain };
}

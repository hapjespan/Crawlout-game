// Fog of war on the client side: how often the sim is asked for the mask, whether the fog is on (`?fog=0` switches it
// off for testing), and the mask as the minimap wants it. The renderer takes the FogMask as it is (renderer.setFog).
import { FOG, fogAt, type FogMask } from '@crawlout/protocol';
import type { MinimapFog } from '@crawlout/ui';

/** The fog mask is asked for this often (ms); the renderer fades the change in between. */
export const FOG_POLL_MS = 200;

/** `?fog=0` disables the fog of war: every entity is shown (the sim's reveal-all view) and nothing is darkened. */
export function fogEnabled(params: URLSearchParams): boolean {
  return params.get('fog') !== '0';
}

/** The mask as per-cell bytes for the minimap: visible now, and explored (which includes the visible cells). */
export function minimapFogOf(mask: FogMask): MinimapFog {
  const n = mask.cellsW * mask.cellsH;
  const visible = new Uint8Array(n);
  const explored = new Uint8Array(n);
  for (let cy = 0; cy < mask.cellsH; cy++) {
    for (let cx = 0; cx < mask.cellsW; cx++) {
      const state = fogAt(mask, cx, cy);
      const i = cy * mask.cellsW + cx;
      if (state === FOG.visible) visible[i] = 1;
      if (state !== FOG.unexplored) explored[i] = 1;
    }
  }
  return { w: mask.cellsW, h: mask.cellsH, visible, explored };
}

/** Same cells as the last minimap fog: a mask that did not change keeps the object, so the HUD keeps its cached layer. */
export function sameMinimapFog(a: MinimapFog | undefined, b: MinimapFog): boolean {
  if (!a || a.w !== b.w || a.h !== b.h) return false;
  for (let i = 0; i < a.visible.length; i++)
    if (a.visible[i] !== b.visible[i] || a.explored[i] !== b.explored[i]) return false;
  return true;
}

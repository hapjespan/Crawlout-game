import { describe, expect, it } from 'vitest';
import type { FogMask } from '@crawlout/protocol';
import { FOG_POLL_MS, fogEnabled, minimapFogOf, sameMinimapFog } from '../src/game/fogView.js';

/** A mask from a picture: '#' visible, '+' explored only, '.' unexplored. */
function maskOf(rows: readonly string[]): FogMask {
  const h = rows.length;
  const w = rows[0]!.length;
  const explored = new Uint8Array(Math.ceil((w * h) / 8));
  const visible = new Uint8Array(Math.ceil((w * h) / 8));
  rows.forEach((row, cy) =>
    [...row].forEach((ch, cx) => {
      const c = cy * w + cx;
      if (ch === '#') visible[c >> 3]! |= 1 << (c & 7);
      if (ch === '#' || ch === '+') explored[c >> 3]! |= 1 << (c & 7);
    }),
  );
  return { frame: 0, playerId: 0, cellsW: w, cellsH: h, cellUnits: 512, explored, visible };
}

describe('fogEnabled', () => {
  it('is on unless ?fog=0', () => {
    expect(fogEnabled(new URLSearchParams(''))).toBe(true);
    expect(fogEnabled(new URLSearchParams('?fog=1'))).toBe(true);
    expect(fogEnabled(new URLSearchParams('?fog=0'))).toBe(false);
    expect(fogEnabled(new URLSearchParams('?webgl&fog=0'))).toBe(false);
  });

  it('asks the sim a few times a second, not every frame', () => {
    expect(FOG_POLL_MS).toBeGreaterThanOrEqual(100);
    expect(FOG_POLL_MS).toBeLessThanOrEqual(500);
  });
});

describe('minimapFogOf', () => {
  it('turns the bitsets into one byte per cell: visible, and explored including the visible', () => {
    const fog = minimapFogOf(maskOf(['#+.', '.#+']));
    expect(fog.w).toBe(3);
    expect(fog.h).toBe(2);
    expect(Array.from(fog.visible)).toEqual([1, 0, 0, 0, 1, 0]);
    expect(Array.from(fog.explored)).toEqual([1, 1, 0, 0, 1, 1]);
  });

  it('reads rows that cross a byte boundary', () => {
    const rows = ['#.#.#.#.#', '.#.#.#.#.'];
    const fog = minimapFogOf(maskOf(rows));
    expect(Array.from(fog.visible).join('')).toBe('101010101' + '010101010');
  });
});

describe('sameMinimapFog', () => {
  it('compares cells, so an unchanged mask keeps the HUD layer cached', () => {
    const a = minimapFogOf(maskOf(['#+.', '.#+']));
    expect(sameMinimapFog(a, minimapFogOf(maskOf(['#+.', '.#+'])))).toBe(true);
    expect(sameMinimapFog(a, minimapFogOf(maskOf(['#+.', '.##'])))).toBe(false);
    expect(sameMinimapFog(a, minimapFogOf(maskOf(['#+.', '.+.'])))).toBe(false);
    expect(sameMinimapFog(a, minimapFogOf(maskOf(['#+.', '.#+', '...'])))).toBe(false);
    expect(sameMinimapFog(undefined, a)).toBe(false);
  });
});

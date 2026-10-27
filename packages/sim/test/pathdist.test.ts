import { describe, expect, it } from 'vitest';
import { TERRAIN_UNREACHABLE, TerrainDistances } from '../src/pathdist.js';
import { createTestMap, createXlTestMap } from '../src/testing.js';

// Padafstanden over het terrein voor de AI (pathdist.ts): een BFS met 4-buren over map.passable vanaf een rechthoek.

describe('TerrainDistances', () => {
  it('is de BFS-afstand over land: om de muur heen, onbereikbaar achter de rand', () => {
    const map = createTestMap(64, 64); // muur op kolom 32 met een opening van 4 cellen op rij 30..33
    const td = new TerrainDistances(map);
    const f = td.field(8, 8, 1, 1);
    expect(f[8 * 64 + 8]).toBe(0);
    expect(f[8 * 64 + 12]).toBe(4);
    // aan de overkant van de muur, op dezelfde rij: via de opening
    const across = f[8 * 64 + 34]!;
    expect(across).toBeGreaterThanOrEqual(26 + 22 + 22);
    expect(f[0]).toBe(TERRAIN_UNREACHABLE); // de rand
    // een rechthoek als bron: de hele rechthoek op 0, ook als hij op een muur ligt
    const g = td.field(31, 10, 3, 2);
    expect(g[10 * 64 + 32]).toBe(0);
    expect(g[10 * 64 + 34]).toBe(1);
  });

  it('geeft dezelfde waarden, hoe vol de cache ook is', () => {
    const map = createXlTestMap();
    const a = new TerrainDistances(map);
    const ref = a.field(40, 40, 5, 5).slice();
    const b = new TerrainDistances(map);
    for (let k = 0; k < 40; k++) b.field(10 + k * 7, 300, 1, 1); // verdringt alles
    expect(b.field(40, 40, 5, 5)).toEqual(ref);
    // de punt-vorm: de cel onder het punt is de bron, en de afstand is symmetrisch
    const ab = b.at(b.fieldAt(42 * 256 + 10, 42 * 256 + 200), 200 * 256, 100 * 256);
    expect(ab).toBe(a.at(a.fieldAt(200 * 256 + 5, 100 * 256 + 5), 42 * 256, 42 * 256));
    expect(ab).toBeGreaterThan(158 + 58 - 1);
  });
});

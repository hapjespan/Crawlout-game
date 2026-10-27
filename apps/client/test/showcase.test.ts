import { describe, expect, it } from 'vitest';
import { buildingTypeId, heroTypeId, unitTypeId } from '@crawlout/data';
import { loadClientGameData } from '../src/game/content.js';
import { showcaseLayout, type ShowcaseItem } from '../src/render/showcase.js';
import { withVertibird } from '../src/render/demo.part1.js';

describe('showcaseLayout (render demo ?showcase)', () => {
  const data = loadClientGameData();
  const layout = showcaseLayout(data);

  it('has every loadout, hero and building exactly once', () => {
    const units = layout.units.map((u) => u.typeId).sort((a, b) => a - b);
    const want = [
      ...data.heroes.map((h) => heroTypeId(h.id)),
      ...data.loadouts.map((l) => unitTypeId(l.id)),
    ];
    expect(units).toEqual(want.sort((a, b) => a - b));
    expect(layout.buildings.map((b) => b.typeId).sort((a, b) => a - b)).toEqual(
      data.buildings.map((b) => buildingTypeId(b.id)).sort((a, b) => a - b),
    );
  });

  it('places nothing on top of anything else, and everything on the terrain', () => {
    const all: ShowcaseItem[] = [...layout.units, ...layout.buildings];
    for (const [i, a] of all.entries()) {
      expect(a.x - a.w / 2).toBeGreaterThanOrEqual(0);
      expect(a.x + a.w / 2).toBeLessThanOrEqual(layout.size);
      expect(a.z + a.d / 2).toBeLessThanOrEqual(layout.size);
      for (const b of all.slice(i + 1)) {
        const apart =
          Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.z - b.z) >= (a.d + b.d) / 2;
        expect(apart, `${a.label} overlaps ${b.label}`).toBe(true);
      }
    }
  });

  it('keeps each faction together', () => {
    for (const items of [layout.units, layout.buildings]) {
      const groups = items.map((i) => i.group).filter((g, k, all) => g !== all[k - 1]);
      expect(new Set(groups).size).toBe(groups.length);
    }
  });
});

describe('withVertibird (render demo ?vertibird)', () => {
  const loadouts = [
    { id: 0, key: 'scavenger' },
    { id: 7, key: 'vertibird' },
  ];
  it('adds one Vertibird per ten units, on top of a given mix', () => {
    expect(withVertibird([], loadouts)).toEqual([...Array(9).fill(1), unitTypeId(7)]);
    expect(withVertibird([5, 6], loadouts).slice(0, 3)).toEqual([5, 6, 5]);
    expect(withVertibird([5, 6], loadouts).at(-1)).toBe(unitTypeId(7));
  });
});

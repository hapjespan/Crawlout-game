import { describe, expect, it } from 'vitest';
import {
  buildingWallHeight,
  DEFAULT_FOOTPRINT,
  FootprintTable,
  footprintsFromGameData,
  snapFootprintCenter,
} from './footprint.js';
import {
  buildingIdOf,
  buildingTypeId,
  classifyTypeId,
  ENTITY_KIND,
  loadoutIdOf,
  TYPE_ID_BUILDING_FIRST,
  TYPE_ID_CLAIM,
  TYPE_ID_SCRAP_NODE,
} from './typeIds.js';

describe('classifyTypeId', () => {
  it('follows the typeId ranges of the content agent', () => {
    expect(classifyTypeId(0)).toBe(ENTITY_KIND.unknown);
    expect(classifyTypeId(1)).toBe(ENTITY_KIND.unit);
    expect(classifyTypeId(1023)).toBe(ENTITY_KIND.unit);
    expect(classifyTypeId(1024)).toBe(ENTITY_KIND.building);
    expect(classifyTypeId(2047)).toBe(ENTITY_KIND.building);
    expect(classifyTypeId(TYPE_ID_SCRAP_NODE)).toBe(ENTITY_KIND.scrapNode);
    expect(classifyTypeId(TYPE_ID_CLAIM)).toBe(ENTITY_KIND.claim);
    expect(classifyTypeId(2050)).toBe(ENTITY_KIND.unknown);
    expect(classifyTypeId(65535)).toBe(ENTITY_KIND.unknown);
  });

  it('maps ids back to loadouts and buildings', () => {
    expect(loadoutIdOf(1)).toBe(0);
    expect(loadoutIdOf(4)).toBe(3);
    expect(loadoutIdOf(1024)).toBe(-1);
    expect(buildingIdOf(TYPE_ID_BUILDING_FIRST + 7)).toBe(7);
    expect(buildingIdOf(5)).toBe(-1);
    expect(buildingTypeId(3)).toBe(1027);
  });
});

describe('FootprintTable', () => {
  const data = {
    buildings: [{ footprint: { w: 5, h: 5 } }, { footprint: { w: 2, h: 3 } }],
  } as Parameters<typeof footprintsFromGameData>[0];

  it('reads footprints from GameData by building typeId and falls back to the default', () => {
    const table = new FootprintTable(footprintsFromGameData(data));
    expect(table.get(buildingTypeId(0))).toEqual({ w: 5, h: 5 });
    expect(table.get(buildingTypeId(1))).toEqual({ w: 2, h: 3 });
    expect(table.get(buildingTypeId(9))).toEqual(DEFAULT_FOOTPRINT);
    expect(table.get(1)).toEqual({ w: 1, h: 1 });
  });

  it('drops its cache when the lookup changes', () => {
    const table = new FootprintTable();
    expect(table.get(buildingTypeId(0))).toEqual(DEFAULT_FOOTPRINT);
    table.setLookup(footprintsFromGameData(data));
    expect(table.get(buildingTypeId(0))).toEqual({ w: 5, h: 5 });
  });

  it('makes bigger buildings taller', () => {
    expect(buildingWallHeight({ w: 5, h: 5 })).toBeGreaterThan(buildingWallHeight({ w: 1, h: 1 }));
  });
});

describe('snapFootprintCenter', () => {
  it('centers odd footprints on a cell and even footprints on a cell corner', () => {
    expect(snapFootprintCenter(10 * 256 + 40, 3 * 256 + 200, { w: 3, h: 3 })).toEqual({
      x: 10 * 256 + 128,
      y: 3 * 256 + 128,
    });
    expect(snapFootprintCenter(10 * 256 + 40, 3 * 256 + 200, { w: 2, h: 2 })).toEqual({
      x: 10 * 256,
      y: 4 * 256,
    });
    expect(snapFootprintCenter(10 * 256 + 40, 3 * 256 + 200, { w: 2, h: 1 })).toEqual({
      x: 10 * 256,
      y: 3 * 256 + 128,
    });
  });
});

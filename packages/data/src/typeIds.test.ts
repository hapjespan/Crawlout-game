import { describe, expect, it } from 'vitest';
import { BUILDING_TYPE_BASE, CLAIM_POINT_TYPE_ID, HERO_TYPE_BASE, SCRAP_NODE_TYPE_ID, buildingTypeId, heroIdOfTypeId, heroTypeId, kindOfTypeId, unitTypeId } from './typeIds.js';

describe('typeId-ruimte', () => {
  it('legt de constanten vast', () => {
    expect(unitTypeId(0)).toBe(1);
    expect(unitTypeId(998)).toBe(999);
    expect(heroTypeId(0)).toBe(1000);
    expect(heroTypeId(23)).toBe(1023);
    expect(HERO_TYPE_BASE).toBe(1000);
    expect(buildingTypeId(0)).toBe(1024);
    expect(buildingTypeId(1023)).toBe(2047);
    expect(BUILDING_TYPE_BASE).toBe(1024);
    expect(SCRAP_NODE_TYPE_ID).toBe(2048);
    expect(CLAIM_POINT_TYPE_ID).toBe(2049);
  });

  it('doet een roundtrip voor units en gebouwen', () => {
    for (let i = 0; i <= 998; i++) expect(kindOfTypeId(unitTypeId(i))).toEqual({ kind: 'unit', index: i });
    for (let i = 0; i <= 998; i++) expect(heroIdOfTypeId(unitTypeId(i))).toBe(-1);
    // een held is een unit (render en HUD), herkenbaar via heroIdOfTypeId
    for (let h = 0; h <= 23; h++) {
      expect(kindOfTypeId(heroTypeId(h)).kind).toBe('unit');
      expect(heroIdOfTypeId(heroTypeId(h))).toBe(h);
    }
    for (const t of [0, 999, 1024, 2048, -1, 1000.5]) expect(heroIdOfTypeId(t)).toBe(-1);
    for (let i = 0; i <= 1023; i++) expect(kindOfTypeId(buildingTypeId(i))).toEqual({ kind: 'building', index: i });
  });

  it('herkent node, claim en none', () => {
    expect(kindOfTypeId(SCRAP_NODE_TYPE_ID).kind).toBe('scrapNode');
    expect(kindOfTypeId(CLAIM_POINT_TYPE_ID).kind).toBe('claimPoint');
    for (const t of [0, 2050, 65535, -1, 1.5]) expect(kindOfTypeId(t).kind).toBe('none');
  });

  it('weigert ids buiten de ruimte', () => {
    expect(() => unitTypeId(999)).toThrow(RangeError);
    expect(() => heroTypeId(24)).toThrow(RangeError);
    expect(() => buildingTypeId(1024)).toThrow(RangeError);
    expect(() => unitTypeId(-1)).toThrow(RangeError);
  });
});

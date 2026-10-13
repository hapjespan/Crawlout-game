import { describe, expect, it } from 'vitest';
import { BUILDING_TYPE_BASE, CLAIM_POINT_TYPE_ID, SCRAP_NODE_TYPE_ID, buildingTypeId, kindOfTypeId, unitTypeId } from './typeIds.js';

describe('typeId-ruimte', () => {
  it('legt de constanten vast', () => {
    expect(unitTypeId(0)).toBe(1);
    expect(unitTypeId(1022)).toBe(1023);
    expect(buildingTypeId(0)).toBe(1024);
    expect(buildingTypeId(1023)).toBe(2047);
    expect(BUILDING_TYPE_BASE).toBe(1024);
    expect(SCRAP_NODE_TYPE_ID).toBe(2048);
    expect(CLAIM_POINT_TYPE_ID).toBe(2049);
  });

  it('doet een roundtrip voor units en gebouwen', () => {
    for (let i = 0; i <= 1022; i++) expect(kindOfTypeId(unitTypeId(i))).toEqual({ kind: 'unit', index: i });
    for (let i = 0; i <= 1023; i++) expect(kindOfTypeId(buildingTypeId(i))).toEqual({ kind: 'building', index: i });
  });

  it('herkent node, claim en none', () => {
    expect(kindOfTypeId(SCRAP_NODE_TYPE_ID).kind).toBe('scrapNode');
    expect(kindOfTypeId(CLAIM_POINT_TYPE_ID).kind).toBe('claimPoint');
    for (const t of [0, 2050, 65535, -1, 1.5]) expect(kindOfTypeId(t).kind).toBe('none');
  });

  it('weigert ids buiten de ruimte', () => {
    expect(() => unitTypeId(1023)).toThrow(RangeError);
    expect(() => buildingTypeId(1024)).toThrow(RangeError);
    expect(() => unitTypeId(-1)).toThrow(RangeError);
  });
});

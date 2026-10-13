// typeId-ruimte (integratievoorstel, ter review door de architect): een plek waar sim, render en client
// dezelfde afspraak gebruiken voor Snapshot.typeId. Pure functies, geen afhankelijkheden.
//   1..1023     unit    = 1 + loadoutId
//   1024..2047  gebouw  = 1024 + buildingId
//   2048        scrap-node
//   2049        claim-point
//   0 en de rest: geen type
export const UNIT_TYPE_BASE = 1;
export const UNIT_TYPE_MAX = 1023;
export const BUILDING_TYPE_BASE = 1024;
export const BUILDING_TYPE_MAX = 2047;
export const SCRAP_NODE_TYPE_ID = 2048;
export const CLAIM_POINT_TYPE_ID = 2049;

export type TypeIdKind = 'unit' | 'building' | 'scrapNode' | 'claimPoint' | 'none';

function checkIndex(what: string, index: number, max: number): void {
  if (!Number.isInteger(index) || index < 0 || index > max) throw new RangeError(`${what} ${index} valt buiten 0..${max}`);
}

export const unitTypeId = (loadoutId: number): number => {
  checkIndex('loadoutId', loadoutId, UNIT_TYPE_MAX - UNIT_TYPE_BASE);
  return UNIT_TYPE_BASE + loadoutId;
};

export const buildingTypeId = (buildingId: number): number => {
  checkIndex('buildingId', buildingId, BUILDING_TYPE_MAX - BUILDING_TYPE_BASE);
  return BUILDING_TYPE_BASE + buildingId;
};

/** Omgekeerd: soort plus index (loadoutId of buildingId; 0 voor scrapNode, claimPoint en none). */
export function kindOfTypeId(typeId: number): { kind: TypeIdKind; index: number } {
  if (Number.isInteger(typeId)) {
    if (typeId >= UNIT_TYPE_BASE && typeId <= UNIT_TYPE_MAX) return { kind: 'unit', index: typeId - UNIT_TYPE_BASE };
    if (typeId >= BUILDING_TYPE_BASE && typeId <= BUILDING_TYPE_MAX) return { kind: 'building', index: typeId - BUILDING_TYPE_BASE };
    if (typeId === SCRAP_NODE_TYPE_ID) return { kind: 'scrapNode', index: 0 };
    if (typeId === CLAIM_POINT_TYPE_ID) return { kind: 'claimPoint', index: 0 };
  }
  return { kind: 'none', index: 0 };
}

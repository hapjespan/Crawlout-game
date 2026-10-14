// typeId-ruimte (integratievoorstel, ter review door de architect): een plek waar sim, render en client
// dezelfde afspraak gebruiken voor Snapshot.typeId. Pure functies, geen afhankelijkheden.
//   1..1023     unit    = 1 + loadoutId (1..999), held = 1000 + heroId (1000..1023)
//   1024..2047  gebouw  = 1024 + buildingId
//   2048        scrap-node
//   2049        claim-point
//   0 en de rest: geen type
// Sprint 3 (sim-core, ter review door de architect): de held is een unit (render en HUD tekenen en selecteren hem als
// unit), dus zijn typeId ligt in de unit-ruimte, in een vast blok aan het eind. kindOfTypeId geeft voor een held
// kind 'unit' (zijn index is dan geen loadoutId); heroIdOfTypeId zegt welke held het is.
export const UNIT_TYPE_BASE = 1;
export const UNIT_TYPE_MAX = 1023;
export const HERO_TYPE_BASE = 1000;
export const HERO_TYPE_MAX = UNIT_TYPE_MAX;
export const BUILDING_TYPE_BASE = 1024;
export const BUILDING_TYPE_MAX = 2047;
export const SCRAP_NODE_TYPE_ID = 2048;
export const CLAIM_POINT_TYPE_ID = 2049;

export type TypeIdKind = 'unit' | 'building' | 'scrapNode' | 'claimPoint' | 'none';

function checkIndex(what: string, index: number, max: number): void {
  if (!Number.isInteger(index) || index < 0 || index > max)
    throw new RangeError(`${what} ${index} valt buiten 0..${max}`);
}

export const unitTypeId = (loadoutId: number): number => {
  checkIndex('loadoutId', loadoutId, HERO_TYPE_BASE - 1 - UNIT_TYPE_BASE);
  return UNIT_TYPE_BASE + loadoutId;
};

export const heroTypeId = (heroId: number): number => {
  checkIndex('heroId', heroId, HERO_TYPE_MAX - HERO_TYPE_BASE);
  return HERO_TYPE_BASE + heroId;
};

/** heroId voor een held-typeId, anders -1. */
export const heroIdOfTypeId = (typeId: number): number =>
  Number.isInteger(typeId) && typeId >= HERO_TYPE_BASE && typeId <= HERO_TYPE_MAX
    ? typeId - HERO_TYPE_BASE
    : -1;

export const buildingTypeId = (buildingId: number): number => {
  checkIndex('buildingId', buildingId, BUILDING_TYPE_MAX - BUILDING_TYPE_BASE);
  return BUILDING_TYPE_BASE + buildingId;
};

/**
 * Omgekeerd: soort plus index (loadoutId of buildingId; 0 voor scrapNode, claimPoint en none). Een held is kind 'unit'
 * met index typeId - 1 (geen loadoutId); gebruik heroIdOfTypeId om hem te herkennen.
 */
export function kindOfTypeId(typeId: number): { kind: TypeIdKind; index: number } {
  if (Number.isInteger(typeId)) {
    if (typeId >= UNIT_TYPE_BASE && typeId <= UNIT_TYPE_MAX)
      return { kind: 'unit', index: typeId - UNIT_TYPE_BASE };
    if (typeId >= BUILDING_TYPE_BASE && typeId <= BUILDING_TYPE_MAX)
      return { kind: 'building', index: typeId - BUILDING_TYPE_BASE };
    if (typeId === SCRAP_NODE_TYPE_ID) return { kind: 'scrapNode', index: 0 };
    if (typeId === CLAIM_POINT_TYPE_ID) return { kind: 'claimPoint', index: 0 };
  }
  return { kind: 'none', index: 0 };
}

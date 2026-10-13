// What a snapshot typeId is, visually: unit, building, scrap node or claim point.
// TODO: vervangen door @crawlout/data typeIds na merge ws4-s2. The content agent adds the same ranges to
// packages/data; until that lands this file mirrors them so render does not wait on it.
//   unit       = 1 + loadoutId    (1..1023)
//   building   = 1024 + buildingId (1024..2047)
//   scrap node = 2048
//   claim      = 2049

export const TYPE_ID_UNIT_FIRST = 1;
export const TYPE_ID_BUILDING_FIRST = 1024;
export const TYPE_ID_SCRAP_NODE = 2048;
export const TYPE_ID_CLAIM = 2049;

export const ENTITY_KIND = { unknown: 0, unit: 1, building: 2, scrapNode: 3, claim: 4 } as const;
export type EntityKind = (typeof ENTITY_KIND)[keyof typeof ENTITY_KIND];

/** Kind of entity for a snapshot typeId. 0 and ids above the claim point are unknown; the renderer draws those as units. */
export function classifyTypeId(typeId: number): EntityKind {
  if (typeId >= TYPE_ID_UNIT_FIRST && typeId < TYPE_ID_BUILDING_FIRST) return ENTITY_KIND.unit;
  if (typeId >= TYPE_ID_BUILDING_FIRST && typeId < TYPE_ID_SCRAP_NODE) return ENTITY_KIND.building;
  if (typeId === TYPE_ID_SCRAP_NODE) return ENTITY_KIND.scrapNode;
  if (typeId === TYPE_ID_CLAIM) return ENTITY_KIND.claim;
  return ENTITY_KIND.unknown;
}

/** Building id (index into GameData.buildings) for a building typeId, else -1. */
export function buildingIdOf(typeId: number): number {
  return classifyTypeId(typeId) === ENTITY_KIND.building ? typeId - TYPE_ID_BUILDING_FIRST : -1;
}

/** Building typeId for a building id. */
export function buildingTypeId(buildingId: number): number {
  return TYPE_ID_BUILDING_FIRST + buildingId;
}

/** Loadout id for a unit typeId, else -1. */
export function loadoutIdOf(typeId: number): number {
  return classifyTypeId(typeId) === ENTITY_KIND.unit ? typeId - TYPE_ID_UNIT_FIRST : -1;
}

/** Drawn with the humanoid: units, plus unknown typeIds so nothing silently disappears. */
export function drawsAsUnit(typeId: number): boolean {
  const kind = classifyTypeId(typeId);
  return kind === ENTITY_KIND.unit || kind === ENTITY_KIND.unknown;
}

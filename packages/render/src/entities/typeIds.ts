// What a snapshot typeId is, visually: unit, building, scrap node or claim point.
// The ranges themselves live in @crawlout/data (typeIds.ts); this file only maps them to render kinds.
import {
  BUILDING_TYPE_BASE,
  CLAIM_POINT_TYPE_ID,
  SCRAP_NODE_TYPE_ID,
  UNIT_TYPE_BASE,
  buildingTypeId as dataBuildingTypeId,
  kindOfTypeId,
} from '@crawlout/data';

export const TYPE_ID_UNIT_FIRST = UNIT_TYPE_BASE;
export const TYPE_ID_BUILDING_FIRST = BUILDING_TYPE_BASE;
export const TYPE_ID_SCRAP_NODE = SCRAP_NODE_TYPE_ID;
export const TYPE_ID_CLAIM = CLAIM_POINT_TYPE_ID;

export const ENTITY_KIND = { unknown: 0, unit: 1, building: 2, scrapNode: 3, claim: 4 } as const;
export type EntityKind = (typeof ENTITY_KIND)[keyof typeof ENTITY_KIND];

const KIND_BY_DATA_KIND = {
  none: ENTITY_KIND.unknown,
  unit: ENTITY_KIND.unit,
  building: ENTITY_KIND.building,
  scrapNode: ENTITY_KIND.scrapNode,
  claimPoint: ENTITY_KIND.claim,
} as const;

/** Kind of entity for a snapshot typeId. Unknown ids are drawn as units so nothing silently disappears. */
export function classifyTypeId(typeId: number): EntityKind {
  return KIND_BY_DATA_KIND[kindOfTypeId(typeId).kind];
}

/** Building id (index into GameData.buildings) for a building typeId, else -1. */
export function buildingIdOf(typeId: number): number {
  const k = kindOfTypeId(typeId);
  return k.kind === 'building' ? k.index : -1;
}

/** Building typeId for a building id. */
export function buildingTypeId(buildingId: number): number {
  return dataBuildingTypeId(buildingId);
}

/** Loadout id for a unit typeId, else -1. */
export function loadoutIdOf(typeId: number): number {
  const k = kindOfTypeId(typeId);
  return k.kind === 'unit' ? k.index : -1;
}

/** Drawn with the humanoid: units, plus unknown typeIds so nothing silently disappears. */
export function drawsAsUnit(typeId: number): boolean {
  const kind = classifyTypeId(typeId);
  return kind === ENTITY_KIND.unit || kind === ENTITY_KIND.unknown;
}

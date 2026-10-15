// Rigid units in the asset-cli manifest. An entry is a rigid unit (a robot: static meshes, no skeleton, no baked clips)
// when it says `rigid: true` or has kind 'rigid-unit'; either spelling works, so the asset side can pick. The shape
// the renderer reads:
//   id, bounds { min, max } (meters, the model at real size), lods (3 GLBs: level, path, triangles),
//   teamMaterials (names of the glTF materials that take the player's color; a name with "team" in it counts too),
//   hover (optional, meters: the height of a floating unit's lowest point above the ground, 0 or absent for a walker;
//   it is already baked into the model, bounds.min.y equals it, so the renderer does not lift the model by it),
//   albedoGain (optional, brightness factor on the albedo).
// The renderer splits these entries off before the manifest goes through manifestSchema (unitAssetLoader.ts), so the
// schema does not have to know them and a manifest with robots stays valid for every other reader.
import { ALBEDO_GAIN_RANGE, boundsSchema, type AssetBounds } from '@crawlout/asset-cli/manifest';

export interface RigidAssetLod {
  path: string;
  triangles: number;
}

export interface RigidAssetEntry {
  id: string;
  bounds: AssetBounds;
  lods: readonly [RigidAssetLod, RigidAssetLod, RigidAssetLod];
  teamMaterials: readonly string[];
  /** Height of the lowest point above the ground, baked into the model; 0 for a unit that stands. */
  hover: number;
  albedoGain?: number;
}

type Raw = Record<string, unknown>;

function isRecord(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** True for a raw manifest entry that describes a rigid unit. */
export function isRigidEntry(raw: unknown): boolean {
  return isRecord(raw) && (raw.rigid === true || raw.kind === 'rigid-unit');
}

/** Validates one raw rigid entry; returns the entry or the reason it cannot be drawn. */
export function parseRigidEntry(raw: Raw): RigidAssetEntry | string {
  const id = raw.id;
  if (typeof id !== 'string' || id.length === 0) return 'rigid entry without an id';
  const bounds = boundsSchema.safeParse(raw.bounds);
  if (!bounds.success) return 'no valid bounds';
  const b = bounds.data;
  if (!(b.max[1] > b.min[1])) return 'bounds have no height';
  const lods = raw.lods;
  if (!Array.isArray(lods) || lods.length !== 3) return 'needs exactly three LODs';
  const parsed: RigidAssetLod[] = [];
  for (const lod of lods as unknown[]) {
    if (!isRecord(lod) || typeof lod.path !== 'string' || lod.path.length === 0)
      return 'a LOD without a path';
    parsed.push({
      path: lod.path,
      triangles: typeof lod.triangles === 'number' ? lod.triangles : 0,
    });
  }
  const hover = raw.hover === undefined ? 0 : raw.hover;
  if (typeof hover !== 'number' || !Number.isFinite(hover) || hover < 0)
    return `hover ${String(hover)} is not a height in meters`;
  const team = raw.teamMaterials;
  if (team !== undefined && (!Array.isArray(team) || team.some((n) => typeof n !== 'string')))
    return 'teamMaterials must be a list of material names';
  return {
    id,
    bounds: b,
    lods: parsed as unknown as RigidAssetEntry['lods'],
    teamMaterials: (team as string[] | undefined) ?? [],
    hover,
    ...(typeof raw.albedoGain === 'number'
      ? {
          albedoGain: Math.min(
            ALBEDO_GAIN_RANGE[1],
            Math.max(ALBEDO_GAIN_RANGE[0], raw.albedoGain),
          ),
        }
      : {}),
  };
}

/**
 * Takes the rigid entries out of a raw manifest. `rest` is the manifest without them (anything that is not a manifest
 * object passes through untouched, for the schema to reject); `rigid` has the entry, or the reason it is unusable.
 */
export function splitRigidEntries(raw: unknown): {
  rest: unknown;
  rigid: Map<string, RigidAssetEntry | string>;
} {
  const rigid = new Map<string, RigidAssetEntry | string>();
  if (!isRecord(raw) || !Array.isArray(raw.assets)) return { rest: raw, rigid };
  const assets: unknown[] = [];
  for (const entry of raw.assets as unknown[]) {
    if (!isRigidEntry(entry)) {
      assets.push(entry);
      continue;
    }
    const parsed = parseRigidEntry(entry as Raw);
    const id = (entry as Raw).id;
    rigid.set(typeof id === 'string' ? id : `#${rigid.size}`, parsed);
  }
  return { rest: { ...raw, assets }, rigid };
}

// Rigid units in the asset-cli manifest. An entry is a rigid unit (a robot: static meshes, no skeleton, no baked clips)
// when its `kind` is 'rigid-unit'; nothing else tells them apart (the older `rigid: true` flag goes away at the next
// manifest bump, so it is not read here). The entry is validated by the asset-cli's own `assetEntrySchema`, the same
// schema every other reader uses, and the renderer keeps the fields it draws with:
//   id, bounds { min, max } (meters, the model at real size), lods (3 GLBs: level, path, triangles),
//   teamMaterials (names of the glTF materials that take the player's color; a name with "team" in it counts too),
//   hover (optional, meters: the height of a floating unit's lowest point above the ground, 0 or absent for a walker;
//   it is already baked into the model, bounds.min.y equals it, so the renderer does not lift the model by it),
//   albedoGain (optional, brightness factor on the albedo).
// The renderer splits these entries off before the manifest goes through manifestSchema (unitAssetLoader.ts), so one
// unusable robot is reported as a reason (and its loadout falls back to the humanoid) instead of invalidating the whole
// manifest for the characters, props and buildings next to it.
import { assetEntrySchema, type AssetBounds, type AssetEntry } from '@crawlout/asset-cli/manifest';

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

/** True for a raw manifest entry that describes a rigid unit: kind 'rigid-unit'. */
export function isRigidEntry(raw: unknown): boolean {
  return isRecord(raw) && raw.kind === 'rigid-unit';
}

/** The renderer's view of an entry the schema has accepted. */
export function rigidEntryOf(entry: AssetEntry): RigidAssetEntry | string {
  const b = entry.bounds;
  if (!(b.max[1] > b.min[1])) return 'bounds have no height';
  return {
    id: entry.id,
    bounds: b,
    lods: entry.lods.map((lod) => ({
      path: lod.path,
      triangles: lod.triangles,
    })) as unknown as RigidAssetEntry['lods'],
    teamMaterials: entry.teamMaterials ?? [],
    hover: entry.hover ?? 0,
    ...(entry.albedoGain !== undefined ? { albedoGain: entry.albedoGain } : {}),
  };
}

/** Validates one raw rigid entry with the asset-cli schema; returns the entry or the reason it cannot be drawn. */
export function parseRigidEntry(raw: Raw): RigidAssetEntry | string {
  if (typeof raw.id !== 'string' || raw.id.length === 0) return 'rigid entry without an id';
  // The schema still asks for `rigid: true` on a rigid-unit; the kind is what says it, so supply the flag.
  const parsed = assetEntrySchema.safeParse({ ...raw, rigid: true });
  if (!parsed.success)
    return parsed.error.issues
      .map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');
  return rigidEntryOf(parsed.data);
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

/// <reference types="vite/client" />
// Every file of assets/dist as a URL (hashed in a build). The manifest's relative paths resolve through this map,
// so replacing a placeholder with a real asset is a data change, not a code change.
//
// Local assets: assets/dist-local (outside git, `pnpm assets --local`) has its own manifest.json in the same format.
// Only in dev (main.ts imports game/localAssets.ts behind import.meta.env.DEV). When it is there, its ids take precedence over the repo's: the two manifests are merged into one (served as a blob
// URL), with the local paths under LOCAL_PREFIX so resolveUrl knows where each file lives. Without dist-local the
// behaviour is exactly the old one. A local `hero_<key>` asset is bound to that hero's typeId (1000 + heroId).
import { heroTypeId } from '@crawlout/data';
import type { UnitAssetConfig } from '@crawlout/render';

/** The dev-only local asset module (game/localAssets.ts), passed in so production never imports it. */
export type LocalAssets = typeof import('./localAssets.js');

const ASSET_DIR = '../../../../assets/dist/';
/** Prefix of local paths in the merged manifest. */
export const LOCAL_PREFIX = 'dist-local/';
const assetFiles = import.meta.glob('../../../../assets/dist/**/*', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
const repoManifests = import.meta.glob('../../../../assets/dist/manifest.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;

interface ManifestLike {
  version: number;
  assets: { id: string; lods: { path: string }[]; baked?: { path: string } }[];
}

/**
 * Merges the local manifest over the repo manifest: an id in `local` replaces the repo entry with that id, the rest
 * of the repo stays. Local paths get `prefix`. Pure; the order is the repo's, then new local ids, sorted on id.
 */
export function mergeManifests<M extends ManifestLike>(
  repo: M | undefined,
  local: M | undefined,
  prefix: string = LOCAL_PREFIX,
): { manifest: M; localIds: string[] } | undefined {
  if (!local) return repo ? { manifest: repo, localIds: [] } : undefined;
  const moved = local.assets.map((a) => ({
    ...a,
    lods: a.lods.map((l) => ({ ...l, path: prefix + l.path })),
    ...(a.baked ? { baked: { ...a.baked, path: prefix + a.baked.path } } : {}),
  }));
  const localIds = moved.map((a) => a.id);
  const assets = [...(repo?.assets ?? []).filter((a) => !localIds.includes(a.id)), ...moved].sort(
    (a, b) => a.id.localeCompare(b.id),
  );
  return { manifest: { ...(repo ?? local), assets } as M, localIds };
}

/** Hero bindings for the asset ids `hero_<key>` that exist in the manifest: asset id to [1000 + heroId]. */
export function heroBindings(
  ids: readonly string[],
  heroes: readonly { id: number; key: string }[],
): Record<string, number[]> {
  const bind: Record<string, number[]> = {};
  for (const hero of heroes)
    if (ids.includes(`hero_${hero.key}`)) bind[`hero_${hero.key}`] = [heroTypeId(hero.id)];
  return bind;
}

/**
 * Asset config for createRenderer, or undefined when assets/dist has no manifest. `?unit=<id>` overrides the default
 * unit. `heroes` (game data) lets a local `hero_<key>` asset draw that hero.
 */
export function assetConfig(
  params: URLSearchParams,
  heroes: readonly { id: number; key: string }[] = [],
  localAssets: LocalAssets | null = null,
): UnitAssetConfig | undefined {
  const unit = params.get('unit');
  // ?teammask=none|materialName|diffuseAlpha|auto overrides the manifest for every character: a way to see whether a
  // model's alpha really carries a team mask or just the opacity the artist painted.
  const maskParam = params.get('teammask');
  const teamMask = (['none', 'materialName', 'diffuseAlpha', 'auto'] as const).find(
    (m) => m === maskParam,
  );
  const repoUrl = assetFiles[`${ASSET_DIR}manifest.json`];
  const local = localAssets?.localManifests[`${localAssets.LOCAL_DIR}manifest.json`] as
    ManifestLike | undefined;
  if (!local) {
    if (!repoUrl) return undefined;
    return {
      manifestUrl: repoUrl,
      resolveUrl: (path) => assetFiles[ASSET_DIR + path] ?? path,
      ...(unit ? { defaultUnit: unit } : {}),
      ...(teamMask ? { teamMask } : {}),
    };
  }
  const merged = mergeManifests(
    repoManifests[`${ASSET_DIR}manifest.json`] as ManifestLike | undefined,
    local,
  )!;
  const manifestUrl = URL.createObjectURL(
    new Blob([JSON.stringify(merged.manifest)], { type: 'application/json' }),
  );
  const bind = heroBindings(merged.localIds, heroes);
  return {
    manifestUrl,
    resolveUrl: (path) =>
      path.startsWith(LOCAL_PREFIX)
        ? (localAssets?.localFiles[localAssets.LOCAL_DIR + path.slice(LOCAL_PREFIX.length)] ?? path)
        : (assetFiles[ASSET_DIR + path] ?? path),
    ...(unit ? { defaultUnit: unit } : {}),
    ...(teamMask ? { teamMask } : {}),
    ...(Object.keys(bind).length > 0 ? { bind } : {}),
  };
}

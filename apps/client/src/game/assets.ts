/// <reference types="vite/client" />
// Every file of assets/dist as a URL (hashed in a build). The manifest's relative paths resolve through this map,
// so replacing a placeholder with a real asset is a data change, not a code change.
import type { UnitAssetConfig } from '@crawlout/render';

const ASSET_DIR = '../../../../assets/dist/';
const assetFiles = import.meta.glob('../../../../assets/dist/**/*', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** Asset config for createRenderer, or undefined when assets/dist has no manifest. `?unit=<id>` overrides the default unit. */
export function assetConfig(params: URLSearchParams): UnitAssetConfig | undefined {
  const manifestUrl = assetFiles[`${ASSET_DIR}manifest.json`];
  if (!manifestUrl) return undefined;
  const unit = params.get('unit');
  return { manifestUrl, resolveUrl: (path) => assetFiles[ASSET_DIR + path] ?? path, ...(unit ? { defaultUnit: unit } : {}) };
}

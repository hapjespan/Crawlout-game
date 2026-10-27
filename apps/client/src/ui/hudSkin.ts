/// <reference types="vite/client" />
// Local-only HUD art (assets/local/hud, outside git: AI-generated imitation of a commercial game's interface, made
// by tools/hud-art/crop.mjs). Like game/localAssets.ts this module is only imported in dev (`import.meta.env.DEV`),
// so a production build never bundles the crops even when they exist on disk.
import type { HudSkin, HudSkinManifest } from '@crawlout/ui';

// Empty when assets/local/hud does not exist (CI, a fresh checkout).
const files = import.meta.glob('../../../../assets/local/hud/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const manifests = import.meta.glob('../../../../assets/local/hud/hud-skin.json', {
  eager: true,
  import: 'default',
}) as Record<string, HudSkinManifest>;

/** The skin to hand to mountHud, or undefined when the local crops are not there (the CSS look then applies). */
export function loadHudSkin(): HudSkin | undefined {
  const manifest = Object.values(manifests)[0];
  if (!manifest) return undefined;
  const urls: Record<string, string> = {};
  for (const [path, url] of Object.entries(files))
    urls[path.slice(path.lastIndexOf('/') + 1)] = url;
  return { manifest, urls };
}

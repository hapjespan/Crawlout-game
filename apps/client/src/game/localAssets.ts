/// <reference types="vite/client" />
// Local-only assets (assets/dist-local, outside git: fan art that is not our IP). This module is only imported in
// dev (`import.meta.env.DEV`), so a production build never bundles these files, even when they exist on disk.
export const LOCAL_DIR = '../../../../assets/dist-local/';

// Empty when assets/dist-local does not exist (CI, a fresh checkout).
export const localFiles = import.meta.glob('../../../../assets/dist-local/**/*', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export const localManifests = import.meta.glob('../../../../assets/dist-local/manifest.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;

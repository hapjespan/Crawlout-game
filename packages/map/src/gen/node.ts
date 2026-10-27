import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { GenIo } from './builder.js';

// Node-kant van de generator (build-tijd): leest bronbestanden uit assets/dist. Niet geëxporteerd via de index,
// zodat de client geen node:fs binnenhaalt; gebruik `@crawlout/map/node`.
const assetsDist = fileURLToPath(new URL('../../../../assets/dist/', import.meta.url));

export const nodeGenIo: GenIo = {
  readSource: (ref) => readFileSync(assetsDist + ref, 'utf8'),
};

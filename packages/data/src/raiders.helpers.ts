// Split from raiders.test.ts to stay under the 5,000-token file limit.
import { fileURLToPath } from 'node:url';
import type { RawGameData } from './loader.js';
import { readDataDir } from './node.js';

// Raiders (data 0.21.0; bevestigd in fase-0 sectie 23 besluit 2): de tweede factie als data, schema en loader.
// De sim speelt de Raiders nog niet; deze tests leggen vast dat de data klopt en wat de sim straks mag aannemen.

const dataDir = fileURLToPath(new URL('../../../data', import.meta.url));

export const raw = (): RawGameData => readDataDir(dataDir);

export type Rec = Record<string, unknown>;

export const records = (
  r: RawGameData,
  key: 'loadouts' | 'buildings' | 'factions' | 'heroes' | 'tech',
) => r[key] as Rec[];

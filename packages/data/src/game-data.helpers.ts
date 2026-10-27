// Split from game-data.test.ts to stay under the 5,000-token file limit.
import { fileURLToPath } from 'node:url';
import type { RawGameData } from './loader.js';
import { readDataDir } from './node.js';

const dataDir = fileURLToPath(new URL('../../../data', import.meta.url));

export const raw = (): RawGameData => readDataDir(dataDir);

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// Test helper: reads a record list of data/ that is split over a directory of JSON arrays (data/loadouts/*.json).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = fileURLToPath(new URL('../../../data/', import.meta.url));

/** data/<name>/*.json concatenated in file-name order: the same list readDataDir in @crawlout/data/node gives. */
export function readDataList(name: string): unknown[] {
  const dir = join(dataDir, name);
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap((file) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown);
}

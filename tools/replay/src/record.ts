// Neemt de fixtures uit fixtures-def.ts op: draait ze en schrijft de replay-JSON met verwachte hashes.
// Gebruik: node --import tsx src/record.ts [map] [naam ...]   (standaard: fixtures, alle fixtures)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES } from './fixtures-def.js';
import { parseReplay, recordedHashes, runReplay } from './run.js';

const dir = process.argv[2] ?? 'fixtures';
const only = process.argv.slice(3);
mkdirSync(dir, { recursive: true });
for (const def of FIXTURES) {
  if (only.length > 0 && !only.includes(def.name)) continue;
  const r = def.build();
  const run = runReplay(r);
  r.hashes = recordedHashes(run);
  parseReplay(r); // het resultaat moet zelf weer een geldige replay zijn
  const file = join(dir, `${def.name}.json`);
  writeFileSync(file, `${JSON.stringify(r, null, 1)}\n`);
  console.log(`record: ${file}: ${run.lastFrame + 1} frames, ${r.hashes.length} hashes`);
}

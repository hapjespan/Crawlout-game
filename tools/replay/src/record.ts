// Neemt de fixtures uit fixtures-def.ts op: draait ze en schrijft de replay-JSON met verwachte hashes.
// Gebruik: node --import tsx src/record.ts [map]   (standaard: fixtures)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES } from './fixtures-def.js';
import { parseReplay, recordedHashes, runReplay } from './run.js';

const dir = process.argv[2] ?? 'fixtures';
mkdirSync(dir, { recursive: true });
for (const def of FIXTURES) {
  const r = def.build();
  const run = runReplay(r);
  r.hashes = recordedHashes(run);
  parseReplay(r); // het resultaat moet zelf weer een geldige replay zijn
  const file = join(dir, `${def.name}.json`);
  writeFileSync(file, `${JSON.stringify(r, null, 1)}\n`);
  console.log(`record: ${file}: ${run.lastFrame + 1} frames, ${r.hashes.length} hashes`);
}

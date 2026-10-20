import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGameDataFromDir } from '@crawlout/data/node';
import { simConfigFromGameData } from '@crawlout/sim';
import { describe, expect, it } from 'vitest';
import { DATA_DIR, mapGrid } from './env.js';
import { envFrom } from './env-core.js';
import { recordedHashes, runReplayIn } from './run-core.js';
import { parseReplay } from './run.js';

// Fase-0 sectie 24 besluit 4: the version string is no longer in the envHash, so a data bump that changes nothing
// the sim reads keeps every fixture hash; no re-recording. Proof: a copy of data/ with only VERSION bumped plays a
// skirmish and a survival fixture with their recorded hashes.
const fixturesDir = join(import.meta.dirname, '..', 'fixtures');
const FIXTURES = ['s2-testmap-move-stop', 's7-rustbelt-formation', 's17-rustbelt-survival-solo'];

describe('a data bump without a content change', () => {
  it('keeps the recorded hashes (dataVersion is not in the envHash)', { timeout: 120_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'crawlout-data-bump-'));
    try {
      cpSync(DATA_DIR, dir, { recursive: true });
      const old = readFileSync(join(dir, 'VERSION'), 'utf8').trim();
      const [major, minor] = old.split('.').map(Number);
      const bumped = `${major}.${minor! + 1}.0`;
      writeFileSync(join(dir, 'VERSION'), `${bumped}\n`);
      const data = loadGameDataFromDir(dir);
      expect(data.dataVersion).toBe(bumped);
      const config = simConfigFromGameData(data);
      for (const name of FIXTURES) {
        const r = parseReplay(JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), 'utf8')));
        expect(r.dataVersion).not.toBe(bumped);
        const { def, grid } = mapGrid(r.map);
        const env = envFrom(data, config, def, grid, r.players, r.settings);
        expect(recordedHashes(runReplayIn(r, env)), name).toEqual(r.hashes);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

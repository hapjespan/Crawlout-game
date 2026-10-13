import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FIXTURES } from './fixtures-def.js';
import { checkReplay, parseReplay, recordedHashes, runReplay } from './run.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const files = readdirSync(fixturesDir).filter((f) => f.endsWith('.json')).sort();
const load = (f: string) => parseReplay(JSON.parse(readFileSync(join(fixturesDir, f), 'utf8')));

describe('replay-fixtures', () => {
  it('er is minstens één fixture, en elke definitie heeft een opgenomen bestand', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const def of FIXTURES) expect(files).toContain(`${def.name}.json`);
  });

  for (const f of files) {
    it(`${f}: hashes kloppen, ook na serialize/deserialize halverwege`, () => {
      const r = load(f);
      expect(checkReplay(r).ok).toBe(true);
      expect(checkReplay(r, { reloadAfterFrame: 137 }).ok).toBe(true);
      const last = Math.max(...r.hashes.map((h) => h.frame));
      expect(checkReplay(r, { reloadAfterFrame: Math.floor(last / 2) }).ok).toBe(true);
    });

    it(`${f}: twee runs geven dezelfde hash op elk frame`, () => {
      const r = load(f);
      expect(runReplay(r).hashes).toEqual(runReplay(r).hashes);
    });

    it(`${f}: de opgenomen hashes zijn wat record nu zou schrijven`, () => {
      const r = load(f);
      expect(recordedHashes(runReplay(r))).toEqual(r.hashes);
    });
  }

  it('een gewijzigd commando valt op als afwijkende hash', () => {
    const r = load(files.find((f) => load(f).bundles.some((b) => b.commands.some((c) => c.type === 'Move')))!);
    const b = r.bundles.find((x) => x.commands.some((c) => c.type === 'Move'))!;
    const c = b.commands.find((x) => x.type === 'Move')!;
    const p = c.payload as { ids: number[]; x: number; y: number };
    c.payload = { ...p, x: p.x + 256 };
    const res = checkReplay(r);
    expect(res.ok).toBe(false);
    expect(res.mismatch!.frame).toBeGreaterThanOrEqual(b.frame);
  });

  it('een andere seed valt op als afwijkende hash', () => {
    const r = load(files[0]!);
    r.seed += 1;
    expect(checkReplay(r).ok).toBe(false);
  });

  it('weigert een replay voor andere data of een onbekende map', () => {
    const r = load(files[0]!);
    expect(() => runReplay({ ...r, dataVersion: '9.9.9' })).toThrow(/data/);
    expect(() => runReplay({ ...r, map: 'bestaat-niet' })).toThrow(/map/);
    expect(() => runReplay({ ...r, map: '../VERSION' })).toThrow(/map/);
  });
});

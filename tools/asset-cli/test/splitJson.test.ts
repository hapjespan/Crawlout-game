// Split JSON configs (src/splitJson.ts): fragments merge in filename order, objects by first appearance, arrays
// concatenated; the single file wins over the directory; scripts/splitConfig.ts is the exact inverse.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { splitConfig } from '../scripts/splitConfig.js';
import { mergeJsonFragments, readSplitJson, splitJsonExists } from '../src/splitJson.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'split-json-'));
  dirs.push(dir);
  return dir;
};

describe('mergeJsonFragments', () => {
  it('merges objects recursively in order of first appearance and concatenates arrays', () => {
    const merged = mergeJsonFragments([
      { version: 1, buildings: { a: { note: 'a', parts: [1, 2] } } },
      { buildings: { a: { parts: [3] } } },
      { buildings: { a: { parts: [4], lod: 2 }, b: { parts: [] } }, attachments: {} },
    ]);
    expect(JSON.stringify(merged)).toBe(
      '{"version":1,"buildings":{"a":{"note":"a","parts":[1,2,3,4],"lod":2},"b":{"parts":[]}},"attachments":{}}',
    );
  });

  it('refuses two fragments that set the same scalar', () => {
    expect(() => mergeJsonFragments([{ version: 1 }, { version: 2 }])).toThrow(/\$\.version/);
  });
});

describe('readSplitJson', () => {
  it('reads the fragments of <name>/ in filename order when <name>.json does not exist', () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'cfg'));
    writeFileSync(join(dir, 'cfg', '02-b.json'), JSON.stringify({ list: [2], b: true }));
    writeFileSync(join(dir, 'cfg', '01-a.json'), JSON.stringify({ a: true, list: [1] }));
    writeFileSync(join(dir, 'cfg', 'notes.txt'), 'not a fragment');
    expect(splitJsonExists(join(dir, 'cfg.json'))).toBe(true);
    expect(JSON.stringify(readSplitJson(join(dir, 'cfg.json')))).toBe(
      '{"a":true,"list":[1,2],"b":true}',
    );
    writeFileSync(join(dir, 'cfg.json'), JSON.stringify({ single: true }));
    expect(readSplitJson(join(dir, 'cfg.json'))).toEqual({ single: true });
    expect(splitJsonExists(join(dir, 'missing.json'))).toBe(false);
  });
});

describe('splitConfig', () => {
  it('cuts a config into fragments that merge back to the same value and order', () => {
    const parts = Array.from({ length: 60 }, (_, i) => ({ type: 'box', size: [i, i + 1, i + 2] }));
    const config = {
      version: 1,
      flatMaterials: { metal: { color: '#888888' } },
      units: {},
      buildings: { big: { footprint: { w: 3, h: 3 }, parts, note: 'end' }, small: { parts: [] } },
      attachments: {},
    };
    const fragments = splitConfig(config, 1500, 400);
    expect(fragments.length).toBeGreaterThan(3);
    expect(fragments.map((f) => f.name)).toEqual([...fragments.map((f) => f.name)].sort());
    expect(fragments[0]!.name).toBe('01-header.json');
    for (const f of fragments) expect(JSON.stringify(f.value, null, 2).length).toBeLessThan(1500);
    const merged = mergeJsonFragments(fragments.map((f) => structuredClone(f.value)));
    expect(JSON.stringify(merged)).toBe(JSON.stringify(config));
  });
});

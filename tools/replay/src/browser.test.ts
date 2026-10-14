import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readDataDir } from '@crawlout/data/node';
import { run } from './browser/entry.js';
import type { BrowserInput } from './browser/entry.js';
import { DATA_DIR, mapSources } from './env.js';
import { parseReplay } from './run.js';

// De browser-runner (src/browser/entry.ts) zonder browser: dezelfde invoer als replay:browsers meegeeft (ruwe data,
// mapbestanden, fixtures als JSON), afgespeeld in Node. Zo blijft de bundel-kant groen ook op een machine zonder
// Playwright-browsers.

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

describe('browser-runner in Node', () => {
  it('speelt de kleinste fixtures uit ruwe bestanden af met dezelfde hashes', () => {
    const names = readdirSync(fixturesDir)
      .filter((f) => f.startsWith('s2-') && f.endsWith('.json') && !f.includes('ai-vs-ai'))
      .sort();
    const replays = names.map((name) => ({
      name,
      replay: parseReplay(JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'))),
    }));
    const maps: BrowserInput['maps'] = {};
    for (const { replay } of replays) maps[replay.map] ??= mapSources(replay.map);
    // via JSON, zoals page.evaluate de invoer doorgeeft
    const input = JSON.parse(
      JSON.stringify({ raw: readDataDir(DATA_DIR), maps, replays }),
    ) as BrowserInput;
    const out = run(input);
    expect(out.results.map((r) => r.name)).toEqual(names);
    for (const r of out.results) expect(r).toMatchObject({ ok: true, mismatch: null });
  });

  it('meldt een afwijkende hash en een ontbrekende map', () => {
    const name = 's2-testmap-move-stop.json';
    const replay = parseReplay(JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')));
    replay.hashes[3]!.hash = (replay.hashes[3]!.hash ^ 1) >>> 0; // uint32 blijven (het schema weigert negatieve hashes)
    const out = run({
      raw: readDataDir(DATA_DIR),
      maps: { testmap: mapSources('testmap') },
      replays: [
        { name, replay },
        { name: 'zonder-map', replay: { ...replay, map: 'rustbelt' } },
      ],
    });
    expect(out.results[0]).toMatchObject({
      ok: false,
      mismatch: { frame: replay.hashes[3]!.frame, reloaded: false },
    });
    expect(out.results[1]!.error).toMatch(/map rustbelt/);
  });
});

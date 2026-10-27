// replay:browsers (fase-0 sectie 7, afdwinging 2): de replay-set in Chromium, Firefox en WebKit via Playwright.
// Bundelt de runner (src/browser/entry.ts) met esbuild tot één script, opent per browser een lege pagina, geeft de
// data, de maps en de fixtures als JSON mee en vergelijkt de hashes per 20 frames met de opgeslagen hashes (en dus met
// Node), ook na serialize/deserialize halverwege. Daarna vergelijkt het de eindhash van elke fixture over de browsers.
//
// Zonder browsers (geen `npx playwright install`) meldt het dat duidelijk en eindigt met exit 0, tenzij --strict of
// REPLAY_BROWSERS_STRICT=1: dan is een ontbrekende browser een fout (voor CI na de installatiestap).
//
// Gebruik: node --import tsx src/browsers.ts [fixtures-map] [--browsers=chromium,firefox,webkit] [--chrome] [--strict]
//   --chrome   ook in de geïnstalleerde Google Chrome (Playwright-channel 'chrome'), voor de handmatige test op de MacBook.
//   REPLAY_CHROMIUM_PATH, REPLAY_FIREFOX_PATH, REPLAY_WEBKIT_PATH: een eigen executable per browser.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, firefox, webkit } from '@playwright/test';
import type { BrowserType, LaunchOptions } from '@playwright/test';
import { readDataDir } from '@crawlout/data/node';
import type { BrowserInput, BrowserResult } from './browser/entry.js';
import { DATA_DIR, mapSources } from './env.js';
import { parseReplay } from './run.js';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined =>
  args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const dir = args.find((a) => !a.startsWith('--')) ?? 'fixtures';
const strict = flag('strict') !== undefined || process.env.REPLAY_BROWSERS_STRICT === '1';
const wanted = (flag('browsers')?.split('=')[1] ?? 'chromium,firefox,webkit')
  .split(',')
  .filter((b) => b.length > 0);
const hex = (h: number): string => `0x${(h >>> 0).toString(16).padStart(8, '0')}`;

interface Target {
  readonly label: string;
  readonly type: BrowserType;
  readonly options: LaunchOptions;
  /** Waarom hij niet kan draaien, of null. */
  readonly missing: string | null;
}

function target(name: string): Target {
  const types: Record<string, BrowserType> = { chromium, firefox, webkit };
  const type = types[name];
  if (type === undefined) throw new Error(`onbekende browser ${name} (chromium, firefox, webkit)`);
  const override = process.env[`REPLAY_${name.toUpperCase()}_PATH`];
  const path = override ?? type.executablePath();
  return {
    label: name,
    type,
    options: override === undefined ? {} : { executablePath: override },
    missing: existsSync(path) ? null : path,
  };
}

const targets: Target[] = wanted.map(target);
if (flag('chrome') !== undefined)
  targets.push({ label: 'chrome', type: chromium, options: { channel: 'chrome' }, missing: null });
const available = targets.filter((t) => t.missing === null);
for (const t of targets)
  if (t.missing !== null) console.log(`replay:browsers: ${t.label} ontbreekt (${t.missing}).`);
if (available.length === 0) {
  console.log(
    'replay:browsers: geen Playwright-browsers geïnstalleerd; niets gedraaid. Installeer ze eenmalig met ' +
      '`pnpm --filter @crawlout/replay exec playwright install chromium firefox webkit` (downloadt de browsers) en draai opnieuw. ' +
      'Zie tools/replay/README.md.',
  );
  process.exit(strict ? 1 : 0);
}

// De bundel: de runner met sim, data-loader en map-loader, zonder Node-modules.
const entry = fileURLToPath(new URL('./browser/entry.ts', import.meta.url));
const bundle = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'iife',
  globalName: 'crawloutReplay',
  platform: 'browser',
  target: 'es2022',
  write: false,
  logLevel: 'silent',
});
const script = bundle.outputFiles[0]!.text;

// De invoer: ruwe data, de maps die de fixtures gebruiken en de fixtures zelf.
const files = existsSync(dir)
  ? readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
  : [];
if (files.length === 0) {
  console.log(`replay:browsers: geen fixtures in ${dir}; groen.`);
  process.exit(0);
}
const replays = files.map((name) => ({
  name,
  replay: parseReplay(JSON.parse(readFileSync(join(dir, name), 'utf8'))),
}));
const maps: BrowserInput['maps'] = {};
for (const { replay } of replays) maps[replay.map] ??= mapSources(replay.map);
const input: BrowserInput = { raw: readDataDir(DATA_DIR), maps, replays };

let failed = 0;
const finals = new Map<string, Map<string, number>>();
for (const t of available) {
  let results: BrowserResult[];
  let userAgent: string;
  const browser = await t.type.launch(t.options).catch((e: unknown) => {
    console.error(
      `replay:browsers: ${t.label} start niet: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`,
    );
    return null;
  });
  if (browser === null) {
    failed++;
    continue;
  }
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><title>replay</title>');
    await page.addScriptTag({ content: script });
    ({ userAgent, results } = await page.evaluate(
      (inp) =>
        (
          globalThis as unknown as {
            crawloutReplay: { run: typeof import('./browser/entry.js').run };
          }
        ).crawloutReplay.run(inp),
      input,
    ));
  } finally {
    await browser.close();
  }
  console.log(`replay:browsers: ${t.label} (${userAgent})`);
  for (const r of results) {
    finals.set(r.name, (finals.get(r.name) ?? new Map<string, number>()).set(t.label, r.finalHash));
    if (r.ok) {
      console.log(
        `  ok   ${r.name}: ${r.frames} frames, ${r.checked} hashes, ook na serialize/deserialize, eindhash ${hex(r.finalHash)}, ${r.ms} ms`,
      );
    } else {
      failed++;
      const m = r.mismatch;
      const why =
        r.error ??
        (m === null
          ? 'onbekend'
          : `frame ${m.frame} verwacht ${hex(m.expected)}, kreeg ${hex(m.actual)}${m.reloaded ? ' (na serialize/deserialize)' : ''}`);
      console.error(`  FOUT ${r.name}: ${why}`);
    }
  }
}

// Over de browsers: elke fixture heeft overal dezelfde eindhash (met de opgeslagen hashes is dat ook die van Node).
for (const [name, byBrowser] of finals) {
  if (new Set(byBrowser.values()).size > 1) {
    failed++;
    console.error(
      `replay:browsers: FOUT ${name}: eindhashes verschillen tussen browsers: ${[...byBrowser].map(([b, h]) => `${b} ${hex(h)}`).join(', ')}`,
    );
  }
}
const missing = targets.length - available.length;
if (failed > 0) {
  console.error(
    `replay:browsers: ${failed} afwijking(en) in ${available.map((t) => t.label).join(', ')}.`,
  );
  process.exit(1);
}
console.log(
  `replay:browsers: ${files.length} fixtures identiek in ${available.map((t) => t.label).join(', ')}${missing > 0 ? `; ${missing} browser(s) niet gedraaid (ontbreken)` : ''}.`,
);
process.exit(strict && missing > 0 ? 1 : 0);

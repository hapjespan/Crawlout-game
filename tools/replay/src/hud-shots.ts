// Review images and a layout check of the HUD demo page (`/hud-demo.html?preset=midgame`, see apps/client/src/ui/demoMidgame.ts).
// Not part of `pnpm test`; needs the client's dev server and Chrome (Playwright channel 'chrome').
//
//   HUD_URL=http://localhost:5202/ node --import tsx src/hud-shots.ts shots /some/dir   4K PNGs (skin on grey, skin on
//                                                                                       transparent, CSS-only on grey)
//   HUD_URL=http://localhost:5202/ node --import tsx src/hud-shots.ts crop f.png 0 0 800 600   a 1:1 detail of the 4K image
//   HUD_URL=http://localhost:5202/ node --import tsx src/hud-shots.ts check              measures the HUD share of the screen
//                                                                                       and looks for overlaps and clipped text
//
// The bitmap skin only loads when the local crops exist in assets/local/hud (dev only, never committed).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import type { Browser } from '@playwright/test';

const URL = process.env.HUD_URL ?? 'http://localhost:5173/';
const PAGE = 'hud-demo.html';
const SIZES: readonly [number, number][] = [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
];

/** The HUD panels that must never cover each other (selectors of the demo's mid-game still life). */
const PANELS = [
  '.co-counters',
  '.co-hero',
  '.co-perk-panel',
  '.co-dominance',
  '.co-toasts li',
  '.co-minimap',
  '.co-top-right',
  '.co-sidebar',
  '.co-selection',
  '.co-roster',
  '.co-building-buttons',
  '.co-roster-list',
  '.co-console',
  '.co-cards',
  '.co-commands',
  '.co-targeting',
];

async function open(browser: Browser, w: number, h: number, query: string) {
  // Reduced motion: no typing cursor or pulsing badge, so the image is the same every time.
  const context = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${URL}${PAGE}?preset=midgame&${query}`);
  await page.waitForSelector('#hud[data-staged]');
  // The skin's images load lazily; wait for fonts and a few frames.
  await page.evaluate(`document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 600)))`);
  return { context, page, errors };
}

async function shots(browser: Browser, dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const jobs: [string, string, boolean][] = [
    ['hud-midgame-4k.png', 'bg=grey', false],
    ['hud-midgame-4k-transparent.png', 'bg=transparent', true],
    ['hud-midgame-4k-noskin.png', 'bg=grey&noskin', false],
  ];
  for (const [file, query, transparent] of jobs) {
    const { context, page, errors } = await open(browser, 3840, 2160, query);
    await page.screenshot({ path: join(dir, file), omitBackground: transparent });
    console.log(
      `wrote ${join(dir, file)}${errors.length ? ` (page errors: ${errors.join('; ')})` : ''}`,
    );
    await context.close();
  }
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Measure {
  band: Record<string, number>;
  panels: { sel: string; rect: Rect }[];
  clipped: string[];
  smallText: string[];
}

const MEASURE = `(() => {
  const PANELS = ${JSON.stringify(PANELS)};
  const rectOf = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const H = innerHeight;
  const h = (sel) => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect().height : 0; };
  const band = {
    roster: h('.co-roster') / H, selection: h('.co-selection') / H, console: h('.co-console') / H,
    rosterWithBuildings: (h('.co-roster') + h('.co-building-buttons')) / H,
  };
  const panels = [];
  for (const sel of PANELS) document.querySelectorAll(sel).forEach((e, i) => panels.push({ sel: sel + (i ? '#' + i : ''), rect: rectOf(e) }));
  const clipped = [];
  const smallText = [];
  document.querySelectorAll('.co-hud *').forEach((e) => {
    const cs = getComputedStyle(e);
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '');
    if (own && parseFloat(cs.fontSize) < 10.99) smallText.push((e.className || e.tagName) + ' ' + cs.fontSize);
    if (cs.display === 'none' || e.closest('.co-sr')) return;
    const tag = (e.className && String(e.className)) || e.tagName;
    if (own && e.scrollWidth > e.clientWidth + 1 && cs.textOverflow === 'ellipsis') clipped.push('ellipsis ' + tag + ' "' + e.textContent.trim().slice(0, 30) + '"');
    if (own && e.scrollHeight > e.clientHeight + 1 && e.clientHeight > 0 && (cs.overflowY === 'hidden' || cs.overflowY === 'auto')) clipped.push('vclip ' + tag + ' "' + e.textContent.trim().slice(0, 30) + '"');
  });
  // Text that sticks out of a box that clips it (overflow hidden or auto): cut off at the edge.
  const range = document.createRange();
  document.querySelectorAll('.co-hud *').forEach((e) => {
    if (e.closest('.co-sr')) return;
    for (const n of e.childNodes) {
      if (n.nodeType !== 3 || n.textContent.trim() === '') continue;
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width === 0) continue;
      for (let a = e; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const ar = a.getBoundingClientRect();
        if (r.right > ar.right + 1 || r.left < ar.left - 1 || r.bottom > ar.bottom + 1 || r.top < ar.top - 1) {
          clipped.push('cut ' + String(a.className).split(' ').slice(-1)[0] + ' "' + n.textContent.trim().slice(0, 24) + '"');
          break;
        }
      }
    }
  });
  // Scrolling containers that hide content (cards, commands, selection glass, roster tray).
  document.querySelectorAll('.co-cards,.co-commands,.co-sel-glass,.co-roster-list,.co-perk-panel').forEach((e) => {
    if (e.scrollHeight > e.clientHeight + 1) clipped.push('scrolls ' + e.className + ' ' + e.scrollHeight + '>' + e.clientHeight);
  });
  return { band, panels, clipped, smallText };
})()`;

/** True when the boxes overlap by more than `slack` px in both directions (panels that touch by design overlap a little). */
const overlap = (a: Rect, b: Rect, slack: number): boolean =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > slack &&
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > slack;

async function check(browser: Browser): Promise<void> {
  for (const [w, h] of SIZES) {
    const { context, page, errors } = await open(browser, w, h, 'bg=grey');
    const m = (await page.evaluate(MEASURE)) as Measure;
    const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
    console.log(
      `\n== ${w}x${h}: roster ${pct(m.band.roster!)}, selection ${pct(m.band.selection!)}, console ${pct(m.band.console!)}, roster + buildings tab ${pct(m.band.rosterWithBuildings!)}`,
    );
    const hits: string[] = [];
    for (let i = 0; i < m.panels.length; i++)
      for (let j = i + 1; j < m.panels.length; j++) {
        const a = m.panels[i]!;
        const b = m.panels[j]!;
        if (a.sel.split('#')[0] === b.sel.split('#')[0]) continue;
        if (overlap(a.rect, b.rect, (h / 572) * 0.64 * 3)) hits.push(`${a.sel} x ${b.sel}`);
      }
    // Everything must be inside the window.
    for (const p of m.panels)
      if (
        p.rect.x < -0.5 ||
        p.rect.y < -0.5 ||
        p.rect.x + p.rect.w > w + 0.5 ||
        p.rect.y + p.rect.h > h + 0.5
      )
        hits.push(`${p.sel} leaves the window`);
    console.log(hits.length ? `OVERLAPS: ${hits.join(', ')}` : 'no overlaps');
    if (m.clipped.length) console.log(`clipped: ${[...new Set(m.clipped)].join(' | ')}`);
    if (m.smallText.length)
      console.log(`text under 11px: ${[...new Set(m.smallText)].join(' | ')}`);
    if (errors.length) console.log(`page errors: ${errors.join('; ')}`);
    await context.close();
  }
}

/** A crop of the page at 1:1 (for looking at details): `crop <file> <x> <y> <w> <h> [query]`; HUD_VIEW=1280x720 sets the window (default 4K). */
async function crop(browser: Browser, file: string, box: number[], query: string): Promise<void> {
  const [vw = 3840, vh = 2160] = (process.env.HUD_VIEW ?? '3840x2160').split('x').map(Number);
  const { context, page } = await open(browser, vw, vh, query);
  const [x = 0, y = 0, width = vw, height = vh] = box;
  await page.screenshot({ path: file, clip: { x, y, width, height } });
  console.log(`wrote ${file}`);
  await context.close();
}

const [mode, dir, ...rest] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  if (mode === 'shots') await shots(browser, dir ?? '.');
  else if (mode === 'check') await check(browser);
  else if (mode === 'crop')
    await crop(browser, dir ?? 'crop.png', rest.slice(0, 4).map(Number), rest[4] ?? 'bg=grey');
  else console.log('usage: hud-shots.ts shots <dir> | check | crop <file> <x> <y> <w> <h> [query]');
} finally {
  await browser.close();
}

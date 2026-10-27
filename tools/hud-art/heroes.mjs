#!/usr/bin/env node
// Cuts the hero portrait sheet into one PNG per hero, plus the `portrait-hero-*` entries for hud-skin.json.
//
// LICENCE / IP: same rule as crop.mjs. The sheet is an AI-generated imitation drawn for the designer's own
// non-commercial fan project and never enters the repository: the output goes to assets/local/hud/ (ignored by version
// control) and is only loaded in dev. This script holds coordinates and names only, no art, so it is safe to commit.
//
// The sheet is a 3 x 3 grid, 1024 x 1536: rows are the factions (dwellers, raiders, garde) and columns the archetypes
// (bouwer, krijger, tacticus), the same order as docs/held-keuze.md. The cell edges below were measured by scanning the
// sheet for the dark gaps between the cards, not guessed from 1024/3.
//
// Usage: node tools/hud-art/heroes.mjs --src <sheet.png> [--out ~/Crawlout/assets/local/hud]
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import process from 'node:process';
import { join, resolve } from 'node:path';
import console from 'node:console';
import { sharp } from './paint.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? resolve(args[i + 1].replace(/^~/, homedir())) : dflt;
};
const SRC = opt('--src', null);
const OUT = opt('--out', join(homedir(), 'Crawlout/assets/local/hud'));
if (!SRC) {
  console.error('geef de sheet op: --src <bestand.png>');
  process.exit(1);
}

/**
 * Rough windows to look in, one per cell. The exact crop is found inside each by shrink-wrapping to the green frame,
 * because a hand-measured grid gets it wrong: the first attempt cut 26 px off the bottom of row 0, losing its frame,
 * and started row 2 seventeen pixels high, taking black in with it. The rows are not evenly spaced either.
 */
const COLUMN_WINDOWS = [
  [8, 345],
  [345, 684],
  [684, 1020],
];
const ROW_WINDOWS = [
  [4, 505],
  [505, 1004],
  [1010, 1536],
];

/** A frame pixel: clearly green rather than the near-black gap between the cards. */
function isFrame(data, width, x, y) {
  const i = (y * width + x) * 4;
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  return g > 55 && g > r * 1.25 && g > b * 1.25;
}

/** Tightest box around the green frame inside a window. */
function frameBox(data, width, height, [x0, x1], [y0, y1]) {
  let minX = Infinity;
  let maxX = -1;
  let minY = Infinity;
  let maxY = -1;
  for (let y = y0; y < Math.min(y1, height); y++)
    for (let x = x0; x < Math.min(x1, width); x++)
      if (isFrame(data, width, x, y)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (maxX < 0) throw new Error('geen groen kader gevonden in dit venster');
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Row order of the sheet. */
const FACTIONS = ['dwellers', 'raiders', 'garde'];
/** Column order of the sheet. */
const ARCHETYPES = ['bouwer', 'krijger', 'tacticus'];

/** Hero id per faction and archetype (data/heroes.json). The file name follows the id, so the HUD can look it up. */
const HEROES = {
  dwellers: { bouwer: 'voorman', krijger: 'opziener', tacticus: 'controleur' },
  raiders: { bouwer: 'marktmeester', krijger: 'warlord', tacticus: 'ketenmeester' },
  garde: { bouwer: 'kwartiermeester', krijger: 'zwaardridder', tacticus: 'archivaris' },
};

mkdirSync(OUT, { recursive: true });

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

const images = {};
for (let row = 0; row < FACTIONS.length; row++) {
  for (let col = 0; col < ARCHETYPES.length; col++) {
    const hero = HEROES[FACTIONS[row]][ARCHETYPES[col]];
    const file = `portrait-hero-${hero}.png`;
    const box = frameBox(data, info.width, info.height, COLUMN_WINDOWS[col], ROW_WINDOWS[row]);
    await sharp(SRC).extract(box).png().toFile(join(OUT, file));
    images[`portrait-hero-${hero}`] = { file, w: box.width, h: box.height };
    console.log(
      `${file.padEnd(34)} ${box.width}x${box.height} op ${box.left},${box.top}  (${FACTIONS[row]} ${ARCHETYPES[col]})`,
    );
  }
}

// Merge into the existing skin manifest so a re-run of crop.mjs and a re-run of this script do not undo each other.
const manifestPath = join(OUT, 'hud-skin.json');
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, 'utf8'))
  : { version: 1, frames: {}, tiles: {}, images: {} };
manifest.images = { ...(manifest.images ?? {}), ...images };
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\n9 portretten en hun manifest-entries naar ${OUT}`);

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

/** Left edge of each column and top edge of each row, from the dark gaps in the sheet. */
const COLUMN_X = [15, 352, 690];
const ROW_Y = [16, 515, 1005];
const CELL = { w: 321, h: 456 };

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

const images = {};
for (let row = 0; row < FACTIONS.length; row++) {
  for (let col = 0; col < ARCHETYPES.length; col++) {
    const hero = HEROES[FACTIONS[row]][ARCHETYPES[col]];
    const file = `portrait-hero-${hero}.png`;
    await sharp(SRC)
      .extract({ left: COLUMN_X[col], top: ROW_Y[row], width: CELL.w, height: CELL.h })
      .png()
      .toFile(join(OUT, file));
    images[`portrait-hero-${hero}`] = { file, w: CELL.w, h: CELL.h };
    console.log(`${file}  (${FACTIONS[row]} ${ARCHETYPES[col]})`);
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

#!/usr/bin/env node
// Crops the HUD artwork delivered by the designer into named PNGs plus a hud-skin.json (9-slice insets per frame).
//
// LICENCE / IP: the source sheets are AI-generated imitations of a commercial game's interface. They never enter git:
// the output goes to assets/local/hud/ in the main checkout (gitignored) and is only loaded in dev (see
// apps/client/src/ui/hudSkin.ts). This script holds coordinates only, no art, so it is safe to commit.
// We crop generic material ONLY: plate textures, panel frames and bezels, buttons, badge chips, hazard stripes. Never logos or emblems, faction lettering, portraits, character names, power armour or the SKL/INV/CHR/PIP/MNU
// buttons. Frames with text inside are hollowed (the interior is made transparent) or built by mirroring one text-free
// corner, so no lettering survives in a crop.
//
// Usage: node tools/hud-art/crop.mjs [--src ~/Downloads] [--out ~/Crawlout/assets/local/hud]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import process from 'node:process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// sharp lives with the asset CLI; resolve it from there so this tool needs no dependency of its own.
const sharp = createRequire(join(here, '../asset-cli/package.json'))('sharp');

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? resolve(args[i + 1].replace(/^~/, homedir())) : dflt;
};
const SRC = opt('--src', join(homedir(), 'Downloads'));
const OUT = opt('--out', join(homedir(), 'Crawlout/assets/local/hud'));

const SHEET = {
  e6: 'Gemini_Generated_Image_tabsftabsftabsft.jpeg', // Gebouwenbalk
  e7: 'Gemini_Generated_Image_ecvj05ecvj05ecvj.jpeg', // Selectiepaneel
  e8: 'Gemini_Generated_Image_b6o7nib6o7nib6o7.jpeg', // Commandopaneel
  e9: 'Gemini_Generated_Image_ipywluipywluipyw.jpeg', // Bouwmenu en plaatsing
  tok: 'Gemini_Generated_Image_bqayrxbqayrxbqay.jpeg', // tokens and generic hardware
  mock: 'mockup-blanked.png', // in-game mockup with blanked glass
};

/** Cut a rectangle {x,y,w,h} out of a sheet as an RGBA PNG buffer. */
async function cut(sheet, [x, y, w, h]) {
  return sharp(join(SRC, SHEET[sheet]))
    .extract({ left: x, top: y, width: w, height: h })
    .ensureAlpha()
    .png()
    .toBuffer();
}

/** Make the interior transparent, keeping `inset` ([top,right,bottom,left]) pixels of rim. */
async function hollow(buf, w, h, [t, r, b, l]) {
  const hole = await sharp({
    create: {
      width: w - l - r,
      height: h - t - b,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  return sharp(buf)
    .composite([{ input: hole, left: l, top: t, blend: 'dest-out' }])
    .png()
    .toBuffer();
}

/**
 * Build a symmetric w*2 x h*2 image from one corner crop (mirrored on both axes). `corner` says which corner of the
 * original object the crop is (tl, tr, bl, br). Used both for frames (text-free corner in, whole frame out) and for
 * seamless tiles.
 */
async function mirror(sheet, rect, corner = 'tl') {
  const [, , w, h] = rect;
  let q = sharp(await cut(sheet, rect));
  if (corner.includes('b')) q = q.flip();
  if (corner.includes('r')) q = q.flop();
  const tl = await q.png().toBuffer();
  const flop = await sharp(tl).flop().png().toBuffer();
  const flip = await sharp(tl).flip().png().toBuffer();
  const both = await sharp(tl).flip().flop().png().toBuffer();
  const buf = await sharp({
    create: {
      width: w * 2,
      height: h * 2,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: tl, left: 0, top: 0 },
      { input: flop, left: w, top: 0 },
      { input: flip, left: 0, top: h },
      { input: both, left: w, top: h },
    ])
    .png()
    .toBuffer();
  return { buf, w: w * 2, h: h * 2 };
}

/** Horizontal repeat period of a diagonal stripe pattern, so the tile repeats without a seam. */
async function stripePeriod(buf, w, h) {
  const { data } = await sharp(buf)
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let best = 8;
  let bestErr = Infinity;
  for (let p = 8; p <= Math.floor(w / 2); p++) {
    let err = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x + p < w; x++) err += Math.abs(data[y * w + x] - data[y * w + x + p]);
    err /= h * (w - p);
    if (err < bestErr) {
      bestErr = err;
      best = p;
    }
  }
  return best;
}

const files = {};
const skin = { version: 1, frames: {}, tiles: {}, images: {} };

async function emit(name, buf, meta) {
  const info = await sharp(buf).metadata();
  writeFileSync(join(OUT, `${name}.png`), buf);
  files[name] = `${info.width}x${info.height}`;
  return { file: `${name}.png`, w: info.width, h: info.height, ...meta };
}

/** A 9-slice frame cut whole from the sheet, with the interior removed. slice = [t,r,b,l] */
async function frameCrop(name, sheet, rect, slice) {
  const [, , w, h] = rect;
  const buf = await hollow(await cut(sheet, rect), w, h, slice);
  skin.frames[name] = await emit(name, buf, { slice });
}

/** A 9-slice frame mirrored from one text-free corner crop; slice is a number or [t,r,b,l] in px of the output. */
async function frameMirror(name, sheet, rect, corner, slice) {
  const { buf } = await mirror(sheet, rect, corner);
  skin.frames[name] = await emit(name, buf, {
    slice: Array.isArray(slice) ? slice : [slice, slice, slice, slice],
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  // Seamless rusty plate texture (mirror-tiled from a text-free area of the Gebouwenbalk sheet).
  {
    const { buf } = await mirror('e6', [765, 655, 385, 150], 'tl');
    skin.tiles['plate-rust'] = await emit('plate-rust', buf, {});
  }

  // Riveted rusty plate: big panels (hero, dominance, top bar, card panel, dialog).
  await frameMirror('frame-plate', 'e6', [715, 616, 48, 48], 'tl', 40);
  // Riveted rusty bezel around a CRT glass (selection panel, enemy variant, perk panel).
  await frameMirror('frame-bezel', 'e7', [455, 152, 44, 44], 'tl', 40);
  // Slim dark inset well with a thin rim (grids, roster bar well).
  await frameMirror('frame-well', 'e8', [42, 182, 22, 22], 'tl', 20);
  // Riveted rim around the command button grid.
  await frameMirror('frame-rim', 'e8', [510, 177, 40, 40], 'tl', 36);
  // Strip with rivets: "Kies een doel", placement bar, toasts.
  await frameMirror('frame-strip', 'e8', [532, 401, 30, 30], 'tl', 28);
  // Green CRT chip bezel of the Gebouwenbalk.
  await frameMirror('frame-chip', 'e6', [52, 162, 34, 34], 'tl', 32);
  // Rusty build-option card with rivets.
  await frameMirror('frame-card', 'e9', [47, 200, 16, 16], 'tl', 15);
  // Minimap bezel from the in-game mockup.
  await frameMirror('frame-minimap', 'mock', [896, 27, 12, 12], 'tl', 11);

  // Generic buttons (normal, amber = active, rust = disabled), interior removed.
  await frameMirror('btn-normal', 'e8', [57, 195, 30, 30], 'tl', 28);
  await frameMirror('btn-amber', 'e8', [330, 195, 30, 30], 'tl', 28);
  await frameMirror('btn-rust', 'e8', [492, 599, 24, 24], 'tl', 22);
  // Key badge and amber count badge (chips), interior removed.
  await frameCrop('badge-key', 'e8', [142, 201, 28, 28], [5, 5, 5, 5]);
  await frameCrop('badge-chip', 'e6', [289, 376, 38, 38], [7, 7, 7, 7]);
  // Paper chip for placement reasons: the text-free left end of a chip, mirrored.
  await frameMirror('chip-paper', 'e9', [684, 370, 12, 20], 'tl', [18, 11, 18, 11]);

  // Hazard stripes: one full period multiple, so it repeats seamlessly along the bar.
  {
    const rect = [500, 306, 150, 22];
    const raw = await cut('e7', rect);
    const p = await stripePeriod(raw, rect[2], rect[3]);
    const tiles = Math.max(1, Math.floor(rect[2] / p));
    const buf = await sharp(raw)
      .extract({ left: 0, top: 0, width: p * tiles, height: rect[3] })
      .png()
      .toBuffer();
    skin.tiles['hazard'] = await emit('hazard', buf, { period: p * tiles });
  }

  writeFileSync(join(OUT, 'hud-skin.json'), `${JSON.stringify(skin, null, 2)}\n`);
  process.stdout.write(`hud-art: ${Object.keys(files).length} crops + hud-skin.json -> ${OUT}\n`);
  for (const [n, s] of Object.entries(files)) process.stdout.write(`  ${n}.png ${s}\n`);
}

await main();

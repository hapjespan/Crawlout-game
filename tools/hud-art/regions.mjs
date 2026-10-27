// The in-game mockup (mockup-blanked.png, 1024x572) turned into clean HUD pieces: every region of the console art with
// the baked lettering and the live numbers painted out, so the HUD can draw its own text and values on top. Only
// coordinates and paint operations live here; the art itself stays in the designer's files and in assets/local.
//
// All coordinates are mockup pixels. The regions are exported at 2x with a light sharpen (see Img.png).
import { Img } from './paint.mjs';

const DARK = [34, 35, 32, 255];

/** The painted-over mockup plus the rectangles of each region. Split out so the tests of the tool stay cheap. */
export async function paintMock(path) {
  const src = await Img.load(path);
  const m = src.clone();

  // --- Top-left brass bar: rebuild the gauge, the four windows and the plate between them.
  // The blank box wiped the left half of the gauge and the lower half of the two left windows. The gauge is symmetric,
  // so its right half is mirrored over the left; the plate strips between the windows are cloned from the right end.
  for (let x = 135; x <= 152; x++) for (let y = 5; y <= 46; y++) m.set(x, y, src.get(304 - x, y));
  m.copy(304, 8, 9, 37, 126, 8, src); // plate between window 2 and the gauge
  m.copy(304, 8, 7, 37, 62, 8, src); // plate between window 1 and 2
  paintDisc(m, 152.5, 25.5, 14, [24, 26, 25], [8, 10, 10]);
  for (const [x, w] of [
    [12, 50], // Schroot
    [69, 56], // Bewoners
    [177, 64], // Populatie
    [248, 55], // Bedden
  ])
    paintWindow(m, x, 9, w, 31);

  // --- Left console: the five plates lose their lettering (the red lamp stays on the plate). The clean stretch of the
  // plate that says MAP is stretched over the lettering of every row.
  const plateX = 22;
  const plateW = 112;
  const plateY = [287, 314, 341, 368, 395];
  const plateH = 21;
  const clean = plateY[2];
  for (const y of plateY) {
    m.stretchFill(86, clean, 24, plateX + 27, y, plateW - 27 - 8, plateH, src);
    if (y !== clean) m.copy(plateX + plateW - 8, clean, 8, plateH, plateX + plateW - 8, y, src);
  }
  // The tab on top of the console says "SELECTIE" in glowing letters; the HUD writes its own word on a dark green LED.
  m.vgradient(25, 263, 41, 13, [12, 38, 16, 255], [6, 22, 9, 255]);
  m.fill(25, 263, 41, 1, [3, 12, 5, 255]);

  // The console case stands on the terrain of the mockup: make every pixel around it transparent, so the real game
  // shows there instead of a rectangle of the mockup's ground.
  m.hollow(0, 258, 22, 14);
  m.hollow(78, 258, 118, 14);
  m.hollow(163, 272, 33, 12);
  m.hollow(148, 284, 48, 139);
  m.hollow(194, 423, 2, 17);
  m.hollow(0, 438, 196, 2);
  m.hollow(283, 438, 407, 2);
  m.hollow(690, 448, 334, 3);

  // --- Selection screen (bottom left): the glass was blanked already; hollow it so the HUD's own glass shows through.
  m.hollowRounded(16, 461, 231, 106, 4);

  // --- Unit bar (bottom centre): the title is painted out by cloning a clean stretch of the header; the well with the
  // four baked portraits is hollowed for the HUD's own tiles. The "BOS" lettering on the right stays as decoration.
  m.stretchFill(400, 444, 50, 452, 444, 58, 16, src);
  m.hollowRounded(303, 474, 360, 92, 3);

  // --- Console (bottom right): name tab, hit-point dots, portrait, the two item slots and the five key plates lose
  // their baked content; the HUD draws its own.
  m.vgradient(704, 455, 56, 21, [40, 42, 37, 255], [30, 31, 28, 255]);
  m.stretchFill(832, 479, 20, 766, 479, 66, 11, src);
  m.hollow(729, 492, 50, 73);
  m.hollow(790, 498, 72, 69);
  m.hollow(872, 498, 66, 69);
  for (const by of [459, 481, 503, 526, 548]) m.inpaintV(985, by + 4, 28, 11);

  return m;
}

/** A dark glass window with a thin lit lower edge, like the bezels of the original. */
function paintWindow(img, x, y, w, h) {
  img.vgradient(x, y, w, h, [30, 31, 29], [20, 21, 20]);
  img.grain(x, y, w, h, 5);
  img.fill(x, y + h, w, 1, [150, 140, 105, 255]);
  img.fill(x, y - 1, w, 1, [10, 10, 9, 255]);
}

/** A flat disc with a radial shade (the face of the gauge); the HUD draws ticks and needle over it. */
function paintDisc(img, cx, cy, r, inner, outer) {
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++)
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > r) continue;
      const t = d / r;
      img.set(x, y, [0, 1, 2].map((i) => inner[i] + (outer[i] - inner[i]) * t).concat(255));
    }
}

export { DARK };

/** Regions of the painted mockup that become bitmaps of their own: name, [x, y, w, h] in mockup pixels. */
export const REGIONS = {
  'region-resources': [0, 0, 322, 50],
  'region-sidebar': [0, 258, 196, 182],
  'region-selection': [0, 452, 283, 120],
  'region-roster': [283, 438, 407, 134],
  'region-console': [690, 448, 334, 124],
};

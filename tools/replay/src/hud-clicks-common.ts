// Split from hud-clicks.ts to stay under the 5,000-token file limit: the settings, page-code snippets, check helper
// and the run context shared by the hud-clicks stages.
import type { Browser, Page } from '@playwright/test';

export const URL = process.env.HUD_URL ?? 'http://localhost:5173/';
export const SHOTS = process.env.HUD_SHOTS;
export const SIZES: readonly [number, number][] = [
  [1600, 900],
  [1280, 720],
];

/**
 * The buildings the test puts up, by data key (type ids shift when buildings are added, so they are looked up in the
 * page through the data, never hard-coded). The sites are chosen at run time with the sim's own placement rule
 * (window.crawlout.placement.reason), searching outward from the HQ, so a change of the rule or the map cannot
 * invalidate them. `top` is the roof height in meters for the click probes.
 */
export const SITE_KEYS = [
  { key: 'lab', name: 'Lab', top: 8 },
  { key: 'werkplaats', name: 'Werkplaats', top: 8 },
] as const;
export const HQ_KEY = 'hoofdgebouw';
export const HQ_NAME = 'Basis';
export const HQ_TOP = 10;
/** Hard limit for one browser run; the script always exits (a hung page counts as a failure, never a hang). */
export const RUN_LIMIT_MS = 6 * 60 * 1000;
export interface Site {
  name: string;
  typeId: number;
  x: number;
  y: number;
  w: number;
  h: number;
  top: number;
}

export const failures: string[] = [];
export const check = (ok: boolean, what: string, detail = ''): void => {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${what}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(what);
};
export const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Code that runs in the page, as strings: this package has no DOM types.
export const OWN = `(() => { const c = window.crawlout; return [...c.entities().values()].filter((e) => e.owner === c.session.playerId).map((e) => ({ id: e.id, t: e.typeId, x: e.x, y: e.y, anim: e.anim })); })()`;
export const QUEUE = `(() => (window.crawlout.status()?.queue ?? []).map((q) => ({ kind: q.kind, id: q.id, b: q.buildingId })))()`;
/** Screen position of a world point (meters x, height above the ground under the camera target, meters z). */
export const project = (x: number, y: number, z: number): string => `(() => {
  const ctl = window.crawlout.renderer.cameraControls; const cam = ctl.camera; cam.updateMatrixWorld();
  const v = cam.matrixWorldInverse.elements, p = cam.projectionMatrix.elements;
  const wy = ctl.target.y + ${y};
  const vx = v[0]*${x}+v[4]*wy+v[8]*${z}+v[12], vy = v[1]*${x}+v[5]*wy+v[9]*${z}+v[13], vz = v[2]*${x}+v[6]*wy+v[10]*${z}+v[14];
  const cx = p[0]*vx+p[4]*vy+p[8]*vz+p[12], cy = p[1]*vx+p[5]*vy+p[9]*vz+p[13], cw = p[3]*vx+p[7]*vy+p[11]*vz+p[15];
  const c = document.getElementById('view');
  return cw <= 0 ? null : { x: (cx / cw + 1) / 2 * c.clientWidth, y: (1 - cy / cw) / 2 * c.clientHeight };
})()`;
/** Camera target on the ground in meters (x, z). */
export const CAMERA = `(() => { const t = window.crawlout.renderer.cameraControls.target; return { x: t.x, z: t.z }; })()`;
export const rectOf = (sel: string): string =>
  `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`;
export const textOf = (sel: string): string =>
  `(() => document.querySelector(${JSON.stringify(sel)})?.textContent ?? '')()`;
/** True when the topmost element at the point is the game canvas (not a HUD panel). */
export const onCanvas = (x: number, y: number): string =>
  `(() => document.elementFromPoint(${x}, ${y})?.id === 'view')()`;

/**
 * Page code: the spot (centre in sim units, on a cell middle) closest to (hx, hy) where the sim's placement rule accepts
 * the building with this data key, searching rings of whole cells outward; null when nothing within 70 cells fits.
 */
export const findSite = (key: string, hx: number, hy: number): string => `(() => {
  const pl = window.crawlout.placement; const f = pl.footprint(${JSON.stringify(key)});
  const typeId = pl.typeId(${JSON.stringify(key)});
  const hcx = Math.floor(${hx} / 256), hcy = Math.floor(${hy} / 256);
  const cands = [];
  for (let dy = -70; dy <= 70; dy++) for (let dx = -70; dx <= 70; dx++) cands.push([dx, dy]);
  cands.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]) || a[1] - b[1] || a[0] - b[0]);
  for (const [dx, dy] of cands) {
    if (Math.hypot(dx, dy) < 20) continue;
    const x = (hcx + dx) * 256 + 128, y = (hcy + dy) * 256 + 128;
    if (pl.reason(${JSON.stringify(key)}, x, y) === 0) return { typeId, x, y, w: f.w, h: f.h };
  }
  return null;
})()`;

export interface Pt {
  x: number;
  y: number;
}
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The page and the human-speed helpers of one browser run, created by runIn() in hud-clicks.ts. */
export interface HudRun {
  browser: Browser;
  page: Page;
  width: number;
  height: number;
  shot: (name: string) => Promise<void>;
  ev: <T>(code: string) => Promise<T>;
  click: (
    p: Pt,
    opts?: { button?: 'left' | 'right'; modifiers?: ('Control' | 'Shift')[] },
  ) => Promise<void>;
  center: (sel: string) => Promise<Pt>;
  selection: () => Promise<string>;
  cardsOpen: () => Promise<boolean>;
  groundSpot: () => Promise<Pt>;
}

/** The run context plus what the build stage found: the own HQ and the two building sites. */
export interface HudRunState extends HudRun {
  hqTypeId: number;
  hqRow: { t: number; x: number; y: number };
  sites: Site[];
}

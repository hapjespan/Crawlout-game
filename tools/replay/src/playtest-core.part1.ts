// Split from playtest-core.ts to stay under the 5,000-token file limit; playtest-core.ts re-exports the public surface.
// Holds: SHOTS, MINUTES, Severity, Finding, Pt, Box, +15 more.

export const SHOTS = process.env.PLAYTEST_SHOTS;

export const MINUTES = Number(process.env.PLAYTEST_MINUTES ?? 15);

export type Severity = 'hoog' | 'midden' | 'laag';

export interface Finding {
  size: string;
  severity: Severity;
  text: string;
  step: string;
}

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

export interface Ent {
  id: number;
  t: number;
  x: number;
  y: number;
  owner: number;
  anim: number;
  hp: number;
  /** Snapshot flag bits (ENTITY_FLAG): 16 = ghost, 8 = in combat. */
  fl: number;
}

export interface PerfSample {
  game: number;
  text: string;
  fps: number;
  worst: number;
  cpu: number;
  dc: number;
}

export const ALL_FINDINGS: Finding[] = [];

export const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const BUILDING_MIN = 1024;

export const BUILDING_MAX = 2048;

export const SCRAP_NODE = 2048;

export const CLAIM_POINT = 2049;

export const ANIM_BUILD = 6;

export const TICK_HZ = 20;

/** Display names of the build menu per data key (BUILDING_NAMES in the client). */
export const DUTCH: Record<string, string> = { trainingsfaciliteit: 'Training' };

// Code that runs in the page, as strings: this package has no DOM types.
export const ENTS = `(() => { const c = window.crawlout; return [...c.entities().values()].map((e) => ({ id: e.id, t: e.typeId, x: e.x, y: e.y, owner: e.owner, anim: e.anim, hp: e.hpPct, fl: e.flags })); })()`;

export const rectOf = (sel: string): string =>
  `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`;

export const textOf = (sel: string): string =>
  `(() => document.querySelector(${JSON.stringify(sel)})?.innerText ?? '')()`;

/** Facts about the HUD layout that should hold at every size: panels on screen, no panel on another, no text out of its panel. */
export const LAYOUT_AUDIT = `(() => {
  const issues = [];
  const W = innerWidth, H = innerHeight;
  const panels = ['.co-counters', '.co-hero', '.co-minimap', '.co-selection', '.co-roster', '.co-cards', '.co-commands', '.co-top-right', '#perf', '.co-targeting', '.co-dominance']
    .map((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return r.width === 0 ? null : { s, r }; }).filter(Boolean);
  for (const p of panels) {
    if (p.r.left < -1 || p.r.top < -1 || p.r.right > W + 1 || p.r.bottom > H + 1) issues.push('paneel buiten beeld: ' + p.s + ' ' + [p.r.left, p.r.top, p.r.right, p.r.bottom].map(Math.round).join(','));
  }
  for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
    const a = panels[i].r, b = panels[j].r;
    if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) issues.push('panelen overlappen: ' + panels[i].s + ' en ' + panels[j].s);
  }
  for (const el of document.querySelectorAll('.co-panel, .co-building-btn, .co-btn, .co-card-main')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || (el.classList.contains('co-hero') && el.querySelector('.co-perk-panel')) || el.classList.contains('co-counters')) continue; // the Robots tab hangs below the counters on purpose
    const cs = getComputedStyle(el);
    const label = el.className.toString().split(' ').slice(0, 2).join('.') + '"' + (el.innerText || '').replace(/\\s+/g, ' ').slice(0, 24) + '"';
    if (el.scrollWidth > el.clientWidth + (el.classList.contains('co-m-plate') ? 12 : 1) && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') issues.push('tekst loopt horizontaal over: ' + label);
    if (el.scrollHeight > el.clientHeight + 1 && cs.overflowY !== 'auto' && cs.overflowY !== 'scroll' && cs.overflowY !== 'hidden') issues.push('tekst loopt verticaal over: ' + label);
    if (el.scrollHeight > el.clientHeight + 1 && cs.overflowY === 'hidden') issues.push('tekst afgesneden: ' + label);
    for (const d of el.querySelectorAll('*')) {
      const q = d.getBoundingClientRect();
      if (q.width === 0 || q.height === 0 || !(d.textContent || '').trim() || d.closest('.co-perk-panel')) continue;
      if (q.right > r.right + 1.5 || q.left < r.left - 1.5) { issues.push('kindtekst buiten ' + label + ': ' + (d.textContent || '').slice(0, 24)); break; }
    }
  }
  return [...new Set(issues)];
})()`;

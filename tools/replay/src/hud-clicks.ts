// HUD and picking in a real browser, with a human-speed mouse (move in steps, press, hold, release). The click bug
// reports ("I cannot click the workshop or the lab, I cannot select anything") never showed up in a headless run that
// clicked instantly, so this drives the actual client the way a player does:
//   - a finished workshop and lab: click the building bar, click the roof and the walls of every building at the
//     default and the far zoom, click a research card, see the queue run, click a locked card and read its reason;
//   - a left click on empty ground clears the selection and closes the card panel; Escape clears it too; a click on a
//     building after a Move target or while a target is pending still selects it;
//   - layout at 1600x900 and 1280x720: the card window sits directly above the commands, clear of the minimap and the
//     bottom bar; the frame stats are top right next to "Opgeven".
//
// Needs a running client (the dev server) and Chrome (Playwright channel 'chrome'); not part of `pnpm test`.
//   HUD_URL=http://localhost:5173/ HUD_SHOTS=/some/dir node --import tsx src/hud-clicks.ts
// Exit 1 when a check fails. Screenshots of every state go to HUD_SHOTS when set.
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';

const URL = process.env.HUD_URL ?? 'http://localhost:5173/';
const SHOTS = process.env.HUD_SHOTS;
const SIZES: readonly [number, number][] = [
  [1600, 900],
  [1280, 720],
];

/**
 * The buildings the test puts up, by data key (type ids shift when buildings are added, so they are looked up in the
 * page through the data, never hard-coded). The sites are chosen at run time with the sim's own placement rule
 * (window.crawlout.placement.reason), searching outward from the HQ, so a change of the rule or the map cannot
 * invalidate them. `top` is the roof height in meters for the click probes.
 */
const SITE_KEYS = [
  { key: 'lab', name: 'Lab', top: 8 },
  { key: 'werkplaats', name: 'Werkplaats', top: 8 },
] as const;
const HQ_KEY = 'hoofdgebouw';
const HQ_NAME = 'Basis';
const HQ_TOP = 10;
/** Hard limit for one browser run; the script always exits (a hung page counts as a failure, never a hang). */
const RUN_LIMIT_MS = 6 * 60 * 1000;
interface Site {
  name: string;
  typeId: number;
  x: number;
  y: number;
  w: number;
  h: number;
  top: number;
}

const failures: string[] = [];
const check = (ok: boolean, what: string, detail = ''): void => {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${what}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(what);
};
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Code that runs in the page, as strings: this package has no DOM types.
const OWN = `(() => { const c = window.crawlout; return [...c.entities().values()].filter((e) => e.owner === c.session.playerId).map((e) => ({ id: e.id, t: e.typeId, x: e.x, y: e.y, anim: e.anim })); })()`;
const QUEUE = `(() => (window.crawlout.status()?.queue ?? []).map((q) => ({ kind: q.kind, id: q.id, b: q.buildingId })))()`;
/** Screen position of a world point (meters x, height above the ground under the camera target, meters z). */
const project = (x: number, y: number, z: number): string => `(() => {
  const ctl = window.crawlout.renderer.cameraControls; const cam = ctl.camera; cam.updateMatrixWorld();
  const v = cam.matrixWorldInverse.elements, p = cam.projectionMatrix.elements;
  const wy = ctl.target.y + ${y};
  const vx = v[0]*${x}+v[4]*wy+v[8]*${z}+v[12], vy = v[1]*${x}+v[5]*wy+v[9]*${z}+v[13], vz = v[2]*${x}+v[6]*wy+v[10]*${z}+v[14];
  const cx = p[0]*vx+p[4]*vy+p[8]*vz+p[12], cy = p[1]*vx+p[5]*vy+p[9]*vz+p[13], cw = p[3]*vx+p[7]*vy+p[11]*vz+p[15];
  const c = document.getElementById('view');
  return cw <= 0 ? null : { x: (cx / cw + 1) / 2 * c.clientWidth, y: (1 - cy / cw) / 2 * c.clientHeight };
})()`;
const rectOf = (sel: string): string =>
  `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`;
const textOf = (sel: string): string =>
  `(() => document.querySelector(${JSON.stringify(sel)})?.textContent ?? '')()`;
/** True when the topmost element at the point is the game canvas (not a HUD panel). */
const onCanvas = (x: number, y: number): string =>
  `(() => document.elementFromPoint(${x}, ${y})?.id === 'view')()`;

/**
 * Page code: the spot (centre in sim units, on a cell middle) closest to (hx, hy) where the sim's placement rule accepts
 * the building with this data key, searching rings of whole cells outward; null when nothing within 70 cells fits.
 */
const findSite = (key: string, hx: number, hy: number): string => `(() => {
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

interface Pt {
  x: number;
  y: number;
}
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

async function run(width: number, height: number): Promise<void> {
  console.log(`\n== ${width}x${height} ==`);
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
  });
  try {
    await runIn(browser, width, height);
  } finally {
    await Promise.race([browser.close().catch(() => undefined), wait(10000)]);
  }
}

async function runIn(browser: Browser, width: number, height: number): Promise<void> {
  const page: Page = await (await browser.newContext({ viewport: { width, height } })).newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (e) => failures.push(`pageerror ${e.message}`));
  // The fake clock lets the sim run minutes in seconds (runFor) while the page also runs in real time (resume).
  await page.clock.install();
  await page.goto(URL);
  await page.clock.resume();
  await page.waitForFunction(`window.crawlout && window.crawlout.entities().size > 10`, null, {
    timeout: 60000,
  });
  await wait(2000);
  const shot = async (name: string): Promise<void> => {
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${width}-${name}.png` });
  };
  const ev = <T>(code: string): Promise<T> => page.evaluate(code) as Promise<T>;

  /** A human click: move in steps, press, hold, release. */
  const click = async (
    p: Pt,
    opts: { button?: 'left' | 'right'; modifiers?: ('Control' | 'Shift')[] } = {},
  ): Promise<void> => {
    await page.mouse.move(p.x, p.y, { steps: 7 });
    await wait(70);
    for (const m of opts.modifiers ?? []) await page.keyboard.down(m);
    await page.mouse.down({ button: opts.button ?? 'left' });
    await wait(100);
    await page.mouse.up({ button: opts.button ?? 'left' });
    for (const m of opts.modifiers ?? []) await page.keyboard.up(m);
    await wait(220);
  };
  const center = async (sel: string): Promise<Pt> => {
    const r = await page.locator(sel).first().boundingBox();
    if (!r) throw new Error(`no element ${sel}`);
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  const selection = (): Promise<string> => ev<string>(textOf('.co-selection'));
  const cardsOpen = (): Promise<boolean> => ev<boolean>(`!!document.querySelector('.co-cards')`);
  const groundSpot = async (): Promise<Pt> => {
    // An empty spot of the canvas, away from every building and HUD panel: probe a ring around the screen center.
    for (const [fx, fy] of [
      [0.5, 0.62],
      [0.3, 0.45],
      [0.7, 0.4],
      [0.45, 0.3],
      [0.6, 0.55],
    ] as const) {
      const p = { x: width * fx, y: height * fy };
      if (!(await ev<boolean>(onCanvas(p.x, p.y)))) continue;
      const hit = await ev<{ entityId: number | null }>(
        `window.crawlout.renderer.pickAt(${p.x}, ${p.y})`,
      );
      if (hit.entityId === null) return p;
    }
    await shot('99-no-ground-spot');
    throw new Error('no empty ground spot');
  };

  const hqTypeId = await ev<number>(`window.crawlout.placement.typeId(${JSON.stringify(HQ_KEY)})`);
  // --- Zoom out and build a lab and a workshop with the one builder (sim time runs on the fake clock).
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(width / 2, height / 2);
    await page.mouse.wheel(0, 240);
    await wait(60);
  }
  await wait(600);
  await shot('00-no-selection');
  const noSel = await selection();
  check(noSel.includes('Niets geselecteerd'), 'no selection at the start');
  check(
    (await ev<string>(textOf('.co-commands'))).includes('Selecteer een eenheid of gebouw'),
    'commands panel only hints when nothing is selected',
  );
  const bar0 = await ev<string>(textOf('.co-building-buttons'));
  check(bar0.includes('Basis'), 'the buildings bar lists the Basis from the start', bar0);

  // Builder selected: Verplaats, Stop, Bouw (no Val aan).
  await click(await center('.co-roster-groups button:has-text("Bouwer")'));
  const builderActions = await ev<string[]>(
    `[...document.querySelectorAll('.co-buttons [data-action]')].map((b) => b.getAttribute('data-action'))`,
  );
  check(
    builderActions.includes('build') &&
      builderActions.includes('move') &&
      !builderActions.includes('attackMove'),
    'builder gets Verplaats, Stop and Bouw but no Val aan',
    builderActions.join(','),
  );
  await shot('01-builder-selected');
  await click(await center('.co-roster-groups button:has-text("Militie")'));
  const militiaActions = await ev<string[]>(
    `[...document.querySelectorAll('.co-buttons [data-action]')].map((b) => b.getAttribute('data-action'))`,
  );
  check(
    militiaActions.includes('attackMove') &&
      !militiaActions.includes('build') &&
      !militiaActions.includes('gather'),
    'militia gets Val aan but no Bouw or Verzamel',
    militiaActions.join(','),
  );
  await shot('02-militia-selected');
  for (const gone of ['hero', 'craft', 'minimap'])
    check(
      !(await ev<boolean>(`!!document.querySelector('[data-action="${gone}"]')`)),
      `no ${gone} button`,
    );
  check(
    await ev<boolean>(`!!document.querySelector('.co-minimap canvas')`),
    'minimap is always shown',
  );
  check(await ev<boolean>(`!!document.querySelector('.co-hero')`), 'hero panel is always shown');

  // Sites: the nearest spots to the HQ where the sim's placement rule accepts the building (a site already ordered
  // counts as a building for the next search, so the two never crowd each other).
  const hqRow = (await ev<{ t: number; x: number; y: number }[]>(OWN)).find(
    (e) => e.t === hqTypeId,
  );
  if (!hqRow) throw new Error('no own HQ found');
  const sites: Site[] = [];
  for (const s of SITE_KEYS) {
    const spot = await ev<{ typeId: number; x: number; y: number; w: number; h: number } | null>(
      findSite(s.key, hqRow.x, hqRow.y),
    );
    check(spot !== null, `a valid site for the ${s.name} exists near the HQ`);
    if (!spot) throw new Error(`no valid site for ${s.key}`);
    sites.push({ ...s, ...spot });
    console.log(`     ${s.name} site at ${spot.x},${spot.y} (typeId ${spot.typeId})`);
    await ev(`(() => {
      const c = window.crawlout; const es = [...c.entities().values()].filter((e) => e.owner === c.session.playerId);
      const builder = es.find((e) => e.typeId === 2)?.id;
      c.session.sendCommand('Build', { ids: [builder], typeId: ${spot.typeId}, x: ${spot.x}, y: ${spot.y} });
    })()`);
    await page.clock.runFor(1000);
  }
  // The scavengers collect scrap meanwhile, so a card is affordable once the buildings stand.
  await ev(`(() => {
    const c = window.crawlout; const es = [...c.entities().values()];
    const mine = es.filter((e) => e.owner === c.session.playerId);
    const scav = mine.filter((e) => e.typeId === 8 || e.typeId === 1 || e.typeId === 7).map((e) => e.id);
    const node = es.filter((e) => e.typeId === 2048).sort((a, b) => Math.hypot(a.x - mine[0].x, a.y - mine[0].y) - Math.hypot(b.x - mine[0].x, b.y - mine[0].y))[0];
    if (node && scav.length) c.session.sendCommand('Gather', { ids: scav, nodeId: node.id });
  })()`);
  await page.clock.runFor(2000);
  const finishAll = `(() => {
    const c = window.crawlout; const es = [...c.entities().values()].filter((e) => e.owner === c.session.playerId);
    const builder = es.find((e) => e.typeId === 2)?.id;
    for (const e of es) if (e.typeId >= 1024 && e.typeId < 2048 && e.anim === 6 && builder) c.session.sendCommand('Build', { ids: [builder], typeId: e.typeId, x: e.x, y: e.y });
  })()`;
  for (let i = 0; i < 14; i++) {
    await ev(finishAll);
    await page.clock.runFor(15000);
    await wait(500);
    const b = (await ev<{ t: number; anim: number }[]>(OWN)).filter(
      (e) => e.t >= 1024 && e.t < 2048,
    );
    if (b.length >= 3 && b.every((e) => e.anim === 0)) break;
  }
  const built = (await ev<{ t: number; anim: number }[]>(OWN)).filter(
    (e) => e.t >= 1024 && e.t < 2048,
  );
  check(
    built.length === 3 && built.every((e) => e.anim === 0),
    'lab and workshop are built',
    JSON.stringify(built),
  );
  for (let i = 0; i < 20 && (await ev<number>(`window.crawlout.status().scrap`)) < 220; i++) {
    await page.clock.runFor(15000);
    await wait(300);
  }
  check(
    (await ev<number>(`window.crawlout.status().scrap`)) >= 220,
    'scrap income pays for a card',
  );
  await page.keyboard.press('Escape');
  await wait(500);
  await shot('03-built');

  // --- The buildings bar: all built buildings, with a badge for what can be started.
  const bar = await ev<string>(textOf('.co-building-buttons'));
  check(
    /Basis/.test(bar) && /Werkplaats/.test(bar) && /Lab/.test(bar),
    'the bar lists Basis, Werkplaats and Lab',
    bar,
  );
  const badge = await ev<string>(textOf('[data-building="werkplaats"] .co-building-badge'));
  check(Number(badge) > 0, 'the workshop shows a badge for the research it can start', badge);

  // --- Click the workshop in the bar: it is selected and its cards open above the commands.
  await click(await center('[data-building="werkplaats"]'));
  check(
    (await selection()).includes('Werkplaats'),
    'bar click selects the workshop',
    await selection(),
  );
  check(await cardsOpen(), 'the card window opens');
  const cards = await ev<Box>(rectOf('.co-cards'));
  const cmds = await ev<Box>(rectOf('.co-commands'));
  const mini = await ev<Box>(rectOf('.co-minimap'));
  const roster = await ev<Box>(rectOf('.co-roster'));
  check(
    cards.y + cards.h <= cmds.y + 1 && Math.abs(cards.x - cmds.x) < 2,
    'cards sit directly above the commands',
    JSON.stringify({ cards, cmds }),
  );
  check(
    !overlaps(cards, mini),
    'cards do not overlap the minimap',
    JSON.stringify({ cards, mini }),
  );
  check(
    !overlaps(cards, roster) && !overlaps(cmds, roster),
    'cards and commands do not overlap the roster bar',
  );
  check(cards.x >= 0 && cards.x + cards.w <= width && cards.y >= 0, 'cards stay on screen');
  const perf = await ev<Box | null>(rectOf('#perf'));
  const giveUp = await ev<Box>(rectOf('.co-top-right'));
  check(
    perf !== null && perf.y < 40 && perf.x + perf.w <= giveUp.x && !overlaps(perf, mini),
    'frame stats sit top right next to Opgeven, clear of the minimap',
    JSON.stringify({ perf, giveUp }),
  );
  await shot('04-workshop-selected');

  // Locked card shows its reason; clicking it does nothing but explain.
  const lockedText = await ev<string>(textOf('.co-card-locked, .co-card[data-state="locked"]'));
  check(/Vereist/.test(lockedText), 'a locked card shows what it requires', lockedText);
  const lockedBefore = (await ev<unknown[]>(QUEUE)).length;
  const locked = await ev<Pt | null>(
    `(() => { const b = document.querySelector('.co-card[data-state="locked"] button'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );
  if (locked) {
    await click(locked);
    check(
      (await ev<unknown[]>(QUEUE)).length === lockedBefore,
      'clicking a locked card starts nothing',
    );
    check(
      (await ev<string>(textOf('.co-card-notice'))).includes('Vergrendeld'),
      'clicking a locked card says why',
    );
  }

  // Click an available card: the research starts.
  const avail = await ev<Pt | null>(
    `(() => { const b = document.querySelector('.co-card[data-state="available"] button'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );
  check(avail !== null, 'an available card exists');
  if (avail) {
    await click(avail);
    await wait(1200);
    const q = await ev<{ kind: string }[]>(QUEUE);
    check(
      q.some((i) => i.kind === 'research'),
      'clicking an available card starts the research',
      JSON.stringify(q),
    );
  }
  await page.clock.runFor(4000);
  await wait(500);
  const prog = await ev<string>(
    `(() => document.querySelector('[data-building="werkplaats"] [role="progressbar"]')?.getAttribute('aria-valuenow') ?? '')()`,
  );
  check(prog !== '', 'the bar shows progress while the workshop researches', prog);
  await shot('05-research-running');

  // --- Clear by clicking empty ground; Escape clears too.
  await click(await groundSpot());
  check(
    (await selection()).includes('Niets geselecteerd'),
    'a click on empty ground clears the selection',
  );
  check(!(await cardsOpen()), '... and closes the card panel');
  check(
    (await ev<string>(textOf('.co-commands'))).includes('Selecteer een eenheid of gebouw'),
    '... and resets the commands panel',
  );
  await click(await center('[data-building="lab"]'));
  check((await selection()).includes('Lab'), 'select the lab from the bar');
  await page.keyboard.press('Escape');
  await wait(300);
  check((await selection()).includes('Niets geselecteerd'), 'Escape clears the selection');
  check(!(await cardsOpen()), '... and closes the card panel');

  // --- World clicks on every building: roof and walls, default and far zoom.
  const own = await ev<{ id: number; t: number; x: number; y: number }[]>(OWN);
  const hqFoot = await ev<{ w: number; h: number }>(
    `window.crawlout.placement.footprint(${JSON.stringify(HQ_KEY)})`,
  );
  const all: Site[] = [
    { name: HQ_NAME, typeId: hqTypeId, x: hqRow.x, y: hqRow.y, ...hqFoot, top: HQ_TOP },
    ...sites,
  ];
  for (const zoom of ['default', 'far'] as const) {
    if (zoom === 'default') {
      for (let i = 0; i < 6; i++) {
        await page.mouse.move(width / 2, height / 2);
        await page.mouse.wheel(0, -240);
        await wait(60);
      }
    } else {
      for (let i = 0; i < 14; i++) {
        await page.mouse.move(width / 2, height / 2);
        await page.mouse.wheel(0, 240);
        await wait(60);
      }
    }
    await wait(1200);
    for (const b of all) {
      await ev(`window.crawlout.renderer.focus(${b.x}, ${b.y})`);
      await wait(1400);
      const cx = b.x / 256;
      const cz = b.y / 256;
      const dx = (b.w / 2) * 0.8;
      const dz = (b.h / 2) * 0.8;
      const probes: [string, number, number, number][] = [
        ['roof centre', cx, b.top * 0.9, cz],
        ['roof near corner', cx - dx, b.top * 0.9, cz + dz],
        ['roof far corner', cx + dx, b.top * 0.9, cz - dz],
        ['front wall', cx, 2.5, cz + dz],
        ['side wall', cx + dx, 2.5, cz],
      ];
      let tried = 0;
      for (const [label, x, y, z] of probes) {
        const p = await ev<Pt | null>(project(x, y, z));
        if (!p || p.x < 4 || p.y < 4 || p.x > width - 4 || p.y > height - 4) continue;
        if (!(await ev<boolean>(onCanvas(p.x, p.y)))) continue; // behind a HUD panel
        const near = await ev<{ entityId: number | null }>(
          `window.crawlout.renderer.pickAt(${p.x}, ${p.y})`,
        );
        // another entity standing there (a unit at the wall) legitimately wins
        if (near.entityId !== null && !own.some((e) => e.id === near.entityId && e.t === b.typeId))
          continue;
        tried++;
        await click({ x: width * 0.5, y: height * 0.15 }); // clear first
        await click(p);
        const sel = await selection();
        check(
          sel.includes(b.name) || (b.name === 'Basis' && sel.includes('Basis')),
          `${zoom} zoom: click on the ${label} of the ${b.name} selects it`,
          sel.replace(/\s+/g, ' ').slice(0, 60),
        );
      }
      check(
        tried >= 2,
        `${zoom} zoom: at least two probe points of the ${b.name} were clickable`,
        String(tried),
      );
    }
  }
  await shot('06-far-zoom');
  for (let i = 0; i < 14; i++) {
    await page.mouse.move(width / 2, height / 2);
    await page.mouse.wheel(0, -240);
    await wait(60);
  }
  await wait(800);

  // --- A building click replaces a unit selection; a unit click replaces a building selection.
  const lab = own.find((e) => e.t === sites[0]!.typeId);
  if (!lab) throw new Error('lab missing');
  await ev(`window.crawlout.renderer.focus(${lab.x}, ${lab.y})`);
  await wait(1200);
  await click(await center('.co-roster-groups button:has-text("Plunderaar")'));
  check((await selection()).includes('Selectie ('), 'units are selected from the roster');
  const labPt = await ev<Pt | null>(project(lab.x / 256, 2.5, lab.y / 256 + 6));
  if (labPt && (await ev<boolean>(onCanvas(labPt.x, labPt.y)))) {
    await click(labPt);
    check(
      (await selection()).includes('Lab'),
      'clicking a building while units are selected selects the building',
      await selection(),
    );
    check(await cardsOpen(), '... and opens its cards');
  }

  // Zoom out a little so there is empty ground around the buildings to click.
  for (let i = 0; i < 5; i++) {
    await page.mouse.move(width / 2, height / 2);
    await page.mouse.wheel(0, 240);
    await wait(60);
  }
  await wait(1000);

  // --- A finished Move target must not leave the click handler in target mode (the old bug): select, Move, click on.
  await click(await center('.co-roster-groups button:has-text("Militie")'));
  await page.keyboard.press('m');
  const spot = await groundSpot();
  await click(spot);
  const labPt2 = await ev<Pt | null>(project(lab.x / 256, 2.5, lab.y / 256 + 6));
  if (labPt2 && (await ev<boolean>(onCanvas(labPt2.x, labPt2.y)))) {
    await click(labPt2);
    check(
      (await selection()).includes('Lab'),
      'after a finished Move target a building click still selects it',
      await selection(),
    );
  }
  // ... and while a target is pending, a click on a building leaves the mode and selects it
  await click(await center('.co-roster-groups button:has-text("Militie")'));
  await page.keyboard.press('a');
  if (labPt2 && (await ev<boolean>(onCanvas(labPt2.x, labPt2.y)))) {
    await click(labPt2);
    check(
      (await selection()).includes('Lab'),
      'a building click during Val aan targeting selects it',
      await selection(),
    );
  }
  await click(await groundSpot());
  check((await selection()).includes('Niets geselecteerd'), 'then empty ground clears again');

  // --- Ctrl+click (macOS right click) on the HUD must not open the browser menu or start anything.
  await click(await center('[data-building="werkplaats"]'), { modifiers: ['Control'] });
  await wait(300);
  await shot('07-final');
  await browser.close();
}

async function main(): Promise<void> {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  for (const [w, h] of SIZES) {
    const watchdog = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`run ${w}x${h} took longer than ${RUN_LIMIT_MS / 1000} s`)),
        RUN_LIMIT_MS,
      ).unref(),
    );
    try {
      await Promise.race([run(w, h), watchdog]);
    } catch (e) {
      check(
        false,
        `run ${w}x${h} finished`,
        e instanceof Error ? e.message.split('\n')[0] : String(e),
      );
    }
  }
}

await main();
if (failures.length > 0) {
  console.log(`\n${failures.length} check(s) failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('\nall HUD click checks passed');
// Exit explicitly: nothing may keep the process alive after the last line.
process.exit(0);

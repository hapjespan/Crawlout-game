// The Raiders' HUD in a real browser (`?faction=raiders`): roster without pseudo loadouts and without truncated names,
// the top bar (slaves, fighters, guards), the commands of a slave, Bewaak (G) on the Raiderkamp and the guard lines of a
// scrap node (data 0.29.0, protocol 0.15.0 Guard), the cards of a tent, the Kooi placement reason, and (after a Slaver is
// made in the tent) Vang with its hint.
//   HUD_URL=http://localhost:5211/ HUD_SHOTS=/some/dir node --import tsx src/hud-raiders.ts
// Exit 1 when a check fails. Not part of `pnpm test`.
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
import { SCRAP_NODE_TYPE_ID } from '@crawlout/data';

const URL = process.env.HUD_URL ?? 'http://localhost:5173/';
const SHOTS = process.env.HUD_SHOTS;
const SIZES: readonly [number, number][] = [
  [1280, 720],
  [1600, 900],
];
const failures: string[] = [];
const check = (ok: boolean, what: string, detail = ''): void => {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${what}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(what);
};
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const textOf = (sel: string): string =>
  `(() => document.querySelector(${JSON.stringify(sel)})?.textContent ?? '')()`;
const ACTIONS = `[...document.querySelectorAll('.co-buttons [data-action]')].map((b) => b.getAttribute('data-action'))`;
/** Screen position of a world point (meters x, height above the camera target's ground, meters z), as hud-clicks.ts. */
const project = (x: number, y: number, z: number): string => `(() => {
  const ctl = window.crawlout.renderer.cameraControls; const cam = ctl.camera; cam.updateMatrixWorld();
  const v = cam.matrixWorldInverse.elements, p = cam.projectionMatrix.elements;
  const wy = ctl.target.y + ${y};
  const vx = v[0]*${x}+v[4]*wy+v[8]*${z}+v[12], vy = v[1]*${x}+v[5]*wy+v[9]*${z}+v[13], vz = v[2]*${x}+v[6]*wy+v[10]*${z}+v[14];
  const cx = p[0]*vx+p[4]*vy+p[8]*vz+p[12], cy = p[1]*vx+p[5]*vy+p[9]*vz+p[13], cw = p[3]*vx+p[7]*vy+p[11]*vz+p[15];
  const c = document.getElementById('view');
  return cw <= 0 ? null : { x: (cx / cw + 1) / 2 * c.clientWidth, y: (1 - cy / cw) / 2 * c.clientHeight };
})()`;
const OWN = `(() => { const c = window.crawlout; return [...c.entities().values()].filter((e) => e.owner === c.session.playerId).map((e) => ({ id: e.id, t: e.typeId, x: e.x, y: e.y, anim: e.anim })); })()`;

async function run(width: number, height: number): Promise<void> {
  console.log(`\n== ${width}x${height} ==`);
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
  });
  try {
    const page: Page = await (await browser.newContext({ viewport: { width, height } })).newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', (e) => failures.push(`pageerror ${e.message}`));
    await page.clock.install();
    await page.goto(`${URL}?skip=1&faction=raiders`);
    await page.clock.resume();
    await page.waitForFunction(`window.crawlout && window.crawlout.entities().size > 10`, null, {
      timeout: 60000,
    });
    await wait(2000);
    const shot = async (name: string): Promise<void> => {
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${width}-${name}.png` });
    };
    const ev = <T>(code: string): Promise<T> => page.evaluate(code) as Promise<T>;
    const clickSel = async (sel: string): Promise<void> => {
      await page.locator(sel).first().click({ delay: 80 });
      await wait(300);
    };

    // --- Roster: no pseudo loadout, Dutch names, nothing cut off.
    const tiles = await ev<string[]>(
      `[...document.querySelectorAll('.co-roster-group')].map((b) => b.getAttribute('data-group'))`,
    );
    check(!tiles.some((t) => t.startsWith('warlord')), 'no warlord_basis tile', tiles.join(','));
    check(
      ['slaaf', 'slaaf_bouwer', 'plunderaar', 'knuppelaar'].every((t) => tiles.includes(t)),
      'the start groups show',
    );
    const cut = await ev<string[]>(
      `[...document.querySelectorAll('.co-roster-name')].filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => n.textContent + ' ' + n.scrollWidth + '>' + n.clientWidth)`,
    );
    check(cut.length === 0, 'no roster name is cut off', cut.join(','));
    const names = await ev<string[]>(
      `[...document.querySelectorAll('.co-roster-group')].map((b) => b.getAttribute('title'))`,
    );
    check(
      names.includes('Slaaf-bouwer') && names.includes('Rover'),
      'Dutch full names in the tooltip',
      names.join(','),
    );

    // --- Top bar.
    const bar = await ev<string>(textOf('.co-raiders'));
    check(
      /Slaven/.test(bar) && /Vechters/.test(bar),
      'the Raider top bar shows slaves and fighters',
      bar,
    );
    await shot('01-start');

    // --- A slave: only Verzamel (no Val aan, no Vang) and the Kooi line.
    await clickSel('[data-group="slaaf"]');
    await clickSel('.co-roster-unit');
    const slaveActions = await ev<string[]>(ACTIONS);
    check(
      slaveActions.includes('gather') &&
        !slaveActions.includes('attackMove') &&
        !slaveActions.includes('capture'),
      'a slave gets Verzamel, no Val aan or Vang',
      slaveActions.join(','),
    );
    const selText = await ev<string>(textOf('.co-selection'));
    check(
      /Kooi: Raiderkamp, werkstraal 45 m/.test(selText) ||
        (await ev<string>(textOf('.co-selection'))).includes('Kooi'),
      'the slave shows his Kooi',
      selText,
    );
    await shot('02-slave');
    await clickSel('[data-group="slaaf_bouwer"]');
    check((await ev<string[]>(ACTIONS)).includes('build'), 'a slave builder gets Bouw');

    // --- Fighters: Val aan and Bewaak (G) with its hint; Bewaak on the Raiderkamp (a Kooi) sends Guard.
    await clickSel('[data-group="knuppelaar"]');
    const fighterActions = await ev<string[]>(ACTIONS);
    check(fighterActions.includes('attackMove'), 'a fighter gets Val aan');
    check(fighterActions.includes('guard'), 'a fighter gets Bewaak', fighterActions.join(','));
    const guardTitle = await ev<string>(
      `document.querySelector('[data-action="guard"]')?.getAttribute('title') ?? ''`,
    );
    check(
      guardTitle === 'Bewaak een kooi of scrapbron: houdt slaven aan het werk',
      'Bewaak explains itself',
      guardTitle,
    );
    await page.keyboard.press('g');
    await wait(300);
    const aim = await ev<string>(textOf('.co-targeting'));
    check(/Kies een kooi of scrapbron om te bewaken/.test(aim), 'G aims Bewaak', aim);
    const camp = await ev<{ x: number; y: number } | null>(`(() => {
      const c = window.crawlout; const t = c.placement.typeId('raiderkamp');
      const e = [...c.entities().values()].find((e) => e.owner === c.session.playerId && e.typeId === t);
      return e ? { x: e.x, y: e.y } : null;
    })()`);
    const campPt = camp
      ? await ev<{ x: number; y: number } | null>(project(camp.x / 256, 1.5, camp.y / 256))
      : null;
    check(campPt !== null, 'the Raiderkamp is on screen');
    if (campPt) {
      await page.mouse.click(campPt.x, campPt.y, { delay: 80 });
      for (let i = 0; i < 6; i++) {
        await page.clock.runFor(2000);
        await wait(300);
      }
      const groups = await ev<
        { kind: string; guardMode: number; guards: number; guardsNeeded: number }[]
      >(
        `(window.crawlout.status()?.slaveGroups ?? []).map((g) => ({ kind: g.kind, guardMode: g.guardMode, guards: g.guards, guardsNeeded: g.guardsNeeded }))`,
      );
      check(
        groups.some((g) => g.kind === 'kooi' && g.guardMode >= 1 && g.guards >= g.guardsNeeded),
        'the knuppelaar guards the Raiderkamp: its slave group is guarded',
        JSON.stringify(groups),
      );
      const guardBar = await ev<string>(textOf('[data-raider="guards"]'));
      check(/Bewakers/.test(guardBar), 'the top bar counts the guards', guardBar);
      await shot('02b-bewaak');
    }
    // --- A scrap node: its guard lines in the selection panel.
    const node = await ev<{ x: number; y: number } | null>(`(() => {
      const c = window.crawlout;
      const hq = [...c.entities().values()].find((e) => e.owner === c.session.playerId && e.typeId === c.placement.typeId('raiderkamp'));
      const nodes = [...c.entities().values()].filter((e) => e.typeId === ${SCRAP_NODE_TYPE_ID});
      nodes.sort((a, b) => Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y));
      return nodes[0] ? { x: nodes[0].x, y: nodes[0].y } : null;
    })()`);
    const nodePt = node
      ? await ev<{ x: number; y: number } | null>(project(node.x / 256, 0.6, node.y / 256))
      : null;
    if (nodePt) {
      await page.keyboard.press('Escape');
      await page.mouse.click(nodePt.x, nodePt.y, { delay: 80 });
      await wait(400);
      const nodeText = await ev<string>(textOf('.co-selection'));
      check(
        /Scrapbron/.test(nodeText) && /Bewakers|Kooi/.test(nodeText),
        'a scrap node shows its guard lines',
        nodeText.slice(0, 200),
      );
      await shot('02c-scrapbron');
    } else check(false, 'a scrap node is on screen');

    // --- Kooi placement reason: too close to the camp.
    const reason = await ev<string>(`(() => {
      const c = window.crawlout; const hq = [...c.entities().values()].find((e) => e.owner === c.session.playerId && e.typeId === c.placement.typeId('raiderkamp'));
      return String(c.placement.reason('kooi', hq.x + 256 * 13, hq.y));
    })()`);
    check(reason === '7', 'a Kooi next to the camp is refused with the hqRange code', reason);

    // --- A tent: cards with Produce.
    const site = await ev<{ typeId: number; x: number; y: number } | null>(`(() => {
      const c = window.crawlout; const pl = c.placement; const typeId = pl.typeId('tent');
      const hq = [...c.entities().values()].find((e) => e.owner === c.session.playerId && e.typeId === pl.typeId('raiderkamp'));
      const hcx = Math.floor(hq.x / 256), hcy = Math.floor(hq.y / 256);
      const cands = [];
      for (let dy = -40; dy <= 40; dy++) for (let dx = -40; dx <= 40; dx++) cands.push([dx, dy]);
      cands.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
      for (const [dx, dy] of cands) { if (Math.hypot(dx, dy) < 14) continue; const x = (hcx + dx) * 256 + 128, y = (hcy + dy) * 256 + 128; if (pl.reason('tent', x, y) === 0) return { typeId, x, y }; }
      return null;
    })()`);
    check(site !== null, 'a site for a tent exists');
    if (site) {
      await ev(
        `(() => { const c = window.crawlout; const b = [...c.entities().values()].find((e) => e.owner === c.session.playerId && e.typeId === c.unitTypeId('slaaf_bouwer')); c.session.sendCommand('Build', { ids: [b.id], typeId: ${site.typeId}, x: ${site.x}, y: ${site.y} }); })()`,
      );
      for (let i = 0; i < 12; i++) {
        await page.clock.runFor(10000);
        await wait(300);
        const tent = (await ev<{ t: number; anim: number }[]>(OWN)).find(
          (e) => e.t === site.typeId,
        );
        if (tent && tent.anim === 0) break;
      }
      const tentRow = (await ev<{ id: number; t: number; anim: number }[]>(OWN)).find(
        (e) => e.t === site.typeId,
      );
      check(tentRow !== undefined && tentRow.anim === 0, 'the tent is built');
      await clickSel('[data-building="tent"]');
      const cards = await ev<string>(textOf('.co-cards'));
      check(
        /Slaver/.test(cards) && /Knuppelaar/.test(cards) && /Rover/.test(cards),
        'the tent has Produce cards',
        cards.slice(0, 160),
      );
      await shot('03-tent-cards');
      // Make a Slaver.
      await page.locator('.co-cards button', { hasText: 'Slaver' }).first().click({ delay: 80 });
      for (let i = 0; i < 8; i++) {
        await page.clock.runFor(5000);
        await wait(300);
        if (
          (
            await ev<string[]>(
              `[...document.querySelectorAll('.co-roster-group')].map((b) => b.getAttribute('data-group') + ':' + b.querySelector('.co-roster-count')?.textContent)`,
            )
          ).includes('slaver:1')
        )
          break;
      }
      await clickSel('[data-group="slaver"]');
      const slaverActions = await ev<string[]>(ACTIONS);
      check(slaverActions.includes('capture'), 'a Slaver gets Vang', slaverActions.join(','));
      await page.locator('[data-action="capture"]').click({ delay: 80 });
      await wait(300);
      const cut6 = await ev<string[]>(
        `[...document.querySelectorAll('.co-roster-name')].filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => n.textContent + ' ' + n.scrollWidth + '>' + n.clientWidth)`,
      );
      check(cut6.length === 0, 'no roster name is cut off with six groups', cut6.join(','));
      const tgt = await ev<string>(textOf('.co-targeting'));
      check(/neer/.test(tgt), 'Vang shows its hint while aiming', tgt);
      await shot('04-slaver-vang');
      await page.keyboard.press('Escape');
    }
    // --- Hero: Warlord with Raid.
    await page.keyboard.press('h');
    await wait(400);
    const raid = await ev<string>(textOf('[data-ability="0"]'));
    check(/Raid/i.test(raid), 'the hero has Raid on Z', raid);
    await page.keyboard.press('z');
    await wait(300);
    check((await ev<string>(textOf('.co-targeting'))).length > 0, 'Raid asks for a target');
    await page.keyboard.press('Escape');
    await shot('05-hero');
  } finally {
    await Promise.race([browser.close().catch(() => undefined), wait(10000)]);
  }
}

if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const limit = setTimeout(
  () => {
    console.log('FAIL run limit reached');
    process.exit(1);
  },
  8 * 60 * 1000,
);
for (const [w, h] of SIZES) await run(w, h);
clearTimeout(limit);
if (failures.length > 0) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
process.exit(0);

// HUD and picking in a real browser, with a human-speed mouse (move in steps, press, hold, release). The click bug
// reports ("I cannot click the workshop or the lab, I cannot select anything") never showed up in a headless run that
// clicked instantly, so this drives the actual client the way a player does:
//   - a finished workshop and lab: click the building bar, click the roof and the walls of every building at the
//     default and the far zoom, click a research card, see the queue run, click a locked card and read its reason;
//   - a left click on empty ground clears the selection and closes the card panel; Escape clears it too; a click on a
//     building after a Move target or while a target is pending still selects it;
//   - the buildings bar lists only buildings with an action (no Basis, no Woning); a click on a bar button, a roster
//     group or a unit card moves the camera, a world click does not; role buttons only after a finished workshop;
//   - layout at 1600x900 and 1280x720: the card window sits directly above the commands, clear of the minimap and the
//     bottom bar; the frame stats are top right next to "Opgeven".
//
// Needs a running client (the dev server) and Chrome (Playwright channel 'chrome'); not part of `pnpm test`.
//   HUD_URL=http://localhost:5173/ HUD_SHOTS=/some/dir node --import tsx src/hud-clicks.ts
// Exit 1 when a check fails. Screenshots of every state go to HUD_SHOTS when set.
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import {
  RUN_LIMIT_MS,
  SHOTS,
  SIZES,
  URL,
  check,
  failures,
  onCanvas,
  textOf,
  wait,
} from './hud-clicks-common.js';
import type { Pt } from './hud-clicks-common.js';
import { runBuildStage } from './hud-clicks-build.js';
import { runBarStage } from './hud-clicks-bar.js';
import { runWorldStage } from './hud-clicks-world.js';
import { runInspectStage } from './hud-clicks-inspect.js';

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
  // ?skip=1: straight into a loopback match, past the splash and the menu
  await page.goto(`${URL}?skip=1`);
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

  // The checks run as sequential stages in hud-clicks-*.ts sharing this context.
  const ctx = await runBuildStage({
    browser,
    page,
    width,
    height,
    shot,
    ev,
    click,
    center,
    selection,
    cardsOpen,
    groundSpot,
  });
  await runBarStage(ctx);
  await runWorldStage(ctx);
  await runInspectStage(ctx);
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

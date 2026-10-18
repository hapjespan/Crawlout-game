// Speeltest-bot: plays about 15 in-game minutes against the AI through the REAL HUD only (mouse and keyboard at human
// speed: moves in steps, press and release with ~120 ms in between). No sendCommand, no sim access. `window.crawlout`
// is read only for assertions and logging (status, entities, camera target, pickAt to find where something is on screen).
//
// Scenario: gather with the scavengers (roster click + right click on a node), the builder builds a house, a
// workshop, a lab, a training facility and later a robot factory (B menu, placement on free ground found by trying),
// research Geweerrek, Raffinage and Robotica from the buildings bar and the cards, craft militia, produce robots, train
// one SPECIAL point, group-move the army (formation), attack-move toward a claim point, use the hero ability, pan and
// zoom the camera, deselect by a click on empty ground and with Escape, select buildings by clicking their roofs.
// Every step logs time, expectation, observation (status, queue, selection text) and takes a screenshot. The perf badge
// is sampled over time. At the end a findings list is printed.
//
// Needs a running client and Chrome (Playwright channel 'chrome'); not part of `pnpm test`.
//   PLAYTEST_URL=http://localhost:5190/ PLAYTEST_SHOTS=/some/dir PLAYTEST_SIZES=1600x900,1280x720 \
//     PLAYTEST_MINUTES=15 node --import tsx src/playtest.ts
// Sim time runs on Playwright's fake clock (runFor) so 15 game minutes take a few real minutes; every input is still
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ALL_FINDINGS, Bot, SHOTS, wait } from './playtest-core.js';
import type { Severity } from './playtest-core.js';
import { runStartSteps } from './playtest-steps-start.js';
import type { PlaytestRun } from './playtest-steps-start.js';
import { runBuildSteps } from './playtest-steps-build.js';
import { runTrainSteps } from './playtest-steps-train.js';
import { runArmySteps } from './playtest-steps-army.js';

const URL = process.env.PLAYTEST_URL ?? 'http://localhost:5190/';
const SIZES: readonly [number, number][] = (process.env.PLAYTEST_SIZES ?? '1600x900,1280x720')
  .split(',')
  .map((s) => s.split('x').map(Number) as [number, number]);

async function run(width: number, height: number): Promise<Bot> {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
  });
  const page: Page = await (await browser.newContext({ viewport: { width, height } })).newPage();
  const bot = new Bot(page, width, height);
  console.log(`\n===== ${bot.size} =====`);
  page.on('pageerror', (e) => bot.finding('hoog', `pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404/.test(m.text()))
      bot.finding('laag', `console error: ${m.text().slice(0, 140)}`);
  });
  await page.clock.install();
  // ?skip=1: straight into a loopback match, past the splash and the menu
  await page.goto(`${URL}?skip=1`);
  await page.clock.resume();
  await page.waitForFunction(`window.crawlout && window.crawlout.entities().size > 10`, null, {
    timeout: 60000,
  });
  await wait(2500);

  // The scenario runs as sequential stages in playtest-steps-*.ts sharing this context.
  const ctx: PlaytestRun = {
    bot,
    page,
    width,
    height,
    house: null,
    werkplaats: null,
    lab: null,
    training: null,
    factory: null,
  };

  await runStartSteps(ctx);
  await runBuildSteps(ctx);
  await runTrainSteps(ctx);
  await runArmySteps(ctx);

  if (SHOTS) writeFileSync(`${SHOTS}/${bot.size}-log.txt`, bot.log.join('\n'));
  await browser.close();
  return bot;
}

if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const bots: Bot[] = [];
for (const [w, h] of SIZES) {
  try {
    bots.push(await run(w, h));
  } catch (e) {
    console.log(`run ${w}x${h} afgebroken: ${e instanceof Error ? e.stack : String(e)}`);
    ALL_FINDINGS.push({
      size: `${w}x${h}`,
      severity: 'hoog',
      text: `bot afgebroken: ${e instanceof Error ? e.message : String(e)}`,
      step: 'crash',
    });
  }
}

console.log('\n===== PERF =====');
for (const b of bots) {
  if (b.perf.length === 0) continue;
  const fps = b.perf.map((p) => p.fps);
  const worst = Math.max(...b.perf.map((p) => p.worst));
  const dc = Math.max(...b.perf.map((p) => p.dc));
  console.log(
    `${b.size}: ${b.perf.length} metingen, fps min ${Math.min(...fps)} gem ${(fps.reduce((a, c) => a + c, 0) / fps.length).toFixed(0)}, slechtste frame ${worst} ms, max ${dc} draw calls`,
  );
  console.log(b.perf.map((p) => `  t=${p.game}s ${p.text}`).join('\n'));
}
console.log('\n===== BEVINDINGEN =====');
const order: Severity[] = ['hoog', 'midden', 'laag'];
for (const sev of order) {
  for (const f of ALL_FINDINGS.filter((x) => x.severity === sev))
    console.log(`[${sev}] (${f.size}, ${f.step}) ${f.text}`);
}
if (ALL_FINDINGS.length === 0) console.log('geen bevindingen');
if (SHOTS)
  writeFileSync(
    `${SHOTS}/findings.json`,
    JSON.stringify(
      { findings: ALL_FINDINGS, perf: bots.map((b) => ({ size: b.size, perf: b.perf })) },
      null,
      1,
    ),
  );

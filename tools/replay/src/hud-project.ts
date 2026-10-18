// Win route C, the Bouwproject, in a real browser (client 0.11.0, ui 0.19.0): the game type in the menu, the project
// panel, the ruins of both wings on the map, a restore by the own builders and the panel and minimap following it.
// Needs a running client (the dev server) and Chrome (Playwright channel 'chrome'); not part of `pnpm test`.
//   HUD_URL=http://localhost:5173/ HUD_SHOTS=/some/dir node --import tsx src/hud-project.ts
// Exit 1 when a check fails. Screenshots go to HUD_SHOTS when set.
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const URL = process.env.HUD_URL ?? 'http://localhost:5173/';
const SHOTS = process.env.HUD_SHOTS;
const failures: string[] = [];
const check = (ok: boolean, what: string, detail = ''): void => {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${what}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(what);
};

interface Part {
  partId: number;
  kind: number;
  x: number;
  y: number;
  state: string;
  owner: number;
}

if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const limit = setTimeout(() => {
  console.log('FAIL time limit');
  process.exit(1);
}, 240_000);
try {
  const page = await (
    await browser.newContext({ viewport: { width: 1600, height: 900 } })
  ).newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (e) => failures.push(`pageerror ${e.message}`));
  const shot = async (name: string): Promise<void> => {
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
  };

  // the menu: Bouwproject is a playable game type
  await page.goto(`${URL}?menu=1`);
  await page.getByRole('button', { name: /^Tegen AI/ }).click();
  const radio = page.getByRole('radio', { name: /^Bouwproject/ });
  await radio.click();
  check((await radio.getAttribute('aria-checked')) === 'true', 'Bouwproject can be chosen');
  await shot('menu-bouwproject');

  // a local match of the game type Bouwproject
  await page.clock.install();
  await page.goto(`${URL}?skip=1&mode=project`);
  await page.clock.resume();
  await page.waitForFunction(`window.crawlout && window.crawlout.status()?.project`, null, {
    timeout: 60000,
  });
  const parts = async (): Promise<Part[]> =>
    (await page.evaluate(`window.crawlout.status().project.parts`)) as Part[];
  const all = await parts();
  check(all.length === 8, 'eight parts (two wings of four)', String(all.length));
  check(
    all.every((p) => p.state === 'ruin'),
    'every part starts as a ruin',
  );
  await page.waitForSelector('.co-project');
  check((await page.locator('.co-project-kind').count()) === 4, 'the panel lists four kinds');
  await shot('panel-start');

  // the own builders restore the water tower nearest to the headquarters
  const me = (await page.evaluate(`window.crawlout.session.playerId`)) as number;
  const target = (await page.evaluate(`(() => {
    const c = window.crawlout;
    const own = [...c.entities().values()].filter((e) => e.owner === ${me});
    const b = c.unitTypeId('bouwer');
    const builders = own.filter((e) => e.typeId === b).map((e) => e.id);
    const hq = own.reduce((a, e) => (e.typeId >= 1024 ? e : a), own[0]);
    const towers = c.status().project.parts.filter((p) => p.kind === 3);
    towers.sort((p, q) => (p.x - hq.x) ** 2 + (p.y - hq.y) ** 2 - ((q.x - hq.x) ** 2 + (q.y - hq.y) ** 2));
    const t = towers[0];
    const typeId = [...c.entities().values()].find((e) => e.id === t.partId).typeId;
    c.session.sendCommand('Build', { ids: builders, typeId, x: t.x, y: t.y });
    c.renderer.focus(t.x, t.y);
    return { id: t.partId, builders: builders.length };
  })()`)) as { id: number; builders: number };
  check(target.builders > 0, 'the start has builders', String(target.builders));
  await page.clock.runFor(4000);
  const after = (await parts()).find((p) => p.partId === target.id);
  check(
    after?.owner === me && after.state !== 'ruin',
    'Build on the ruin starts the restore',
    after?.state ?? '-',
  );
  await shot('restoring');
  await page.clock.runFor(150_000);
  const done = (await parts()).find((p) => p.partId === target.id);
  check(done?.state === 'restored', 'the water tower is restored', done?.state ?? '-');
  const hold = await page.locator('.co-project-kind').nth(3).textContent();
  check(/hersteld/.test(hold ?? ''), 'the panel shows it restored', hold ?? '');
  await shot('restored');
  // the other wing, still ruins
  const far = all.find((p) => p.kind === 0 && p.partId !== target.id && p.x < 192 * 256);
  if (far) await page.evaluate(`window.crawlout.renderer.focus(${far.x}, ${far.y})`);
  await page.clock.runFor(1000);
  await shot('west-wing-ruins');
} finally {
  clearTimeout(limit);
  await browser.close();
}
if (failures.length > 0) {
  console.log(`${failures.length} failed: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('hud-project: all checks passed');

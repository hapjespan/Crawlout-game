// Screenshots of the screens before the match (splash, hoofdmenu, Tegen AI, Speler tegen speler, lobby, instellingen) in
// a real browser, at two window sizes and in both looks: with the dev bitmap skin (when assets/local/hud exists) and with
// the CSS fallback "Roest en Fosfor" (?noskin=1), which is what production shows. For the design review.
//
// Usage (own vite on a free port; the relay for the lobby shots is started here on a free port, never on 8787):
//   MENU_URL=http://localhost:5212/ MENU_SHOTS=/some/dir node --import tsx src/menu-shots.ts
//   MENU_SIZES=1600x900,1280x720  MENU_LOOKS=skin,css
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { readDataVersion, startRelayServer } from '../../../packages/relay/src/server.js';

const URL = process.env.MENU_URL ?? 'http://localhost:5212/';
const SHOTS = process.env.MENU_SHOTS ?? '';
const SIZES = (process.env.MENU_SIZES ?? '1600x900,1280x720').split(',').map((s) => {
  const [w, h] = s.split('x').map(Number);
  return { w: w!, h: h! };
});
const LOOKS = (process.env.MENU_LOOKS ?? 'skin,css').split(',');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
  console.log(`  ${name}`);
}

async function run(look: string, w: number, h: number, relayUrl: string): Promise<void> {
  const tag = `${look}-${w}x${h}`;
  console.log(`\n== ${tag} ==`);
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', (e) => console.log(`  pageerror ${e.message}`));
    const q = look === 'css' ? '?noskin=1' : '';
    await page.goto(`${URL}${q}`);

    // splash: first while it loads (if we are quick enough), then loaded
    await wait(150);
    await shot(page, `${tag}-1-splash-loading`);
    await page.locator('.co-m-press').waitFor();
    await wait(2500); // let the typing finish and the camera drift a little
    await shot(page, `${tag}-2-splash`);

    await page.keyboard.press('Space');
    await page.locator('.co-m-item').first().waitFor();
    await wait(300);
    await shot(page, `${tag}-3-menu`);

    await page.keyboard.press('1');
    await page.locator('[role=radiogroup]').first().waitFor();
    await wait(300);
    await shot(page, `${tag}-4-ai`);
    await page
      .getByRole('radio', { name: /^Raiders/ })
      .first()
      .click();
    await page.getByRole('radio', { name: 'Dwellers' }).last().click();
    await wait(200);
    await shot(page, `${tag}-5-ai-raiders`);

    await page.keyboard.press('Escape');
    await page.keyboard.press('2');
    await page.locator('#co-m-name').waitFor();
    await page.fill('#co-m-relay', relayUrl);
    await page.fill('#co-m-name', 'Martien');
    await wait(200);
    await shot(page, `${tag}-6-pvp`);
    await page.getByRole('button', { name: 'Nieuwe kamer' }).click();
    await page.locator('.co-m-roomcode').waitFor();
    await page.locator('.co-m-player').first().waitFor();
    await wait(300);
    await shot(page, `${tag}-7-lobby`);
    await page.getByRole('button', { name: 'AI toevoegen' }).click();
    await page.locator('.co-m-player').nth(1).waitFor();
    await wait(300);
    await shot(page, `${tag}-8-lobby-ai`);

    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('3');
    await page.locator('.co-m-setrow').first().waitFor();
    await wait(300);
    await shot(page, `${tag}-9-settings`);
  } finally {
    await Promise.race([browser.close().catch(() => undefined), wait(10000)]);
  }
}

if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const relay = await startRelayServer({ port: 0, dataVersion: readDataVersion() });
try {
  for (const look of LOOKS)
    for (const { w, h } of SIZES) await run(look, w, h, `ws://localhost:${relay.port}`);
} finally {
  await relay.close();
}
process.exit(0);

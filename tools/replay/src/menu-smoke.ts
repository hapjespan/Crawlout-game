// Browser smoke test of the screens before the match, in real Chrome:
//   splash -> menu -> Tegen AI -> Start -> in the game -> Opgeven -> Terug naar menu,
//   menu -> Speler tegen speler -> lobby on a local relay (a free port, never 8787): connection error, two players with the
//   same name, factions, ready, start,
//   settings that survive a reload, and the URL shortcuts (?skip=1, ?menu=1).
//
// Usage (own vite on a free port):
//   MENU_URL=http://localhost:5212/ node --import tsx src/menu-smoke.ts
import { chromium, type Browser, type Page } from '@playwright/test';
import { readDataVersion, startRelayServer } from '../../../packages/relay/src/server.js';

const URL = process.env.MENU_URL ?? 'http://localhost:5212/';
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const failures: string[] = [];
function check(ok: boolean, what: string, detail = ''): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(what);
}

const IN_GAME = `window.crawlout && window.crawlout.entities().size > 10`;

async function newPage(browser: Browser, w = 1280, h = 720): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (e) => failures.push(`pageerror ${e.message}`));
  return page;
}

/** Runs a code string in the page; the result type is the caller's claim. */
const ev = <T = unknown>(page: Page, code: string): Promise<T> => page.evaluate(code) as Promise<T>;

async function text(page: Page, sel: string): Promise<string> {
  return (await page.locator(sel).first().textContent()) ?? '';
}

async function toMenu(page: Page, query = ''): Promise<void> {
  await page.goto(`${URL}${query}`);
  // ?menu=1 opens the main menu without the splash
  if (!query.includes('menu=1')) {
    await page.locator('.co-m-press').waitFor();
    await page.keyboard.press('Space');
  }
  await page.locator('.co-m-item').first().waitFor();
  await wait(150);
}

async function run(browser: Browser, relayPort: number): Promise<void> {
  const relayUrl = `ws://localhost:${relayPort}`;

  // --- splash, menu, Tegen AI, in the game, and back
  const a = await newPage(browser);
  await a.goto(URL);
  check(await a.locator('.co-menu').isVisible(), 'the splash shows at once');
  await a.locator('.co-m-press').waitFor();
  check((await text(a, '.co-m-title')).toLowerCase() === 'crawlout', 'the splash has the title');
  check(
    (await a.locator('[role=progressbar]').getAttribute('aria-valuenow')) === '100',
    'the progress bar reaches 100% when loading is done',
  );
  check(
    (await ev(a, `!!document.querySelector('#hud .co-hud')`)) === false,
    'no HUD before the match',
  );
  await a.keyboard.press('Space');
  await a.locator('.co-m-item').first().waitFor();
  await wait(150);
  check((await a.locator('.co-m-item').count()) === 3, 'the main menu has three choices');
  check(
    (await ev(a, `document.activeElement?.classList.contains('co-m-item')`)) === true,
    'the first menu item has the focus',
  );
  await a.keyboard.press('ArrowDown');
  check(
    (await ev<string>(a, `document.activeElement?.textContent`))?.includes(
      'Speler tegen speler',
    ) === true,
    'the arrow keys move through the menu',
  );
  await a.getByRole('button', { name: /^Tegen AI/ }).click();
  await a.getByRole('radiogroup', { name: 'Speltype' }).waitFor();
  check(
    (await a.getByRole('radio', { name: /Survival/ }).getAttribute('aria-disabled')) === 'true' &&
      (await a.locator('.co-m-soon').count()) === 1,
    'Survival co-op is marked "binnenkort" and cannot be chosen (Bouwproject is playable)',
  );
  await a.getByRole('radio', { name: /Survival/ }).click({ force: true });
  check(
    (await a.getByRole('radio', { name: /^Skirmish/ }).getAttribute('aria-checked')) === 'true',
    'clicking a game type that is not there yet changes nothing',
  );
  await a
    .getByRole('radio', { name: /^Raiders/ })
    .first()
    .click();
  await a.getByRole('radio', { name: 'Dwellers' }).last().click();
  await a.getByRole('button', { name: 'Start' }).click();
  await a.waitForFunction(IN_GAME, null, { timeout: 60000 });
  await wait(1500);
  check(!(await a.locator('.co-menu').isVisible()), 'the menu is gone in the game');
  check((await a.locator('#hud .co-hud').count()) === 1, 'the HUD is mounted in the game');
  const faction = await ev<string>(a, `window.crawlout.session.faction`);
  check(faction === 'raiders', 'the chosen faction is played', String(faction));
  check(
    (await ev<number>(a, `[...document.querySelectorAll('.co-roster-group')].length`)) > 0,
    'the unit bar shows units',
  );
  // surrender: the way back to the menu after a match
  await a.getByRole('button', { name: 'Opgeven', exact: true }).click();
  await a.locator('.co-dialog .co-btn.co-danger').click();
  await a.locator('.co-m-endplate').waitFor({ timeout: 20000 });
  check(/Verloren/.test(await text(a, '#end')), 'the end overlay says Verloren after surrendering');
  await a.getByRole('button', { name: 'Terug naar menu' }).click();
  await a.locator('.co-m-item').first().waitFor();
  check(
    a.url().includes('menu=1') && !a.url().includes('skip'),
    'Terug naar menu opens the menu without the splash',
    a.url(),
  );
  await a.context().close();

  // --- URL shortcuts
  const s = await newPage(browser);
  await s.goto(`${URL}?skip=1`);
  await s.waitForFunction(IN_GAME, null, { timeout: 60000 });
  check(!(await s.locator('.co-menu').count()), '?skip=1 starts the match without a menu');
  await s.context().close();
  const f = await newPage(browser);
  await f.goto(`${URL}?faction=raiders`);
  await f.waitForFunction(IN_GAME, null, { timeout: 60000 });
  check(
    (await ev(f, `window.crawlout.session.faction`)) === 'raiders',
    '?faction=raiders still starts as the Raiders',
  );
  await f.context().close();

  // --- settings survive a reload
  const st = await newPage(browser);
  await toMenu(st, '?menu=1&still=1');
  await st.keyboard.press('3');
  await st.getByRole('radio', { name: 'Uit', exact: true }).first().click();
  await st.getByRole('radio', { name: 'Extra groot' }).click();
  check(await st.locator('.co-m-reload').isVisible(), 'a shadow change asks for a reload');
  const stored = await ev<string | null>(st, `localStorage.getItem('crawlout.settings.v1')`);
  check(
    !!stored && JSON.parse(stored!).shadows === 'off' && JSON.parse(stored!).hudScale === 'xlarge',
    'settings are stored',
    String(stored),
  );
  check(
    (await ev(st, `document.documentElement.style.getPropertyValue('--hud-scale')`)) === '0.96',
    'the HUD size applies at once',
  );
  await st.reload();
  await st.locator('.co-m-item').first().waitFor();
  check(
    (await ev(st, `document.documentElement.style.getPropertyValue('--hud-scale')`)) === '0.96',
    'the HUD size is still there after a reload',
  );
  await st.context().close();

  // --- Speler tegen speler
  const p1 = await newPage(browser);
  await toMenu(p1, '?menu=1');
  await p1.keyboard.press('2');
  await p1.locator('#co-m-name').waitFor();
  const dflt = await p1.inputValue('#co-m-relay');
  check(
    /^ws:\/\/localhost:8787$/.test(dflt),
    'the relay address defaults to this host on port 8787',
    dflt,
  );
  await p1.fill('#co-m-name', 'Anna');
  await p1.fill('#co-m-relay', 'http://nope');
  await p1.getByRole('button', { name: 'Nieuwe kamer' }).click();
  check(
    /ws:\/\/ of wss:\/\//.test(await text(p1, '.co-m-status')),
    'a relay address without ws:// is refused in Dutch',
  );
  await p1.fill('#co-m-relay', 'ws://localhost:1');
  await p1.getByRole('button', { name: 'Nieuwe kamer' }).click();
  await p1.locator('.co-m-status[data-tone=bad]').waitFor({ timeout: 15000 });
  check(
    /Geen verbinding/.test(await text(p1, '.co-m-status')),
    'a relay that is not there gives a connection error',
    await text(p1, '.co-m-status'),
  );
  await p1.keyboard.press('Escape');
  await p1.fill('#co-m-relay', relayUrl);
  await p1.getByRole('button', { name: 'Nieuwe kamer' }).click();
  await p1.locator('.co-m-pname').first().waitFor();
  const code = (await text(p1, '.co-m-roomcode')).trim();
  check(/^[A-Z2-9]{5}$/.test(code), 'a new room gets a five character code', code);
  check(
    /Verbonden/.test(await text(p1, '.co-m-status')),
    'the lobby shows the connection',
    await text(p1, '.co-m-status'),
  );
  check(
    (await p1.locator('.co-m-player').count()) === 1 &&
      (await text(p1, '.co-m-player')).includes('Host'),
    'the creator is the host',
  );

  // a second player with the same name joins the room
  const p2 = await newPage(browser);
  await toMenu(p2, '?menu=1');
  await p2.keyboard.press('2');
  await p2.fill('#co-m-name', 'Anna');
  await p2.fill('#co-m-relay', relayUrl);
  await p2.fill('#co-m-room', code);
  await p2.getByRole('button', { name: 'Kamer joinen' }).click();
  await p2.locator('.co-m-player').nth(1).waitFor();
  const names = await p2.locator('.co-m-pname').allTextContents();
  check(
    names.length === 2 && names[1]!.startsWith('Anna 2') && names[1]!.includes('Jij'),
    'a duplicate name gets a number and the guest knows which row is hers',
    names.join(' | '),
  );
  await p1.locator('.co-m-player').nth(1).waitFor();
  check(
    (await p1.locator('.co-m-player[data-you]').count()) === 1 &&
      (await text(p1, '.co-m-player[data-you]')).includes('Host'),
    'the host sees which row is hers',
  );
  check(
    await p1.getByRole('button', { name: 'Start potje' }).isDisabled(),
    'the host cannot start until the guest is ready',
  );
  check(
    !(await p2.getByRole('button', { name: 'AI toevoegen' }).count()),
    'a guest cannot add an AI',
  );

  // factions per player
  await p2.getByRole('radio', { name: 'Raiders' }).click();
  await p1.waitForFunction(
    `[...document.querySelectorAll('.co-m-pfaction')].some(e => /Raiders/.test(e.textContent))`,
  );
  check(true, 'the host sees the faction of the guest');
  await p2.getByRole('button', { name: 'Klaar', exact: true }).click();
  await p1.waitForFunction(`!document.querySelector('.co-btn.co-m-primary').disabled`);
  check(true, 'the host can start once the guest is ready');
  await p1.getByRole('button', { name: 'Start potje' }).click();
  await Promise.all([
    p1.waitForFunction(IN_GAME, null, { timeout: 60000 }),
    p2.waitForFunction(IN_GAME, null, { timeout: 60000 }),
  ]);
  check(
    !(await p1.locator('.co-menu').isVisible()) && !(await p2.locator('.co-menu').isVisible()),
    'both clients go into the game',
  );
  const f1 = await ev(p1, `window.crawlout.session.faction`);
  const f2 = await ev(p2, `window.crawlout.session.faction`);
  check(
    f1 === 'dwellers' && f2 === 'raiders',
    'each player plays the faction chosen in the lobby',
    `${f1}/${f2}`,
  );
  await p1.context().close();
  await p2.context().close();

  // host with an AI on its own
  const h = await newPage(browser);
  await toMenu(h, '?menu=1');
  await h.keyboard.press('2');
  await h.fill('#co-m-name', 'Solo');
  await h.fill('#co-m-relay', relayUrl);
  await h.getByRole('button', { name: 'Nieuwe kamer' }).click();
  await h.getByRole('button', { name: 'AI toevoegen' }).click();
  await h.locator('.co-m-player').nth(1).waitFor();
  await h.getByRole('button', { name: 'Start potje' }).click();
  await h.waitForFunction(IN_GAME, null, { timeout: 60000 });
  check(true, 'a host with an AI starts a relay match alone');
  await h.context().close();
}

const relay = await startRelayServer({ port: 0, dataVersion: readDataVersion() });
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
});
try {
  await run(browser, relay.port);
} catch (err) {
  failures.push(`exception ${err instanceof Error ? err.message : String(err)}`);
  console.log(err);
} finally {
  await Promise.race([browser.close().catch(() => undefined), wait(10000)]);
  await relay.close();
}
console.log(
  failures.length === 0 ? '\nALL OK' : `\n${failures.length} failure(s): ${failures.join('; ')}`,
);
process.exit(failures.length === 0 ? 0 : 1);

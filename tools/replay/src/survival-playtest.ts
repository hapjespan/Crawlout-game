// Survival co-op playtest through the real front end, in real Chrome (pattern of menu-smoke.ts and hud-clicks.ts):
//   solo:  menu -> Tegen AI -> Survival co-op -> Start; HUD wave counter and countdown, wave 1 arrives (the Playwright
//          fake clock runs the loopback sim fast, as hud-clicks does), no console errors; "Buiten je bouwzone" once.
//   relay: two browsers over the ws relay (own instance on a free port, never 8787): host makes a room and sets
//          Survival, the guest joins, ready, start; both see the same wave and the same state hashes, no desync banner.
//
// Usage (own vite on a free port, e.g. `cd apps/client && npx vite --port 5230 --strictPort`):
//   SURVIVAL_URL=http://localhost:5230/ pnpm --filter @crawlout/replay survival-playtest
// Options (env): SURVIVAL_PART=solo|relay (default both), SURVIVAL_RELAY_TICK_MS (relay tick, default 12; 50 = real
// time), SURVIVAL_RELAY_WAVES (waves to wait for in the relay part, default 1).
import { chromium, type Browser, type Page } from '@playwright/test';
import { readDataVersion, startRelayServer } from '../../../packages/relay/src/server.js';

const URL = process.env.SURVIVAL_URL ?? 'http://localhost:5230/';
const PART = process.env.SURVIVAL_PART ?? 'both';
const RELAY_TICK_MS = Number(process.env.SURVIVAL_RELAY_TICK_MS ?? 12);
const RELAY_WAVES = Number(process.env.SURVIVAL_RELAY_WAVES ?? 1);
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const failures: string[] = [];
function check(ok: boolean, what: string, detail = ''): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(what);
}

const IN_GAME = `window.crawlout && window.crawlout.entities().size > 10`;
const ev = <T = unknown>(page: Page, code: string): Promise<T> => page.evaluate(code) as Promise<T>;
const textOf = (page: Page, sel: string): Promise<string> =>
  page
    .locator(sel)
    .first()
    .textContent()
    .then((t) => t ?? '')
    .catch(() => '');

async function newPage(browser: Browser, label: string): Promise<Page> {
  const page = await (
    await browser.newContext({ viewport: { width: 1280, height: 720 } })
  ).newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (e) => failures.push(`${label} pageerror ${e.message}`));
  page.on('console', (m) => {
    // the missing /favicon.ico (404) is known and harmless
    if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico'))
      failures.push(`${label} console.error ${m.text().slice(0, 200)} ${m.location().url}`);
  });
  return page;
}

/** "Golf 1/15" -> 1; -1 when the panel is not there. */
async function waveOf(page: Page): Promise<number> {
  const m = /Golf (\d+)\/(\d+)/.exec(await textOf(page, '.co-survival-wave'));
  return m ? Number(m[1]) : -1;
}

async function aliveOf(page: Page): Promise<number> {
  return Number(/(\d+) vijanden/.exec(await textOf(page, '.co-survival-alive'))?.[1] ?? -1);
}

/** The HUD panel contents that must be equal on every client at the same frame. */
const panelOf = (page: Page): Promise<string> =>
  textOf(page, '.co-survival').then((t) => t.replace(/\s+/g, ' ').trim());

async function desynced(page: Page): Promise<boolean> {
  return (await page.locator('.co-desync').count()) > 0;
}

/**
 * Page code: orders `key` sites one after the other, each as far from the HQ as the sim's placement rule allows but
 * inside the own zone, until a spot OUTSIDE the zone passes the sim rule (code 0): then only the zone rule refuses it.
 * Returns that spot (sim units) or null. Uses the existing hooks only (placement.reason, session.sendCommand).
 */
const chainToZoneEdge = (key: string): string => `(async () => {
  const c = window.crawlout, pl = c.placement, me = c.session.playerId;
  const z = c.session.survivalZones()[me];
  const f = pl.footprint(${JSON.stringify(key)}), typeId = pl.typeId(${JSON.stringify(key)});
  const cands = [];
  for (let a = 0; a < 24; a++) for (let d = 12; d <= (z.radius / 256) + 20; d += 1.5)
    cands.push({ x: Math.floor((z.x + Math.cos(a * Math.PI / 12) * d * 256) / 256) * 256 + 128,
                 y: Math.floor((z.y + Math.sin(a * Math.PI / 12) * d * 256) / 256) * 256 + 128 });
  const dist = (p) => Math.hypot(p.x - z.x, p.y - z.y);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let step = 0; step < 8; step++) {
    const ok = cands.filter((p) => pl.reason(${JSON.stringify(key)}, p.x, p.y) === 0);
    const out = ok.filter((p) => dist(p) > z.radius + 256);
    if (out.length) return out.sort((p, q) => dist(p) - dist(q))[0];
    const inside = ok.filter((p) => dist(p) <= z.radius).sort((p, q) => dist(q) - dist(p));
    if (!inside.length) return null;
    const builder = [...c.entities().values()].find((e) => e.owner === me && e.typeId === c.unitTypeId('bouwer'));
    c.session.sendCommand('Build', { ids: [builder.id], typeId, x: inside[0].x, y: inside[0].y });
    await sleep(1500);
  }
  return null;
})()`;

/** "Buiten je bouwzone": hover a spot the sim's placement rule accepts but that lies outside the own build zone. */
async function zoneRefusal(page: Page): Promise<void> {
  const edge = await ev<{ x: number; y: number } | null>(page, chainToZoneEdge('woning'));
  check(
    edge !== null,
    'a spot outside the zone that passes the sim placement rule exists',
    JSON.stringify(edge),
  );
  if (!edge) return;
  await ev(page, `window.crawlout.renderer.focus(${edge.x}, ${edge.y})`);
  for (let i = 0; i < 4; i++) {
    await page.mouse.move(640, 300);
    await page.mouse.wheel(0, 240);
    await wait(60);
  }
  await wait(400);
  await page.locator('.co-roster-groups button:has-text("Bouwer")').first().click();
  await page.locator('[data-action="build"]').first().click();
  await page.getByRole('button', { name: /^Woning/ }).click();
  await ev(page, `window.crawlout.renderer.focus(${edge.x}, ${edge.y})`);
  await wait(500);
  const pt = await ev<{ x: number; y: number } | null>(
    page,
    `(() => {
    const ctl = window.crawlout.renderer.cameraControls; const cam = ctl.camera; cam.updateMatrixWorld();
    const v = cam.matrixWorldInverse.elements, p = cam.projectionMatrix.elements;
    const x = ${edge.x} / 256, z = ${edge.y} / 256, wy = ctl.target.y;
    const vx = v[0]*x+v[4]*wy+v[8]*z+v[12], vy = v[1]*x+v[5]*wy+v[9]*z+v[13], vz = v[2]*x+v[6]*wy+v[10]*z+v[14];
    const cx = p[0]*vx+p[4]*vy+p[8]*vz+p[12], cy = p[1]*vx+p[5]*vy+p[9]*vz+p[13], cw = p[3]*vx+p[7]*vy+p[11]*vz+p[15];
    const c = document.getElementById('view');
    return cw <= 0 ? null : { x: (cx / cw + 1) / 2 * c.clientWidth, y: (1 - cy / cw) / 2 * c.clientHeight };
  })()`,
  );
  check(pt !== null, 'the outside spot projects onto the screen', JSON.stringify(pt));
  if (!pt) return;
  await page.mouse.move(pt.x, pt.y, { steps: 5 });
  await wait(300);
  const reason = await textOf(page, '.co-placement-reason');
  check(
    /Buiten je bouwzone/.test(reason),
    'a spot outside the zone is refused with "Buiten je bouwzone"',
    reason.trim(),
  );
  await page.keyboard.press('Escape');
}

async function solo(browser: Browser): Promise<void> {
  console.log('\n--- solo survival');
  const page = await newPage(browser, 'solo');
  // The fake clock lets the loopback sim run minutes in seconds (runFor), as hud-clicks does; no sim hacks.
  await page.clock.install();
  await page.goto(`${URL}?menu=1`);
  await page.clock.resume();
  await page.locator('.co-m-item').first().waitFor();
  await page.getByRole('button', { name: /^Tegen AI/ }).click();
  await page.getByRole('radiogroup', { name: 'Speltype' }).waitFor();
  const radio = page.getByRole('radio', { name: /Survival/ });
  check(
    (await radio.getAttribute('aria-disabled')) !== 'true',
    'Survival co-op can be chosen under Tegen AI',
  );
  await radio.click();
  check(
    (await radio.getAttribute('aria-checked')) === 'true',
    'clicking Survival co-op selects it',
  );
  await page.getByRole('button', { name: 'Start' }).click();
  await page.waitForFunction(IN_GAME, null, { timeout: 60000 });
  await page.locator('.co-survival').waitFor();
  await wait(1500);
  const soloZones = await ev<number>(page, `window.crawlout.session.survivalZones()?.length ?? 0`);
  check(soloZones >= 1, 'the solo match has build zones', String(soloZones));
  const first = await panelOf(page);
  check(/Golf 0\/\d+/.test(first), 'the HUD shows the wave counter before wave 1', first);
  check(/over \d+:\d\d/.test(first), 'the HUD shows the countdown to the next wave', first);
  check((await page.locator('.co-minimap').count()) > 0, 'the minimap is shown');
  await zoneRefusal(page);

  // fast-forward to wave 1 (120 s in the data) in steps of 10 s of sim time
  let wave = 0;
  const frame0 = await ev<number>(page, `window.crawlout.session.frame`);
  for (let i = 0; i < 40 && wave < 1; i++) {
    await page.clock.runFor(10000);
    await wait(250);
    wave = await waveOf(page);
  }
  check(wave >= 1, 'wave 1 starts', `Golf ${wave}`);
  await wait(500);
  const during = await panelOf(page);
  check(/Golf 1\/\d+/.test(during), 'the HUD counter shows Golf 1', during);
  check(/over \d+:\d\d/.test(during), 'the HUD countdown now points at wave 2', during);
  check((await aliveOf(page)) > 0, 'wave 1 has living enemies', String(await aliveOf(page)));
  check(
    (await textOf(page, '[data-survival-target]')).includes('jij'),
    'the wave target is the player in solo',
    await textOf(page, '[data-survival-target]'),
  );
  const frame1 = await ev<number>(page, `window.crawlout.session.frame`);
  check(frame1 - frame0 >= 2300, 'the sim ran about 120 s', `${frame1 - frame0} frames`);
  // let the wave walk in for another 40 s of sim time
  for (let i = 0; i < 4; i++) {
    await page.clock.runFor(10000);
    await wait(250);
  }
  check(!(await desynced(page)), 'no desync banner in solo');
  await page.context().close();
}

async function relayPart(browser: Browser): Promise<void> {
  console.log('\n--- survival over the relay, two browsers');
  const relay = await startRelayServer({
    port: 0,
    dataVersion: readDataVersion(),
    tickMs: RELAY_TICK_MS,
  });
  const relayUrl = `ws://localhost:${relay.port}`;
  try {
    const host = await newPage(browser, 'host');
    await host.goto(`${URL}?menu=1`);
    await host.locator('.co-m-item').first().waitFor();
    await host.keyboard.press('2');
    await host.fill('#co-m-name', 'Anna');
    await host.fill('#co-m-relay', relayUrl);
    await host.getByRole('button', { name: 'Nieuwe kamer' }).click();
    await host.locator('.co-m-roomcode').waitFor();
    const code = ((await host.locator('.co-m-roomcode').textContent()) ?? '').trim();
    await host.getByRole('radio', { name: /Survival/ }).click();
    await host
      .waitForFunction(
        `[...document.querySelectorAll('[role=radio]')].some(e => /Survival/.test(e.textContent) && e.getAttribute('aria-checked') === 'true')`,
        null,
        { timeout: 5000 },
      )
      .then(
        () => check(true, 'the host sets the lobby to Survival co-op'),
        () => check(false, 'the host sets the lobby to Survival co-op'),
      );
    const guest = await newPage(browser, 'guest');
    await guest.goto(`${URL}?menu=1`);
    await guest.locator('.co-m-item').first().waitFor();
    await guest.keyboard.press('2');
    await guest.fill('#co-m-name', 'Bert');
    await guest.fill('#co-m-relay', relayUrl);
    await guest.fill('#co-m-room', code);
    await guest.getByRole('button', { name: 'Kamer joinen' }).click();
    await guest.locator('.co-m-player').nth(1).waitFor();
    await guest
      .getByRole('radio', { name: /Survival/ })
      .waitFor({ timeout: 5000 })
      .catch(() => undefined);
    await wait(500);
    const guestSees = await guest.locator('.co-m-lobby, .co-menu').first().innerText();
    check(/Survival/.test(guestSees), 'the guest sees the Survival game type', '');
    await guest.getByRole('button', { name: 'Klaar', exact: true }).click();
    await host.waitForFunction(`!document.querySelector('.co-btn.co-m-primary').disabled`);
    await host.getByRole('button', { name: 'Start potje' }).click();
    await Promise.all([
      host.waitForFunction(IN_GAME, null, { timeout: 60000 }),
      guest.waitForFunction(IN_GAME, null, { timeout: 60000 }),
    ]);
    await Promise.all([
      host.locator('.co-survival').waitFor(),
      guest.locator('.co-survival').waitFor(),
    ]);
    check(true, 'both clients are in a survival match with the survival HUD');
    const zones = await Promise.all(
      [host, guest].map((p) =>
        ev<number>(p, `window.crawlout.session.survivalZones()?.length ?? 0`),
      ),
    );
    check(
      zones[0] === zones[1] && (zones[0] ?? 0) >= 2,
      'both clients know the same build zones (one per slot)',
      zones.join('/'),
    );
    const ids = await Promise.all(
      [host, guest].map((p) => ev<number>(p, `window.crawlout.session.playerId`)),
    );
    check(ids[0] !== ids[1], 'the two clients are different players', ids.join('/'));

    // wait for the wave(s); sample the sync every second
    let maxWave = 0;
    let hashesCompared = 0;
    let mismatch = '';
    const deadline = Date.now() + 12 * 60 * 1000;
    while (Date.now() < deadline) {
      await wait(1000);
      const fh = await ev<number>(host, `window.crawlout.session.frame`);
      const fg = await ev<number>(guest, `window.crawlout.session.frame`);
      const common = Math.floor(Math.min(fh, fg) / 20) * 20 - 20;
      if (common > 0) {
        const [hh, hg] = await Promise.all(
          [host, guest].map((p) =>
            ev<number | undefined>(p, `window.crawlout.session.hashAt(${common})`),
          ),
        );
        if (hh !== undefined && hg !== undefined) {
          hashesCompared++;
          if (hh !== hg) mismatch ||= `frame ${common}: ${hh} vs ${hg}`;
        }
      }
      maxWave = Math.min(await waveOf(host), await waveOf(guest));
      if ((await desynced(host)) || (await desynced(guest))) break;
      if (maxWave >= RELAY_WAVES) break;
    }
    await wait(2000);
    check(maxWave >= RELAY_WAVES, `both clients reach wave ${RELAY_WAVES}`, `Golf ${maxWave}`);
    check(!(await desynced(host)) && !(await desynced(guest)), 'no desync banner on either client');
    check(
      hashesCompared >= 10 && mismatch === '',
      'state hashes are equal on both clients',
      `${hashesCompared} compared ${mismatch}`,
    );
    const [ph, pg] = [await panelOf(host), await panelOf(guest)];
    // the clients run a frame or two apart: compare wave and target, and the alive counts within the same hash frame
    const strip = (t: string): string =>
      t
        .replace(/over \d+:\d\d/, '')
        .replace(/\(\d+ over\)/, '')
        .replace(/Doel van deze golf: .*/, '');
    check(
      strip(ph) === strip(pg),
      'host and guest show the same wave and countdown text',
      `${ph} | ${pg}`,
    );
    const [ah, ag] = [await aliveOf(host), await aliveOf(guest)];
    check(
      ah > 0 && Math.abs(ah - ag) <= 2,
      'both see the living enemies of the wave',
      `${ah}/${ag}`,
    );
    const tgt = await Promise.all([host, guest].map((p) => textOf(p, '[data-survival-target]')));
    // one client is the target ("jij"), the other sees that player's name
    check(
      /jij/.test(tgt[0]!) !== /jij/.test(tgt[1]!) ||
        (/Anna/.test(tgt[0]!) && /Anna|Bert/.test(tgt[1]!)),
      'the wave target is the same player on both clients',
      `${tgt[0]!.trim()} | ${tgt[1]!.trim()}`,
    );
    await host.context().close();
    await guest.context().close();
  } finally {
    await relay.close();
  }
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
});
try {
  if (PART !== 'relay') await solo(browser);
  if (PART !== 'solo') await relayPart(browser);
} catch (err) {
  failures.push(`exception ${err instanceof Error ? err.message : String(err)}`);
  console.log(err);
} finally {
  await Promise.race([browser.close().catch(() => undefined), wait(10000)]);
}
const errs = failures.filter((f) => /pageerror|console\.error/.test(f));
check(errs.length === 0, 'no console errors or page errors', errs.slice(0, 3).join(' ; '));
console.log(
  failures.length === 0
    ? '\nALL OK'
    : `\n${failures.length} failure(s):\n- ${failures.join('\n- ')}`,
);
process.exit(failures.length === 0 ? 0 : 1);

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
import {
  ALL_FINDINGS,
  BUILDING_MAX,
  BUILDING_MIN,
  Bot,
  CLAIM_POINT,
  MINUTES,
  SCRAP_NODE,
  SHOTS,
  placeBuilding,
  untilBuilt,
  wait,
} from './playtest-core.js';
import type { Ent, Severity } from './playtest-core.js';

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

  await bot.step(
    'start',
    'spel gestart: 300 scrap, 6 bewoners, pop 6/6, held en 1 bouwer',
    async () => {
      const s = await bot.status();
      bot.expect(
        s.scrap === 300 && s.settlers === 6,
        'startstatus 300 scrap en 6 bewoners',
        'laag',
        `${s.scrap}/${s.settlers}`,
      );
      bot.expect(
        (await bot.text('.co-selection')).includes('Niets geselecteerd'),
        'niets geselecteerd bij de start',
      );
      await bot.samplePerf();
    },
  );

  // ---- camera: pan with keys, zoom, edge ----
  await bot.step(
    'camera-pan-zoom',
    'WASD/pijltjes verschuiven de camera, het wiel zoomt binnen de grenzen',
    async () => {
      const c0 = await bot.cam();
      await page.mouse.move(width / 2, height / 2);
      await bot.key('ArrowRight', 700);
      const c1 = await bot.cam();
      bot.expect(
        Math.hypot(c1.x - c0.x, c1.z - c0.z) > 1,
        'pijltje rechts verschuift de camera',
        'midden',
        JSON.stringify({ c0, c1 }),
      );
      await bot.key('d', 500);
      await bot.key('w', 500);
      const c2 = await bot.cam();
      bot.expect(
        Math.hypot(c2.x - c1.x, c2.z - c1.z) > 0.5,
        'D en W verschuiven de camera',
        'midden',
      );
      await bot.key('q', 400);
      await bot.key('e', 400);
      await bot.wheel(-240, 8);
      const near = await bot.cam();
      await bot.wheel(240, 25);
      const far = await bot.cam();
      bot.say(`  zoom: dichtbij ${near.d.toFixed(0)} m, ver ${far.d.toFixed(0)} m`);
      bot.expect(far.d > near.d * 2, 'wiel uitzoomen vergroot de afstand sterk', 'midden');
      await bot.shot('camera-far');
      await bot.wheel(-240, 14);
      await bot.samplePerf();
    },
  );
  await bot.step(
    'camera-edge',
    'de camera botst niet hard tegen de kaartrand en het beeld blijft bruikbaar',
    async () => {
      await page.mouse.move(width / 2, height / 2);
      await bot.page.keyboard.down('ArrowLeft');
      await bot.page.keyboard.down('ArrowUp');
      await wait(5000);
      await bot.page.keyboard.up('ArrowLeft');
      await bot.page.keyboard.up('ArrowUp');
      await wait(500);
      const c = await bot.cam();
      bot.say(
        `  camera na 5 s naar linksboven: x ${c.x.toFixed(0)} z ${c.z.toFixed(0)} afstand ${c.d.toFixed(0)}`,
      );
      await bot.shot('camera-corner');
      bot.expect(
        c.x >= -2 && c.z >= -2,
        'camera blijft binnen de kaart',
        'midden',
        `${c.x.toFixed(0)},${c.z.toFixed(0)}`,
      );
    },
  );
  // Back to the base: the Basis is no longer in the buildings bar (it has no action), so H (hero, who starts at the base) does it.
  await bot.step(
    'camera-home',
    'H selecteert de held en zet de camera terug bij de basis',
    async () => {
      const hq = await bot.hq();
      await page.keyboard.press('h');
      await wait(1500);
      const c = await bot.cam();
      bot.expect(
        Math.hypot(c.x - hq.x / 256, c.z - hq.y / 256) < 25,
        'camera staat bij de basis',
        'midden',
        `${c.x.toFixed(0)},${c.z.toFixed(0)} vs ${(hq.x / 256).toFixed(0)},${(hq.y / 256).toFixed(0)}`,
      );
      await page.keyboard.press('Escape');
      await bot.wheel(240, 6);
    },
  );

  // ---- gather ----
  await bot.step(
    'verzamelen',
    'plunderaars selecteren via de roster en rechts klikken op een bron: ze gaan verzamelen en scrap stijgt',
    async () => {
      const ents = await bot.ents();
      const hq = await bot.hq();
      const nearest = ents
        .filter((e) => e.t === SCRAP_NODE)
        .sort((a, b) => Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y))[0];
      if (!nearest) throw new Error('geen scrapbron op de kaart');
      const node = nearest;
      const d = Math.hypot(node.x - hq.x, node.y - hq.y) / 256;
      bot.say(`  dichtste bron op ${d.toFixed(0)} m van de basis`);
      if (d > 60) bot.finding('laag', `dichtste scrapbron ligt ${d.toFixed(0)} m van de basis`);
      await bot.panTo((node.x + hq.x) / 2, (node.y + hq.y) / 2);
      bot.expect(await bot.rosterGroup('Plunderaar'), 'roster toont Plunderaar-knop');
      bot.expect(
        (await bot.selection()).toLowerCase().includes('selectie ('),
        'plunderaars zijn geselecteerd',
      );
      const p = await bot.screenOf(node, [0, 1, 2, 0.5]);
      if (!p) {
        bot.finding('hoog', 'scrapbron niet aanklikbaar op het scherm (pickAt raakt hem niet)');
        return;
      }
      await bot.click(p, { button: 'right' });
      await bot.advance(20);
      const acts = await bot.ev<string[]>(
        `[...document.querySelectorAll('.co-roster-unit')].map((b) => b.getAttribute('data-activity'))`,
      );
      const s0 = (await bot.status()).scrap;
      await bot.advance(45);
      const s1 = (await bot.status()).scrap;
      bot.say(`  activiteiten ${acts.join(',') || '(lijst dicht)'}; scrap ${s0} -> ${s1} in 45 s`);
      bot.expect(s1 > s0, 'scrap stijgt na verzamelen', 'hoog', `${s0} -> ${s1}`);
    },
  );

  // ---- builder: house, workshop ----
  let house: Ent | null = null;
  await bot.step(
    'woning-bouwen',
    'bouwer plaatst een woning via B-menu; pop-cap stijgt na afloop',
    async () => {
      await bot.panTo((await bot.hq()).x, (await bot.hq()).y);
      await bot.wheel(240, 5);
      house = await placeBuilding(bot, 'woning');
      if (await untilBuilt(bot, house, 'woning')) {
        await bot.advance(2);
        const s = await bot.status();
        bot.expect(s.popCap >= 11, 'popCap stijgt naar 11 met een woning', 'midden', `${s.popCap}`);
      }
    },
  );
  let werkplaats: Ent | null = null;
  await bot.step('werkplaats-bouwen', 'werkplaats geplaatst en gebouwd', async () => {
    werkplaats = await placeBuilding(bot, 'werkplaats');
    await untilBuilt(bot, werkplaats, 'werkplaats');
  });
  await bot.step(
    'scrap-sparen-lab',
    'scrap loopt op tot 150 voor het lab (inkomsten kloppen)',
    async () => {
      const s0 = (await bot.status()).scrap;
      const t0 = await bot.gameSeconds();
      await bot.until('150 scrap', async () => (await bot.status()).scrap >= 150, 300, 5);
      const dt = (await bot.gameSeconds()) - t0;
      const s1 = (await bot.status()).scrap;
      bot.say(
        `  inkomsten: ${s0} -> ${s1} in ${dt.toFixed(0)} s = ${(((s1 - s0) / Math.max(1, dt)) * 60).toFixed(0)} scrap/min`,
      );
    },
  );
  let lab: Ent | null = null;
  await bot.step('lab-bouwen', 'lab geplaatst en gebouwd', async () => {
    lab = await placeBuilding(bot, 'lab');
    await untilBuilt(bot, lab, 'lab');
  });

  // ---- research ----
  await bot.step(
    'gebouwenbalk',
    'de balk toont Werkplaats en Lab (geen Basis) met een badge voor wat te starten is',
    async () => {
      const bar = (await bot.text('.co-building-buttons')).replace(/\s+/g, ' ');
      bot.expect(
        /Werkplaats/.test(bar) && /Lab/.test(bar),
        'balk toont Werkplaats en Lab',
        'hoog',
        bar,
      );
    },
  );
  await bot.step(
    'geweerrek',
    'Werkplaats via de balk selecteren, kaart Geweerrek starten (100 scrap)',
    async () => {
      await bot.until('100 scrap', async () => (await bot.status()).scrap >= 100, 120, 5);
      bot.expect(await bot.buildingButton('werkplaats'), 'klik op Werkplaats in de balk');
      bot.expect((await bot.selection()).includes('Werkplaats'), 'Werkplaats geselecteerd');
      const before = await bot.cards();
      bot.say(`  kaarten: ${before.map((c) => `${c.naam}[${c.state}]`).join(', ')}`);
      const st = await bot.clickCard('Geweerrek');
      bot.expect(st === 'available', 'kaart Geweerrek is beschikbaar', 'midden', String(st));
      await wait(800);
      const q = (await bot.status()).queue;
      bot.expect(
        q.some((i) => i.kind === 'research'),
        'onderzoek loopt in de wachtrij',
        'hoog',
        JSON.stringify(q),
      );
      // locked card says why
      const locked = (await bot.cards()).find((c) => c.state === 'locked');
      if (locked) {
        const q0 = (await bot.status()).queue.length;
        await bot.clickCard(locked.naam);
        const notice = (await bot.text('.co-card-notice')).trim();
        bot.expect(
          notice.length > 0,
          `klik op vergrendelde kaart "${locked.naam}" geeft een reden`,
          'midden',
          notice,
        );
        bot.expect((await bot.status()).queue.length === q0, 'vergrendelde kaart start niets');
      }
      // a card that does nothing without a reason: tooExpensive / busy must explain
      for (const c of await bot.cards())
        if (
          (c.state === 'tooExpensive' || c.state === 'busy' || c.state === 'locked') &&
          c.title === ''
        )
          bot.finding('midden', `kaart "${c.naam}" (${c.state}) heeft geen tooltip met de reden`);
    },
  );
  await bot.step(
    'raffinage',
    'Lab selecteren, Raffinage starten (ontgrendelt trainingsfaciliteit)',
    async () => {
      await bot.until('125 scrap', async () => (await bot.status()).scrap >= 125, 180, 5);
      bot.expect(await bot.buildingButton('lab'), 'klik op Lab in de balk');
      const st = await bot.clickCard('Raffinage');
      bot.expect(st === 'available', 'kaart Raffinage beschikbaar', 'midden', String(st));
      await wait(600);
    },
  );
  await bot.step('robotica', 'Robotica starten (180 scrap, zodra het lab vrij is)', async () => {
    await bot.until(
      'lab vrij',
      async () =>
        !(await bot.status()).queue.some(
          (q) => q.kind === 'research' && q.buildingId === (lab?.id ?? -1),
        ),
      120,
      4,
    );
    await bot.until('180 scrap', async () => (await bot.status()).scrap >= 180, 240, 5);
    await bot.buildingButton('lab');
    const st = await bot.clickCard('Robotica');
    bot.expect(st === 'available', 'kaart Robotica beschikbaar', 'midden', String(st));
    await wait(600);
    bot.expect(
      (await bot.status()).queue.some((q) => q.kind === 'research'),
      'Robotica loopt',
      'hoog',
    );
  });

  // ---- selecting by roofs, deselect ----
  await bot.step(
    'daken-klikken',
    'klikken op het dak van Basis, Werkplaats en Lab selecteert dat gebouw',
    async () => {
      await bot.wheel(240, 4);
      for (const [label, b] of [
        ['Werkplaats', werkplaats],
        ['Lab', lab],
      ] as const) {
        if (!b) continue;
        await bot.panTo(b.x, b.y);
        const fresh = (await bot.buildings()).find((e) => e.id === b.id);
        if (!fresh) continue;
        const p = await bot.screenOf(fresh, [8, 6, 4, 3, 2, 1]);
        if (!p) {
          bot.finding(
            'midden',
            `dak van ${label} niet aan te klikken (pickAt mist op alle hoogtes)`,
          );
          continue;
        }
        await bot.click({ x: width * 0.5, y: height * 0.1 });
        await bot.click(p);
        bot.expect(
          (await bot.selection()).includes(label),
          `klik op dak selecteert ${label}`,
          'hoog',
          await bot.selection(),
        );
      }
    },
  );
  await bot.step(
    'deselecteren',
    'klik op lege grond en Escape heffen de selectie op en sluiten het kaartvenster',
    async () => {
      await bot.buildingButton('lab');
      bot.expect(
        await bot.ev<boolean>(`!!document.querySelector('.co-cards')`),
        'kaartvenster open bij Lab',
      );
      await bot.click(await bot.emptySpot());
      bot.expect(
        (await bot.selection()).includes('Niets geselecteerd'),
        'klik op lege grond heft selectie op',
        'hoog',
      );
      bot.expect(
        !(await bot.ev<boolean>(`!!document.querySelector('.co-cards')`)),
        'kaartvenster sluit',
      );
      await bot.buildingButton('lab');
      await bot.key('Escape');
      bot.expect(
        (await bot.selection()).includes('Niets geselecteerd'),
        'Escape heft selectie op',
        'hoog',
      );
    },
  );

  // ---- training facility + SPECIAL ----
  let training: Ent | null = null;
  await bot.step(
    'training-bouwen',
    'na Raffinage staat Training in het bouwmenu; geplaatst en gebouwd',
    async () => {
      await bot.until(
        'Raffinage klaar',
        async () => (await bot.status()).techs.length >= 1,
        200,
        5,
      );
      await bot.until('180 scrap', async () => (await bot.status()).scrap >= 180, 240, 5);
      const hq = await bot.hq();
      await bot.panTo(hq.x, hq.y);
      await bot.wheel(240, 4);
      training = await placeBuilding(bot, 'trainingsfaciliteit');
      await untilBuilt(bot, training, 'training');
    },
  );
  await bot.step(
    'special-trainen',
    'Training selecteren en een SPECIAL-kaart starten; trained-teller stijgt',
    async () => {
      await bot.until('100 scrap', async () => (await bot.status()).scrap >= 100, 200, 5);
      bot.expect(
        await bot.buildingButton('trainingsfaciliteit'),
        'Training staat in de gebouwenbalk',
      );
      const cs = await bot.cards();
      bot.say(`  kaarten: ${cs.map((c) => `${c.naam}[${c.state}]`).join(', ')}`);
      const pick = cs.find((c) => c.kind === 'train' && c.state === 'available');
      bot.expect(!!pick, 'minstens één training-kaart is beschikbaar', 'midden');
      if (pick) {
        await bot.clickCard(pick.naam);
        const queued = await bot.until(
          'training in de wachtrij',
          async () => (await bot.status()).queue.some((q) => q.kind === 'train'),
          12,
          1,
        );
        bot.expect(queued, `training "${pick.naam}" start`, 'hoog');
        const before = ((await bot.status()).trained ?? []).reduce((a, b) => a + b, 0);
        await bot.until(
          'SPECIAL-punt erbij',
          async () => ((await bot.status()).trained ?? []).reduce((a, b) => a + b, 0) > before,
          120,
          5,
        );
      }
    },
  );

  // ---- craft / retrain militia ----
  await bot.step(
    'militie-craften',
    'plunderaars selecteren, kaart Militie in het kaartvenster: ze worden militie',
    async () => {
      await bot.until('120 scrap', async () => (await bot.status()).scrap >= 120, 200, 5);
      bot.expect(
        await bot.rosterGroup('Plunderaar'),
        'plunderaars selecteren (groep opent de lijst)',
      );
      // Only three of them: pick single units from the roster list (click, shift-click), so the income keeps running.
      const units = page.locator('.co-roster-unit');
      let n = await units.count();
      if (n < 3) {
        // the group was already selected: a second click toggles the list open
        await bot.rosterGroup('Plunderaar');
        n = await units.count();
      }
      if (n >= 3) {
        for (let i = 0; i < 3; i++) {
          const b = await units.nth(i).boundingBox();
          if (b) await bot.click({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, { shift: i > 0 });
        }
        bot.expect(
          /\(3\)/.test(await bot.selection()),
          'drie losse plunderaars geselecteerd via de rosterlijst',
          'midden',
          await bot.selection(),
        );
      } else bot.finding('midden', 'rosterlijst toont geen losse eenheden na klik op de groep');
      const cs = await bot.cards();
      bot.say(`  kaarten: ${cs.map((c) => `${c.naam}[${c.state}]`).join(', ')}`);
      if (cs.length === 0)
        bot.finding(
          'midden',
          'geen craft-kaarten met plunderaars geselecteerd en werkplaats klaar (hint "Druk K ..." ?)',
        );
      const st = await bot.clickCard('Militie');
      bot.expect(st === 'available', 'kaart Militie beschikbaar', 'midden', String(st));
      await wait(800);
      const q = (await bot.status()).queue;
      bot.expect(
        q.some((i) => i.kind === 'craft'),
        'craft staat in de wachtrij',
        'midden',
        JSON.stringify(q),
      );
      await bot.advance(25);
    },
  );
  await bot.step('hero-en-leger', 'roster toont Militie met meer dan 1 eenheid', async () => {
    const roster = (await bot.text('.co-roster-groups')).replace(/\s+/g, ' ');
    bot.say(`  roster: ${roster}`);
  });

  // ---- robot factory + robots ----
  let factory: Ent | null = null;
  await bot.step(
    'robotfabriek-bouwen',
    'na Robotica staat Robotfabriek in het bouwmenu; geplaatst en gebouwd',
    async () => {
      await bot.until('Robotica klaar', async () => (await bot.status()).techs.length >= 2, 240, 5);
      await bot.until('220 scrap', async () => (await bot.status()).scrap >= 220, 300, 5);
      const hq = await bot.hq();
      await bot.panTo(hq.x, hq.y);
      await bot.wheel(240, 4);
      factory = await placeBuilding(bot, 'robotfabriek');
      await untilBuilt(bot, factory, 'robotfabriek');
    },
  );
  await bot.step(
    'robots-produceren',
    'Robotfabriek selecteren en een robot produceren; Robots-teller stijgt',
    async () => {
      await bot.until('150 scrap', async () => (await bot.status()).scrap >= 150, 240, 5);
      bot.expect(await bot.buildingButton('robotfabriek'), 'Robotfabriek in de balk');
      const cs = await bot.cards();
      bot.say(`  kaarten: ${cs.map((c) => `${c.naam}[${c.state}]`).join(', ')}`);
      const pick = cs.find((c) => c.kind === 'produce' && c.state === 'available');
      bot.expect(!!pick, 'een robotkaart is beschikbaar', 'midden');
      if (pick) {
        await bot.clickCard(pick.naam);
        bot.expect(
          await bot.until(
            'productie in de wachtrij',
            async () => (await bot.status()).queue.some((q) => q.kind === 'produce'),
            10,
            1,
          ),
          `productie "${pick.naam}" start`,
          'hoog',
        );
        await bot.until(
          'robot klaar',
          async () => ((await bot.status()).robotPop ?? 0) > 0,
          120,
          5,
        );
        bot.expect(((await bot.status()).robotPop ?? 0) > 0, 'Robots-teller is gestegen', 'hoog');
        bot.expect(
          (await bot.text('.co-counters')).includes('ROBOTS'),
          'teller Robots staat in de bovenbalk',
          'laag',
        );
      }
    },
  );

  // ---- army: group move (formation), attack move, hero ability ----
  await bot.step(
    'leger-formatie',
    'militie en held samen rechts-klikken: ze lopen in formatie (niet op 1 punt) en komen aan',
    async () => {
      const hq = await bot.hq();
      await bot.panTo(hq.x, hq.y);
      await bot.wheel(240, 3);
      bot.expect(await bot.rosterGroup('Militie'), 'militie geselecteerd');
      await bot.rosterGroup('Opziener', true);
      const sel = await bot.selection();
      bot.say(`  selectie: ${sel}`);
      const spot = await bot.emptySpot();
      await bot.click(spot, { button: 'right' });
      await bot.advance(8);
      await bot.advance(20);
      const me = await bot.me();
      const mil = (await bot.ents()).filter((e) => e.owner === me && e.t < BUILDING_MIN);
      // spread of the army: minimum pairwise distance among the militia
      const army = mil.filter((e) => e.t !== 2 && e.t !== 7 && e.t !== 1000);
      let minD = Infinity;
      for (const a of army)
        for (const b of army)
          if (a.id < b.id) minD = Math.min(minD, Math.hypot(a.x - b.x, a.y - b.y) / 256);
      bot.say(
        `  leger: ${army.length} eenheden, kleinste onderlinge afstand ${minD === Infinity ? '-' : minD.toFixed(1)} m`,
      );
      if (army.length >= 2)
        bot.expect(minD > 0.4, 'groep staat niet op één punt', 'midden', `${minD.toFixed(2)} m`);
    },
  );
  await bot.step(
    'held-ability',
    'held selecteren (roster Opziener), Z, klik op de grond: Lockdown gaat in cooldown',
    async () => {
      bot.expect(await bot.rosterGroup('Opziener'), 'Opziener in de roster');
      const hasAbility = await bot.ev<boolean>(`!!document.querySelector('[data-ability]')`);
      bot.expect(hasAbility, 'abilityknop zichtbaar bij geselecteerde held', 'midden');
      await bot.wheel(-240, 6); // close enough that a click is within the 10 m range
      await bot.key('z');
      const mode = await bot.text('.co-targeting');
      bot.expect(
        /ability/i.test(mode) || mode.length > 0,
        'Z start richtmodus voor de ability',
        'midden',
        mode,
      );
      const me = await bot.me();
      const h = (await bot.ents()).find((e) => e.owner === me && e.t === 1000);
      const p = h ? await bot.screenOf(h) : null;
      let spot = p ? { x: p.x + 70, y: p.y + 40 } : await bot.emptySpot();
      const hit = await bot.ev<{ entityId: number | null }>(
        `window.crawlout.renderer.pickAt(${spot.x}, ${spot.y})`,
      );
      if (hit.entityId !== null) {
        bot.say(
          `  doelpunt van de ability raakt een eenheid/gebouw (${hit.entityId}): een klik daarop selecteert in plaats van te richten`,
        );
        bot.finding(
          'midden',
          'ability-doel (Z) of Val aan (A): een klik op een eenheid of gebouw annuleert het richten en selecteert dat object (clickRules.leftClickIs); een vijand direct aanklikken als doel kan dus niet',
        );
        // empty ground inside the ability range (10 m): nearest free grid point 4 to 8 m from the hero
        const near = h
          ? (await bot.groundGrid(14))
              .filter((g) => g.eid === null)
              .map((g) => ({ g, d: Math.hypot(g.gx - h.x, g.gy - h.y) / 256 }))
              .filter((c) => c.d >= 4 && c.d <= 8)
              .sort((a, b) => a.d - b.d)[0]
          : undefined;
        spot = near ? { x: near.g.px, y: near.g.py } : await bot.emptySpot();
      }
      await bot.click(spot);
      await wait(600);
      // sim 0.15.0: a spot beyond rangeU is no longer refused; the hero walks into range first and casts there
      const cooldown = async (): Promise<number> =>
        (await bot.status()).hero?.abilityCooldownTicks?.[0] ?? 0;
      await bot.until('Lockdown geworpen', async () => (await cooldown()) > 0, 30, 2);
      const cd = await cooldown();
      bot.expect(cd > 0, 'Lockdown staat in cooldown na gebruik', 'midden', `${cd}`);
    },
  );
  await bot.step(
    'realtime-meting',
    'ongeveer 16 seconden echte tijd met camerabeweging: fps en slechtste frame blijven bruikbaar',
    async () => {
      await page.mouse.move(width / 2, height / 2);
      for (let i = 0; i < 4; i++) {
        await bot.page.keyboard.down(i % 2 === 0 ? 'ArrowLeft' : 'ArrowRight');
        await wait(1500);
        await bot.page.keyboard.up(i % 2 === 0 ? 'ArrowLeft' : 'ArrowRight');
        await bot.samplePerf();
      }
      const worst = Math.max(...bot.perf.slice(-4).map((x) => x.worst));
      bot.expect(
        worst <= 40,
        'slechtste frame in de echte-tijdmeting onder 40 ms',
        'midden',
        `${worst} ms`,
      );
    },
  );
  await bot.step(
    'aanval-claimpunt',
    'Val aan (A) naar een claimpunt: militie loopt erheen en vecht onderweg',
    async () => {
      const me = await bot.me();
      const ents = await bot.ents();
      const hq = await bot.hq();
      const claim = ents
        .filter((e) => e.t === CLAIM_POINT && e.owner !== me)
        .sort((a, b) => Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y))[0];
      if (!claim) {
        bot.finding('laag', 'geen claimpunt gevonden');
        return;
      }
      bot.say(
        `  claimpunt op ${(Math.hypot(claim.x - hq.x, claim.y - hq.y) / 256).toFixed(0)} m, eigenaar ${claim.owner}`,
      );
      await bot.panTo(claim.x, claim.y);
      await bot.wheel(240, 4);
      bot.expect(await bot.rosterGroup('Militie'), 'militie geselecteerd');
      await bot.key('a');
      bot.expect(
        /aanvalsdoel/.test(await bot.text('.co-targeting')),
        'A toont de aanvalsmodus',
        'midden',
      );
      const near = (await bot.groundGrid(40)).sort(
        (a, b) =>
          Math.hypot(a.gx - claim.x, a.gy - claim.y) - Math.hypot(b.gx - claim.x, b.gy - claim.y),
      )[0];
      if (!near) throw new Error('geen grond bij het claimpunt zichtbaar');
      await bot.click({ x: near.px, y: near.py });
      const start = (await bot.own()).filter(
        (e) => e.t === 4 || (e.t < BUILDING_MIN && e.t !== 2 && e.t !== 7 && e.t !== 1000),
      );
      await bot.advance(40);
      const after = await bot.own();
      const moved = start.filter((s) => {
        const a = after.find((x) => x.id === s.id);
        return a && Math.hypot(a.x - s.x, a.y - s.y) > 256 * 3;
      });
      bot.expect(
        moved.length > 0,
        'eenheden bewegen richting het doel',
        'midden',
        `${moved.length}/${start.length}`,
      );
      // units stuck: same position over two checks while the order should still run
      const a1 = await bot.own();
      await bot.advance(15);
      const a2 = await bot.own();
      const stuck = a1.filter(
        (e) => e.t < BUILDING_MIN && a2.find((x) => x.id === e.id && x.x === e.x && x.y === e.y),
      ).length;
      bot.say(`  na nog 15 s: ${stuck} eenheden onbewogen (kan klaar zijn)`);
    },
  );
  await bot.step(
    'claimen',
    'bouwer rechts-klikt een claimpunt: claimpaal wordt gebouwd, dominantie telt punt',
    async () => {
      const me = await bot.me();
      const ents = await bot.ents();
      const hq = await bot.hq();
      const claim = ents
        .filter((e) => e.t === CLAIM_POINT && e.owner !== me)
        .sort((a, b) => Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y))[0];
      if (!claim) return;
      await bot.panTo(claim.x, claim.y);
      bot.expect(await bot.rosterGroup('Bouwer'), 'bouwer geselecteerd');
      const p = await bot.screenOf(claim, [0, 1, 2]);
      if (!p) {
        bot.finding('midden', 'claimpunt niet aan te klikken');
        return;
      }
      await bot.click(p, { button: 'right' });
      await bot.until(
        'claim genomen',
        async () => (await bot.ents()).find((e) => e.id === claim.id)?.owner === me,
        120,
        5,
      );
      const dom = (await bot.text('.co-dominance')).replace(/\s+/g, ' ');
      bot.say(`  dominantie: ${dom}`);
    },
  );

  // ---- play on until the time is up, answering alerts and keeping production going ----
  await bot.step(
    'doorspelen',
    `tot ${MINUTES} spelminuten doorspelen: scrap besteden, alarmen lezen`,
    async () => {
      while (!(await bot.gameOver())) {
        const s = await bot.status();
        const win = await bot.text('#end');
        if (/Gewonnen|Verloren/.test(win)) {
          bot.say(`  einde: ${win.trim()}`);
          break;
        }
        const toasts = await bot.text('.co-toasts');
        if (toasts.trim()) bot.say(`  alarmen: ${toasts.replace(/\s+/g, ' ').trim()}`);
        if (s.scrap >= 150 && factory) {
          await bot.buildingButton('robotfabriek');
          const pick = (await bot.cards()).find(
            (c) => c.kind === 'produce' && c.state === 'available',
          );
          if (pick) await bot.clickCard(pick.naam);
        }
        await bot.key('Escape');
        await bot.advance(20);
        await bot.samplePerf();
      }
      const me = await bot.me();
      const all = await bot.ents();
      bot.say(
        `  eind: eigen eenheden ${all.filter((e) => e.owner === me && e.t < BUILDING_MIN).length}, eigen gebouwen ${all.filter((e) => e.owner === me && e.t >= BUILDING_MIN && e.t < BUILDING_MAX).length}`,
      );
    },
  );

  await bot.step('eind', 'eindstand en perf', async () => {
    await bot.samplePerf();
    await bot.shot('final');
  });

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

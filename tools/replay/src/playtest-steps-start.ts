// Split from playtest.ts to stay under the 5,000-token file limit: one sequential stage of run(),
// sharing the run context. Stage: start, camera pan/zoom/edge/home and gathering.
import type { Page } from '@playwright/test';
import { SCRAP_NODE, wait } from './playtest-core.js';
import type { Bot, Ent } from './playtest-core.js';

/** State shared by the stages of one playtest run (run() in playtest.ts calls the stages in order). */
export interface PlaytestRun {
  bot: Bot;
  page: Page;
  width: number;
  height: number;
  house: Ent | null;
  werkplaats: Ent | null;
  lab: Ent | null;
  training: Ent | null;
  factory: Ent | null;
}

export async function runStartSteps(ctx: PlaytestRun): Promise<void> {
  const { bot, page, width, height } = ctx;
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
}

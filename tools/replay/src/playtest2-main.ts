// Split from playtest2.ts to stay under the 5,000-token file limit; playtest2.ts stays the entry script.
// Holds: gatherStart, bot0, armyReady, playOn, mainRun.
import {
  Bot,
  MINUTES,
  BUILDING_MIN,
  BUILDING_MAX,
  untilBuilt,
  SHOTS,
  wait,
} from './playtest-core.js';
import { chromium, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import {
  M,
  URL,
  advanceWatching,
  armySize,
  fogLine,
  fogView,
  groundAt,
  grp,
  makeCtx,
  menuStart,
  selectArmy,
  selectUnits,
  startAndFog,
  toast,
  waitScrap,
} from './playtest2-base.js';
import type { Cfg, Ctx } from './playtest2-base.js';
import {
  S,
  barSelect,
  build,
  campClear,
  ensureArmy,
  perkPanel,
  scoutCheck,
  scoutHome,
} from './playtest2-scenarios.js';
import { dwellersOpening, dwellersTech, liberate } from './playtest2-dwellers.js';
import {
  claimByBuildMenu,
  claimByHero,
  heroClaimCheck,
  scoutFog,
  selectRules,
  surrender,
} from './playtest2-scout.js';
import { raidersEconomyTech, raidersOpening, slaverHunt } from './playtest2-raiders.js';

// ---------------------------------------------------------------- start, play on, run
async function gatherStart(c: Ctx): Promise<void> {
  const { bot } = c;
  const raiders = c.cfg.own === 'raiders';
  await S(
    c,
    'verzamelen',
    `de verzamelaars (${bot.workerName}) met rechts klikken naar een scrapbron sturen: scrap stijgt`,
    async () => {
      const ents = await bot.ents();
      const hq = await bot.hq();
      const node = ents
        .filter((e) => e.t === 2048)
        .sort(
          (a, b) => Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y),
        )[0]!;
      bot.say(`  dichtste bron op ${(Math.hypot(node.x - hq.x, node.y - hq.y) / M).toFixed(0)} m`);
      await bot.panTo((node.x + hq.x) / 2, (node.y + hq.y) / 2);
      if (raiders) {
        // one slave first: his panel names his Kooi
        await selectUnits(c, 'slaaf', 1);
        const sel = await bot.selection();
        bot.expect(
          /Kooi/.test(sel),
          'een slaaf toont zijn Kooi in het selectiepaneel',
          'laag',
          sel.slice(0, 120),
        );
        await bot.shot('slaaf-paneel');
      }
      bot.expect(await grp(bot, raiders ? 'slaaf' : 'scavenger'), 'roster toont de verzamelgroep');
      const p = await bot.screenOf(node, [0, 1, 2, 0.5]);
      if (!p) {
        bot.finding('hoog', 'scrapbron niet aanklikbaar');
        return;
      }
      await bot.click(p, { button: 'right' });
      const s0 = (await bot.status()).scrap;
      await bot.advance(60);
      const s1 = (await bot.status()).scrap;
      bot.expect(s1 > s0, 'scrap stijgt na het verzamelen', 'hoog', `${s0} -> ${s1}`);
      await bot.key('Escape');
    },
  );
}

const bot0 = (c: Ctx): Bot => c.bot;

async function armyReady(c: Ctx, want: number): Promise<void> {
  const { bot } = c;
  await S(
    c,
    'leger-op-sterkte',
    `het leger (held en vechters) telt minstens ${want} eenheden voor het nest`,
    async () => {
      if (c.cfg.own === 'raiders') {
        // a tent makes one fighter at a time: queue the next Knuppelaar every time the tent is free
        const t0 = await bot.gameSeconds();
        while ((await armySize(c)) < want && (await bot.gameSeconds()) - t0 < 300) {
          const s = await bot.status();
          if (
            s.scrap >= 35 &&
            !s.queue.some((q) => q.kind === 'produce') &&
            (await barSelect(bot, 'tent', 'Tent'))
          ) {
            await bot.clickCard('Knuppelaar');
          }
          await bot.key('Escape');
          await bot.advance(8);
        }
      }
      const n = await ensureArmy(c, want, 120);
      bot.expect(n >= want, `leger van ${want}`, 'midden', `${n}`);
    },
  );
}

/** Plays on until the time is up: spends scrap, reads alarms, sends the army to an attack alert. */
async function playOn(c: Ctx): Promise<void> {
  const { bot } = c;
  await S(
    c,
    'doorspelen',
    `tot ${MINUTES} spelminuten doorspelen: scrap besteden, alarmen lezen en erop reageren`,
    async () => {
      let alerts = 0;
      while (!(await bot.gameOver())) {
        const win = await bot.text('#end');
        if (/gewonnen|verloren/i.test(win)) {
          bot.say(`  einde: ${win.trim()}`);
          break;
        }
        const tt = await toast(bot);
        if (tt) bot.say(`  alarmen: ${tt}`);
        if (/aanval|valt aan/i.test(tt) && alerts++ < 4) {
          await bot.key(' ');
          await selectArmy(bot);
          await bot.key('a');
          const mm = await groundAt(bot, (await bot.cam()).x * M, (await bot.cam()).z * M, false);
          if (mm) await bot.click(mm);
          else await bot.key('Escape');
        }
        const s = await bot.status();
        if (
          c.cfg.own === 'raiders' &&
          s.scrap >= 60 &&
          s.pop < s.popCap &&
          (await bot.buildings()).some((b) => b.anim !== 6)
        ) {
          if (await bot.buildingButton('tent')) {
            const st = (await bot.cards()).find(
              (k) =>
                k.kind === 'produce' && k.state === 'available' && /Rover|Knuppelaar/.test(k.naam),
            );
            if (st) await bot.clickCard(st.naam);
          }
        }
        if (c.cfg.own === 'dwellers' && s.scrap >= 150 && (await bot.buildings()).length > 4) {
          if (await bot.buildingButton('robotfabriek')) {
            const st = (await bot.cards()).find(
              (k) => k.kind === 'produce' && k.state === 'available',
            );
            if (st) await bot.clickCard(st.naam);
          }
        }
        await bot.key('Escape');
        await advanceWatching(bot, 20, 5);
        await bot.samplePerf();
      }
      const all = await bot.ents();
      bot.say(
        `  eind: eigen eenheden ${all.filter((e) => e.owner === c.me && e.t < BUILDING_MIN).length}, eigen gebouwen ${all.filter((e) => e.owner === c.me && e.t >= BUILDING_MIN && e.t < BUILDING_MAX).length}; ${fogLine(await fogView(c))}`,
      );
    },
  );
}

export async function mainRun(cfg: Cfg): Promise<Bot> {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
  });
  const page: Page = await (
    await browser.newContext({ viewport: { width: cfg.w, height: cfg.h } })
  ).newPage();
  const bot = new Bot(page, cfg.w, cfg.h);
  bot.tag = `${cfg.own === 'raiders' ? 'ra' : 'dw'}-vs-${cfg.ai === 'raiders' ? 'ra' : 'dw'}-`;
  bot.workerName = cfg.own === 'raiders' ? 'Slaaf' : 'Plunderaar';
  console.log(`\n===== ${bot.tag}${bot.size} =====`);
  page.on('pageerror', (e) => bot.finding('hoog', `pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404/.test(m.text()))
      bot.finding('laag', `console error: ${m.text().slice(0, 140)}`);
  });
  await page.clock.install();
  await page.goto(URL);
  await page.clock.resume();
  try {
    await menuStart(bot, cfg);
    const c = await makeCtx(bot, cfg);
    await startAndFog(c);
    await gatherStart(c);
    if (cfg.own === 'dwellers') {
      await dwellersOpening(c);
      await armyReady(c, 6);
      await campClear(c);
      await perkPanel(c);
      await S(
        c,
        'tweede-woning',
        'een tweede woning geeft meer bedden (de pop zit vol); pop-cap stijgt',
        async () => {
          await waitScrap(bot0(c), 95, 120);
          const before = (await c.bot.status()).popCap;
          const h2 = await build(c, 'woning', 'woning 2');
          if (await untilBuilt(c.bot, h2, 'woning 2')) {
            await c.bot.advance(2);
            const after = (await c.bot.status()).popCap;
            c.bot.expect(
              after > before,
              'popCap stijgt met de tweede woning',
              'midden',
              `${before} -> ${after}`,
            );
          }
        },
      );
      await claimByBuildMenu(c);
      await claimByHero(c);
      await scoutHome(c);
      await scoutCheck(c);
      if (cfg.ai === 'raiders') await liberate(c);
      await scoutFog(c);
      await dwellersTech(c, async () => {});
      await heroClaimCheck(c);
    } else {
      await raidersOpening(c);
      await armyReady(c, 6);
      await campClear(c);
      await perkPanel(c);
      await claimByBuildMenu(c);
      await claimByHero(c);
      await scoutHome(c);
      await scoutCheck(c);
      await scoutFog(c);
      await raidersEconomyTech(c, async () => {});
      await heroClaimCheck(c);
      await slaverHunt(c);
    }
    await selectRules(c);
    await playOn(c);
    await S(c, 'eind', 'eindstand en perf', async () => {
      await bot.samplePerf();
      await bot.shot('final');
    });
    await surrender(c);
  } catch (e) {
    bot.finding(
      'hoog',
      `run afgebroken: ${e instanceof Error ? e.stack?.split('\n').slice(0, 3).join(' | ') : String(e)}`,
    );
  }
  if (SHOTS) writeFileSync(`${SHOTS}/${bot.tag}${bot.size}-log.txt`, bot.log.join('\n'));
  await Promise.race([browser.close().catch(() => undefined), wait(10000)]);
  return bot;
}

// Split from playtest.ts to stay under the 5,000-token file limit: one sequential stage of run(),
// sharing the run context. Stage: training facility, SPECIAL, militia crafting and robots.
import { placeBuilding, untilBuilt, wait } from './playtest-core.js';
import type { PlaytestRun } from './playtest-steps-start.js';

export async function runTrainSteps(ctx: PlaytestRun): Promise<void> {
  const { bot, page } = ctx;
  // ---- training facility + SPECIAL ----
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
      ctx.training = await placeBuilding(bot, 'trainingsfaciliteit');
      await untilBuilt(bot, ctx.training, 'training');
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
  await bot.step(
    'robotfabriek-bouwen',
    'na Robotica staat Robotfabriek in het bouwmenu; geplaatst en gebouwd',
    async () => {
      await bot.until('Robotica klaar', async () => (await bot.status()).techs.length >= 2, 240, 5);
      await bot.until('220 scrap', async () => (await bot.status()).scrap >= 220, 300, 5);
      const hq = await bot.hq();
      await bot.panTo(hq.x, hq.y);
      await bot.wheel(240, 4);
      ctx.factory = await placeBuilding(bot, 'robotfabriek');
      await untilBuilt(bot, ctx.factory, 'robotfabriek');
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
}

// Split from playtest2.ts to stay under the 5,000-token file limit; playtest2.ts stays the entry script.
// Holds: dwellersOpening, dwellersTech, liberate.
import { type Ent, untilBuilt, wait } from './playtest-core.js';
import {
  armySize,
  cardsReport,
  dist,
  selectUnits,
  tid,
  unitPoint,
  waitScrap,
} from './playtest2-base.js';
import type { Ctx } from './playtest2-base.js';
import { S, barSelect, build } from './playtest2-scenarios.js';

// ---------------------------------------------------------------- Dwellers
export async function dwellersOpening(c: Ctx): Promise<{ werk: Ent | null }> {
  const { bot } = c;
  let house: Ent | null = null;
  let werk: Ent | null = null;
  await S(
    c,
    'woning-bouwen',
    'bouwer plaatst een woning (B-menu); de pop-cap stijgt na afloop',
    async () => {
      house = await build(c, 'woning', 'woning');
      if (await untilBuilt(bot, house, 'woning')) {
        await bot.advance(2);
        const s = await bot.status();
        bot.expect(s.popCap >= 11, 'popCap stijgt naar 11 met een woning', 'midden', `${s.popCap}`);
      }
    },
  );
  await S(c, 'werkplaats-bouwen', 'werkplaats geplaatst en gebouwd', async () => {
    werk = await build(c, 'werkplaats', 'werkplaats');
    await untilBuilt(bot, werk, 'werkplaats');
  });
  await S(c, 'gebouwenbalk', 'de balk toont de Werkplaats (geen Basis)', async () => {
    const bar = (await bot.text('.co-building-buttons')).replace(/\s+/g, ' ');
    bot.expect(
      /Werkplaats/.test(bar) && !/Basis/.test(bar),
      'balk toont Werkplaats en geen Basis',
      'midden',
      bar,
    );
    await barSelect(bot, 'werkplaats', 'Werkplaats');
    await cardsReport(bot, 'werkplaats');
    // a locked card must explain why when clicked
    const locked = (await bot.cards()).find((k) => k.state === 'locked');
    if (locked) {
      await bot.clickCard(locked.naam);
      bot.expect(
        (await bot.text('.co-card-notice')).trim().length > 0,
        `klik op vergrendelde kaart "${locked.naam}" geeft een reden`,
        'midden',
      );
    }
    await bot.key('Escape');
  });
  await S(
    c,
    'militie-craften',
    'idle bewoners selecteren en de kaart Militie kiezen: ze worden militie (vijf in totaal)',
    async () => {
      let crafted = 0;
      for (let round = 0; round < 3 && crafted < 5; round++) {
        await waitScrap(bot, 90, 200);
        const want = Math.min(3, 5 - crafted);
        const n =
          (await selectUnits(c, 'scavenger', want, true)) ||
          (await selectUnits(c, 'scavenger', want));
        bot.expect(n > 0, 'bewoners geselecteerd via de rosterlijst', 'midden', `${n}`);
        const cs = await bot.cards();
        if (round === 0) bot.say(`  kaarten: ${cs.map((k) => `${k.naam}[${k.state}]`).join(', ')}`);
        const st = await bot.clickCard('Militie');
        bot.expect(st === 'available', 'kaart Militie beschikbaar', 'midden', String(st));
        await wait(500);
        bot.expect(
          (await bot.status()).queue.some((q) => q.kind === 'craft'),
          'craft staat in de wachtrij',
          'midden',
        );
        crafted += n;
        await bot.key('Escape');
        await bot.advance(35);
      }
      bot.say(`  gecraft: ${crafted}; leger nu ${await armySize(c)}`);
    },
  );
  return { werk };
}

export async function dwellersTech(c: Ctx, afterLab: () => Promise<void>): Promise<void> {
  const { bot } = c;
  let lab: Ent | null = null;
  await S(c, 'lab-bouwen', 'lab geplaatst en gebouwd', async () => {
    await waitScrap(bot, 150, 300);
    lab = await build(c, 'lab', 'lab');
    await untilBuilt(bot, lab, 'lab');
  });
  await afterLab();
  await S(c, 'geweerrek', 'Werkplaats via de balk, kaart Geweerrek starten', async () => {
    await waitScrap(bot, 100, 200);
    if (await barSelect(bot, 'werkplaats', 'Werkplaats')) {
      const st = await bot.clickCard('Geweerrek');
      bot.expect(st === 'available', 'kaart Geweerrek beschikbaar', 'midden', String(st));
      await wait(600);
      bot.expect(
        (await bot.status()).queue.some((q) => q.kind === 'research'),
        'onderzoek loopt',
        'hoog',
      );
    }
    await bot.key('Escape');
  });
  await S(c, 'raffinage', 'Lab via de balk, kaart Raffinage starten', async () => {
    await waitScrap(bot, 125, 240);
    if (await barSelect(bot, 'lab', 'Lab')) {
      await cardsReport(bot, 'lab');
      const st = await bot.clickCard('Raffinage');
      bot.expect(st === 'available', 'kaart Raffinage beschikbaar', 'midden', String(st));
    }
    await bot.key('Escape');
  });
  let training: Ent | null = null;
  await S(
    c,
    'training-bouwen',
    'na Raffinage staat Training in het bouwmenu; gebouwd',
    async () => {
      await bot.until(
        'Raffinage klaar',
        async () => (await bot.status()).techs.length >= 2,
        240,
        5,
      );
      await waitScrap(bot, 180, 300);
      training = await build(c, 'trainingsfaciliteit', 'training');
      await untilBuilt(bot, training, 'training');
    },
  );
  await S(
    c,
    'special-trainen',
    'Training selecteren en een SPECIAL-kaart starten; het punt komt erbij',
    async () => {
      await waitScrap(bot, 100, 240);
      if (await barSelect(bot, 'trainingsfaciliteit', 'Training')) {
        const pick = (await bot.cards()).find((k) => k.kind === 'train' && k.state === 'available');
        bot.expect(!!pick, 'minstens een trainingkaart beschikbaar', 'midden');
        if (pick) {
          await bot.clickCard(pick.naam);
          const before = ((await bot.status()).trained ?? []).reduce((a, b) => a + b, 0);
          await bot.until(
            'SPECIAL-punt erbij',
            async () => ((await bot.status()).trained ?? []).reduce((a, b) => a + b, 0) > before,
            120,
            5,
          );
          bot.expect(
            ((await bot.status()).trained ?? []).reduce((a, b) => a + b, 0) > before,
            'het getrainde SPECIAL-punt telt',
            'midden',
          );
        }
      }
      await bot.key('Escape');
    },
  );
  await S(c, 'robotica', 'Lab: Robotica starten', async () => {
    await bot.until(
      'lab vrij',
      async () =>
        !(await bot.status()).queue.some(
          (q) => q.kind === 'research' && q.buildingId === (lab?.id ?? -1),
        ),
      120,
      4,
    );
    await waitScrap(bot, 180, 300);
    if (await barSelect(bot, 'lab', 'Lab')) {
      const st = await bot.clickCard('Robotica');
      bot.expect(st === 'available', 'kaart Robotica beschikbaar', 'midden', String(st));
    }
    await bot.key('Escape');
  });
  let factory: Ent | null = null;
  await S(
    c,
    'robotfabriek-bouwen',
    'na Robotica staat Robotfabriek in het bouwmenu; gebouwd',
    async () => {
      await bot.until('Robotica klaar', async () => (await bot.status()).techs.length >= 3, 300, 5);
      await waitScrap(bot, 220, 300);
      factory = await build(c, 'robotfabriek', 'robotfabriek');
      await untilBuilt(bot, factory, 'robotfabriek');
    },
  );
  await S(
    c,
    'robots-produceren',
    'Robotfabriek: een robot produceren; de technicus-regel en de robotteller kloppen',
    async () => {
      await waitScrap(bot, 150, 240);
      if (await barSelect(bot, 'robotfabriek', 'Robotfabriek')) {
        await cardsReport(bot, 'robotfabriek');
        const pick = (await bot.cards()).find(
          (k) => k.kind === 'produce' && k.state === 'available',
        );
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
          bot.expect(((await bot.status()).robotPop ?? 0) > 0, 'de Robots-teller stijgt', 'hoog');
          bot.expect(
            (await bot.text('.co-counters')).includes('ROBOTS'),
            'teller Robots staat in de bovenbalk',
            'laag',
          );
        }
      }
      await bot.key('Escape');
    },
  );
}

export async function liberate(c: Ctx): Promise<void> {
  const { bot } = c;
  await S(
    c,
    'bevrijd-slaaf',
    'R (Bevrijd) en een klik op een zichtbare vijandelijke slaaf: hij wordt bevrijd en loopt naar jou',
    async () => {
      const slaaf = await tid(c, 'slaaf');
      // the scout keeps walking to the enemy node: give the slaves that work there a few seconds to come into sight
      for (let i = 0; i < 8; i++) {
        const seen = (await bot.ents()).some((e) => e.t === slaaf && e.owner !== c.me);
        if (seen || !(await bot.own()).some((e) => e.id === c.scoutId)) break;
        await bot.advance(2);
      }
      const prisoners = (await bot.ents()).filter((e) => e.t === slaaf && e.owner !== c.me);
      const view = await bot.ev<boolean>(`!!document.querySelector('[data-action="liberate"]')`);
      bot.say(
        `  vijandelijke slaven in zicht: ${prisoners.length}; Bevrijd-knop op de kaart: ${view}`,
      );
      const sc = (await bot.own()).find((e) => e.id === c.scoutId);
      if (prisoners.length === 0) {
        bot.finding(
          'laag',
          'geen vijandelijke slaaf in zicht van de verkenner; Bevrijd kon niet worden beproefd',
        );
        return;
      }
      if (!sc) {
        bot.finding('midden', 'verkenner sneuvelde voor Bevrijd kon worden beproefd');
        return;
      }
      const target = prisoners.sort((a, b) => dist(a, sc) - dist(b, sc))[0]!;
      await selectUnits(c, 'militie', 1);
      // look at the slave first (a minimap click would answer an aiming mode), then aim
      const p = await unitPoint(bot, target.id);
      if (!p) {
        bot.finding('midden', 'de vijandelijke slaaf is niet aan te klikken');
        return;
      }
      bot.expect(
        await bot.ev<boolean>(`!!document.querySelector('[data-action="liberate"]')`),
        'de knop Bevrijd staat op de commandokaart met een slaaf in zicht',
        'midden',
      );
      await bot.key('r');
      const hint = (await bot.text('.co-targeting')).replace(/\s+/g, ' ').trim();
      bot.expect(/bevrijd/i.test(hint), 'R toont de Bevrijd-modus', 'midden', hint);
      await bot.click(p);
      await bot.advance(15);
      const after = (await bot.ents()).find((e) => e.id === target.id);
      bot.say(`  slaaf ${target.id}: eigenaar ${target.owner} -> ${after ? after.owner : 'weg'}`);
      bot.expect(
        after?.owner === c.me,
        'de slaaf is bevrijd en nu van jou (aanraken 3 s, geen bewakers binnen 12 m)',
        'midden',
        after ? `eigenaar ${after.owner}` : 'weg',
      );
      await bot.shot('bevrijd');
    },
  );
}

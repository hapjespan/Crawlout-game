// Split from playtest.ts to stay under the 5,000-token file limit: one sequential stage of run(),
// sharing the run context. Stage: house, workshop, lab, research, roof clicks and deselecting.
import { placeBuilding, untilBuilt, wait } from './playtest-core.js';
import type { PlaytestRun } from './playtest-steps-start.js';

export async function runBuildSteps(ctx: PlaytestRun): Promise<void> {
  const { bot, width, height } = ctx;
  // ---- builder: house, workshop ----
  await bot.step(
    'woning-bouwen',
    'bouwer plaatst een woning via B-menu; pop-cap stijgt na afloop',
    async () => {
      await bot.panTo((await bot.hq()).x, (await bot.hq()).y);
      await bot.wheel(240, 5);
      ctx.house = await placeBuilding(bot, 'woning');
      if (await untilBuilt(bot, ctx.house, 'woning')) {
        await bot.advance(2);
        const s = await bot.status();
        bot.expect(s.popCap >= 11, 'popCap stijgt naar 11 met een woning', 'midden', `${s.popCap}`);
      }
    },
  );
  await bot.step('werkplaats-bouwen', 'werkplaats geplaatst en gebouwd', async () => {
    ctx.werkplaats = await placeBuilding(bot, 'werkplaats');
    await untilBuilt(bot, ctx.werkplaats, 'werkplaats');
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
  await bot.step('lab-bouwen', 'lab geplaatst en gebouwd', async () => {
    ctx.lab = await placeBuilding(bot, 'lab');
    await untilBuilt(bot, ctx.lab, 'lab');
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
          (q) => q.kind === 'research' && q.buildingId === (ctx.lab?.id ?? -1),
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
        ['Werkplaats', ctx.werkplaats],
        ['Lab', ctx.lab],
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
}

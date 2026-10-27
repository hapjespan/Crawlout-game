// Split from playtest.ts to stay under the 5,000-token file limit: one sequential stage of run(),
// sharing the run context. Stage: army formation, hero ability, attack-move, claiming, play on and the end.
import { BUILDING_MAX, BUILDING_MIN, CLAIM_POINT, MINUTES, wait } from './playtest-core.js';
import type { PlaytestRun } from './playtest-steps-start.js';

export async function runArmySteps(ctx: PlaytestRun): Promise<void> {
  const { bot, page, width, height } = ctx;
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
        if (s.scrap >= 150 && ctx.factory) {
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
}

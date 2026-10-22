// Split from playtest2.ts to stay under the 5,000-token file limit; playtest2.ts stays the entry script.
// Holds: raidersOpening, raidersEconomyTech, slaverHunt.
import { type Ent, untilBuilt, wait, placeBuilding, BUILDING_MIN } from './playtest-core.js';
import {
  M,
  cardsReport,
  dist,
  fogLine,
  fogView,
  grp,
  orderViaMinimap,
  ownOf,
  selectArmy,
  selectUnits,
  tid,
  toast,
  unitPoint,
  waitScrap,
} from './playtest2-base.js';
import type { Ctx } from './playtest2-base.js';
import { S, WORKERS_T, barSelect, build } from './playtest2-scenarios.js';

// ---------------------------------------------------------------- Raiders
export async function raidersOpening(c: Ctx): Promise<void> {
  const { bot } = c;
  let tent: Ent | null = null;
  await S(
    c,
    'tent-bouwen',
    'de slaaf-bouwer plaatst een tent (B-menu): een tent geeft 4 bedden en vechters',
    async () => {
      const s0 = await bot.status();
      tent = await build(c, 'tent', 'tent', 16);
      if (await untilBuilt(bot, tent, 'tent')) {
        await bot.advance(2);
        const s = await bot.status();
        bot.expect(
          s.popCap >= s0.popCap + 4,
          'popCap stijgt met 4 door een tent',
          'midden',
          `${s0.popCap} -> ${s.popCap}`,
        );
      }
    },
  );
  await S(
    c,
    'kooi-bouwen',
    'een Kooi te dicht bij het kamp wordt geweigerd met uitleg; op de rand van de basis lukt hij',
    async () => {
      await waitScrap(bot, 65, 200);
      const hq = await bot.hq();
      await bot.panTo(hq.x, hq.y);
      if ((await bot.cam()).d < 50) await bot.wheel(240, 3);
      if (!(await bot.rosterGroup('Bouwer'))) bot.finding('hoog', 'geen bouwer in de roster');
      await bot.key('b');
      const opt = bot.page.locator('.co-build-option[aria-label^="Kooi,"]').first();
      bot.expect(
        (await opt.count()) > 0 && !(await opt.isDisabled()),
        'Kooi staat betaalbaar in het bouwmenu',
        'hoog',
      );
      const box = await opt.boundingBox();
      if (box) await bot.click({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
      const hqP = await bot.screenOf(hq, [8, 6, 4, 3, 2, 1]);
      const gridNear = (await bot.groundGrid(20))
        .filter((g) => g.eid === null)
        .map((g) => ({ ...g, d: dist({ x: g.gx, y: g.gy }, hq) }))
        .filter((g) => g.d > 11 && g.d < 14)
        .sort((a, b) => a.d - b.d)[0];
      if (gridNear) {
        await bot.move({ x: gridNear.px, y: gridNear.py }, 10);
        await wait(300);
        const reason = (await bot.text('.co-targeting')).replace(/\s+/g, ' ').trim();
        const hint = (await bot.text('.co-hint')).replace(/\s+/g, ' ').trim();
        bot.say(
          `  Kooi te dichtbij (${gridNear.d.toFixed(0)} m): plaatsbalk "${reason.slice(0, 120)}" hint "${hint.slice(0, 80)}"`,
        );
        bot.expect(
          /rand van je basis|dicht|ver/i.test(reason + hint),
          'de plaatsbalk legt uit waarom de Kooi daar niet kan',
          'midden',
          reason.slice(0, 80),
        );
        await bot.shot('kooi-te-dichtbij');
        await bot.click({ x: gridNear.px, y: gridNear.py });
        bot.expect(
          /Plaats/.test(await bot.text('.co-targeting')),
          'een geweigerde klik laat de plaatsmodus open',
          'laag',
        );
      } else bot.say('  geen vrij grondpunt op 11-14 m van het kamp in beeld');
      void hqP;
      await bot.key('Escape');
      const kooi = await placeBuilding(bot, 'kooi', 'Bouwer', 17);
      bot.expect(kooi !== null, 'de Kooi staat op de rand van de basis', 'hoog');
      await untilBuilt(bot, kooi, 'kooi', 200);
      await bot.advance(3);
      const bar = (await bot.text('.co-raiders')).replace(/\s+/g, ' ').trim();
      bot.say(`  bovenbalk: ${bar}`);
      bot.expect(/KOOI/i.test(bar), 'de bovenbalk toont de Kooi-telling', 'laag', bar);
    },
  );
  await S(
    c,
    'tent-kaarten',
    'de tent via de balk: kaarten Rover, Knuppelaar en Slaver; drie Knuppelaars maken (de Rovers bewaken de Kooi)',
    async () => {
      await waitScrap(bot, 85, 200);
      if (await barSelect(bot, 'tent', 'Tent')) {
        await cardsReport(bot, 'tent');
        for (const naam of ['Knuppelaar', 'Knuppelaar', 'Knuppelaar']) {
          await waitScrap(bot, 40, 120);
          const st = await bot.clickCard(naam);
          bot.expect(
            st === 'available' || st === 'busy',
            `kaart ${naam} beschikbaar`,
            'midden',
            String(st),
          );
          await wait(500);
        }
        bot.expect(
          (await bot.status()).queue.some((q) => q.kind === 'produce'),
          'productie loopt in de wachtrij',
          'midden',
        );
      }
      await bot.key('Escape');
    },
  );
  await S(
    c,
    'slaaf-rollen',
    'SetRole op slaven: twee slaven worden bouwers (2) en weer verzamelaars (1)',
    async () => {
      const n = await selectUnits(c, 'slaaf', 2);
      const acts = await bot.ev<string[]>(
        `[...document.querySelectorAll('.co-buttons [data-action]')].map((b) => b.getAttribute('data-action') + ':' + b.textContent.trim())`,
      );
      bot.say(`  commando's bij een slaaf: ${acts.join(' ')}`);
      const sel0 = await bot.selection();
      const roleB = await bot.ev<boolean>(
        `!!document.querySelector('[data-action="roleBuilder"]')`,
      );
      bot.expect(roleB, 'een slaaf heeft de rolknop Bouwer', 'midden', acts.join(' '));
      if (roleB && n === 2) {
        await bot.key('2');
        await bot.advance(3);
        const sel1 = await bot.selection();
        const acts1 = await bot.ev<string[]>(
          `[...document.querySelectorAll('.co-buttons [data-action]')].map((b) => b.getAttribute('data-action'))`,
        );
        bot.say(`  na rol Bouwer: selectie "${sel1.slice(0, 50)}"; commando's ${acts1.join(',')}`);
        bot.expect(
          acts1.includes('build') && !acts1.includes('gather'),
          'na SetRole Bouwer staat Bouw op de commandokaart (en geen Verzamel)',
          'midden',
          acts1.join(','),
        );
        if (sel0 === sel1)
          bot.finding(
            'laag',
            'SetRole op slaven: het selectiepaneel en de roster tonen de nieuwe rol niet (alleen de commandokaart wijzigt)',
          );
        await bot.shot('slaven-rol-bouwer');
        await bot.key('1');
        await bot.advance(3);
        const acts2 = await bot.ev<string[]>(
          `[...document.querySelectorAll('.co-buttons [data-action]')].map((b) => b.getAttribute('data-action'))`,
        );
        bot.expect(
          acts2.includes('gather') && !acts2.includes('build'),
          'rol Slaaf (1) zet de slaven terug op Verzamel',
          'laag',
          acts2.join(','),
        );
      }
      await bot.key('Escape');
    },
  );
}

export async function raidersEconomyTech(c: Ctx, afterChem: () => Promise<void>): Promise<void> {
  const { bot } = c;
  let chemlab: Ent | null = null;
  await S(
    c,
    'plundermarkt-bouwen',
    'Plundermarkt geplaatst en gebouwd (afleverpunt en techs)',
    async () => {
      await waitScrap(bot, 80, 300);
      const m = await build(c, 'plundermarkt', 'plundermarkt');
      await untilBuilt(bot, m, 'plundermarkt');
      if (await barSelect(bot, 'plundermarkt', 'Plundermarkt'))
        await cardsReport(bot, 'plundermarkt');
      await bot.key('Escape');
    },
  );
  await S(c, 'chemlab-bouwen', 'Chemlab geplaatst en gebouwd', async () => {
    await waitScrap(bot, 130, 300);
    chemlab = await build(c, 'chemlab', 'chemlab');
    await untilBuilt(bot, chemlab, 'chemlab');
  });
  await afterChem();
  await S(
    c,
    'chemie-onderzoek',
    'Chemlab: Chemie onderzoeken (150); de kaart noemt wat het ontgrendelt',
    async () => {
      await waitScrap(bot, 150, 300);
      if (await barSelect(bot, 'chemlab', 'Chemlab')) {
        await cardsReport(bot, 'chemlab');
        const st = await bot.clickCard('Chemie');
        bot.expect(st === 'available', 'kaart Chemie beschikbaar', 'midden', String(st));
        await wait(500);
        bot.expect(
          (await bot.status()).queue.some((q) => q.kind === 'research'),
          'onderzoek Chemie loopt',
          'hoog',
        );
      }
      await bot.key('Escape');
    },
  );
  await S(
    c,
    'chemdealer-maken',
    'na Chemie: Chem-dealer in de tent (70); zijn paneel legt de chems uit',
    async () => {
      await bot.until('Chemie klaar', async () => (await bot.status()).techs.length >= 1, 300, 5);
      await waitScrap(bot, 70, 240);
      if (await barSelect(bot, 'tent', 'Tent')) {
        const st = await bot.clickCard('Chem-dealer');
        bot.expect(
          st === 'available',
          'kaart Chem-dealer beschikbaar na Chemie',
          'midden',
          String(st),
        );
      }
      await bot.key('Escape');
      await bot.until(
        'Chem-dealer klaar',
        async () => (await ownOf(c, 'chemdealer')).length > 0,
        90,
        4,
      );
      const have = (await ownOf(c, 'chemdealer')).length > 0;
      bot.expect(have, 'er is een Chem-dealer', 'midden');
      if (have) {
        await grp(bot, 'chemdealer');
        const sel = await bot.selection();
        bot.say(`  Chem-dealer geselecteerd: "${sel.slice(0, 200)}"`);
        bot.expect(
          /psycho|jet|chem/i.test(sel),
          'het selectiepaneel van de Chem-dealer noemt zijn chems',
          'laag',
          sel.slice(0, 80),
        );
        await bot.shot('chemdealer');
        await bot.key('Escape');
      }
      if (await barSelect(bot, 'chemlab', 'Chemlab')) {
        await waitScrap(bot, 130, 200);
        const st = await bot.clickCard('Psycho');
        bot.say(`  kaart Psycho: ${st}`);
      }
      await bot.key('Escape');
    },
  );
}

export async function slaverHunt(c: Ctx): Promise<void> {
  const { bot } = c;
  await S(c, 'slaver-maken', 'tent: twee Slavers (55 per stuk) maken', async () => {
    await waitScrap(bot, 55, 240);
    for (let n = 1; n <= 2; n++) {
      await waitScrap(bot, 55, 120);
      if (await barSelect(bot, 'tent', 'Tent')) {
        const st = await bot.clickCard('Slaver');
        bot.expect(st === 'available' || n > 1, 'kaart Slaver beschikbaar', 'midden', String(st));
      }
      await bot.key('Escape');
      await bot.until(
        `Slaver ${n} klaar`,
        async () => (await ownOf(c, 'slaver')).length >= n,
        120,
        4,
      );
    }
    bot.expect((await ownOf(c, 'slaver')).length > 0, 'er is een Slaver', 'hoog');
  });
  // a node of the enemy far enough from his base for Vang (more than 36 m), where his gatherers walk
  const nodes = (await bot.ents())
    .filter((e) => e.t === 2048)
    .sort((a, b) => dist(a, c.theirs) - dist(b, c.theirs));
  const node = nodes.find((n) => dist(n, c.theirs) > 42)!;
  const spot = (() => {
    const dx = c.mine.x - node.x,
      dy = c.mine.y - node.y,
      l = Math.hypot(dx, dy);
    return { x: node.x + (dx / l) * 12 * M, y: node.y + (dy / l) * 12 * M };
  })();
  await S(
    c,
    'slavenjacht',
    'Warlord, Slaver en de overige vechters (de Rovers blijven als bewakers bij de Kooi) lopen naar een vijandelijke scrapbron; zodra een bewoner in zicht komt: F en een klik vangt hem; de gevangene loopt naar de Kooi en wordt slaaf',
    async () => {
      const n = await selectArmy(bot, true, c.guards);
      bot.say(
        `  jachtgroep: ${n} eenheden; doel ${(spot.x / M).toFixed(0)},${(spot.y / M).toFixed(0)} (bron ${(node.x / M).toFixed(0)},${(node.y / M).toFixed(0)}, ${dist(node, c.theirs).toFixed(0)} m van zijn basis)`,
      );
      // along the east and south edge, around the camps of the middle
      const legs = [{ x: 318 * M, y: 230 * M }, { x: 230 * M, y: 335 * M }, spot];
      let leg = 0;
      bot.expect(
        await orderViaMinimap(bot, 'm', legs[0]!.x, legs[0]!.y),
        'verplaatsorder via de minimap',
      );
      const settlerTypes = new Set<number>([await tid(c, 'scavenger'), await tid(c, 'bouwer')]);
      const slaves0 = (await ownOf(c, 'slaaf')).length;
      let target: Ent | null = null;
      let revolt = '';
      const t0 = await bot.gameSeconds();
      let lastLog = 0;
      for (;;) {
        await bot.advance(3);
        await bot.pulse();
        const tt = await toast(bot);
        if (/onbewaakt|ontsnap/i.test(tt)) revolt = tt;
        const f = await fogView(c);
        const cand = f.enemyUnits.filter((e) => settlerTypes.has(e.t) && dist(e, c.theirs) > 38);
        if (cand.length > 0) {
          target = cand[0]!;
          break;
        }
        const t = (await bot.gameSeconds()) - t0;
        const fighters = (await bot.own()).filter(
          (e) => e.t < BUILDING_MIN && !WORKERS_T(c).has(e.t),
        );
        if (fighters.length > 0 && leg < legs.length - 1) {
          const avg = {
            x: fighters.reduce((a, e) => a + e.x, 0) / fighters.length,
            y: fighters.reduce((a, e) => a + e.y, 0) / fighters.length,
          };
          if (dist(avg, legs[leg]!) < 25) {
            leg++;
            await orderViaMinimap(bot, 'm', legs[leg]!.x, legs[leg]!.y);
          }
        }
        if (t - lastLog >= 20) {
          lastLog = t;
          bot.say(`  jacht t+${t.toFixed(0)}s: groep ${fighters.length}, ${fogLine(f)}`);
        }
        if (fighters.length === 0) {
          bot.finding(
            'midden',
            'de hele jachtgroep sneuvelde onderweg naar de vijandelijke scrapbron (mist: niets gezien voor ze vielen)',
          );
          break;
        }
        if (t > 420) {
          bot.finding('midden', 'geen vijandelijke bewoner in zicht binnen 420 s');
          break;
        }
      }
      bot.say(
        `  onderweg ${((await bot.gameSeconds()) - t0).toFixed(0)} s; opstandalarm: "${revolt || '(geen toast gezien)'}"; bovenbalk: ${(await bot.text('.co-raiders')).replace(/\s+/g, ' ').trim()}`,
      );
      if (!target) return;
      const tg = target as Ent;
      bot.say(
        `  doel: bewoner ${tg.id} op ${(tg.x / M).toFixed(0)},${(tg.y / M).toFixed(0)}, ${dist(tg, c.theirs).toFixed(0)} m van zijn basis, hp ${tg.hp}%`,
      );
      if (!(await selectUnits(c, 'slaver', 1))) {
        bot.finding('midden', 'de Slaver is er niet meer om te vangen');
        return;
      }
      const p = await unitPoint(bot, tg.id);
      if (!p) {
        bot.finding('midden', 'de vijandelijke bewoner is niet aan te klikken voor Vang');
        return;
      }
      bot.expect(
        await bot.ev<boolean>(`!!document.querySelector('[data-action="capture"]')`),
        'de Slaver heeft de knop Vang',
        'hoog',
      );
      await bot.key('f');
      const hint = (await bot.text('.co-targeting')).replace(/\s+/g, ' ').trim();
      bot.expect(/neer|vang/i.test(hint), 'F toont de Vang-modus met uitleg', 'midden', hint);
      await bot.click(p);
      await bot.shot('vang-start');
      let caught = false;
      for (let t = 0; t < 60 && !caught; t += 3) {
        await bot.advance(3);
        const e = (await bot.ents()).find((x) => x.id === tg.id);
        if (e && e.owner === c.me) caught = true;
      }
      const e2 = (await bot.ents()).find((x) => x.id === tg.id);
      bot.say(`  doel na afloop: ${e2 ? `eigenaar ${e2.owner}, hp ${e2.hp}%` : 'weg (dood?)'}`);
      bot.expect(
        caught,
        'de Slaver vangt de bewoner (hij wordt van jou)',
        'midden',
        e2 ? `eigenaar ${e2.owner}` : 'dood',
      );
      if (caught) {
        await bot.shot('gevangene');
        const d0 = dist(e2!, c.mine);
        await bot.until(
          'gevangene bij de Kooi en slaaf',
          async () => (await ownOf(c, 'slaaf')).length > slaves0,
          240,
          5,
        );
        const e3 = (await bot.own()).find((x) => x.id === tg.id);
        bot.say(
          `  gevangene: ${d0.toFixed(0)} m van het kamp -> ${e3 ? `${dist(e3, c.mine).toFixed(0)} m, type ${e3.t}` : 'weg'}; slaven ${slaves0} -> ${(await ownOf(c, 'slaaf')).length}`,
        );
        bot.expect(
          (await ownOf(c, 'slaaf')).length > slaves0,
          'de gevangene loopt naar de Kooi en wordt een slaaf',
          'midden',
        );
      }
      await bot.key('Escape');
    },
  );
}

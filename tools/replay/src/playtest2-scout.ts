// Split from playtest2.ts to stay under the 5,000-token file limit; playtest2.ts stays the entry script.
// Holds: scoutFog, claimByBuildMenu, claimByHero, heroClaimCheck, selectRules, surrender.
import { type Ent, BUILDING_MIN, wait } from './playtest-core.js';
import {
  M,
  MAP,
  armySize,
  dist,
  fogLine,
  fogView,
  groundPoint,
  grp,
  hero,
  orderViaMinimap,
  selectUnits,
  waitScrap,
} from './playtest2-base.js';
import type { Ctx } from './playtest2-base.js';
import { S } from './playtest2-scenarios.js';

/** With the scout still alive near the enemy: attack a visible target, retreat, check the ghosts, click a ghost. */
export async function scoutFog(c: Ctx): Promise<void> {
  const { bot } = c;
  const scoutOf = async (): Promise<Ent | undefined> =>
    (await bot.own()).find((e) => e.id === c.scoutId);
  await S(
    c,
    'zichtbaar-doel-aanvallen',
    'rechts klikken op een zichtbare vijandelijke eenheid of gebouw: de verkenner valt aan (Attack, alleen op zichtbare doelen)',
    async () => {
      const f = await fogView(c);
      const sc = await scoutOf();
      if (!sc || f.enemyUnits.length + f.enemyBuildings.length === 0) {
        bot.finding('laag', 'geen verkenner of geen zichtbare vijand om een aanval op te testen');
        return;
      }
      const pool = [...f.enemyUnits, ...f.enemyBuildings].sort((a, b) => dist(a, sc) - dist(b, sc));
      const target = pool[0]!;
      bot.say(`  doel: type ${target.t} op ${dist(target, sc).toFixed(0)} m, hp ${target.hp}%`);
      await bot.panTo(target.x, target.y);
      if (!(await selectUnits(c, c.cfg.own === 'raiders' ? 'plunderaar' : 'militie', 1))) return;
      const fresh = (await bot.ents()).find((e) => e.id === target.id);
      if (!fresh) return;
      const p = await bot.screenOf(
        fresh,
        target.t >= BUILDING_MIN ? [6, 4, 2, 1] : [0.8, 1.5, 0.4],
      );
      if (!p) {
        bot.finding(
          'midden',
          `zichtbaar vijandelijk doel (type ${target.t}) niet aan te klikken (pickAt mist)`,
        );
        return;
      }
      await bot.click(p, { button: 'right' });
      const hp0 = fresh.hp;
      await bot.advance(8);
      const after = (await bot.ents()).find((e) => e.id === target.id);
      const me = await scoutOf();
      bot.say(
        `  na 8 s: doel hp ${hp0}% -> ${after ? `${after.hp}%` : 'weg'}; verkenner ${me ? `hp ${me.hp}%, anim ${me.anim}` : 'gesneuveld'}`,
      );
      bot.expect(
        !after || after.hp < hp0 || (me?.fl ?? 0) % 16 >= 8 || me?.anim === 3 || me?.anim === 4,
        'een rechtsklik op een zichtbaar doel start een aanval',
        'midden',
      );
      await bot.shot('aanval-zichtbaar');
    },
  );
  await S(
    c,
    'terugtrekken-ghosts',
    'de verkenner trekt terug: gebouwen die uit zicht raken blijven als ghost staan (laatst gezien)',
    async () => {
      const sc = await scoutOf();
      if (!sc) {
        const f = await fogView(c);
        bot.say(`  verkenner gesneuveld; ${fogLine(f)}`);
        bot.expect(
          f.ghosts.length > 0 || !c.seenEnemyBuildings,
          'na het verlies van het zicht staan de geziene gebouwen als ghost op de kaart',
          'hoog',
          fogLine(f),
        );
        return;
      }
      await selectUnits(c, c.cfg.own === 'raiders' ? 'plunderaar' : 'militie', 1);
      const home = { x: (c.mine.x + c.theirs.x) / 2, y: (c.mine.y + c.theirs.y) / 2 };
      await orderViaMinimap(bot, 'm', home.x, home.y);
      await bot.until(
        'gebouwen uit zicht',
        async () => (await fogView(c)).enemyBuildings.length === 0,
        90,
        3,
      );
      const f = await fogView(c);
      bot.say(`  ${fogLine(f)}`);
      bot.expect(
        !c.seenEnemyBuildings || f.ghosts.length > 0,
        'geziene vijandelijke gebouwen blijven als ghost staan',
        'hoog',
        fogLine(f),
      );
      if (f.ghosts.length > 0) {
        const gh = f.ghosts[0]!;
        await bot.panTo(gh.x, gh.y);
        const p = await bot.screenOf(gh, [6, 4, 2, 1]);
        if (p) {
          await bot.click(p);
          const sel = await bot.selection();
          bot.expect(
            /Laatst gezien/i.test(sel),
            'een ghost aanklikken toont "Laatst gezien"',
            'midden',
            sel.slice(0, 80),
          );
          await bot.shot('ghost-aangeklikt');
          // right click on a ghost with units selected: attack-move to its spot (the sim refuses a ghost as a target)
          const sc2 = await scoutOf();
          if (
            sc2 &&
            (await selectUnits(c, c.cfg.own === 'raiders' ? 'plunderaar' : 'militie', 1))
          ) {
            await bot.panTo(gh.x, gh.y);
            const p2 = await bot.screenOf(gh, [6, 4, 2, 1]);
            if (p2) {
              const d0 = dist(sc2, gh);
              await bot.click(p2, { button: 'right' });
              await bot.advance(12);
              const sc3 = await scoutOf();
              bot.expect(
                !sc3 || dist(sc3, gh) < d0 - 5,
                'rechtsklik op een ghost stuurt de eenheid erheen (AttackMove)',
                'midden',
                sc3 ? `${d0.toFixed(0)} -> ${dist(sc3, gh).toFixed(0)} m` : 'gesneuveld',
              );
            }
          }
        } else bot.finding('midden', 'ghost-gebouw niet aan te klikken (pickAt mist)');
      }
      await bot.key('Escape');
    },
  );
}

// ---------------------------------------------------------------- claim posts
export async function claimByBuildMenu(c: Ctx): Promise<void> {
  const { bot } = c;
  const label = c.cfg.own === 'raiders' ? 'Plunderpost' : 'Claimpaal';
  const points = MAP.claimPoints
    .filter((p) => p.kind === 'settlement')
    .map((p) => ({ x: p.x * M, y: p.y * M }))
    .sort((a, b) => dist(a, c.mine) - dist(b, c.mine));
  const pt = points[0]!;
  c.claimPt = pt;
  await S(
    c,
    'claimpost-bouwmenu',
    `bouwer kiest ${label} in het bouwmenu (B) en klikt bij het dichtste claimpunt: de post wordt gebouwd en het punt is van jou`,
    async () => {
      await waitScrap(bot, 60, 200);
      const idx = await bot.ev<number>(
        `(() => { const s = window.crawlout.status(); return s.claimPoints.findIndex((p) => p.owner === 255); })()`,
      );
      if (idx < 0) bot.finding('laag', 'geen neutraal claimpunt meer');
      if (!(await grp(bot, c.cfg.own === 'raiders' ? 'slaaf_bouwer' : 'bouwer'))) {
        bot.finding('hoog', 'geen bouwer in de roster voor de claimpost');
        return;
      }
      await bot.panTo(pt.x, pt.y);
      await bot.key('b');
      const opt = bot.page.locator(`.co-build-option[aria-label^="${label},"]`).first();
      if (!(await opt.count()) || (await opt.isDisabled())) {
        bot.finding('hoog', `${label} staat niet (of uitgeschakeld) in het bouwmenu`);
        await bot.key('Escape');
        return;
      }
      const b = await opt.boundingBox();
      if (b) await bot.click({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
      bot.expect(
        /Plaats/.test(await bot.text('.co-targeting')),
        `na de keuze staat de plaatsbalk er ("Plaats ${label}")`,
        'hoog',
      );
      if ((await bot.cam()).d > 80) await bot.wheel(-240, 3);
      const g = await groundPoint(bot, pt.x + 2 * M, pt.y + 2 * M);
      if (!g) {
        bot.finding('midden', 'claimpunt niet in beeld om de post te plaatsen');
        await bot.key('Escape');
        return;
      }
      await bot.move(g, 10);
      await wait(300);
      bot.say(
        `  plaatsbalk bij het claimpunt: "${(await bot.text('.co-targeting')).replace(/\s+/g, ' ').trim().slice(0, 120)}"`,
      );
      await bot.shot('claim-plaatsen');
      await bot.click(g, { settle: 600 });
      const stillPlacing = /Plaats/.test(await bot.text('.co-targeting'));
      bot.expect(
        !stillPlacing,
        'de klik wordt geaccepteerd (een claimplek bij het punt)',
        'hoog',
        (await bot.text('.co-targeting')).slice(0, 80),
      );
      if (stillPlacing) await bot.key('Escape');
      await bot.until(
        'claimpunt genomen',
        async () => {
          const s = await bot.ev<{ owner: number }[]>(`window.crawlout.status().claimPoints`);
          return s.some((p) => p.owner === c.me);
        },
        200,
        5,
      );
      const dom = (await bot.text('.co-dominance')).replace(/\s+/g, ' ');
      bot.say(`  dominantie: ${dom}`);
      bot.expect(/[1-9]\/3/.test(dom), 'de dominantiebalk telt het punt', 'midden', dom);
      // the builder walks back to the base: the next buildings go up there
      if (await grp(bot, c.cfg.own === 'raiders' ? 'slaaf_bouwer' : 'bouwer')) {
        await orderViaMinimap(bot, 'm', c.mine.x - 6 * M, c.mine.y + 6 * M);
        await bot.advance(2);
        await bot.key('Escape');
      }
    },
  );
}

export async function claimByHero(c: Ctx): Promise<void> {
  const { bot } = c;
  const free = MAP.claimPoints
    .map((p) => ({ x: p.x * M, y: p.y * M, kind: p.kind }))
    .filter((p) => dist(p, c.claimPt ?? c.mine) > 5 && dist(p, c.camp) > 30)
    .sort((a, b) => dist(a, c.mine) - dist(b, c.mine));
  const pt = free[0];
  if (!pt) return;
  c.heroPt = pt;
  await S(
    c,
    'held-claimt-punt',
    'de held loopt naar een neutraal claimpunt en blijft staan: de voortgangsring/activiteit loopt (3 minuten), het punt wordt een beacon',
    async () => {
      await grp(bot, 'hero');
      bot.expect(
        await orderViaMinimap(bot, 'm', pt.x, pt.y),
        'verplaatsorder voor de held via de minimap',
      );
      await bot.until(
        'held bij het punt',
        async () => {
          const h = await hero(c);
          return !!h && dist(h, pt) < 8;
        },
        150,
        5,
      );
      await bot.key('Escape');
    },
  );
}

/** Later: the hero has stood in the circle for a while; the sim reports it and the point becomes a beacon after 3 minutes. */
export async function heroClaimCheck(c: Ctx): Promise<void> {
  const { bot } = c;
  const pt = c.heroPt;
  if (!pt) return;
  await S(
    c,
    'held-claim-controle',
    'na ongeveer 3 minuten staat het punt op naam van jou (beacon) en telt voor dominantie',
    async () => {
      const idx = MAP.claimPoints.findIndex((p) => p.x * M === pt.x && p.y * M === pt.y);
      type Cp = {
        owner: number;
        beacon: boolean;
        activity: string;
        progressPermille: number;
        by: number;
      };
      const read = (): Promise<Cp[]> => bot.ev<Cp[]>(`window.crawlout.status().claimPoints`);
      let st = await read();
      bot.say(`  claimpunt ${idx} nu: ${JSON.stringify(st[idx])}`);
      const h = await hero(c);
      bot.say(
        `  held ${h ? `op ${dist(h, pt).toFixed(0)} m van het punt, hp ${h.hp}%` : 'gesneuveld'}`,
      );
      if (h && dist(h, pt) < 10) {
        await bot.until(
          'held-claim klaar',
          async () => (await read())[idx]?.owner === c.me,
          200,
          5,
        );
        st = await read();
      }
      bot.expect(
        st[idx]?.owner === c.me || !h || dist(h, pt) >= 10,
        'de held claimt het punt zonder paal (3 minuten stilstaan)',
        'midden',
        JSON.stringify(st[idx]),
      );
      bot.say(`  dominantie: ${(await bot.text('.co-dominance')).replace(/\s+/g, ' ')}`);
      await bot.shot('held-claim');
    },
  );
}

// ---------------------------------------------------------------- deselect and select rules
export async function selectRules(c: Ctx): Promise<void> {
  const { bot } = c;
  await S(
    c,
    'selectieregels',
    'klik op lege grond en Escape heffen de selectie op; shift voegt toe; een vijand aanklikken inspecteert alleen; slepen selecteert eigen eenheden',
    async () => {
      const hq = await bot.hq();
      await bot.panTo(hq.x, hq.y);
      await bot.wheel(240, 3);
      const first = c.cfg.own === 'raiders' ? 'plunderaar' : 'scavenger';
      await selectUnits(c, first, 2);
      bot.expect(
        /\(2\)/.test(await bot.selection()) || (await armySize(c)) < 2,
        'twee eenheden geselecteerd via de lijst',
        'laag',
        (await bot.selection()).slice(0, 40),
      );
      await bot.click(await bot.emptySpot());
      bot.expect(
        (await bot.selection()).includes('Niets geselecteerd'),
        'klik op lege grond heft de selectie op',
        'hoog',
      );
      await selectUnits(c, first, 1);
      await bot.key('Escape');
      bot.expect(
        (await bot.selection()).includes('Niets geselecteerd'),
        'Escape heft de selectie op',
        'hoog',
      );
      // box select around the HQ: own units only
      const hqP = await bot.screenOf(hq, [8, 6, 4, 3, 2, 1]);
      if (hqP) {
        await bot.move({ x: Math.max(10, hqP.x - 260), y: Math.max(80, hqP.y - 160) });
        await bot.page.mouse.down();
        await bot.move(
          {
            x: Math.min(c.bot.width - 10, hqP.x + 260),
            y: Math.min(c.bot.height - 200, hqP.y + 160),
          },
          12,
        );
        await bot.page.mouse.up();
        await wait(300);
        const sel = await bot.selection();
        bot.say(`  sleepselectie om de basis: "${sel.slice(0, 60)}"`);
        bot.expect(
          /SELECTIE \(\d+\)/.test(sel) || /Niets/.test(sel) === false,
          'slepen over de basis selecteert eigen eenheden',
          'midden',
          sel.slice(0, 60),
        );
        await bot.key('Escape');
      }
      // a visible enemy: inspect only
      const f = await fogView(c);
      if (f.enemyUnits.length + f.enemyBuildings.length > 0) {
        const e = [...f.enemyUnits, ...f.enemyBuildings][0]!;
        await bot.panTo(e.x, e.y);
        const p = await bot.screenOf(e, e.t >= BUILDING_MIN ? [6, 4, 2, 1] : [0.8, 1.5]);
        if (p) {
          await selectUnits(c, first, 1);
          const before = await bot.selection();
          await bot.click(p);
          const after = await bot.selection();
          bot.say(
            `  selectie voor/na klik op vijand: "${before.slice(0, 40)}" / "${after.slice(0, 60)}"`,
          );
        }
      }
      await bot.key('Escape');
    },
  );
}

// ---------------------------------------------------------------- end of the match: Opgeven and back to the menu
export async function surrender(c: Ctx): Promise<void> {
  const { bot } = c;
  await bot.step(
    'opgeven-menu',
    'Opgeven met bevestiging geeft "Verloren" met Terug naar menu; die knop opent het menu zonder splash',
    async () => {
      await bot.key('Escape');
      if (!/gewonnen|verloren/i.test(await bot.text('#end'))) {
        await bot.page.getByRole('button', { name: 'Opgeven', exact: true }).click();
        await wait(300);
        bot.expect(
          await bot.page.locator('.co-dialog').isVisible(),
          'Opgeven vraagt om bevestiging',
          'midden',
        );
        await bot.shot('opgeven-dialoog');
        await bot.page.locator('.co-dialog .co-btn.co-danger').click();
      }
      await bot.page.locator('.co-m-endplate').waitFor({ timeout: 30000 });
      const end = (await bot.text('#end')).replace(/\s+/g, ' ').trim();
      bot.say(`  eindscherm: ${end.slice(0, 120)}`);
      bot.expect(
        /gewonnen|verloren/i.test(end),
        'het eindscherm zegt Gewonnen of Verloren',
        'hoog',
      );
      await bot.shot('eindscherm');
      await bot.page.getByRole('button', { name: 'Terug naar menu' }).click();
      await bot.page.locator('.co-m-item').first().waitFor({ timeout: 30000 });
      bot.expect(
        bot.page.url().includes('menu=1') && !bot.page.url().includes('skip'),
        'Terug naar menu opent het hoofdmenu zonder splash',
        'midden',
        bot.page.url(),
      );
      bot.expect(
        (await bot.page.locator('.co-m-item').count()) === 3,
        'het hoofdmenu heeft weer drie keuzes',
      );
    },
  );
}

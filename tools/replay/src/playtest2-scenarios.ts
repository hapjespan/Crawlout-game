// Split from playtest2.ts to stay under the 5,000-token file limit; playtest2.ts stays the entry script.
// Holds: barSelect, S, build, ensureArmy, campClear, WORKERS_T, +3 more.
import { Bot, type Ent, placeBuilding, BUILDING_MIN, BUILDING_MAX } from './playtest-core.js';
import {
  M,
  STOP_AFTER,
  WORKERS,
  armySize,
  dist,
  fogLine,
  fogView,
  groundAt,
  grp,
  heroStatus,
  orderViaMinimap,
  ownOf,
  selectArmy,
  selectUnits,
  toast,
} from './playtest2-base.js';
import type { Ctx, FogView } from './playtest2-base.js';

/** Selects a building by its Gebouwen-bar button and checks the selection panel names it. */
export async function barSelect(bot: Bot, key: string, expectName: string): Promise<boolean> {
  const ok = await bot.buildingButton(key);
  bot.expect(ok, `${expectName} staat in de gebouwenbalk`, 'midden');
  if (!ok) return false;
  bot.expect(
    (await bot.selection()).includes(expectName),
    `${expectName} geselecteerd via de balk`,
    'midden',
    (await bot.selection()).slice(0, 50),
  );
  return true;
}

/** Runs a step unless the stop-after limit, the end of the match or the time limit says no. */
export async function S(
  c: Ctx,
  name: string,
  expected: string,
  fn: () => Promise<void>,
): Promise<void> {
  const { bot } = c;
  if (STOP_AFTER && c.stepsDone >= STOP_AFTER) return;
  if (/gewonnen|verloren/i.test(await bot.text('#end')) || (await bot.gameOver())) return;
  c.stepsDone++;
  await bot.step(name, expected, fn);
}

// ---------------------------------------------------------------- building (both factions)
export async function build(c: Ctx, key: string, label: string, nearMin = 19): Promise<Ent | null> {
  const { bot } = c;
  const hq = await bot.hq();
  await bot.panTo(hq.x, hq.y);
  if ((await bot.cam()).d < 50) await bot.wheel(240, 4);
  const site = await placeBuilding(bot, key, 'Bouwer', nearMin, key !== 'kooi');
  if (site) bot.say(`  ${label} bouwplaats ${site.id}`);
  return site;
}

// ---------------------------------------------------------------- the creep camp (both factions)
export async function ensureArmy(c: Ctx, want: number, maxS: number): Promise<number> {
  await c.bot.until(`leger van ${want}`, async () => (await armySize(c)) >= want, maxS, 5);
  return armySize(c);
}

export async function campClear(c: Ctx): Promise<void> {
  const { bot } = c;
  const camp = c.camp;
  const raiders = c.cfg.own === 'raiders';
  const stage = (() => {
    const dx = c.mine.x - camp.x,
      dy = c.mine.y - camp.y,
      l = Math.hypot(dx, dy);
    return { x: camp.x + (dx / l) * 24 * M, y: camp.y + (dy / l) * 24 * M };
  })();
  await S(
    c,
    'kamp-opstellen',
    `held en vechters verzamelen en naar 24 m van het bandietennest op ${(camp.x / M).toFixed(0)},${(camp.y / M).toFixed(0)} lopen (buiten zicht)`,
    async () => {
      const n = await selectArmy(bot, true, c.guards);
      bot.say(
        `  leger: ${n} eenheden (held inbegrepen); selectie "${(await bot.selection()).slice(0, 40)}"`,
      );
      bot.expect(
        n >= 5,
        'minstens held plus 4 vechters voor een nest van niveau 1',
        'midden',
        `${n}`,
      );
      const t0 = await bot.gameSeconds();
      bot.expect(
        await orderViaMinimap(bot, 'm', stage.x, stage.y),
        'M plus een klik op de minimap geeft een verplaatsorder',
      );
      await bot.until(
        'leger bij de opstelplek',
        async () => {
          const own = (await bot.own()).filter((e) => e.t < BUILDING_MIN && !WORKERS_T(c).has(e.t));
          return own.length > 0 && own.every((e) => dist(e, stage) < 12);
        },
        150,
        4,
      );
      bot.say(`  aangekomen na ${((await bot.gameSeconds()) - t0).toFixed(0)} s`);
      const f = await fogView(c);
      bot.say(`  op 24 m: ${fogLine(f)}`);
    },
  );
  await S(
    c,
    'kamp-naderen',
    'het leger loopt tot 13 m: de bandieten komen in zicht (mist wijkt); een nest is een kaartpunt dat zichtbaar wordt',
    async () => {
      await selectArmy(bot, true, c.guards);
      const near = (() => {
        const dx = c.mine.x - camp.x,
          dy = c.mine.y - camp.y,
          l = Math.hypot(dx, dy);
        return { x: camp.x + (dx / l) * 13 * M, y: camp.y + (dy / l) * 13 * M };
      })();
      await orderViaMinimap(bot, 'm', near.x, near.y);
      await bot.until(
        'leger bij het nest',
        async () => {
          const own = (await bot.own()).filter((e) => e.t < BUILDING_MIN && !WORKERS_T(c).has(e.t));
          return own.length > 0 && own.every((e) => dist(e, near) < 8);
        },
        60,
        3,
      );
      const f = await fogView(c);
      bot.expect(f.creeps.length > 0, 'de bandieten zijn nu zichtbaar', 'midden', fogLine(f));
      await bot.panTo(camp.x, camp.y);
      await bot.shot('nest-in-zicht');
    },
  );
  await S(
    c,
    'kamp-aanvallen',
    raiders
      ? 'Warlord met Raid (Z) en alle vechters Val aan (A) naar het nest: nest geruimd, buit en XP'
      : 'Opziener met Lockdown (Z) en alle militie Val aan (A) naar het nest: nest geruimd, buit en XP',
    async () => {
      const s0 = await bot.status();
      const h0 = await heroStatus(bot);
      const army0 = await armySize(c);
      await selectArmy(bot, true, c.guards);
      await bot.key('a');
      bot.expect(
        /aanvalsdoel/.test(await bot.text('.co-targeting')),
        'A toont de aanvalsmodus',
        'midden',
      );
      const g = await groundAt(bot, camp.x, camp.y, true);
      if (!g) {
        bot.finding('midden', 'nest niet aan te klikken op de grond');
        await bot.key('Escape');
        return;
      }
      await bot.click(g);
      // the hero ability goes off as the fight starts
      await bot.advance(5);
      await grp(bot, 'hero');
      await bot.key('z');
      const g2 = await groundAt(bot, camp.x, camp.y, false);
      if (g2) await bot.click(g2);
      let cleared = false;
      let wiped = false;
      let revoltSeen = '';
      for (let t = 0; t < 120 && !cleared; t += 3) {
        await bot.advance(3);
        const f = await fogView(c);
        const tt = await toast(bot);
        if (/Kooi|ontsnap/i.test(tt)) revoltSeen = tt;
        if (t % 12 === 0)
          bot.say(
            `  t+${t}s: ${f.creeps.length} bandieten, leger ${await armySize(c)}, ${(await bot.text('.co-raiders')).replace(/\s+/g, ' ').trim()}`,
          );
        if (t === 9) await bot.shot('nest-gevecht');
        if (t >= 12 && f.creeps.length === 0) {
          cleared = true;
          if ((await armySize(c)) === 0) wiped = true;
        }
      }
      const s1 = await bot.status();
      const h1 = await heroStatus(bot);
      const army1 = await armySize(c);
      bot.say(
        `  leger ${army0} -> ${army1}; scrap ${s0.scrap} -> ${s1.scrap}; held xp ${h0.xp} -> ${h1.xp}, level ${h0.level} -> ${h1.level}`,
      );
      bot.expect(
        cleared && !wiped,
        'het nest is geruimd (geen bandieten meer in zicht en het leger leeft nog)',
        'hoog',
        wiped ? 'leger dood, zicht weg' : '',
      );
      bot.expect(
        s1.scrap - s0.scrap >= 100,
        'de buit (120 scrap) komt binnen',
        'midden',
        `${s1.scrap - s0.scrap}`,
      );
      bot.expect(
        h1.xp > h0.xp || h1.level > h0.level,
        'de held krijgt XP van het nest (100 plus kills)',
        'hoog',
        `${h0.xp} -> ${h1.xp}`,
      );
      if (raiders)
        bot.say(`  alarm tijdens de afwezigheid van het leger: ${revoltSeen || '(geen)'}`);
      await bot.shot('nest-geruimd');
      // back to the base: the Kooi needs its guards, and the loot is in
      if (await selectArmy(bot, true, c.guards))
        await orderViaMinimap(bot, 'm', c.mine.x, c.mine.y + 12 * M);
      await bot.key('Escape');
    },
  );
}

export const WORKERS_T = (c: Ctx): Set<number> => {
  const out = new Set<number>();
  for (const k of [...WORKERS, ...c.guards]) {
    const v = c.tids.get(`u:${k}`);
    if (v !== undefined) out.add(v);
  }
  return out;
};

// ---------------------------------------------------------------- perk panel
export async function perkPanel(c: Ctx): Promise<void> {
  const { bot } = c;
  await S(
    c,
    'perk-paneel',
    'na een level-up staat de badge "Kies perk" er; P opent het paneel; een klik kiest een perk; de badge verdwijnt',
    async () => {
      const h = await heroStatus(bot);
      bot.say(`  held: level ${h.level}, xp ${h.xp}, perks open ${h.pending}, gekozen ${h.perks}`);
      await bot.key('Escape');
      await bot.key('p');
      bot.expect(
        !(await bot.ev<boolean>(`!!document.querySelector('#co-perk-panel')`)) || h.pending > 0,
        'P zonder open perk opent niets',
      );
      if (h.pending === 0) {
        bot.finding(
          'midden',
          `held level ${h.level} (xp ${h.xp}) maar geen perk om te kiezen; geen level-up bij het nest?`,
        );
        return;
      }
      await bot.key('Escape');
      const badge = (await bot.text('.co-perk-badge')).trim();
      bot.expect(
        /Kies perk/.test(badge),
        'de badge "Kies perk (n)" staat bij het heldenpaneel',
        'hoog',
        badge,
      );
      await bot.key('p');
      const open = await bot.ev<boolean>(`!!document.querySelector('#co-perk-panel')`);
      bot.expect(open, 'P opent het perkpaneel', 'hoog');
      const names = await bot.ev<string[]>(
        `[...document.querySelectorAll('.co-perk')].map((b) => b.getAttribute('data-perk') + (b.classList.contains('co-perk-locked') ? '(vergrendeld)' : ''))`,
      );
      bot.say(`  perks: ${names.join(', ')}`);
      await bot.shot('perkpaneel-open');
      const pick = bot.page.locator('.co-perk:not(.co-perk-locked)').first();
      if (!(await pick.count())) {
        bot.finding('midden', 'alle perks zijn vergrendeld terwijl er een open is');
        return;
      }
      const b = await pick.boundingBox();
      if (b) await bot.click({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, { settle: 600 });
      await bot.advance(2);
      const h2 = await heroStatus(bot);
      bot.expect(
        h2.perks === h.perks + 1 && h2.pending === h.pending - 1,
        'de perk is gekozen (status.perks +1, open -1)',
        'hoog',
        `${h.perks}/${h.pending} -> ${h2.perks}/${h2.pending}`,
      );
      if (h2.pending === 0)
        bot.expect(
          !(await bot.ev<boolean>(`!!document.querySelector('#co-perk-panel')`)),
          'het paneel sluit na de laatste keuze',
          'laag',
        );
    },
  );
}

// ---------------------------------------------------------------- scouting, fog, ghosts, attacking only what is visible
export async function scoutHome(c: Ctx): Promise<void> {
  const { bot } = c;
  const fighters = c.cfg.own === 'raiders' ? 'plunderaar' : 'militie';
  const nodes = (await bot.ents()).filter((e) => e.t === 2048);
  const node = nodes
    .sort((a, b) => dist(a, c.theirs) - dist(b, c.theirs))
    .find((e) => dist(e, c.theirs) > 14)!;
  const dx = c.mine.x - node.x,
    dy = c.mine.y - node.y,
    l = Math.hypot(dx, dy);
  const target = { x: node.x + (dx / l) * 8 * M, y: node.y + (dy / l) * 8 * M };
  await S(
    c,
    'verkenner-sturen',
    'een enkele eenheid via M en de minimap naar de vijandelijke scrapbron sturen: onderweg wordt de mist gelicht',
    async () => {
      const n = await selectUnits(c, fighters, 1);
      bot.expect(
        n === 1 && /\(1\)|SELECTIE/.test(await bot.selection()),
        'één verkenner geselecteerd',
        'midden',
        await bot.selection(),
      );
      const ids = (await ownOf(c, fighters)).map((e) => e.id).sort((a, b) => a - b);
      c.scoutId = ids[0] ?? null;
      const before = (await bot.own()).find((e) => e.id === c.scoutId);
      bot.expect(
        await orderViaMinimap(bot, 'm', target.x, target.y),
        'verkenner krijgt een verplaatsorder via de minimap',
      );
      await bot.advance(20);
      const after = (await bot.own()).find((e) => e.id === c.scoutId);
      bot.expect(
        !!before && !!after && dist(before, after) > 15,
        'de verkenner loopt weg (20 s)',
        'midden',
        before && after ? `${dist(before, after).toFixed(0)} m` : 'weg',
      );
      const f = await fogView(c);
      bot.say(`  na 20 s: ${fogLine(f)}`);
      await bot.key('Escape');
    },
  );
  c.scoutTarget = target;
}

export async function scoutCheck(c: Ctx): Promise<void> {
  const { bot } = c;
  if (!c.scoutTarget) return;
  await S(
    c,
    'verkenner-ziet-vijand',
    'de verkenner komt bij de vijand: er verschijnen vijandelijke eenheden en gebouwen in zicht (mist wijkt)',
    async () => {
      let seen: FogView | null = null;
      const scoutAlive = async (): Promise<Ent | undefined> =>
        (await bot.own()).find((e) => e.id === c.scoutId);
      await bot.until(
        'vijand in zicht',
        async () => {
          const f = await fogView(c);
          if (f.enemyUnits.length + f.enemyBuildings.length > 0) {
            seen = f;
            return true;
          }
          return !(await scoutAlive());
        },
        200,
        2,
      );
      const sc = await scoutAlive();
      bot.say(
        `  verkenner: ${sc ? `op ${(sc.x / M).toFixed(0)},${(sc.y / M).toFixed(0)} hp ${sc.hp}%` : 'gesneuveld'}; ${fogLine(await fogView(c))}`,
      );
      bot.expect(seen !== null, 'de verkenner ziet de vijand voor hij sneuvelt', 'midden');
      if (seen) {
        const sf = seen as FogView;
        c.seenEnemyBuildings = sf.enemyBuildings.length > 0;
        const kinds = [...new Set(sf.enemyUnits.map((e) => e.t))].join(',');
        bot.say(
          `  zichtbaar: eenheden types ${kinds || '-'}; gebouwen ${sf.enemyBuildings.map((e) => e.t).join(',') || '-'}`,
        );
        // every enemy entity that is visible must really be within a sight radius of own units (no wallhack)
        const mine = (await bot.own()).filter((e) => e.t < BUILDING_MAX);
        const far = sf.enemyUnits.filter((e) => Math.min(...mine.map((m) => dist(m, e))) > 40);
        bot.expect(
          far.length === 0,
          'vijandelijke eenheden in beeld liggen binnen zichtbereik van eigen eenheden',
          'hoog',
          `${far.length} te ver`,
        );
      }
      await bot.panTo(c.scoutTarget!.x, c.scoutTarget!.y);
      await bot.shot('vijand-in-zicht');
    },
  );
}

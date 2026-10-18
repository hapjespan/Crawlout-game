// Speeltest 2: the same human-speed bot as playtest.ts (mouse and keyboard through the REAL HUD, no sendCommand), but it
// starts through the real front end (splash -> menu -> Tegen AI -> choose faction and AI faction -> Start) and plays about
// 15 in-game minutes against the scripted AI. It covers what playtest.ts does not: fog of war (scouting reveals, ghost
// buildings, attacking only visible targets), creep camps (tier 1 with hero and militia, loot and hero XP), the perk panel
// (P) after a level-up, claim posts (build menu and hero claim), the Raiders (Slaver Vang on an enemy settler, slaves to the
// Kooi, SetRole on slaves, tents and Produce, chems through the Chem-dealer, Warlord Raid, the revolt warning), the Dwellers
// (Bevrijd an enemy-held slave when one is visible, robots, training), the Gebouwen bar, cards, deselect and select rules,
// and "Terug naar menu" after Opgeven.
//
// Plan: PLAYTEST2_PLAN=dw-ra@1600x900,ra-dw@1600x900,dw-dw@1600x900,dw-ra@1280x720  (own faction - AI faction @ size)
//   PLAYTEST_URL=http://localhost:5215/ PLAYTEST_SHOTS=/some/dir PLAYTEST_MINUTES=15 node --import tsx src/playtest2.ts
// Sim time runs on Playwright's fake clock (runFor); every input is still real-time human speed. Needs a running client
// and Chrome; not part of `pnpm test`. Reads the map file (spawns, claim points, camps) as the map knowledge a player has.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  ALL_FINDINGS,
  BUILDING_MAX,
  BUILDING_MIN,
  Bot,
  MINUTES,
  SHOTS,
  placeBuilding,
  untilBuilt,
  wait,
} from './playtest-core.js';
import type { Box, Ent, Pt, Severity } from './playtest-core.js';

const URL = process.env.PLAYTEST_URL ?? 'http://localhost:5215/';
const PLAN = (
  process.env.PLAYTEST2_PLAN ?? 'dw-ra@1600x900,ra-dw@1600x900,dw-dw@1600x900,dw-ra@1280x720'
)
  .split(',')
  .map((p) => {
    const [pair, size] = p.split('@') as [string, string];
    const [own, ai] = pair.split('-') as [string, string];
    const [w, h] = size.split('x').map(Number) as [number, number];
    return {
      own: own === 'ra' ? 'raiders' : 'dwellers',
      ai: ai === 'ra' ? 'raiders' : 'dwellers',
      w,
      h,
    } as Cfg;
  });
/** Stop after this many steps (development aid). */
const STOP_AFTER = Number(process.env.PLAYTEST2_STOP_AFTER ?? 0);

type Faction = 'dwellers' | 'raiders';
interface Cfg {
  own: Faction;
  ai: Faction;
  w: number;
  h: number;
}
interface MapFile {
  size: { w: number; h: number };
  spawns: { x: number; y: number }[];
  claimPoints: { x: number; y: number; kind: string }[];
  creepCamps: { x: number; y: number; tier: number }[];
}
const MAP = JSON.parse(
  readFileSync(new globalThis.URL('../../../data/maps/rustbelt.json', import.meta.url), 'utf8'),
) as MapFile;
const M = 256;
const NEUTRAL = 255;
const GHOST = 16;
const WORKERS = new Set(['scavenger', 'bouwer', 'slaaf', 'slaaf_bouwer', 'technicus']);

/** Facts about one run, filled in as the scenario goes. */
interface Ctx {
  bot: Bot;
  cfg: Cfg;
  me: number;
  /** HQ of both sides in sim units (map knowledge: the spawns). */
  mine: Pt;
  theirs: Pt;
  camp: { x: number; y: number; tier: number };
  tids: Map<string, number>;
  /** Scout and army bookkeeping. */
  scoutId: number | null;
  seenEnemyBuildings: boolean;
  stepsDone: number;
  /** Roster groups that stay home as guards of the Kooi (Raiders). */
  guards: string[];
  scoutTarget?: Pt;
  claimPt?: Pt;
  heroPt?: Pt;
}

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y) / M;

// ---------------------------------------------------------------- helpers: types, roster, selection
async function tid(c: Ctx, key: string, building = false): Promise<number> {
  const k = `${building ? 'b:' : 'u:'}${key}`;
  const have = c.tids.get(k);
  if (have !== undefined) return have;
  const id = await c.bot.ev<number>(
    building
      ? `window.crawlout.placement.typeId(${JSON.stringify(key)})`
      : `window.crawlout.unitTypeId(${JSON.stringify(key)})`,
  );
  c.tids.set(k, id);
  return id;
}
async function ownOf(c: Ctx, key: string): Promise<Ent[]> {
  const t = await tid(c, key);
  return (await c.bot.own()).filter((e) => e.t === t);
}
async function hero(c: Ctx): Promise<Ent | undefined> {
  return (await c.bot.own()).find((e) => e.t >= 1000 && e.t < 1024);
}
async function groupKeys(bot: Bot): Promise<string[]> {
  return bot.ev<string[]>(
    `[...document.querySelectorAll('.co-roster-group')].map((b) => b.getAttribute('data-group'))`,
  );
}
async function grp(bot: Bot, key: string, shift = false): Promise<boolean> {
  const sel = `.co-roster-group[data-group="${key}"], [data-group="${key}"]`;
  const p = await bot.center(sel);
  if (!p) return false;
  if (await bot.page.locator(sel).first().isDisabled()) return false;
  await bot.click(p, { shift });
  return true;
}
/** All fighters (every roster group that is not a worker group) and the hero. */
async function selectArmy(
  bot: Bot,
  withHero = true,
  exclude: readonly string[] = [],
): Promise<number> {
  const keys = (await groupKeys(bot)).filter(
    (k) => (withHero || k !== 'hero') && !WORKERS.has(k) && !exclude.includes(k),
  );
  let first = true;
  let n = 0;
  for (const k of keys) {
    const count = Number(
      (await bot.text(`[data-group="${k}"] .co-roster-count`)).trim().replace(/\D/g, '') || 0,
    );
    if (count === 0) continue;
    if (await grp(bot, k, !first)) {
      first = false;
      n += count;
    }
  }
  return n;
}
async function armySize(c: Ctx): Promise<number> {
  const skip = new Set<number>();
  for (const k of [...WORKERS, ...c.guards]) skip.add(await tid(c, k));
  return (await c.bot.own()).filter((e) => e.t < BUILDING_MIN && !skip.has(e.t)).length;
}

// ---------------------------------------------------------------- helpers: orders by minimap and ground
/** Orders the current selection to a far point: command key (m = verplaats, a = val aan, f = vang), then a minimap click. */
async function orderViaMinimap(bot: Bot, cmdKey: string, x: number, y: number): Promise<boolean> {
  await bot.key(cmdKey);
  const mode = (await bot.text('.co-targeting')).trim();
  if (mode === '') {
    bot.finding('midden', `toets ${cmdKey.toUpperCase()} met een selectie start geen richtmodus`);
    return false;
  }
  const mm = await bot.ev<Box | null>(
    `(() => { const e = document.querySelector('.co-minimap canvas'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`,
  );
  if (!mm) return false;
  const fx = Math.min(0.99, Math.max(0.01, x / M / MAP.size.w));
  const fy = Math.min(0.99, Math.max(0.01, y / M / MAP.size.h));
  await bot.click({ x: mm.x + fx * mm.w, y: mm.y + fy * mm.h }, { settle: 400 });
  return true;
}
/** Screen point on the ground nearest to a sim position (entity free), probing the canvas with pickAt. */
async function groundPoint(bot: Bot, x: number, y: number): Promise<(Pt & { d: number }) | null> {
  return bot.ev(`(() => {
    const r = window.crawlout.renderer; let best = null;
    for (let py = 70; py < innerHeight - 20; py += 14) for (let px = 20; px < innerWidth - 20; px += 14) {
      if (document.elementFromPoint(px, py)?.id !== 'view') continue;
      const h = r.pickAt(px, py); if (!h.ground || h.entityId !== null) continue;
      const d = Math.hypot(h.ground.x - ${x}, h.ground.y - ${y});
      if (!best || d < best.d) best = { x: px, y: py, d };
    }
    return best && { x: best.x, y: best.y, d: best.d / 256 };
  })()`);
}
/** Camera to a sim position, then the ground point there (null when it is not on screen). */
async function groundAt(bot: Bot, x: number, y: number, zoomIn = true): Promise<Pt | null> {
  await bot.panTo(x, y);
  if (zoomIn && (await bot.cam()).d > 80) await bot.wheel(-240, 3);
  const g = await groundPoint(bot, x, y);
  if (!g || g.d > 8) return null;
  return g;
}
/** Screen point of a moving unit: zoom in a little, look at its fresh position, retry a few times (it walks). */
async function unitPoint(
  bot: Bot,
  id: number,
  heights: number[] = [0.8, 1.5, 0.4, 1.1],
): Promise<Pt | null> {
  for (let i = 0; i < 4; i++) {
    const e = (await bot.ents()).find((x) => x.id === id);
    if (!e) return null;
    await bot.panTo(e.x, e.y);
    if ((await bot.cam()).d > 55) await bot.wheel(-240, 3);
    const fresh = (await bot.ents()).find((x) => x.id === id);
    const p = fresh ? await bot.screenOf(fresh, heights) : null;
    if (p) return p;
  }
  return null;
}

async function advanceWatching(bot: Bot, seconds: number, step = 4): Promise<void> {
  for (let left = seconds; left > 0; left -= step) {
    await bot.advance(Math.min(step, left));
    await bot.pulse();
    await bot.tendEconomy();
  }
}

// ---------------------------------------------------------------- helpers: fog and enemies
interface FogView {
  enemyUnits: Ent[];
  enemyBuildings: Ent[];
  ghosts: Ent[];
  creeps: Ent[];
}
async function fogView(c: Ctx): Promise<FogView> {
  const ents = await c.bot.ents();
  const creepIds = new Set<number>();
  for (const k of ['bandiet_schutter', 'bandiet_knokker', 'bandiet_baas'])
    creepIds.add(await tid(c, k));
  const foe = ents.filter((e) => e.owner !== c.me && e.owner !== NEUTRAL && e.t < BUILDING_MAX);
  const creeps = ents.filter((e) => creepIds.has(e.t));
  return {
    enemyUnits: foe.filter((e) => e.t < BUILDING_MIN),
    enemyBuildings: foe.filter((e) => e.t >= BUILDING_MIN && (e.fl & GHOST) === 0),
    ghosts: foe.filter((e) => e.t >= BUILDING_MIN && (e.fl & GHOST) !== 0),
    creeps,
  };
}
const fogLine = (f: FogView): string =>
  `vijand: ${f.enemyUnits.length} eenheden, ${f.enemyBuildings.length} gebouwen in zicht, ${f.ghosts.length} ghosts, ${f.creeps.length} bandieten in zicht`;

// ---------------------------------------------------------------- the run
async function toast(bot: Bot): Promise<string> {
  return (await bot.text('.co-toasts')).replace(/\s+/g, ' ').trim();
}
async function heroStatus(
  bot: Bot,
): Promise<{ level: number; xp: number; pending: number; perks: number }> {
  const s = await bot.status();
  const h = s.hero as unknown as
    { level: number; xp: number; pendingPerks?: number; perks?: unknown[] } | undefined;
  return {
    level: h?.level ?? 0,
    xp: h?.xp ?? 0,
    pending: h?.pendingPerks ?? 0,
    perks: h?.perks?.length ?? 0,
  };
}

async function menuStart(bot: Bot, cfg: Cfg): Promise<void> {
  const page = bot.page;
  const hasHud = (): Promise<boolean> =>
    bot.ev<boolean>(`!!document.querySelector('#hud .co-hud')`);
  await bot.step(
    'splash',
    'splash met titel, voortgangsbalk op 100 procent en "druk op een toets"; geen HUD',
    async () => {
      await page.locator('.co-m-press').waitFor({ timeout: 60000 });
      bot.expect(
        (await bot.text('.co-m-title')).toLowerCase() === 'crawlout',
        'de splash toont de titel Crawlout',
      );
      bot.expect(
        (await page.locator('[role=progressbar]').getAttribute('aria-valuenow')) === '100',
        'de laadbalk staat op 100 procent',
      );
      bot.expect(!(await hasHud()), 'geen HUD voor het potje');
      await wait(1200);
    },
  );
  await bot.step(
    'hoofdmenu',
    'een toets opent het menu met drie keuzes; het eerste item heeft focus; pijltjes lopen door het menu',
    async () => {
      await page.keyboard.press('Space');
      await page.locator('.co-m-item').first().waitFor();
      await wait(300);
      bot.expect((await page.locator('.co-m-item').count()) === 3, 'drie menukeuzes');
      bot.expect(
        await bot.ev<boolean>(`document.activeElement?.classList.contains('co-m-item') === true`),
        'het eerste item heeft focus',
      );
      await bot.key('ArrowDown');
      bot.expect(
        (await bot.ev<string>(`document.activeElement?.textContent ?? ''`)).includes(
          'Speler tegen speler',
        ),
        'pijl omlaag gaat naar Speler tegen speler',
      );
      await bot.key('ArrowUp');
    },
  );
  await bot.step(
    'tegen-ai',
    `Tegen AI: eigen factie ${cfg.own}, AI-factie ${cfg.ai}, keuzes staan aangevinkt`,
    async () => {
      await bot.click((await bot.center('.co-m-item'))!);
      await page
        .getByRole('button', { name: /^Tegen AI/ })
        .first()
        .waitFor({ timeout: 2000 })
        .catch(() => undefined);
      if (!(await page.getByRole('radiogroup', { name: 'Speltype' }).count()))
        await page.getByRole('button', { name: /^Tegen AI/ }).click();
      await page.getByRole('radiogroup', { name: 'Speltype' }).waitFor({ timeout: 10000 });
      await wait(400);
      const name = (f: Faction): RegExp => (f === 'raiders' ? /Raiders/ : /Dwellers/);
      const ownBtn = page
        .getByRole('radiogroup', { name: 'Jouw factie' })
        .getByRole('radio', { name: name(cfg.own) });
      const aiBtn = page
        .getByRole('radiogroup', { name: 'Factie van de AI' })
        .getByRole('radio', { name: name(cfg.ai) });
      await bot.click(
        (await bot.center(
          '[aria-label="Jouw factie"] [role=radio]:has-text("' +
            (cfg.own === 'raiders' ? 'Raiders' : 'Dwellers') +
            '")',
        ))!,
      );
      await bot.click(
        (await bot.center(
          '[aria-label="Factie van de AI"] [role=radio]:has-text("' +
            (cfg.ai === 'raiders' ? 'Raiders' : 'Dwellers') +
            '")',
        ))!,
      );
      bot.expect(
        (await ownBtn.getAttribute('aria-checked')) === 'true',
        `Jouw factie: ${cfg.own} aangevinkt`,
      );
      bot.expect(
        (await aiBtn.getAttribute('aria-checked')) === 'true',
        `Factie van de AI: ${cfg.ai} aangevinkt`,
      );
      bot.expect(
        (await page.getByRole('radio', { name: /^Skirmish/ }).getAttribute('aria-checked')) ===
          'true',
        'speltype Skirmish staat aan',
      );
    },
  );
  await bot.step(
    'start-knop',
    'Start brengt het potje op gang: menu weg, HUD er, juiste factie',
    async () => {
      await bot.click((await bot.center('button:has-text("Start")'))!, { settle: 600 });
      await page.waitForFunction(`window.crawlout && window.crawlout.entities().size > 10`, null, {
        timeout: 90000,
      });
      await wait(2500);
      bot.expect(!(await page.locator('.co-menu').isVisible()), 'het menu is weg');
      bot.expect(await hasHud(), 'de HUD staat er');
      const f = await bot.ev<string>(`window.crawlout.session.faction`);
      bot.expect(f === cfg.own, `de gekozen factie wordt gespeeld (${cfg.own})`, 'hoog', f);
    },
  );
}

async function makeCtx(bot: Bot, cfg: Cfg): Promise<Ctx> {
  const me = await bot.me();
  const mine = { x: MAP.spawns[me]!.x * M, y: MAP.spawns[me]!.y * M };
  const theirs = { x: MAP.spawns[1 - me]!.x * M, y: MAP.spawns[1 - me]!.y * M };
  const camp = MAP.creepCamps
    .filter((k) => k.tier === 1)
    .map((k) => ({ ...k, d: Math.hypot(k.x * M - mine.x, k.y * M - mine.y) }))
    .sort((a, b) => a.d - b.d)[0]!;
  return {
    bot,
    cfg,
    me,
    mine,
    theirs,
    camp: { x: camp.x * M, y: camp.y * M, tier: 1 },
    tids: new Map(),
    guards: cfg.own === 'raiders' ? ['plunderaar'] : [],
    scoutId: null,
    seenEnemyBuildings: false,
    stepsDone: 0,
  };
}

async function startAndFog(c: Ctx): Promise<void> {
  const { bot } = c;
  await bot.step(
    'start',
    'startstatus; alleen eigen eenheden en kaartkennis in beeld; geen vijand; niets geselecteerd',
    async () => {
      const s = await bot.status();
      const keys = await groupKeys(bot);
      bot.say(`  roster-groepen: ${keys.join(', ')}; scrap ${s.scrap}, bewoners ${s.settlers}`);
      const f = await fogView(c);
      bot.expect(
        f.enemyUnits.length === 0 && f.enemyBuildings.length === 0 && f.ghosts.length === 0,
        'bij de start staat er niets van de vijand in beeld (mist)',
        'hoog',
        fogLine(f),
      );
      const ents = await bot.ents();
      bot.expect(
        ents.some((e) => e.t === 2048) && ents.some((e) => e.t === 2049),
        'scrapbronnen en claimpunten zijn kaartkennis en dus zichtbaar',
      );
      bot.expect(
        (await bot.text('.co-selection')).includes('Niets geselecteerd'),
        'niets geselecteerd',
      );
      await bot.samplePerf();
    },
  );
}

/** Selects n single units of a group through the roster list; idleOnly picks units without a task first. */
async function selectUnits(c: Ctx, key: string, n: number, idleOnly = false): Promise<number> {
  const { bot } = c;
  const list = bot.page.locator('.co-roster-unit');
  if (!(await grp(bot, key))) return 0;
  let count = await list.count();
  if (count === 0) {
    await grp(bot, key); // a second click opens the list
    count = await list.count();
  }
  const acts = await bot.ev<string[]>(
    `[...document.querySelectorAll('.co-roster-unit')].map((b) => b.getAttribute('data-activity'))`,
  );
  const idx = acts
    .map((a, i) => ({ a, i }))
    .filter((x) => !idleOnly || x.a === 'idle')
    .map((x) => x.i);
  let taken = 0;
  for (const i of idx.slice(0, n)) {
    const b = await list.nth(i).boundingBox();
    if (!b) continue;
    await bot.click({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, { shift: taken > 0 });
    taken++;
  }
  return taken;
}

async function waitScrap(bot: Bot, n: number, maxS = 240): Promise<boolean> {
  return bot.until(`${n} scrap`, async () => (await bot.status()).scrap >= n, maxS, 5);
}

/** The cards of the selected building, logged with their state and reason; flags cards that do nothing without a reason. */
async function cardsReport(bot: Bot, what: string): Promise<void> {
  const cs = await bot.cards();
  bot.say(`  kaarten (${what}): ${cs.map((k) => `${k.naam}[${k.state}]`).join(', ') || '(geen)'}`);
  for (const k of cs)
    if (
      (k.state === 'tooExpensive' || k.state === 'busy' || k.state === 'locked') &&
      k.title === ''
    )
      bot.finding(
        'midden',
        `kaart "${k.naam}" (${k.state}) bij ${what} heeft geen tooltip met de reden`,
      );
}

/** Selects a building by its Gebouwen-bar button and checks the selection panel names it. */
async function barSelect(bot: Bot, key: string, expectName: string): Promise<boolean> {
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
async function S(c: Ctx, name: string, expected: string, fn: () => Promise<void>): Promise<void> {
  const { bot } = c;
  if (STOP_AFTER && c.stepsDone >= STOP_AFTER) return;
  if (/gewonnen|verloren/i.test(await bot.text('#end')) || (await bot.gameOver())) return;
  c.stepsDone++;
  await bot.step(name, expected, fn);
}

// ---------------------------------------------------------------- building (both factions)
async function build(c: Ctx, key: string, label: string, nearMin = 19): Promise<Ent | null> {
  const { bot } = c;
  const hq = await bot.hq();
  await bot.panTo(hq.x, hq.y);
  if ((await bot.cam()).d < 50) await bot.wheel(240, 4);
  const site = await placeBuilding(bot, key, 'Bouwer', nearMin, key !== 'kooi');
  if (site) bot.say(`  ${label} bouwplaats ${site.id}`);
  return site;
}

// ---------------------------------------------------------------- the creep camp (both factions)
async function ensureArmy(c: Ctx, want: number, maxS: number): Promise<number> {
  await c.bot.until(`leger van ${want}`, async () => (await armySize(c)) >= want, maxS, 5);
  return armySize(c);
}

async function campClear(c: Ctx): Promise<void> {
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
const WORKERS_T = (c: Ctx): Set<number> => {
  const out = new Set<number>();
  for (const k of [...WORKERS, ...c.guards]) {
    const v = c.tids.get(`u:${k}`);
    if (v !== undefined) out.add(v);
  }
  return out;
};

// ---------------------------------------------------------------- perk panel
async function perkPanel(c: Ctx): Promise<void> {
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
async function scoutHome(c: Ctx): Promise<void> {
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

async function scoutCheck(c: Ctx): Promise<void> {
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

/** With the scout still alive near the enemy: attack a visible target, retreat, check the ghosts, click a ghost. */
async function scoutFog(c: Ctx): Promise<void> {
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
async function claimByBuildMenu(c: Ctx): Promise<void> {
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

async function claimByHero(c: Ctx): Promise<void> {
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
async function heroClaimCheck(c: Ctx): Promise<void> {
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
async function selectRules(c: Ctx): Promise<void> {
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
async function surrender(c: Ctx): Promise<void> {
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

// ---------------------------------------------------------------- Dwellers
async function dwellersOpening(c: Ctx): Promise<{ werk: Ent | null }> {
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

async function dwellersTech(c: Ctx, afterLab: () => Promise<void>): Promise<void> {
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

async function liberate(c: Ctx): Promise<void> {
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

// ---------------------------------------------------------------- Raiders
async function raidersOpening(c: Ctx): Promise<void> {
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

async function raidersEconomyTech(c: Ctx, afterChem: () => Promise<void>): Promise<void> {
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

async function slaverHunt(c: Ctx): Promise<void> {
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

async function mainRun(cfg: Cfg): Promise<Bot> {
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

if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const bots: Bot[] = [];
for (const cfg of PLAN) bots.push(await mainRun(cfg));

console.log('\n===== PERF =====');
for (const b of bots) {
  if (b.perf.length === 0) continue;
  const fps = b.perf.map((p) => p.fps);
  const worst = Math.max(...b.perf.map((p) => p.worst));
  const dc = Math.max(...b.perf.map((p) => p.dc));
  console.log(
    `${b.tag}${b.size}: ${b.perf.length} metingen, fps min ${Math.min(...fps)} gem ${(fps.reduce((a, x) => a + x, 0) / fps.length).toFixed(0)}, slechtste frame ${worst} ms, max ${dc} draw calls`,
  );
}
console.log('\n===== BEVINDINGEN =====');
const order: Severity[] = ['hoog', 'midden', 'laag'];
for (const sev of order)
  for (const f of ALL_FINDINGS.filter((x) => x.severity === sev))
    console.log(`[${sev}] (${f.size}, ${f.step}) ${f.text}`);
if (ALL_FINDINGS.length === 0) console.log('geen bevindingen');
if (SHOTS)
  writeFileSync(
    `${SHOTS}/findings2-${bots.map((b) => b.tag + b.size).join('+')}.json`,
    JSON.stringify(
      { findings: ALL_FINDINGS, perf: bots.map((b) => ({ run: b.tag + b.size, perf: b.perf })) },
      null,
      1,
    ),
  );
process.exit(0);

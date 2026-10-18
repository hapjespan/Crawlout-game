// Split from playtest2.ts to stay under the 5,000-token file limit; playtest2.ts stays the entry script.
// Holds: URL, PLAN, STOP_AFTER, Faction, Cfg, MapFile, +30 more.
import { readFileSync } from 'node:fs';
import {
  Bot,
  type Pt,
  type Ent,
  BUILDING_MIN,
  type Box,
  BUILDING_MAX,
  wait,
} from './playtest-core.js';

export const URL = process.env.PLAYTEST_URL ?? 'http://localhost:5215/';

export const PLAN = (
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
export const STOP_AFTER = Number(process.env.PLAYTEST2_STOP_AFTER ?? 0);

type Faction = 'dwellers' | 'raiders';

export interface Cfg {
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

export const MAP = JSON.parse(
  readFileSync(new globalThis.URL('../../../data/maps/rustbelt.json', import.meta.url), 'utf8'),
) as MapFile;

export const M = 256;

const NEUTRAL = 255;

const GHOST = 16;

export const WORKERS = new Set(['scavenger', 'bouwer', 'slaaf', 'slaaf_bouwer', 'technicus']);

/** Facts about one run, filled in as the scenario goes. */
export interface Ctx {
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

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y) / M;

// ---------------------------------------------------------------- helpers: types, roster, selection
export async function tid(c: Ctx, key: string, building = false): Promise<number> {
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

export async function ownOf(c: Ctx, key: string): Promise<Ent[]> {
  const t = await tid(c, key);
  return (await c.bot.own()).filter((e) => e.t === t);
}

export async function hero(c: Ctx): Promise<Ent | undefined> {
  return (await c.bot.own()).find((e) => e.t >= 1000 && e.t < 1024);
}

async function groupKeys(bot: Bot): Promise<string[]> {
  return bot.ev<string[]>(
    `[...document.querySelectorAll('.co-roster-group')].map((b) => b.getAttribute('data-group'))`,
  );
}

export async function grp(bot: Bot, key: string, shift = false): Promise<boolean> {
  const sel = `.co-roster-group[data-group="${key}"], [data-group="${key}"]`;
  const p = await bot.center(sel);
  if (!p) return false;
  if (await bot.page.locator(sel).first().isDisabled()) return false;
  await bot.click(p, { shift });
  return true;
}

/** All fighters (every roster group that is not a worker group) and the hero. */
export async function selectArmy(
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

export async function armySize(c: Ctx): Promise<number> {
  const skip = new Set<number>();
  for (const k of [...WORKERS, ...c.guards]) skip.add(await tid(c, k));
  return (await c.bot.own()).filter((e) => e.t < BUILDING_MIN && !skip.has(e.t)).length;
}

// ---------------------------------------------------------------- helpers: orders by minimap and ground
/** Orders the current selection to a far point: command key (m = verplaats, a = val aan, f = vang), then a minimap click. */
export async function orderViaMinimap(
  bot: Bot,
  cmdKey: string,
  x: number,
  y: number,
): Promise<boolean> {
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
export async function groundPoint(
  bot: Bot,
  x: number,
  y: number,
): Promise<(Pt & { d: number }) | null> {
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
export async function groundAt(bot: Bot, x: number, y: number, zoomIn = true): Promise<Pt | null> {
  await bot.panTo(x, y);
  if (zoomIn && (await bot.cam()).d > 80) await bot.wheel(-240, 3);
  const g = await groundPoint(bot, x, y);
  if (!g || g.d > 8) return null;
  return g;
}

/** Screen point of a moving unit: zoom in a little, look at its fresh position, retry a few times (it walks). */
export async function unitPoint(
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

export async function advanceWatching(bot: Bot, seconds: number, step = 4): Promise<void> {
  for (let left = seconds; left > 0; left -= step) {
    await bot.advance(Math.min(step, left));
    await bot.pulse();
    await bot.tendEconomy();
  }
}

// ---------------------------------------------------------------- helpers: fog and enemies
export interface FogView {
  enemyUnits: Ent[];
  enemyBuildings: Ent[];
  ghosts: Ent[];
  creeps: Ent[];
}

export async function fogView(c: Ctx): Promise<FogView> {
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

export const fogLine = (f: FogView): string =>
  `vijand: ${f.enemyUnits.length} eenheden, ${f.enemyBuildings.length} gebouwen in zicht, ${f.ghosts.length} ghosts, ${f.creeps.length} bandieten in zicht`;

// ---------------------------------------------------------------- the run
export async function toast(bot: Bot): Promise<string> {
  return (await bot.text('.co-toasts')).replace(/\s+/g, ' ').trim();
}

export async function heroStatus(
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

export async function menuStart(bot: Bot, cfg: Cfg): Promise<void> {
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

export async function makeCtx(bot: Bot, cfg: Cfg): Promise<Ctx> {
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

export async function startAndFog(c: Ctx): Promise<void> {
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
export async function selectUnits(
  c: Ctx,
  key: string,
  n: number,
  idleOnly = false,
): Promise<number> {
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

export async function waitScrap(bot: Bot, n: number, maxS = 240): Promise<boolean> {
  return bot.until(`${n} scrap`, async () => (await bot.status()).scrap >= n, maxS, 5);
}

/** The cards of the selected building, logged with their state and reason; flags cards that do nothing without a reason. */
export async function cardsReport(bot: Bot, what: string): Promise<void> {
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

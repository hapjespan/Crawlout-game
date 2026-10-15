import { DELAY_FRAMES_DEFAULT, MAX_ENTITIES_PER_COMMAND } from '@crawlout/protocol';
import type { CommandEnvelope, FrameBundle, Replay } from '@crawlout/protocol';
import { ROLES, buildingTypeId } from '@crawlout/data';
import { ORDER_CRAFT, ORDER_NONE } from '@crawlout/sim';
import type { Sim, UnitView } from '@crawlout/sim';
import { gameData } from './env.js';
import { createReplaySim } from './run.js';

// Een eenvoudige speler-bot voor het opnemen van fixtures: hij kijkt naar de state (zoals een speler naar zijn scherm)
// en geeft gewone commando's. Alleen bij `record` draait hij; de fixture bevat de bundels die hij gaf, en de replay
// speelt die af zonder bot. Hij mag dus alles wat de sim publiek laat zien gebruiken, ook floats: het determinisme
// zit in de sim, niet hier.

export type Add = (playerId: number, type: CommandEnvelope['type'], payload: unknown) => void;
/** Kijkt naar de state na frame f - 1 en geeft commando's die in frame f worden uitgevoerd. */
export type Controller = (sim: Sim, frame: number, add: Add) => void;

/**
 * Neemt een replay op met controllers: per frame eerst de controllers (in volgorde), dan de bundel voor dat frame.
 * envelope.frame = uitvoerframe - DELAY, seq per speler oplopend. `until` mag eerder stoppen (true = stop na dit frame).
 * Vult r.bundles en zet het laatste frame in r.hashes (record vult de echte hashes in).
 */
export function recordControlled(
  r: Replay,
  frames: number,
  controllers: readonly Controller[],
  until?: (sim: Sim, frame: number) => boolean,
): Sim {
  const sim = createReplaySim(r);
  const seqs: number[] = [];
  const bundles: FrameBundle[] = [];
  let last = frames - 1;
  for (let f = 0; f < frames; f++) {
    const commands: CommandEnvelope[] = [];
    const add: Add = (playerId, type, payload) => {
      const seq = seqs[playerId] ?? 0;
      seqs[playerId] = seq + 1;
      commands.push({ frame: Math.max(0, f - DELAY_FRAMES_DEFAULT), playerId, seq, type, payload });
    };
    for (const c of controllers) c(sim, f, add);
    const b = { frame: f, commands };
    if (commands.length > 0) bundles.push(b);
    sim.applyBundle(b);
    sim.tick();
    if (until?.(sim, f) === true) {
      last = f;
      break;
    }
  }
  r.bundles = bundles;
  r.hashes = [{ frame: last, hash: 0 }];
  return sim;
}

const ROLE_SCAV = ROLES.indexOf('scavenger');
const ROLE_BUILDER = ROLES.indexOf('builder');
const ROLE_MILITIA = ROLES.indexOf('militia');

export const buildingType = (key: string): number =>
  buildingTypeId(gameData().data.buildings.find((b) => b.key === key)!.id);
export const techOf = (key: string): number => gameData().data.tech.find((t) => t.key === key)!.id;

/**
 * Waar een gebouw van de bot komt, afgeleid uit de map en de state (nooit vaste cellen): bij het eigen hoofdgebouw, bij
 * het eigen settlement-punt (het claimpunt aan de eigen kant, buiten het midden), bij het tweede settlement-punt aan de
 * eigen kant (Rustbelt XL heeft er twee per kant) of bij het middenpunt (het claimpunt het dichtst bij het midden van de
 * map).
 */
export type SiteAnchor = 'hq' | 'settlement' | 'settlement2' | 'centre';

/** Gebouw in de bouwlijst: type en plaats. homewardM schuift het anker zoveel meter op naar het eigen hoofdgebouw (negatief: van huis weg, naar de vijand). */
export interface PlannedBuilding {
  readonly key: string;
  readonly at: SiteAnchor;
  readonly homewardM?: number;
}

/** Het claimpunt het dichtst bij het midden van de map (tiebreak laagste id). */
export function centrePoint(sim: Sim): UnitView {
  const mx = sim.map.w * 128;
  const my = sim.map.h * 128;
  return nearestOf(
    sim
      .entityIds()
      .map((id) => sim.getUnit(id)!)
      .filter((u) => u.kind === 'claimPoint'),
    mx,
    my,
  )!;
}

/**
 * Het claimpunt aan de kant van speler p: buiten het middenpunt, het k-de dichtst bij zijn spawn (k = 0 het dichtst;
 * tiebreak laagste id).
 */
export function settlementPoint(sim: Sim, p: number, k = 0): UnitView {
  const centre = centrePoint(sim);
  const spawn = sim.map.spawns[p]!;
  const list = sim
    .entityIds()
    .map((id) => sim.getUnit(id)!)
    .filter((u) => u.kind === 'claimPoint' && u.id !== centre.id)
    .map((u) => ({ u, d: (u.x - spawn.x) ** 2 + (u.y - spawn.y) ** 2 }))
    .sort((a, b) => a.d - b.d || a.u.id - b.u.id);
  return list[Math.min(k, list.length - 1)]!.u;
}

/** Het hoofdgebouw van speler p, of zijn spawn als het er niet (meer) staat. */
function hqOf(sim: Sim, p: number): { x: number; y: number } {
  const hq = sim
    .entityIds()
    .map((id) => sim.getUnit(id)!)
    .find(
      (u) => u.kind === 'building' && u.owner === p && u.typeId === buildingType('hoofdgebouw'),
    );
  return hq ?? sim.map.spawns[p]!;
}

function nearestOf<T extends { x: number; y: number; id?: number }>(
  list: readonly T[],
  x: number,
  y: number,
): T | undefined {
  let best: T | undefined;
  let bestD = Infinity;
  for (const u of list) {
    const d = (u.x - x) ** 2 + (u.y - y) ** 2;
    if (d < bestD) {
      best = u;
      bestD = d;
    }
  }
  return best;
}

/** Een punt `m` meter van `from` in de richting van `to` (eenheden). */
export function toward(
  from: { x: number; y: number },
  to: { x: number; y: number },
  m: number,
): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x: Math.round(from.x + (dx * m * 256) / len),
    y: Math.round(from.y + (dy * m * 256) / len),
  };
}

/** Het anker van een plaats voor speler p, in eenheden. */
export function anchorOf(
  sim: Sim,
  p: number,
  at: SiteAnchor,
  homewardM = 0,
): { x: number; y: number } {
  const home = hqOf(sim, p);
  const a =
    at === 'hq'
      ? home
      : at === 'centre'
        ? centrePoint(sim)
        : settlementPoint(sim, p, at === 'settlement2' ? 1 : 0);
  return homewardM !== 0 ? toward(a, home, homewardM) : { x: a.x, y: a.y };
}

/**
 * Zoekt bouwplekken zoals een speler dat op zijn scherm doet: de vrije plek het dichtst bij het anker waar de footprint
 * plus een rand van één cel op begaanbare grond ligt, zonder gebouwen, scrap-nodes of claimpunten. "Dichtst bij" is
 * lopend (BFS over het terrein vanaf het anker, om water en bos heen, xl-int), zodat een plek nooit aan de overkant van de rivier
 * ligt; bij gelijke loopafstand de kleinste hemelsbrede. Plekken die al gekozen zijn (take) tellen als bezet, zodat een
 * reeks gebouwen uit één startstate niet op dezelfde plek valt.
 */
export class SitePlanner {
  private readonly taken: { x0: number; y0: number; x1: number; y1: number }[] = [];

  constructor(private readonly sim: Sim) {}

  /** Midden (eenheden) van een vrije plek voor gebouw `key` van speler p bij het anker, of null. */
  find(p: number, key: string, at: SiteAnchor, homewardM = 0): { x: number; y: number } | null {
    const sim = this.sim;
    const bt = sim.config.buildingTypes.find((b) => b.typeId === buildingType(key))!;
    const fw = bt.footprintW;
    const fh = bt.footprintH;
    const a = anchorOf(sim, p, at, homewardM);
    const blocked = this.blocked();
    const ax = a.x >> 8;
    const ay = a.y >> 8;
    // zoekstraal in cellen (midden van de footprint), zoals AI_SITE_RING in de sim: op echte schaal (data 0.14.0) liggen
    // tien woningen van 13 x 20 m tot ongeveer 50 m van het hoofdgebouw (was 24)
    const R = 56;
    const walk = this.walkFrom(ax, ay, R + 4);
    let best: { x: number; y: number } | null = null;
    let bestW = Infinity;
    let bestD = Infinity;
    for (let cy = ay - R; cy <= ay + R; cy++) {
      for (let cx = ax - R; cx <= ax + R; cx++) {
        const fx = cx - (fw >> 1);
        const fy = cy - (fh >> 1);
        const wd = walk.get(cy * sim.map.w + cx);
        if (wd === undefined || wd > bestW) continue;
        // het midden van de footprint zoals de sim het zet (createBuilding)
        const x = fx * 256 + fw * 128;
        const y = fy * 256 + fh * 128;
        const d = (x - a.x) ** 2 + (y - a.y) ** 2;
        if (wd === bestW && d >= bestD) continue;
        if (!this.free(blocked, fx - 1, fy - 1, fw + 2, fh + 2)) continue;
        best = { x, y };
        bestW = wd;
        bestD = d;
      }
    }
    return best;
  }

  /** Loopafstand over het terrein (cellen, 4-buren, om water en bos heen) vanaf de cel van het anker, binnen r cellen. */
  private walkFrom(ax: number, ay: number, r: number): Map<number, number> {
    const { w, h } = this.sim.map;
    const out = new Map<number, number>();
    const start = ay * w + ax;
    out.set(start, 0);
    const queue = [start];
    for (let k = 0; k < queue.length; k++) {
      const c = queue[k]!;
      const cx = c % w;
      const cy = (c - cx) / w;
      const d = out.get(c)!;
      for (const [nx, ny] of [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1],
      ] as const) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (Math.abs(nx - ax) > r || Math.abs(ny - ay) > r) continue;
        const n = ny * w + nx;
        if (this.sim.map.passable[n] !== 1 || out.has(n)) continue;
        out.set(n, d + 1);
        queue.push(n);
      }
    }
    return out;
  }

  /** Zoals find, en de plek telt daarna als bezet. */
  take(p: number, key: string, at: SiteAnchor, homewardM = 0): { x: number; y: number } {
    const bt = this.sim.config.buildingTypes.find((b) => b.typeId === buildingType(key))!;
    const at2 = this.find(p, key, at, homewardM);
    if (at2 === null) throw new Error(`geen plek voor ${key} bij ${at} voor speler ${p}`);
    const fx = (at2.x - bt.footprintW * 128) >> 8;
    const fy = (at2.y - bt.footprintH * 128) >> 8;
    this.taken.push({ x0: fx, y0: fy, x1: fx + bt.footprintW, y1: fy + bt.footprintH });
    return at2;
  }

  private blocked(): Uint8Array {
    const sim = this.sim;
    const { w, h } = sim.map;
    const b = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) b[i] = sim.map.passable[i] === 1 ? 0 : 1;
    const mark = (x0: number, y0: number, x1: number, y1: number): void => {
      for (let y = Math.max(0, y0); y < Math.min(h, y1); y++)
        for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) b[y * w + x] = 1;
    };
    for (const id of sim.entityIds()) {
      const u = sim.getUnit(id)!;
      if (u.kind === 'building') {
        const bt = sim.config.buildingTypes.find((t) => t.typeId === u.typeId)!;
        const fx = (u.x - bt.footprintW * 128) >> 8;
        const fy = (u.y - bt.footprintH * 128) >> 8;
        mark(fx, fy, fx + bt.footprintW, fy + bt.footprintH);
      } else if (u.kind === 'scrapNode' || u.kind === 'claimPoint') {
        mark(u.x >> 8, u.y >> 8, (u.x >> 8) + 1, (u.y >> 8) + 1);
      }
    }
    for (const t of this.taken) mark(t.x0, t.y0, t.x1, t.y1);
    return b;
  }

  private free(b: Uint8Array, x0: number, y0: number, fw: number, fh: number): boolean {
    const { w, h } = this.sim.map;
    if (x0 < 0 || y0 < 0 || x0 + fw > w || y0 + fh > h) return false;
    for (let y = y0; y < y0 + fh; y++)
      for (let x = x0; x < x0 + fw; x++) if (b[y * w + x] === 1) return false;
    return true;
  }
}

export interface BotPlan {
  /** Bouwlijst in volgorde; een gebouw met prereqTech wacht tot de tech er is. */
  readonly builds: readonly PlannedBuilding[];
  /** Techs in volgorde; Research zodra het kan (de sim weigert wat niet kan). */
  readonly research: readonly string[];
  /** Zoveel bouwers houdt hij (omscholen zodra er een werkplaats is). */
  readonly builders: number;
  /** Omscholen tot militie zodra hij zoveel bewoners heeft (of vanaf militiaFrame), tot militiaCount militie. */
  readonly militiaAtSettlers: number;
  readonly militiaFrame?: number;
  readonly militiaCount: number;
  /** Aanvallen (AttackMove naar het hoofdgebouw van de ander, held mee) zodra hij zoveel militie heeft, vanaf attackFrame. */
  readonly attackWithMilitia: number;
  readonly attackFrame?: number;
  /** Doel van de aanval: het hoofdgebouw van de ander (standaard) of een van zijn settlement-punten (zie SiteAnchor). */
  readonly attackTarget?: 'hq' | 'settlement' | 'settlement2';
  /** Militie zonder taak en de held houden deze plek (AttackMove erheen zodra ze verder dan 6 m weg zijn). */
  readonly guard?: SiteAnchor;
  /**
   * Uitgeven (balans speltest 14 oktober): boven aboveScrap schoolt hij een plunderaar om tot het eerste loadout uit
   * army waarvoor de techs er zijn, zolang hij meer dan keepScavengers plunderaars heeft. Zonder spend geeft hij na zijn
   * plan niets meer uit (een passieve speler).
   */
  readonly spend?: {
    readonly aboveScrap: number;
    readonly army: readonly string[];
    readonly keepScavengers: number;
  };
}

/** Een bot voor speler p volgens plan. Kijkt elke `every` frames. */
export function settlementBot(p: number, plan: BotPlan, every = 10): Controller {
  const data = gameData().data;
  let militiaDone = false;
  let attacked = false;
  let lastAttack = -1;
  let next = 0;
  return (sim, f, add) => {
    if (f % every !== p % every || sim.isDefeated(p)) return;
    const all = sim.entityIds().map((id) => sim.getUnit(id)!);
    const mine = all.filter((u) => u.owner === p);
    const units = mine.filter((u) => u.kind === 'unit');
    const hero = mine.find((u) => u.kind === 'hero');
    const hq = mine.find((u) => u.kind === 'building' && u.typeId === buildingType('hoofdgebouw'));
    const st = sim.playerStatus(p);
    const techs = st.techs ?? [];
    const done = (key: string): UnitView | undefined =>
      mine.find(
        (u) => u.kind === 'building' && u.typeId === buildingType(key) && u.buildState === 2,
      );
    const role = (r: number): UnitView[] =>
      units.filter((u) => u.role === r && u.order !== ORDER_CRAFT);
    const idle = (list: UnitView[]): UnitView[] => list.filter((u) => u.order === ORDER_NONE);
    const send = (type: CommandEnvelope['type'], ids: number[], payload: object): void => {
      for (let k = 0; k < ids.length; k += MAX_ENTITIES_PER_COMMAND)
        add(p, type, { ids: ids.slice(k, k + MAX_ENTITIES_PER_COMMAND), ...payload });
    };

    // verzamelen: scavengers zonder werk naar de dichtstbijzijnde node met voorraad
    const nodes = all.filter((u) => u.kind === 'scrapNode' && u.amount > 0);
    const byNode = new Map<number, number[]>();
    for (const u of idle(role(ROLE_SCAV))) {
      let best: UnitView | undefined;
      let bestD = Infinity;
      for (const n of nodes) {
        const d = (n.x - u.x) ** 2 + (n.y - u.y) ** 2;
        if (d < bestD) {
          best = n;
          bestD = d;
        }
      }
      if (best !== undefined) byNode.set(best.id, [...(byNode.get(best.id) ?? []), u.id]);
    }
    for (const [nodeId, ids] of [...byNode].sort((a, b) => a[0] - b[0]))
      send('Gather', ids, { nodeId });

    // bouwers: aanvullen in de werkplaats, één tegelijk
    const scavs = role(ROLE_SCAV);
    const crafting = units.some((u) => u.order === ORDER_CRAFT);
    if (
      done('werkplaats') &&
      !crafting &&
      role(ROLE_BUILDER).length < plan.builders &&
      scavs.length > 0
    ) {
      add(p, 'SetRole', { ids: [scavs[scavs.length - 1]!.id], role: 'builder' });
    }

    // bouwen: bouwplaatsen afmaken, daarna het volgende gebouw uit de lijst. Gebouw k van type T staat zodra er
    // (af of in aanbouw) minstens zoveel T zijn als er T in de lijst staan tot en met k.
    const builders = idle(role(ROLE_BUILDER)).map((u) => u.id);
    const site = mine.find((u) => u.kind === 'building' && u.buildState === 1);
    while (next < plan.builds.length) {
      const t = buildingType(plan.builds[next]!.key);
      const want = plan.builds.slice(0, next + 1).filter((b) => buildingType(b.key) === t).length;
      const have = mine.filter((u) => u.kind === 'building' && u.typeId === t).length;
      if (have < want) break;
      next++;
    }
    if (builders.length > 0) {
      if (site !== undefined)
        send('Build', builders, { typeId: site.typeId, x: site.x, y: site.y });
      else if (next < plan.builds.length) {
        const b = plan.builds[next]!;
        const def = data.buildings.find((x) => x.key === b.key)!;
        if (def.prereqTech.every((t) => techs.includes(t)) && st.scrap >= def.scrapCost) {
          const at = new SitePlanner(sim).find(p, b.key, b.at, b.homewardM);
          if (at !== null) send('Build', builders, { typeId: buildingType(b.key), ...at });
        }
      }
    }

    // onderzoek: de eerste tech die er nog niet is; de sim weigert zonder gebouw, prereqTech of scrap
    const todo = plan.research.map(techOf).find((t) => !techs.includes(t));
    if (todo !== undefined) add(p, 'Research', { techId: todo });

    // uitgeven boven een drempel: omscholen tot het beste leger-loadout
    const sp = plan.spend;
    if (
      sp !== undefined &&
      st.scrap >= sp.aboveScrap &&
      done('werkplaats') &&
      !crafting &&
      scavs.length > sp.keepScavengers
    ) {
      const lo = sp.army
        .map((k) => data.loadouts.find((l) => l.key === k)!)
        .find((l) => l.prereqTech.every((t) => techs.includes(t)));
      if (lo !== undefined) add(p, 'Craft', { ids: [scavs[0]!.id], loadoutId: lo.id });
    }

    // militie
    if (
      !militiaDone &&
      (st.settlers >= plan.militiaAtSettlers ||
        (plan.militiaFrame !== undefined && f >= plan.militiaFrame)) &&
      done('werkplaats')
    ) {
      militiaDone = true;
      send(
        'SetRole',
        scavs.slice(0, plan.militiaCount).map((u) => u.id),
        { role: 'militia' },
      );
    }
    const militia = role(ROLE_MILITIA);
    if (plan.guard !== undefined) {
      const g = anchorOf(sim, p, plan.guard);
      const guards =
        hero !== undefined && hero.order === ORDER_NONE ? [...idle(militia), hero] : idle(militia);
      const go = guards
        .filter((u) => (u.x - g.x) ** 2 + (u.y - g.y) ** 2 > (6 * 256) ** 2)
        .map((u) => u.id);
      if (go.length > 0) send('AttackMove', go, g);
    }
    const enemyHq = all.find(
      (u) =>
        u.kind === 'building' &&
        u.owner !== p &&
        u.owner < 8 &&
        u.typeId === buildingType('hoofdgebouw'),
    );
    if (
      enemyHq !== undefined &&
      militia.length >= plan.attackWithMilitia &&
      f >= (plan.attackFrame ?? 0)
    ) {
      if (!attacked || f - lastAttack >= 400) {
        const ids = (attacked ? idle(militia) : militia).map((u) => u.id);
        if (hero !== undefined && (!attacked || hero.order === ORDER_NONE)) ids.push(hero.id);
        const goal =
          plan.attackTarget === undefined || plan.attackTarget === 'hq'
            ? enemyHq
            : settlementPoint(sim, enemyHq.owner, plan.attackTarget === 'settlement2' ? 1 : 0);
        if (ids.length > 0) send('AttackMove', ids, { x: goal.x, y: goal.y });
        attacked = true;
        lastAttack = f;
      }
    }

    // de held: oplappen, perks, Lockdown op de dichtstbijzijnde vijand binnen bereik
    const h = data.heroes[st.hero?.heroId ?? -1];
    if (h !== undefined && st.hero !== null) {
      if (st.hero.state === 'dead' && hq !== undefined && st.scrap >= h.reviveScrap)
        add(p, 'Recruit', { buildingId: hq.id });
      if (st.hero.pendingPerks > 0)
        for (const perkId of h.perkPool) add(p, 'PickPerk', { heroId: h.id, perkId });
      if (hero !== undefined && st.hero.abilityCooldownTicks[0] === 0) {
        const ab = h.abilities[0]!;
        const enemies = all.filter(
          (u) => (u.kind === 'unit' || u.kind === 'hero') && u.owner !== p && u.owner < 8,
        );
        const near = enemies
          .map((u) => ({ u, d: (u.x - hero.x) ** 2 + (u.y - hero.y) ** 2 }))
          .filter((e) => e.d <= ab.rangeU * ab.rangeU)
          .sort((a, b) => a.d - b.d || a.u.id - b.u.id)[0];
        if (near !== undefined)
          add(p, 'HeroAbility', { heroId: h.id, abilityId: 0, x: near.u.x, y: near.u.y });
      }
    }
  };
}

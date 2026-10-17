import { ROLES } from '@crawlout/data';
import { ORDER_NONE, PROVIDES_HQ } from '@crawlout/sim';
import type { Sim } from '@crawlout/sim';
import type { Controller } from './bot.js';
import { SitePlanner, buildingType, settlementPoint, techOf } from './bot.js';
import { gameData } from './env.js';

// Player bots for the Raider fixtures (sim 0.18.0): they look at the state like a player at his screen and give plain
// commands; only `record` runs them, the fixture holds the bundles. Floats are fine here (the determinism is in the sim).
// World fields (slaveState, visTo) are read directly: the HUD of a player shows the same (his slaves, what he sees).

const ROLE_SCAV = ROLES.indexOf('scavenger');
const ROLE_BUILDER = ROLES.indexOf('builder');
const ROLE_MILITIA = ROLES.indexOf('militia');
const SLAVE_SLAVE = 2;
const SLAVE_CAPTIVE = 1;
export const loadoutOf = (key: string): number =>
  gameData().data.loadouts.find((l) => l.key === key)!.id;

/** Units of player p (not the hero, no corpses), with the world index. */
function unitsOf(sim: Sim, p: number): { id: number; i: number }[] {
  const w = sim.world;
  const out: { id: number; i: number }[] = [];
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] !== 1 || w.owner[i] !== p) continue;
    const u = sim.getUnit(w.idOf(i))!;
    if (u.kind === 'unit') out.push({ id: u.id, i });
  }
  return out;
}

/** Finished own buildings of a type (ids ascending). */
function buildingsOf(sim: Sim, p: number, key: string, done = true): number[] {
  const t = buildingType(key);
  return sim.entityIds().filter((id) => {
    const u = sim.getUnit(id)!;
    return (
      u.kind === 'building' && u.owner === p && u.typeId === t && (!done || u.buildState === 2)
    );
  });
}

/** The headquarters of player p (any faction). */
function hqOf(sim: Sim, p: number): { x: number; y: number } {
  for (const id of sim.entityIds()) {
    const u = sim.getUnit(id)!;
    if (u.kind !== 'building' || u.owner !== p) continue;
    const b = sim.config.buildingTypes.find((t) => t.typeId === u.typeId);
    if (b !== undefined && (b.provides & PROVIDES_HQ) !== 0) return u;
  }
  return sim.map.spawns[p]!;
}

/** The scrap node nearest (x, y) with scrap, farther than `minM` metres from (ox, oy). */
function nodeNear(sim: Sim, x: number, y: number, ox = 0, oy = 0, minM = 0): number {
  let best = 0;
  let bestD = Infinity;
  for (const id of sim.entityIds()) {
    const u = sim.getUnit(id)!;
    if (u.kind !== 'scrapNode' || u.amount <= 0) continue;
    if (minM > 0 && Math.hypot(u.x - ox, u.y - oy) / 256 <= minM) continue;
    const d = (u.x - x) ** 2 + (u.y - y) ** 2;
    if (d < bestD) {
      best = id;
      bestD = d;
    }
  }
  return best;
}

export interface RaiderPlan {
  /** Buildings in order (the slave builder puts them at the headquarters). */
  readonly builds: readonly string[];
  /** Claim the own settlement point with the slave builder from this frame (0 = never). */
  readonly claimAt?: number;
  readonly research: readonly string[];
  /** Loadouts produced in turn in the idle tents and the autosloperij (one at a time per building). */
  readonly produce: readonly string[];
  /** Hold back this much scrap (the bot saves for its research). */
  readonly keep?: number;
  /** From this frame on the Slavers hunt enemy settlers outside his base (0 = never). */
  readonly huntFrom?: number;
  /** At this frame every fighter (not the Slavers) and the hero attack-move to the enemy headquarters (0 = never). */
  readonly allOutAt?: number;
  /** At this frame every fighter and the hero attack-move to the second own settlement point (0 = never). */
  readonly toSettlementAt?: number;
}

/** A Raider player (see RaiderPlan); every `every` frames. */
export function raiderBot(p: number, plan: RaiderPlan, every = 10): Controller {
  let planner: SitePlanner | null = null;
  let built = 0;
  let claimed = false;
  let next = 0;
  const enemy = 1 - p;
  return (sim, frame, add) => {
    planner ??= new SitePlanner(sim);
    const w = sim.world;
    const units = unitsOf(sim, p);
    const fighters = units.filter(
      (u) =>
        w.role[u.i] === ROLE_MILITIA &&
        w.slaveState[u.i] === 0 &&
        sim.getUnit(u.id)!.kind === 'unit',
    );
    const slavers = fighters.filter(
      (u) => sim.config.unitTypes.find((t) => t.typeId === w.typeId[u.i])?.capture,
    );
    if (plan.allOutAt !== undefined && frame === plan.allOutAt) {
      // every fighter and the hero: nobody guards the slaves at home any more
      const hero = sim.ps.heroEnt[p]!;
      const ids = [
        ...fighters.filter((u) => !slavers.includes(u)).map((u) => u.id),
        ...(hero !== 0 ? [hero] : []),
      ];
      const at = hqOf(sim, enemy);
      if (ids.length > 0) add(p, 'AttackMove', { ids, x: at.x, y: at.y });
    }
    if (plan.toSettlementAt !== undefined && frame === plan.toSettlementAt) {
      // every fighter and the hero to the second settlement point at the own side (away from the camp)
      const hero = sim.ps.heroEnt[p]!;
      const ids = [
        ...fighters.filter((u) => !slavers.includes(u)).map((u) => u.id),
        ...(hero !== 0 ? [hero] : []),
      ];
      const pt = settlementPoint(sim, p, 1);
      if (ids.length > 0) add(p, 'AttackMove', { ids, x: pt.x + 512, y: pt.y });
    }
    if (frame % every !== 0) return;
    const scrap = sim.playerStatus(p).scrap;
    const builders = units.filter(
      (u) => w.slaveState[u.i] === SLAVE_SLAVE && w.role[u.i] === ROLE_BUILDER,
    );
    const idleBuilder = builders.find((u) => w.orderType(u.i) === ORDER_NONE);
    // claim the own settlement point
    if (
      !claimed &&
      plan.claimAt !== undefined &&
      plan.claimAt > 0 &&
      frame >= plan.claimAt &&
      idleBuilder
    ) {
      const pt = settlementPoint(sim, p);
      add(p, 'Claim', { ids: [idleBuilder.id], pointId: pt.id });
      claimed = true;
    } else if (built < plan.builds.length && idleBuilder) {
      const key = plan.builds[built]!;
      const bt = sim.config.buildingTypes.find((t) => t.typeId === buildingType(key))!;
      if (scrap >= bt.scrapCost) {
        const at = planner.find(p, key, 'hq');
        if (at !== null) add(p, 'Build', { ids: [idleBuilder.id], typeId: bt.typeId, ...at });
        built++;
      }
    }
    // research in order, as soon as it can be paid (and nothing is running)
    const status = sim.playerStatus(p);
    const done = new Set(status.techs);
    const busy = (status.queue ?? []).some((q) => q.kind === 'research');
    for (const key of plan.research) {
      const t = techOf(key);
      if (done.has(t)) continue;
      const cost = gameData().data.tech[t]!.scrapCost;
      if (!busy && scrap >= cost) add(p, 'Research', { techId: t });
      break;
    }
    // production
    const keep = plan.keep ?? 0;
    for (const b of [...buildingsOf(sim, p, 'tent'), ...buildingsOf(sim, p, 'autosloperij')]) {
      if (sim.queue(p).some((q) => q.buildingId === b) || plan.produce.length === 0) continue;
      const key = plan.produce[next % plan.produce.length]!;
      const l = gameData().data.loadouts.find((x) => x.key === key)!;
      if (scrap < l.scrapCost + keep || status.popCap - status.pop < l.popCost) break;
      if (!l.prereqTech.every((t) => done.has(t))) {
        next++;
        break;
      }
      add(p, 'Produce', { buildingId: b, loadoutId: l.id });
      next++;
      break;
    }
    // idle slaves gather at the node nearest the camp
    const home = hqOf(sim, p);
    const idleSlaves = units
      .filter((u) => w.slaveState[u.i] === SLAVE_SLAVE && w.role[u.i] === ROLE_SCAV)
      .filter((u) => w.orderType(u.i) === ORDER_NONE)
      .map((u) => u.id);
    if (idleSlaves.length > 0)
      add(p, 'Gather', { ids: idleSlaves, nodeId: nodeNear(sim, home.x, home.y) });
    // Slavers hunt: the nearest visible enemy settler outside his base radius, else walk to his far node
    if (plan.huntFrom !== undefined && plan.huntFrom > 0 && frame >= plan.huntFrom) {
      const rules = sim.config.factions[sim.players[p]!.factionId]!.slaves!;
      const ehq = hqOf(sim, enemy);
      for (const s of slavers) {
        const sx = w.x[s.i]!;
        const sy = w.y[s.i]!;
        let best = -1;
        let bestD = Infinity;
        for (const e of unitsOf(sim, enemy)) {
          if (((w.visTo[e.i]! >> p) & 1) === 0 || w.role[e.i] === ROLE_MILITIA) continue;
          if (Math.hypot(w.x[e.i]! - ehq.x, w.y[e.i]! - ehq.y) <= rules.minDistanceFromOwnerBase)
            continue;
          const d = Math.hypot(w.x[e.i]! - sx, w.y[e.i]! - sy);
          if (d < bestD) {
            best = e.id;
            bestD = d;
          }
        }
        if (best !== -1) {
          if (w.target[s.i] !== best) add(p, 'Attack', { ids: [s.id], target: best });
        } else if (w.orderType(s.i) === ORDER_NONE) {
          const n = nodeNear(
            sim,
            ehq.x,
            ehq.y,
            ehq.x,
            ehq.y,
            rules.minDistanceFromOwnerBase / 256 + 2,
          );
          const nu = sim.getUnit(n);
          if (nu !== null && Math.hypot(nu.x - sx, nu.y - sy) > 6 * 256)
            add(p, 'Move', { ids: [s.id], ...detour(sim, sx, sy, nu.x + 256, nu.y) });
        }
      }
    }
  };
}

/**
 * Creep camps (sim 0.19.0): a player walks a lone unit around a living bandit camp instead of past it. The next
 * waypoint on the shortest walk from (x, y) to (tx, ty) over walkable cells that keeps 10 m from every living camp
 * centre, `ahead` cells along it (4-neighbour BFS from the target, the same metric as the sim's terrain distances);
 * the target itself when that walk does not exist or is short.
 */
function detour(
  sim: Sim,
  x: number,
  y: number,
  tx: number,
  ty: number,
  ahead = 25,
): { x: number; y: number } {
  const { w, h, passable } = sim.map;
  const camps = (sim.map.creepCamps ?? []).filter((_, k) => sim.creeps.state[k] !== 3);
  if (camps.length === 0) return { x: tx, y: ty };
  const avoid = (cx: number, cy: number): boolean =>
    camps.some((c) => Math.hypot(cx + 0.5 - c.x / 256, cy + 0.5 - c.y / 256) < 10);
  const dist = new Int32Array(w * h).fill(-1);
  const t = (ty >> 8) * w + (tx >> 8);
  dist[t] = 0;
  const queue = [t];
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q]!;
    const cx = c % w;
    const cy = (c - cx) / w;
    for (const [nx, ny] of [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1],
    ] as const) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (dist[n] !== -1 || passable[n] !== 1 || avoid(nx, ny)) continue;
      dist[n] = dist[c]! + 1;
      queue.push(n);
    }
  }
  let c = (y >> 8) * w + (x >> 8);
  if (dist[c] === -1 || dist[c]! <= ahead) return { x: tx, y: ty };
  for (let k = 0; k < ahead; k++) {
    const cx = c % w;
    const cy = (c - cx) / w;
    let best = c;
    for (const n of [c + 1, c - 1, c + w, c - w]) {
      const nx = n % w;
      if (n < 0 || n >= w * h || Math.abs(nx - cx) > 1 || Math.abs((n - nx) / w - cy) > 1) continue;
      if (dist[n] !== -1 && dist[n]! < dist[best]!) best = n;
    }
    if (best === c) break;
    c = best;
  }
  const cx = c % w;
  return { x: cx * 256 + 128, y: ((c - cx) / w) * 256 + 128 };
}

export interface DwellerBaitPlan {
  /** The scavengers gather at the nearest node farther than this from the own headquarters (outside the base radius). */
  readonly farM: number;
  /** At this frame the militia and the hero walk to the Raiders' camp and free every slave they see (0 = never). */
  readonly liberateAt?: number;
  /** At this frame the militia and the hero attack-move to the Raiders' camp (0 = never). */
  readonly attackAt?: number;
}

/** A Dweller player that gathers far from home (bait for Slavers) and later frees slaves at the Raiders' camp. */
export function dwellerBaitBot(p: number, plan: DwellerBaitPlan, every = 10): Controller {
  const enemy = 1 - p;
  let sent = false;
  return (sim, frame, add) => {
    if (frame % every !== 0) return;
    const w = sim.world;
    const units = unitsOf(sim, p);
    const home = hqOf(sim, p);
    const idleScavs = units
      .filter((u) => w.role[u.i] === ROLE_SCAV && w.slaveState[u.i] === 0)
      .filter((u) => w.orderType(u.i) === ORDER_NONE)
      .map((u) => u.id);
    if (idleScavs.length > 0)
      add(p, 'Gather', {
        ids: idleScavs,
        nodeId: nodeNear(sim, home.x, home.y, home.x, home.y, plan.farM),
      });
    const army = units.filter((u) => w.role[u.i] === ROLE_MILITIA).map((u) => u.id);
    const heroes = sim
      .entityIds()
      .filter((id) => sim.getUnit(id)!.kind === 'hero' && sim.getUnit(id)!.owner === p);
    const camp = hqOf(sim, enemy);
    if (plan.attackAt !== undefined && plan.attackAt > 0 && frame >= plan.attackAt && !sent) {
      sent = true;
      if (army.length + heroes.length > 0)
        add(p, 'AttackMove', { ids: [...army, ...heroes], x: camp.x, y: camp.y });
    }
    if (plan.liberateAt === undefined || plan.liberateAt <= 0 || frame < plan.liberateAt) return;
    // every free unit of the army takes the nearest visible enemy slave or captive (Attack = walk up and touch)
    const bound = unitsOf(sim, enemy).filter(
      (u) =>
        (w.slaveState[u.i] === SLAVE_SLAVE || w.slaveState[u.i] === SLAVE_CAPTIVE) &&
        ((w.visTo[u.i]! >> p) & 1) !== 0,
    );
    for (const id of [...army, ...heroes]) {
      const i = w.resolve(id);
      if (bound.length === 0) {
        const to = { x: camp.x, y: camp.y + 25 * 256 };
        if (
          w.orderType(i) === ORDER_NONE &&
          !sent &&
          Math.hypot(w.x[i]! - to.x, w.y[i]! - to.y) > 6 * 256
        )
          add(p, 'Move', { ids: [id], ...to });
        continue;
      }
      let best = bound[0]!;
      let bestD = Infinity;
      for (const b of bound) {
        const d = Math.hypot(w.x[b.i]! - w.x[i]!, w.y[b.i]! - w.y[i]!);
        if (d < bestD) {
          best = b;
          bestD = d;
        }
      }
      if (w.target[i] !== best.id) add(p, 'Attack', { ids: [id], target: best.id });
    }
  };
}

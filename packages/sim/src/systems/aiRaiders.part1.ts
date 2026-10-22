// Split from aiRaiders.ts to stay under the 5,000-token file limit; aiRaiders.ts re-exports the public surface.
// Holds: ROLE_SCAVENGER, ROLE_BUILDER, ROLE_MILITIA, Tally, onMission, tally, +5 more.
import { ROLES } from '@crawlout/data';
import type { SimContext } from './common.js';
import { raidOver, type AiScratch, type Fields, findSite, chunks } from './ai.js';
import { sabotageOver } from './aiProject.js';
import { campAt, campAlive } from './creeps.js';
import {
  type SimAiScript,
  type SimRaidPlan,
  type SimBuildingType,
  AI_SITE_HQ,
  type SimSlaveRules,
} from '../config.js';
import {
  C,
  BSTATE_DONE,
  JOB_PRODUCE,
  BSTATE_SITE,
  SLAVE_SLAVE,
  ORDER_CRAFT,
  ORDER_NONE,
  SLAVE_NONE,
  ORDER_ATTACK_MOVE,
  ORDER_GATHER,
  ORDER_GUARD,
} from '../ecs/world.js';
import { DEPOT_MASK } from './orders.js';
import { type WorkReach, guardGroups, isOwnKooi } from './slaves.js';
import { applyCommand, canPlaceType } from './commands.js';
import { idiv, imod } from '../math/int.js';
import { hasTechs } from '../effects.js';
import { produceWorkers } from './aiWorkers.js';
import { produceGarde } from './aiGarde.js';

// System 2 (AI part) for a script with a raid plan (ai/raiders-basic.json, data 0.21.0; sim 0.18.0): the scripted
// Raider. No cheats, the same commands and fog of war as the Dweller AI (systems/ai.ts, whose helpers it uses), and
// every number from the script. Raiders never work: slaves gather and build within the work radius of their cage,
// fighters come new from the tents (Produce) and never retrain. Per tick, in this order:
//  1. the hero (revive, perk, Raid) and the threat at the own buildings (as the Dwellers);
//  2. the guards (sim 0.24.0, guardPosts): every post a slave group needs under the guard rule (systems/slaves.ts) gets
//     fighters in guard mode (the Guard command): a Kooi its cageGuards, a node without a Kooi near 1 per 5 slaves;
//     the headquarters at least raidPlan.garrison.minFighters. A guard goes on no wave, raid or escort; one that no
//     post needs any more is released;
//  3. tents when free beds run low (housingBuildingId, housingFreeBeds), then the build order (a slave builder builds
//     within its work radius: a site of the script outside it moves to the headquarters), then richBuilds;
//  4. research from researchFromTicks (the list in order), what is affordable now; with `reserve` (from fromTicks, with
//     at least minArmy fighters and no threat) the next research that only waits for scrap is saved for;
//  5. production in every idle own building that makes something: Slavers up to slaveRaids.slavers (from fromTicks),
//     buggies in the autosloperij up to harass.max (from fromTicks), else the next fighter of fighterMix (cyclic by
//     weight, PlayerState.aiMix; a type without its techs is skipped), from what is above the reserve;
//  6. claims with a slave builder (claimNext, with an escort of free fighters for a far point), builders help at a site,
//     slaves gather at a node within their reach (exclusive nodes first, then the shortest trip), and SetRole makes
//     slave builders up to `builders` at a cage;
//  7. the slave raid: from slaveRaids.fromTicks, while none is out and retryTicks have passed, the free Slavers go to
//     the enemy node nearest his spawn outside his base radius (map knowledge) and up to `escort` free fighters screen
//     them on the way from there to his spawn; maxRaidTicks after they got there (or without Slavers) they come back;
//  8. harass: healthy free buggies go to that node too; a buggy under retreatHpPermille comes home;
//  9. waves as the Dwellers (attackTimers, waveInterval, waveMinArmy and growth, a push from pushFromTicks with
//     pushMinArmy, a raid on an enemy claim point while he holds enough for dominance; else the wave lapses); from dominancePush.fromTicks with at least minArmy free fighters the army camps
//     at the claim point nearest home that is not its own (the hero claims it there, a slave builder puts a plunderpost
//     there, the fighters take a beacon over or raze a post); while p holds enough points for dominance the army camps
//     at its own point nearest the enemy instead (sim 0.19.0);
// 10. defend against a threat (also an enemy the army sees within defendRadius of its camp, sim 0.19.0), else rally
//     (rallySite) as the Dwellers.

const ROLE_SCAVENGER = ROLES.indexOf('scavenger');

const ROLE_BUILDER = ROLES.indexOf('builder');

const ROLE_MILITIA = ROLES.indexOf('militia');

const ROLE_TECHNICIAN = ROLES.indexOf('technician');

/** The units and buildings of a Raider player this tick. */
export interface Tally {
  readonly builders: number[];
  readonly idleBuilders: number[];
  readonly scavs: number[];
  readonly idleScavs: number[];
  /** Fighters without Slavers and buggies. */
  readonly army: number[];
  readonly idleArmy: number[];
  readonly slavers: number[];
  readonly idleSlavers: number[];
  readonly buggies: number[];
  readonly idleBuggies: number[];
  /**
   * Data 0.43.0 (the Garde, raidPlan support): technicians (the Klerk). No fighters: they never count for a wave, a
   * push or the reserve. Empty for a faction without a technician loadout.
   */
  readonly techs: number[];
  readonly idleTechs: number[];
  /** Data 0.43.0 (the Garde, raidPlan airlift): own transports. No fighters either (systems/aiGarde.ts). */
  readonly transports: number[];
  /** Completed own buildings without work (research or job), ascending: where Produce and Research can go. */
  readonly idleBuildings: number[];
  readonly depots: number[];
  buildersPlanned: number;
  /** Free scavengers in production (data 0.38.0). */
  scavsPlanned: number;
  producingSlavers: number;
  producingBuggies: number;
  /** Data 0.43.0 (the Garde): technicians and transports in production. */
  producingTechs: number;
  producingTransports: number;
  site: number;
  housingSite: boolean;
}

/**
 * Whether fighter i of p (on an AttackMove) is on a mission: a push (to an enemy spawn) or a raid on a claim point that
 * an enemy still holds. Anything else (the rally point, the dominance camp, home, an escort after its raid) is free:
 * such a unit may go on the next wave.
 */
function onMission(ctx: SimContext, p: number, i: number): boolean {
  const w = ctx.world;
  const o = w.currentOrder(i);
  const x = w.ordX[o]!;
  const y = w.ordY[o]!;
  for (let q = 0; q < ctx.playerCount; q++) {
    const sp = ctx.map.spawns[q]!;
    if (q !== p && sp.x === x && sp.y === y) return true;
  }
  for (const pt of ctx.claimPoints) if (w.x[pt] === x && w.y[pt] === y) return !raidOver(ctx, p, i);
  // a sabotage run (win route C, sim 0.25.0) until the part is no opponent's any more
  const part = sabotageOver(ctx, p, x, y);
  if (part !== null) return !part;
  // a creep run (sim 0.20.0) until its camp is cleared
  const camp = campAt(ctx, x, y);
  return camp >= 0 && campAlive(ctx, camp);
}

export function tally(
  ctx: SimContext,
  p: number,
  script: SimAiScript,
  plan: SimRaidPlan,
  scratch: AiScratch,
): Tally {
  const w = ctx.world;
  const t: Tally = {
    builders: [],
    idleBuilders: [],
    scavs: [],
    idleScavs: [],
    army: [],
    idleArmy: [],
    slavers: [],
    idleSlavers: [],
    buggies: [],
    idleBuggies: [],
    techs: [],
    idleTechs: [],
    transports: [],
    idleBuildings: [],
    depots: [],
    buildersPlanned: 0,
    scavsPlanned: 0,
    producingSlavers: 0,
    producingBuggies: 0,
    producingTechs: 0,
    producingTransports: 0,
    site: -1,
    housingSite: false,
  };
  const load = scratch.nodeLoad;
  const slaverType = plan.slaveRaids?.slaverTypeId ?? -1;
  const buggyType = plan.harass?.typeId ?? -1;
  // data 0.43.0 (the Garde): the Klerk and the Vertibird of the script; -1 for a script without them
  const techType = plan.support?.typeId ?? -1;
  const transportType = plan.airlift?.typeId ?? -1;
  // data 0.38.0 (sim 0.32.0): a faction without slaves (raidPlan workers) works with free builders and scavengers
  const freeWorkers = plan.workers !== null;
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] !== 1) continue;
    if (w.has(i, C.resource)) {
      load[i] = 0;
      continue;
    }
    if (w.owner[i] !== p) continue;
    if (w.has(i, C.building)) {
      const bt = ctx.buildingType(w.typeId[i]!);
      if (w.bstate[i] === BSTATE_DONE) {
        if (bt !== undefined && (bt.provides & DEPOT_MASK) !== 0) t.depots.push(i);
        if (w.job[i] === 0 && w.research[i] === 0 && w.hp[i]! > 0) t.idleBuildings.push(i);
        if (w.jobKind[i] === JOB_PRODUCE && w.job[i] !== 0) {
          if (w.job[i] === slaverType) t.producingSlavers++;
          else if (w.job[i] === buggyType) t.producingBuggies++;
          else if (w.job[i] === techType) t.producingTechs++;
          else if (w.job[i] === transportType) t.producingTransports++;
          else if (freeWorkers) {
            // data 0.38.0 (the Garde): free workers in production count as planned
            const role = ctx.unitType(w.job[i]!)?.role;
            if (role === ROLE_BUILDER) t.buildersPlanned++;
            else if (role === ROLE_SCAVENGER) t.scavsPlanned++;
          }
        }
      } else if (w.bstate[i] === BSTATE_SITE) {
        if (t.site < 0) t.site = i;
        if (w.typeId[i] === script.housingTypeId) t.housingSite = true;
      }
      continue;
    }
    if (!w.has(i, C.unit | C.orders | C.health) || w.has(i, C.hero)) continue;
    const st = w.slaveState[i]!;
    const ord = w.orderType(i);
    const id = w.idOf(i);
    const freeWorker =
      freeWorkers &&
      st === SLAVE_NONE &&
      (w.role[i] === ROLE_BUILDER || w.role[i] === ROLE_SCAVENGER);
    if (st === SLAVE_SLAVE || freeWorker) {
      if (ord === ORDER_CRAFT) {
        if (ctx.unitType(w.ordX[w.currentOrder(i)]!)?.role === ROLE_BUILDER) t.buildersPlanned++;
        continue;
      }
      if (w.role[i] === ROLE_BUILDER) {
        t.builders.push(id);
        if (ord === ORDER_NONE) t.idleBuilders.push(id);
      } else if (w.role[i] === ROLE_SCAVENGER) {
        t.scavs.push(id);
        if (ord === ORDER_NONE) t.idleScavs.push(id);
      }
      continue;
    }
    // data 0.43.0 (the Garde, raidPlan support): a technician (the Klerk) is no worker and no fighter; a free one goes
    // with a wave or the defence (systems/aiGarde.ts), an idle one repairs where it stands (orders.part2.ts)
    if (st === SLAVE_NONE && w.role[i] === ROLE_TECHNICIAN) {
      t.techs.push(id);
      if (ord === ORDER_NONE || (ord === ORDER_ATTACK_MOVE && !onMission(ctx, p, i)))
        t.idleTechs.push(id);
      continue;
    }
    if (st !== SLAVE_NONE || w.role[i] !== ROLE_MILITIA) continue;
    const idle = ord === ORDER_NONE || (ord === ORDER_ATTACK_MOVE && !onMission(ctx, p, i));
    if (ctx.unitType(w.typeId[i]!)?.transport != null) {
      // data 0.43.0 (the Garde, raidPlan airlift): a transport is logistics, never a fighter. A loaded one that is shot
      // down takes its cargo with it, so it is never counted into a wave and never sent at the enemy.
      t.transports.push(id);
    } else if (ctx.unitType(w.typeId[i]!)?.capture != null) {
      t.slavers.push(id);
      if (idle) t.idleSlavers.push(id);
    } else if (w.typeId[i] === buggyType) {
      t.buggies.push(id);
      if (idle) t.idleBuggies.push(id);
    } else {
      t.army.push(id);
      if (idle) t.idleArmy.push(id);
    }
  }
  for (const id of t.scavs) {
    const i = w.resolve(id);
    if (w.orderType(i) !== ORDER_GATHER) continue;
    const n = w.resolve(w.ordT[w.currentOrder(i)]!);
    if (n >= 0 && w.has(n, C.resource)) load[n] = load[n]! + 1;
  }
  return t;
}

/** A slave builder `builder` puts building bt at a spot for `site` within its reach (else at the headquarters). */
export function build(
  ctx: SimContext,
  p: number,
  hq: number,
  bt: SimBuildingType,
  site: number,
  fields: Fields,
  builder: number,
  reach: WorkReach | null,
): boolean {
  let at = findSite(ctx, p, hq, bt, site, fields, reach);
  if (at === null && site !== AI_SITE_HQ) at = findSite(ctx, p, hq, bt, AI_SITE_HQ, fields, reach);
  if (at === null) return false;
  return applyCommand(ctx, {
    playerId: p,
    seq: 0,
    type: 'Build',
    payload: { ids: [builder], typeId: bt.typeId, x: at.x, y: at.y },
  });
}

/** As richBuild in ai.ts: the first rich build of which there are too few and that can be paid now, or -1. */
export function richBuild(ctx: SimContext, p: number, script: SimAiScript): number {
  const w = ctx.world;
  for (let k = 0; k < script.richBuilds.length; k++) {
    const tid = script.richBuilds[k]!.typeId;
    let want = 0;
    for (let q = 0; q <= k; q++) if (script.richBuilds[q]!.typeId === tid) want++;
    let have = 0;
    for (let i = 0; i < w.highWater; i++)
      if (w.alive[i] === 1 && w.owner[i] === p && w.has(i, C.building) && w.typeId[i] === tid)
        have++;
    if (have >= want) continue;
    const bt = ctx.buildingType(tid);
    if (bt === undefined || !canPlaceType(ctx, p, tid) || ctx.ps.scrap[p]! < bt.scrapCost)
      return -1;
    return k;
  }
  return -1;
}

/**
 * The guards (sim 0.24.0; the guard rule of systems/slaves.ts, instead of the old garrison per Kooi): every post that a
 * slave group needs gets fighters in guard mode (the Guard command): the Kooi of a Kooi group cageGuards, the node of a
 * node group ceil(slaves / guardModeSlavesPerGuard) (guard mode on the node asks the least); the headquarters (the
 * Raiderkamp is a Kooi) at least raidPlan.garrison.minFighters, its home guard. Idle fighters (then idle buggies)
 * nearest the post go; a guard that no post needs any more is released with Stop (the last ones first). Returns the ids
 * sent this tick (they are still in the tally's idle lists).
 */
export function guardPosts(
  ctx: SimContext,
  p: number,
  hq: number,
  plan: SimRaidPlan,
  rules: SimSlaveRules,
  t: Tally,
): number[] {
  const w = ctx.world;
  const posts: number[] = [];
  const need: number[] = [];
  const want = (post: number, n: number): void => {
    const k = posts.indexOf(post);
    if (k < 0) {
      posts.push(post);
      need.push(n);
    } else if (need[k]! < n) need[k] = n;
  };
  for (const g of guardGroups(ctx, p, ROLE_MILITIA)) {
    const n = g.members.length;
    want(
      g.target,
      g.kooi
        ? rules.cageGuards
        : idiv(n + rules.guardModeSlavesPerGuard - 1, rules.guardModeSlavesPerGuard),
    );
  }
  if (hq >= 0 && isOwnKooi(ctx, p, hq)) want(hq, plan.garrisonMinFighters);
  // the guards there now, ascending index
  const on: number[][] = posts.map(() => []);
  const release: number[] = [];
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] !== 1 || w.owner[i] !== p || w.orderType(i) !== ORDER_GUARD) continue;
    if (!w.has(i, C.unit | C.health) || w.has(i, C.hero)) continue;
    const post = w.resolve(w.ordT[w.currentOrder(i)]!);
    const k = post < 0 ? -1 : posts.indexOf(post);
    if (k < 0) release.push(w.idOf(i));
    else on[k]!.push(w.idOf(i));
  }
  const idle = [...t.idleArmy, ...t.idleBuggies];
  const sent: number[] = [];
  for (let k = 0; k < posts.length; k++) {
    const b = posts[k]!;
    const have = on[k]!;
    // too many: the last ones go
    while (have.length > need[k]!) release.push(have.pop()!);
    const call: number[] = [];
    for (let n = have.length; n < need[k]!; n++) {
      let best = -1;
      let bestD = 0;
      for (const gid of idle) {
        if (sent.includes(gid)) continue;
        const i = w.resolve(gid);
        const dx = w.x[i]! - w.x[b]!;
        const dy = w.y[i]! - w.y[b]!;
        const d = dx * dx + dy * dy;
        if (best < 0 || d < bestD) {
          best = gid;
          bestD = d;
        }
      }
      if (best < 0) break;
      sent.push(best);
      call.push(best);
    }
    if (call.length > 0)
      applyCommand(ctx, {
        playerId: p,
        seq: 0,
        type: 'Guard',
        payload: { ids: call, targetId: w.idOf(b) },
      });
  }
  for (const part of chunks(release))
    applyCommand(ctx, { playerId: p, seq: 0, type: 'Stop', payload: { ids: part } });
  return sent;
}

/** The weighted fighter mix as a flat cycle of type ids. */
function mixCycle(plan: SimRaidPlan): number[] {
  const out: number[] = [];
  for (const m of plan.fighterMix) for (let k = 0; k < m.weight; k++) out.push(m.typeId);
  return out;
}

/** Step 5: Produce in every idle own building that makes the next unit (see the top of this file). */
export function produce(
  ctx: SimContext,
  p: number,
  plan: SimRaidPlan,
  t: Tally,
  reserve: number,
  builders: number,
): void {
  const w = ctx.world;
  const ps = ctx.ps;
  const tick = ctx.frame;
  const cycle = mixCycle(plan);
  // data 0.38.0 (the Garde): free workers first, each from a building that makes them
  const used: number[] = [];
  if (plan.workers !== null && !produceWorkers(ctx, p, plan.workers, builders, t, used)) return;
  // data 0.43.0 (the Garde): the Klerks and the Vertibird come before the fighter mix, and the mix leaves the price of
  // a transport it is saving for alone (systems/aiGarde.ts)
  const keep = reserve + produceGarde(ctx, p, plan, t, used, reserve);
  let slavers = t.slavers.length + t.producingSlavers;
  let buggies = t.buggies.length + t.producingBuggies;
  const sr = plan.slaveRaids;
  const hr = plan.harass;
  // three passes in priority order: Slavers, buggies, the fighter mix; a pick that waits for scrap keeps it for itself
  for (let pass = 0; pass < 3; pass++) {
    for (const b of t.idleBuildings) {
      if (used.includes(b)) continue;
      const bt = w.typeId[b]!;
      const can = (typeId: number): boolean => {
        const u = ctx.unitType(typeId);
        return u !== undefined && u.producedAtTypeId === bt && hasTechs(ctx, p, u.prereqTech);
      };
      let pick = 0;
      let step = -1;
      if (pass === 0) {
        if (sr !== null && tick >= sr.fromTicks && slavers < sr.slavers && can(sr.slaverTypeId))
          pick = sr.slaverTypeId;
      } else if (pass === 1) {
        if (hr !== null && tick >= hr.fromTicks && buggies < hr.max && can(hr.typeId))
          pick = hr.typeId;
      } else {
        for (let k = 0; k < cycle.length; k++) {
          const typeId = cycle[imod(ps.aiMix[p]! + k, cycle.length)]!;
          // data 0.38.0 (raidPlan mixInOrder): the next fighter with its techs is made where it is made; until then
          // this building waits (a cheap Initiate does not take the beds a frame needs)
          if (plan.mixInOrder && !hasTechs(ctx, p, ctx.unitType(typeId)?.prereqTech ?? []))
            continue;
          if (!can(typeId)) {
            if (plan.mixInOrder) break;
            continue;
          }
          pick = typeId;
          step = k;
          break;
        }
      }
      if (pick === 0) continue;
      const u = ctx.unitType(pick)!;
      if (ps.scrap[p]! < u.scrapCost + keep) return;
      used.push(b);
      if (
        !applyCommand(ctx, {
          playerId: p,
          seq: 0,
          type: 'Produce',
          payload: { buildingId: w.idOf(b), loadoutId: u.loadoutId },
        })
      )
        continue;
      if (pick === sr?.slaverTypeId) slavers++;
      else if (pick === hr?.typeId) buggies++;
      if (step >= 0) ps.aiMix[p] = imod(ps.aiMix[p]! + step + 1, cycle.length);
    }
  }
}

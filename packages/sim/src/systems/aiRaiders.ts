import { ROLES } from '@crawlout/data';
import type { SimAiScript, SimBuildingType, SimRaidPlan, SimSlaveRules } from '../config.js';
import { AI_SITE_FRONT, AI_SITE_HQ } from '../config.js';
import { HERO_DEAD, hasTechs, heroOf } from '../effects.js';
import {
  BSTATE_DONE,
  BSTATE_SITE,
  C,
  JOB_PRODUCE,
  ORDER_ATTACK_MOVE,
  ORDER_CRAFT,
  ORDER_GATHER,
  ORDER_GUARD,
  ORDER_NONE,
  SLAVE_NONE,
  SLAVE_SLAVE,
} from '../ecs/world.js';
import { PROVIDES_HQ } from '../fromData.js';
import { idiv, imod } from '../math/int.js';
import { TERRAIN_UNREACHABLE } from '../pathdist.js';
import type { Census } from './census.js';
import { applyCommand, canPlaceType } from './commands.js';
import type { SimContext } from './common.js';
import { distToRect2, nodeAllowed, visibleTo } from './common.js';
import { heroIndex } from './hero.js';
import { DEPOT_MASK } from './orders.js';
import type { AiScratch, Fields } from './ai.js';
import {
  ESCORT_OFFSET,
  RESEARCH_IMPOSSIBLE,
  chunks,
  claimAt,
  claimNext,
  enemyOf,
  exclusiveFor,
  fieldOf,
  findSite,
  findThreat,
  heroClaimNear,
  heroThink,
  ownClaimNear,
  raidOver,
  rallyCell,
  researchFor,
  stepAlong,
  waveReady,
} from './ai.js';
import type { WorkReach } from './slaves.js';
import { guardGroups, isOwnKooi, workReach } from './slaves.js';
import { aiCreepRun, campAlive, campAt } from './creeps.js';
import { pointsOf } from './claims.js';

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

/** The units and buildings of a Raider player this tick. */
interface Tally {
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
  /** Completed own buildings without work (research or job), ascending: where Produce and Research can go. */
  readonly idleBuildings: number[];
  readonly depots: number[];
  buildersPlanned: number;
  producingSlavers: number;
  producingBuggies: number;
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
  // a creep run (sim 0.20.0) until its camp is cleared
  const camp = campAt(ctx, x, y);
  return camp >= 0 && campAlive(ctx, camp);
}

function tally(
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
    idleBuildings: [],
    depots: [],
    buildersPlanned: 0,
    producingSlavers: 0,
    producingBuggies: 0,
    site: -1,
    housingSite: false,
  };
  const load = scratch.nodeLoad;
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
          if (w.job[i] === plan.slaveRaids.slaverTypeId) t.producingSlavers++;
          else if (w.job[i] === plan.harass.typeId) t.producingBuggies++;
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
    if (st === SLAVE_SLAVE) {
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
    if (st !== SLAVE_NONE || w.role[i] !== ROLE_MILITIA) continue;
    const idle = ord === ORDER_NONE || (ord === ORDER_ATTACK_MOVE && !onMission(ctx, p, i));
    if (ctx.unitType(w.typeId[i]!)?.capture != null) {
      t.slavers.push(id);
      if (idle) t.idleSlavers.push(id);
    } else if (w.typeId[i] === plan.harass.typeId) {
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

export function raiderThink(
  ctx: SimContext,
  census: Census,
  scratch: AiScratch,
  p: number,
  script: SimAiScript,
  plan: SimRaidPlan,
): void {
  const w = ctx.world;
  const ps = ctx.ps;
  const tick = ctx.frame;
  const hq = census.hq[p]!;
  const factionId = ctx.players[p]!.factionId;
  const rules = ctx.config.factions[factionId]!.slaves;
  const enemy = enemyOf(ctx, p);
  const enemySpawn = enemy < 0 ? null : ctx.map.spawns[enemy]!;
  const fields: Fields | null =
    hq < 0
      ? null
      : {
          home: fieldOf(ctx, hq),
          enemy: enemySpawn === null ? null : ctx.terrainDist.fieldAt(enemySpawn.x, enemySpawn.y),
          enemyCx: enemySpawn === null ? 0 : enemySpawn.x >> 8,
          enemyCy: enemySpawn === null ? 0 : enemySpawn.y >> 8,
        };
  if (ps.aiClaimAt[p] === 0 && tick >= script.claimFarFromTicks)
    ps.aiClaimAt[p] =
      tick + (script.waveJitterTicks > 0 ? ctx.rng.nextInt(script.waveJitterTicks + 1) : 0) + 1;

  const t = tally(ctx, p, script, plan, scratch);

  // 1 the hero and the threat
  heroThink(ctx, p, hq);
  const hero = heroIndex(ctx, p);
  const heroId = hero < 0 ? -1 : w.idOf(hero);
  let nodes = 0;
  const idx = ctx.index;
  idx.refresh(w);
  for (let k = 0; k < idx.nodeCount; k++) {
    const j = idx.nodes[k]!;
    if (w.amount[j]! > 0 && nodeAllowed(ctx, j, p)) nodes++;
  }
  const h = heroOf(ctx, p);
  const heroWaits =
    hq >= 0 &&
    h !== undefined &&
    ps.heroState[p] === HERO_DEAD &&
    (nodes > 0 || ps.scrap[p]! >= h.reviveScrap);
  const threat = hq >= 0 ? findThreat(ctx, scratch, p, hq, script.defendRadius) : -1;

  // 2 the guards
  const guards = fields === null || rules === null ? [] : guardPosts(ctx, p, hq, plan, rules, t);
  const free = t.idleArmy.filter((id) => !guards.includes(id));

  let saving = heroWaits;
  let reserve = 0;

  // 3 tents, build order, rich builds
  const reachOf = (id: number | undefined): WorkReach | null =>
    id === undefined ? null : workReach(ctx, w.resolve(id));
  const popCap = census.popCap(ctx, p);
  const hbt = script.housingTypeId === 0 ? undefined : ctx.buildingType(script.housingTypeId);
  if (
    !saving &&
    fields !== null &&
    hbt !== undefined &&
    !t.housingSite &&
    census.beds[p]! < ctx.config.popCapMax &&
    popCap - census.pop[p]! <= script.housingFreeBeds &&
    canPlaceType(ctx, p, hbt.typeId) &&
    ps.scrap[p]! >= hbt.scrapCost &&
    t.idleBuilders.length > 0
  ) {
    if (build(ctx, p, hq, hbt, AI_SITE_HQ, fields, t.idleBuilders[0]!, reachOf(t.idleBuilders[0])))
      t.idleBuilders.shift();
  }
  const order = script.buildOrder;
  let bi = ps.aiBuild[p]!;
  while (!saving && fields !== null && bi < order.length && tick >= order[bi]!.atTick) {
    const bt = ctx.buildingType(order[bi]!.typeId);
    if (bt === undefined || bt.factionId !== factionId || (bt.provides & PROVIDES_HQ) !== 0) {
      bi++;
      continue;
    }
    if (!hasTechs(ctx, p, bt.prereqTech)) {
      const r = researchFor(ctx, p, bt.prereqTech);
      if (r.techId === RESEARCH_IMPOSSIBLE) {
        bi++;
        continue;
      }
      if (r.techId >= 0)
        applyCommand(ctx, { playerId: p, seq: 0, type: 'Research', payload: { techId: r.techId } });
      else {
        saving = true;
        reserve = r.cost;
      }
      break;
    }
    if (ps.scrap[p]! < bt.scrapCost) {
      saving = true;
      reserve = bt.scrapCost;
      break;
    }
    const builder = t.idleBuilders[0];
    if (builder === undefined) break;
    const site = order[bi]!.site ?? AI_SITE_HQ;
    if (build(ctx, p, hq, bt, site, fields, builder, reachOf(builder))) t.idleBuilders.shift();
    // placed, or no spot within reach anywhere: on to the next order either way
    bi++;
    break;
  }
  ps.aiBuild[p] = bi;
  if (
    !saving &&
    fields !== null &&
    bi >= order.length &&
    t.site < 0 &&
    ps.scrap[p]! >= script.richScrap &&
    t.idleBuilders.length > 0
  ) {
    const rb = richBuild(ctx, p, script);
    if (rb >= 0) {
      const o = script.richBuilds[rb]!;
      const bt = ctx.buildingType(o.typeId)!;
      if (build(ctx, p, hq, bt, o.site, fields, t.idleBuilders[0]!, reachOf(t.idleBuilders[0])))
        t.idleBuilders.shift();
    }
  }

  // 4 research (the reserve: the next research that only waits for scrap, with an army and no threat)
  // the reserve as the Dwellers', but only a threat at the headquarters stops it: the Raiders' plunderposts stand at
  // contested points far away, and a fight there must not stop the tech
  const homeThreat =
    threat >= 0 &&
    distToRect2(w.x[threat]!, w.y[threat]!, w.fx[hq]!, w.fy[hq]!, w.fw[hq]!, w.fh[hq]!) <=
      script.defendRadius * script.defendRadius;
  const reserveOn =
    script.reserve !== null &&
    tick >= script.reserve.fromTicks &&
    t.army.length >= script.reserve.minArmy &&
    !homeThreat;
  if (!saving && tick >= script.researchFromTicks) {
    for (const techId of script.research) {
      if (hasTechs(ctx, p, [techId])) continue;
      const r = researchFor(ctx, p, [techId], reserve);
      if (r.techId === RESEARCH_IMPOSSIBLE) continue;
      if (r.techId >= 0)
        applyCommand(ctx, { playerId: p, seq: 0, type: 'Research', payload: { techId: r.techId } });
      else if (reserveOn && reserve === 0) reserve = r.cost;
      break;
    }
  }

  // 5 production
  if (!heroWaits) produce(ctx, p, plan, t, reserve);

  // 6 claims, building help, gathering, slave builders
  if (!saving && fields !== null && tick >= script.claimFromTicks && t.idleBuilders.length > 0) {
    if (claimNext(ctx, p, t.idleBuilders[0]!, script, free, fields)) t.idleBuilders.shift();
  }
  if (t.site >= 0 && t.idleBuilders.length > 0)
    applyCommand(ctx, {
      playerId: p,
      seq: 0,
      type: 'Build',
      payload: {
        ids: t.idleBuilders,
        typeId: w.typeId[t.site]!,
        x: w.x[t.site]!,
        y: w.y[t.site]!,
      },
    });
  gatherIdle(ctx, p, script, t, scratch);
  if (t.builders.length + t.buildersPlanned < script.builders && t.scavs.length > 1) {
    const pick =
      t.idleScavs.length > 0 ? t.idleScavs[t.idleScavs.length - 1] : t.scavs[t.scavs.length - 1];
    applyCommand(ctx, {
      playerId: p,
      seq: 0,
      type: 'SetRole',
      payload: { ids: [pick!], role: 'builder' },
    });
  }

  if (fields === null || enemy < 0 || enemySpawn === null) {
    rally(ctx, p, hq, script, fields, threat, free, heroId, hero);
    return;
  }

  // 7 the slave raid, 8 harass
  const spot = rules === null ? -1 : raidSpot(ctx, enemy, rules, fields);
  slaveRaid(ctx, p, plan, t, free, spot, hq, fields);
  harass(ctx, p, plan, t, spot, hq, fields);

  // 9 waves and the dominance push (the hero goes along)
  const wave = waveReady(ctx, p, script, enemy, free.length, nodes, hq);
  if (wave !== null) {
    const k = ps.aiAttack[p]!;
    // as the Dwellers: a push on the headquarters, or, while the enemy holds enough points for dominance, a raid on one
    // of his claim points; else the wave lapses (measured: waves at his workers before the push starved the Dwellers
    // and every match went to the Raiders by minute 24, packages/sim/CHANGELOG.md 0.18.0)
    let target: { x: number; y: number } | null = null;
    const pt = wave.raidPt;
    if (wave.push) target = enemySpawn;
    else if (pt >= 0) target = { x: w.x[pt]!, y: w.y[pt]! };
    const jitter = script.waveJitterTicks > 0 ? ctx.rng.nextInt(script.waveJitterTicks + 1) : 0;
    ps.aiAttack[p] = k + 1;
    ps.aiWaveAt[p] = tick + script.waveIntervalTicks + jitter;
    if (target !== null) {
      const send = [...free];
      if (heroId >= 0) send.push(heroId);
      if (pt >= 0 && t.idleBuilders.length > 0) claimAt(ctx, p, t.idleBuilders[0]!, pt);
      attackMove(ctx, p, send, target.x, target.y);
      return;
    }
  }
  // creep camps (sim 0.20.0, ai/*.json creeps): without a threat, a big enough free army clears the nearest camp
  if (
    threat < 0 &&
    aiCreepRun(
      ctx,
      p,
      script,
      fields.home,
      free,
      heroId >= 0 && w.orderType(hero) === ORDER_NONE ? heroId : -1,
    )
  )
    return;
  const push = tick >= plan.dominancePush.fromTicks ? dominanceTarget(ctx, p, fields) : -1;
  rally(
    ctx,
    p,
    hq,
    script,
    fields,
    threat,
    free,
    heroId,
    hero,
    push >= 0 && free.length >= plan.dominancePush.minArmy ? push : -1,
  );
}

/** A slave builder `builder` puts building bt at a spot for `site` within its reach (else at the headquarters). */
function build(
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
function richBuild(ctx: SimContext, p: number, script: SimAiScript): number {
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
function guardPosts(
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
function produce(ctx: SimContext, p: number, plan: SimRaidPlan, t: Tally, reserve: number): void {
  const w = ctx.world;
  const ps = ctx.ps;
  const tick = ctx.frame;
  const cycle = mixCycle(plan);
  let slavers = t.slavers.length + t.producingSlavers;
  let buggies = t.buggies.length + t.producingBuggies;
  const used: number[] = [];
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
        if (
          tick >= plan.slaveRaids.fromTicks &&
          slavers < plan.slaveRaids.slavers &&
          can(plan.slaveRaids.slaverTypeId)
        )
          pick = plan.slaveRaids.slaverTypeId;
      } else if (pass === 1) {
        if (tick >= plan.harass.fromTicks && buggies < plan.harass.max && can(plan.harass.typeId))
          pick = plan.harass.typeId;
      } else {
        for (let k = 0; k < cycle.length; k++) {
          const typeId = cycle[imod(ps.aiMix[p]! + k, cycle.length)]!;
          if (!can(typeId)) continue;
          pick = typeId;
          step = k;
          break;
        }
      }
      if (pick === 0) continue;
      const u = ctx.unitType(pick)!;
      if (ps.scrap[p]! < u.scrapCost + reserve) return;
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
      if (pick === plan.slaveRaids.slaverTypeId) slavers++;
      else if (pick === plan.harass.typeId) buggies++;
      if (step >= 0) ps.aiMix[p] = imod(ps.aiMix[p]! + step + 1, cycle.length);
    }
  }
}

/** Step 6: idle slaves to a node within their reach with room (exclusive first, then the shortest trip). */
function gatherIdle(
  ctx: SimContext,
  p: number,
  script: SimAiScript,
  t: Tally,
  scratch: AiScratch,
): void {
  if (t.idleScavs.length === 0) return;
  const w = ctx.world;
  const idx = ctx.index;
  const load = scratch.nodeLoad;
  const cost = scratch.nodeCost;
  for (let k = 0; k < idx.nodeCount; k++) {
    const j = idx.nodes[k]!;
    let c = TERRAIN_UNREACHABLE;
    for (const dep of t.depots) {
      const d = ctx.terrainDist.at(fieldOf(ctx, dep), w.x[j]!, w.y[j]!);
      if (d < c) c = d;
    }
    cost[j] = c;
  }
  for (const id of t.idleScavs) {
    const reach = workReach(ctx, w.resolve(id));
    if (reach !== null && reach.r < 0) continue;
    let best = -1;
    let bestEx = false;
    let bestD = 0;
    let any = -1;
    let anyD = 0;
    for (let k = 0; k < idx.nodeCount; k++) {
      const j = idx.nodes[k]!;
      if (w.amount[j]! <= 0 || cost[j] === TERRAIN_UNREACHABLE || !nodeAllowed(ctx, j, p)) continue;
      if (reach !== null) {
        const dx = w.x[j]! - reach.x;
        const dy = w.y[j]! - reach.y;
        if (dx * dx + dy * dy > reach.r * reach.r) continue;
      }
      const d = cost[j]!;
      if (any < 0 || d < anyD) {
        any = j;
        anyD = d;
      }
      if (load[j]! >= script.scavengersPerNode) continue;
      const ex = exclusiveFor(ctx, j, p);
      if (best < 0 || (ex && !bestEx) || (ex === bestEx && d < bestD)) {
        best = j;
        bestEx = ex;
        bestD = d;
      }
    }
    if (best < 0) best = any;
    if (best < 0) continue;
    load[best] = load[best]! + 1;
    applyCommand(ctx, {
      playerId: p,
      seq: 0,
      type: 'Gather',
      payload: { ids: [id], nodeId: w.idOf(best) },
    });
  }
}

/**
 * Where the Raiders rob and harass, outside the enemy's base radius (minDistanceFromOwnerBase from each of his
 * headquarters) and with scrap (map knowledge): a node exclusive to him (near one of his claim points: his workers go
 * there first), else any node, each the nearest his spawn over land; -1 without one. Sim 0.19.0: nearest his spawn
 * also for his exclusive nodes (was: nearest home, which is his front claim point where his army gathers; no catch in
 * 66 matches).
 */
function raidSpot(ctx: SimContext, enemy: number, rules: SimSlaveRules, fields: Fields): number {
  if (fields.enemy === null) return -1;
  const w = ctx.world;
  const idx = ctx.index;
  idx.refresh(w);
  const r = rules.minDistanceFromOwnerBase;
  let best = -1;
  let bestD = 0;
  let bestEx = false;
  for (let k = 0; k < idx.nodeCount; k++) {
    const j = idx.nodes[k]!;
    if (w.amount[j]! <= 0) continue;
    if (ctx.terrainDist.at(fields.home, w.x[j]!, w.y[j]!) === TERRAIN_UNREACHABLE) continue;
    let inBase = false;
    for (let q = 0; q < idx.buildingCount && !inBase; q++) {
      const b = idx.buildings[q]!;
      if (w.owner[b] !== enemy) continue;
      const bt = ctx.buildingType(w.typeId[b]!);
      if (bt === undefined || (bt.provides & PROVIDES_HQ) === 0) continue;
      const dx = w.x[j]! - w.x[b]!;
      const dy = w.y[j]! - w.y[b]!;
      if (dx * dx + dy * dy <= r * r) inBase = true;
    }
    if (inBase) continue;
    const ex = exclusiveFor(ctx, j, enemy);
    const d = ctx.terrainDist.at(fields.enemy, w.x[j]!, w.y[j]!);
    if (best < 0 || (ex && !bestEx) || (ex === bestEx && d < bestD)) {
      best = j;
      bestD = d;
      bestEx = ex;
    }
  }
  return best;
}

/** The point next to node j where a raid party walks (one unit off, so raidOver never takes it for a claim point). */
const besideNode = (ctx: SimContext, j: number): { x: number; y: number } => ({
  x: ctx.world.x[j]! + ESCORT_OFFSET,
  y: ctx.world.y[j]!,
});

/** AttackMove for a list of unit ids, in commands of at most the protocol's size. */
function attackMove(
  ctx: SimContext,
  p: number,
  ids: readonly number[],
  x: number,
  y: number,
): void {
  for (const part of chunks(ids))
    applyCommand(ctx, { playerId: p, seq: 0, type: 'AttackMove', payload: { ids: part, x, y } });
}

/** Where the army gathers at home: in front of the headquarters on the way to the enemy (as the Dwellers' rally hq). */
function homePoint(ctx: SimContext, hq: number, fields: Fields): { x: number; y: number } {
  const c = rallyCell(ctx, hq, fields);
  return c === null
    ? { x: ctx.world.x[hq]!, y: ctx.world.y[hq]! }
    : { x: (c.cx << 8) + 128, y: (c.cy << 8) + 128 };
}

/** Step 7: the slave raid (see the top of this file). Takes its escort out of `free`. */
function slaveRaid(
  ctx: SimContext,
  p: number,
  plan: SimRaidPlan,
  t: Tally,
  free: number[],
  spot: number,
  hq: number,
  fields: Fields,
): void {
  const ps = ctx.ps;
  const sr = plan.slaveRaids;
  const tick = ctx.frame;
  if (ps.aiRaidOut[p] === 1) {
    if (tick < ps.aiRaidAt[p]! && t.slavers.length > 0) return;
    // over: everyone on the way to the raid spot comes home
    ps.aiRaidOut[p] = 0;
    ps.aiRaidAt[p] = tick + sr.retryTicks;
    // every Slaver farther from home than the rally radius walks back (an idle one at the spot too)
    const home = homePoint(ctx, hq, fields);
    const w = ctx.world;
    const back = t.slavers.filter((id) => {
      const i = w.resolve(id);
      const dx = w.x[i]! - home.x;
      const dy = w.y[i]! - home.y;
      return dx * dx + dy * dy > ctx.config.aggroRange * ctx.config.aggroRange;
    });
    attackMove(ctx, p, back, home.x, home.y);
    return;
  }
  if (tick < sr.fromTicks || tick < ps.aiRaidAt[p]! || spot < 0 || t.idleSlavers.length === 0)
    return;
  const w = ctx.world;
  const at = besideNode(ctx, spot);
  attackMove(ctx, p, t.idleSlavers, at.x, at.y);
  // the escort screens the Slavers: it stands between the node and the enemy spawn, twice the aggro range out, so it
  // meets the defenders and leaves the workers at the node to the Slavers (an escort at the node kills them first)
  const escort = free.splice(0, sr.escort);
  if (escort.length > 0 && fields.enemy !== null) {
    const c = stepAlong(
      ctx,
      fields.enemy,
      fields.enemyCx,
      fields.enemyCy,
      w.x[spot]! >> 8,
      w.y[spot]! >> 8,
      (2 * ctx.config.aggroRange) >> 8,
    );
    attackMove(ctx, p, escort, (c.cx << 8) + 128, (c.cy << 8) + 128);
  }
  ps.aiRaidOut[p] = 1;
  // maxRaidTicks at the spot: the walk there (the slowest Slaver over land) does not count
  let speed = 0;
  for (const id of t.idleSlavers) {
    const v = w.speed[w.resolve(id)]!;
    if (speed === 0 || v < speed) speed = v;
  }
  const cells = ctx.terrainDist.at(fields.home, w.x[spot]!, w.y[spot]!);
  ps.aiRaidAt[p] = tick + sr.maxRaidTicks + (speed > 0 ? idiv(cells * 256, speed) : 0);
}

/** Step 8: healthy idle buggies to the raid spot; a hurt one on the way comes home. */
function harass(
  ctx: SimContext,
  p: number,
  plan: SimRaidPlan,
  t: Tally,
  spot: number,
  hq: number,
  fields: Fields,
): void {
  const w = ctx.world;
  const hr = plan.harass;
  if (ctx.frame < hr.fromTicks || t.buggies.length === 0) return;
  const hurt = (id: number): boolean => {
    const i = w.resolve(id);
    return w.hp[i]! * 1000 < w.maxHp[i]! * hr.retreatHpPermille;
  };
  const home = homePoint(ctx, hq, fields);
  const back = t.buggies.filter((id) => !t.idleBuggies.includes(id) && hurt(id));
  if (back.length > 0)
    applyCommand(ctx, {
      playerId: p,
      seq: 0,
      type: 'Move',
      payload: { ids: back, x: home.x, y: home.y },
    });
  const go = t.idleBuggies.filter((id) => !hurt(id));
  if (go.length === 0 || spot < 0) return;
  const at = besideNode(ctx, spot);
  attackMove(ctx, p, go, at.x, at.y);
}

/**
 * The claim point nearest home over land that is not p's own (neutral or the enemy's), or -1. While p holds enough
 * points for dominance, its own point nearest the enemy instead: the army holds the count there rather than storming a
 * defended enemy point (measured, data 0.24.0: the camp ran into the Dwellers' front turret at minute 14 and the Raiders
 * never rebuilt).
 */
function dominanceTarget(ctx: SimContext, p: number, fields: Fields): number {
  const w = ctx.world;
  if (pointsOf(ctx, p) >= ctx.map.dominance.pointsRequired && fields.enemy !== null)
    return ownClaimNear(ctx, p, fields.enemy);
  let best = -1;
  let bestD = 0;
  for (const pt of ctx.claimPoints) {
    if (w.owner[pt] === p) continue;
    const d = ctx.terrainDist.at(fields.home, w.x[pt]!, w.y[pt]!);
    if (d === TERRAIN_UNREACHABLE) continue;
    if (best < 0 || d < bestD) {
      best = pt;
      bestD = d;
    }
  }
  return best;
}

/** The visible enemy unit (no slave or captive) nearest (x, y) within r, then the lowest index; -1 without one. */
function enemyNear(ctx: SimContext, p: number, x: number, y: number, r: number): number {
  const w = ctx.world;
  const r2 = r * r;
  let best = -1;
  let bestD = 0;
  for (let j = 0; j < w.highWater; j++) {
    if (!w.has(j, C.unit | C.health) || w.hp[j]! <= 0) continue;
    const o = w.owner[j]!;
    if (o === p || o >= ctx.playerCount || w.slaveState[j] !== SLAVE_NONE) continue;
    if (!visibleTo(w, j, p)) continue;
    const dx = w.x[j]! - x;
    const dy = w.y[j]! - y;
    const d = dx * dx + dy * dy;
    if (d > r2 || (best >= 0 && d >= bestD)) continue;
    best = j;
    bestD = d;
  }
  return best;
}

/**
 * Steps 9b and 10: free fighters (and the idle hero) defend against a threat, or camp at the dominance target, or
 * rally at the script's rally site (as the Dwellers).
 */
function rally(
  ctx: SimContext,
  p: number,
  hq: number,
  script: SimAiScript,
  fields: Fields | null,
  threat: number,
  free: number[],
  heroId: number,
  hero: number,
  push = -1,
): void {
  const w = ctx.world;
  const idle = [...free];
  if (
    heroId >= 0 &&
    w.orderType(hero) === ORDER_NONE &&
    !(threat < 0 && heroClaimNear(ctx, p, hero, script))
  )
    idle.push(heroId);
  if (idle.length === 0 || fields === null) return;
  let to: { x: number; y: number };
  let r = script.rallyRadius;
  // the camp is no building, so findThreat does not cover it: an enemy the army sees within defendRadius of its camp
  // is a threat too (measured, data 0.24.0: a passing Dweller wave shot the idle camp from beyond the aggro range)
  const at =
    threat < 0 && push >= 0
      ? enemyNear(ctx, p, w.x[push]!, w.y[push]!, script.defendRadius)
      : threat;
  if (at >= 0) {
    to = { x: w.x[at]!, y: w.y[at]! };
    r = 0;
  } else if (push >= 0) {
    // camp next to the point (one unit off: raidOver must not take the march for a finished raid)
    to = { x: w.x[push]! + ESCORT_OFFSET, y: w.y[push]! };
  } else {
    const f =
      script.rallySite === AI_SITE_FRONT && fields.enemy !== null ? fields.enemy : fields.home;
    const pt = script.rallySite === AI_SITE_HQ ? -1 : ownClaimNear(ctx, p, f);
    to = pt >= 0 ? { x: w.x[pt]!, y: w.y[pt]! } : homePoint(ctx, hq, fields);
  }
  const go: number[] = [];
  for (const id of idle) {
    const i = w.resolve(id);
    const dx = w.x[i]! - to.x;
    const dy = w.y[i]! - to.y;
    if (dx * dx + dy * dy <= r * r) continue;
    // already on its way there: no new order (a new one would choose the formation again every tick)
    const o = w.currentOrder(i);
    if (o >= 0 && w.ordType[o] === ORDER_ATTACK_MOVE && w.ordX[o] === to.x && w.ordY[o] === to.y)
      continue;
    go.push(id);
  }
  attackMove(ctx, p, go, to.x, to.y);
}

// Split from aiRaiders.ts to stay under the 5,000-token file limit; aiRaiders.ts re-exports the public surface.
// Holds: raiderThink.
import { type SimContext, nodeAllowed, distToRect2 } from './common.js';
import type { Census } from './census.js';
import {
  type AiScratch,
  enemyOf,
  type Fields,
  fieldOf,
  heroThink,
  findThreat,
  researchFor,
  RESEARCH_IMPOSSIBLE,
  claimNext,
  waveReady,
  claimAt,
} from './ai.js';
import { type SimAiScript, type SimRaidPlan, AI_SITE_HQ } from '../config.js';
import { heroIndex } from './hero.js';
import { heroOf, HERO_DEAD, hasTechs } from '../effects.js';
import { type WorkReach, workReach } from './slaves.js';
import { canPlaceType, applyCommand } from './commands.js';
import { PROVIDES_HQ } from '../fromData.js';
import { aiRestore, sabotageTarget } from './aiProject.js';
import { ORDER_NONE } from '../ecs/world.js';
import { aiCreepRun } from './creeps.js';
import { build, guardPosts, produce, richBuild, tally } from './aiRaiders.part1.js';
import {
  attackMove,
  dominanceTarget,
  gatherIdle,
  harass,
  raidSpot,
  rally,
  slaveRaid,
} from './aiRaiders.part2.js';

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
  // Before the far claims open (claimFarFromS) saving for the build order or a tech does not hold the claims back
  // (sim 0.26.0): a claim post on the own side is cheap, and the idle slave builder used to wait minutes for the next
  // building while that claim was open: a race with the autosloperij of the build order that was won or lost on the
  // spot of the second Kooi (the post went up at minute 9 or after minute 12; data 0.30.0, Kooi 5x5).
  const claimHeld = tick < script.claimFarFromTicks ? heroWaits : saving;
  if (!claimHeld && fields !== null && tick >= script.claimFromTicks && t.idleBuilders.length > 0) {
    if (claimNext(ctx, p, t.idleBuilders[0]!, script, free, fields)) t.idleBuilders.shift();
  }
  // win route C (sim 0.25.0, ai/*.json project): restore a ruin of a kind it lacks (the Raider script may leave it out)
  const restore = aiRestore(ctx, p, script, hq, t.army.length, threat, t.idleBuilders, saving);
  for (const id of restore.ids) {
    const k = t.idleBuilders.indexOf(id);
    if (k >= 0) t.idleBuilders.splice(k, 1);
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

  // 8b win route C (sim 0.25.0, ai/*.json project): sabotage, as the Dwellers (ai.ts): an opponent close to the
  // Bouwproject draws the free army to his part nearest to the headquarters, unless the headquarters is under attack
  const sabotage = homeThreat ? -1 : sabotageTarget(ctx, p, script, hq);
  if (sabotage >= 0 && free.length > 0 && free.length >= script.project!.sabotageMinArmy) {
    const send = [...free];
    if (heroId >= 0 && w.orderType(hero) === ORDER_NONE) send.push(heroId);
    attackMove(ctx, p, send, w.x[sabotage]!, w.y[sabotage]!);
    return;
  }

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

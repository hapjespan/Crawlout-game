// Split from ai.ts to stay under the 5,000-token file limit; ai.ts re-exports the public surface.
// Holds: aiSystem, think, thinkSpend, thinkWork, thinkAttack, thinkDefend.
import { aiRestore, sabotageTarget, rallyPart } from './aiProject.js';
import { hasTechs } from '../effects.js';
import { applyCommand } from './commands.js';
import { TERRAIN_UNREACHABLE } from '../pathdist.js';
import {
  nodeAllowed,
  distToRect2,
  nearestFreeCellAround,
  cellCenterOf,
  type SimContext,
  NO_WINNER,
  playerInTurn,
} from './common.js';
import { idiv } from '../math/int.js';
import { ROLE_MILITIA } from './orders.js';
import { ORDER_NONE } from '../ecs/world.js';
import { aiCreepRun } from './creeps.js';
import { AI_SITE_FRONT, AI_SITE_HQ, type SimAiScript } from '../config.js';
import { type Census, takeCensus } from './census.js';
import { raiderThink } from './aiRaiders.js';
import { AiScratch, chunks, fieldOf, ownClaimNear, rallyCell } from './ai.geometry.js';
import {
  armyType,
  builderRobotStep,
  drawToThreat,
  enemyOf,
  exclusiveFor,
  heroClaimNear,
  liberate,
  produceRobot,
} from './ai.sites.js';
import { thinkBuild, thinkCount, thinkPrelude } from './ai.think.state.js';
import type { ThinkTurn } from './ai.think.state.js';
import {
  RESEARCH_IMPOSSIBLE,
  affordable,
  claimAt,
  claimNext,
  researchFor,
  trainNext,
  upgradeOne,
} from './ai.plans.js';

export function aiSystem(ctx: SimContext, census: Census, scratch: AiScratch): void {
  if (ctx.globals.winner !== NO_WINNER) return;
  let counted = false;
  // wie eerst denkt, krijgt bij een gelijke stand de plek of het punt: in de doordraaiende beurtvolgorde
  for (let k = 0; k < ctx.playerCount; k++) {
    const p = playerInTurn(ctx, k);
    const pl = ctx.players[p]!;
    if (!pl.ai || ctx.ps.defeated[p] !== 0) continue;
    const faction = ctx.config.factions[pl.factionId]!;
    // data 0.24.0 (proposal): a script for the opponent's faction (lobby knowledge) goes before the default one
    const enemy = enemyOf(ctx, p);
    const vs = enemy < 0 ? -1 : faction.aiScriptVersus[ctx.players[enemy]!.factionId]!;
    const si = vs >= 0 ? vs : faction.aiScript;
    if (si < 0) continue;
    if (!counted) {
      takeCensus(ctx, census);
      counted = true;
    }
    const script = ctx.config.aiScripts[si]!;
    // data 0.21.0: a script with a raid plan plays the Raiders (systems/aiRaiders.ts)
    if (script.raidPlan !== null) raiderThink(ctx, census, scratch, p, script, script.raidPlan);
    else think(ctx, census, scratch, p, script);
  }
}

function think(
  ctx: SimContext,
  census: Census,
  scratch: AiScratch,
  p: number,
  script: SimAiScript,
): void {
  const t = thinkPrelude(thinkCount(ctx, census, scratch, p, script));
  thinkBuild(t);
  thinkSpend(t);
  thinkWork(t);
  if (thinkAttack(t)) return;
  thinkDefend(t);
}

/** Steps 3c (restore a ruin), 4 (research), 4b (robots) and 4c (training). */
function thinkSpend(t: ThinkTurn): void {
  const { ctx, p, script, tick, hq, militia, idleBuilders, robots, reserveOn } = t;
  // 3c win route C (sim 0.25.0, ai/*.json project): restore the nearest ruin of a kind it lacks; while it cannot pay
  // the restore it saves for it, before research, robots, training and the army (like the build order)
  const restore = aiRestore(
    ctx,
    p,
    script,
    hq,
    militia.length + t.robotWeight,
    t.threat,
    idleBuilders,
    t.saving,
  );
  for (const id of restore.ids) {
    const k = idleBuilders.indexOf(id);
    if (k >= 0) idleBuilders.splice(k, 1);
  }
  if (restore.wait > 0) {
    t.saving = true;
    t.reserve = restore.wait;
  }

  // 4 onderzoek, 4b robots en 4c training (data 0.17.0): elk geeft alleen uit wat boven de reserve zit; met reserveOn
  // spaart hij voor het eerste doel in de volgorde dat alleen op scrap wacht. Volgorde: onderzoek, robots, training;
  // vanaf reserve.robotsFirstFromTicks robots vóór onderzoek.
  const researchStep = (): number => {
    if (tick < script.researchFromTicks) return 0;
    for (const techId of script.research) {
      if (hasTechs(ctx, p, [techId])) continue;
      const r = researchFor(ctx, p, [techId], t.reserve);
      if (r.techId === RESEARCH_IMPOSSIBLE) continue;
      if (r.techId >= 0)
        applyCommand(ctx, {
          playerId: p,
          seq: 0,
          type: 'Research',
          payload: { techId: r.techId },
        });
      return r.cost;
    }
    return 0;
  };
  // robots (data 0.16.0): vanaf fromTicks in de fabriek, cyclisch uit de volgorde, tot max levende robots
  // data 0.26.0: first a builder robot while robots.builders asks for one (builderRobotStep, -1 = not now)
  const robotStep = (): number => {
    if (script.robots === null) return 0;
    const rb = script.robots.builders;
    if (rb !== null && tick >= rb.fromTicks) {
      const cost = builderRobotStep(
        ctx,
        p,
        rb,
        t.builderRobots + t.builderRobotsProducing,
        t.reserve,
      );
      if (cost >= 0) return cost;
    }
    return tick >= script.robots.fromTicks
      ? produceRobot(ctx, p, script.robots, robots.length + t.producing, t.reserve)
      : 0;
  };
  // training is luxe: alleen met een leger van minstens reserve.minArmy en zonder dreiging (reserveOn)
  const trainingStep = (): number =>
    script.training !== null && tick >= script.training.fromTicks && reserveOn
      ? trainNext(ctx, p, script.training.programIds, t.reserve)
      : 0;
  if (!t.saving) {
    const robotsFirst = script.reserve !== null && tick >= script.reserve.robotsFirstFromTicks;
    for (const step of robotsFirst
      ? [robotStep, researchStep, trainingStep]
      : [researchStep, robotStep, trainingStep]) {
      const cost = step();
      if (reserveOn && t.reserve === 0) t.reserve = cost;
    }
  }
}

/** Steps 5 (claims), 6 (help at a site), 7 (scavengers to nodes), 8a (a new builder) and 8 (roles). */
function thinkWork(t: ThinkTurn): void {
  const { ctx, p, script, tick, fields, builders, idleBuilders, idleScavs, scavs, militia } = t;
  const { idleMilitia, depots, load, nodes, threat } = t;
  const w = ctx.world;
  const ps = ctx.ps;
  const idx = ctx.index;
  // 5 claimen
  if (!t.saving && fields !== null && tick >= script.claimFromTicks && idleBuilders.length > 0) {
    if (claimNext(ctx, p, idleBuilders[0]!, script, idleMilitia, fields)) idleBuilders.shift();
  }

  // 6 bouwers zonder werk helpen bij een bouwplaats
  const site = t.site;
  if (site >= 0 && idleBuilders.length > 0) {
    applyCommand(ctx, {
      playerId: p,
      seq: 0,
      type: 'Build',
      payload: { ids: idleBuilders, typeId: w.typeId[site]!, x: w.x[site]!, y: w.y[site]! },
    });
  }

  // 7 plunderaars zonder werk naar een node met plek: exclusieve nodes eerst, dan de kortste rit (padafstand van de
  // node tot het dichtstbijzijnde eigen depot: hoofdgebouw of werkplaats)
  if (idleScavs.length > 0) {
    const cost = t.scratch.nodeCost;
    for (let k = 0; k < idx.nodeCount; k++) {
      const j = idx.nodes[k]!;
      let c = TERRAIN_UNREACHABLE;
      for (const dep of depots) {
        const d = ctx.terrainDist.at(fieldOf(ctx, dep), w.x[j]!, w.y[j]!);
        if (d < c) c = d;
      }
      cost[j] = c;
    }
    for (const id of idleScavs) {
      let best = -1;
      let bestEx = false;
      let bestD = 0;
      let any = -1;
      let anyD = 0;
      for (let k = 0; k < idx.nodeCount; k++) {
        const j = idx.nodes[k]!;
        if (w.amount[j]! <= 0 || cost[j] === TERRAIN_UNREACHABLE || !nodeAllowed(ctx, j, p))
          continue;
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
      // alle nodes vol: de dichtstbijzijnde (op padafstand) met voorraad
      if (best < 0) best = any;
      if (best < 0) break;
      load[best] = load[best]! + 1;
      applyCommand(ctx, {
        playerId: p,
        seq: 0,
        type: 'Gather',
        payload: { ids: [id], nodeId: w.idOf(best) },
      });
    }
  }

  // 8a geen enkele bouwer (ook niet in opleiding) en wel een werkplaats: meteen een bewoner omscholen tot bouwer, ook
  // als hij spaart (bouwen is de uitweg); een plunderaar, en zonder plunderaars een militie
  if (t.workshop && builders.length + t.buildersPlanned === 0 && script.builders > 0) {
    const pick =
      idleScavs.length > 0
        ? idleScavs[idleScavs.length - 1]
        : scavs.length > 0
          ? scavs[scavs.length - 1]
          : militia.length > 0
            ? militia[militia.length - 1]
            : undefined;
    if (pick !== undefined)
      applyCommand(ctx, {
        playerId: p,
        seq: 0,
        type: 'SetRole',
        payload: { ids: [pick], role: 'builder' },
      });
  }

  // 8 rolverdeling
  else if (t.workshop && scavs.length > 0 && !t.holdScrap) {
    const minutes = idiv(tick, ctx.config.ticksPerMinute);
    let share = script.militiaPermille + minutes * script.militiaPermillePerMin;
    if (share > script.militiaPermilleMax) share = script.militiaPermilleMax;
    if (threat >= 0 && share < script.threatMilitiaPermille) share = script.threatMilitiaPermille;
    const excess = scavs.length - nodes * script.scavengersPerNode;
    const pick = idleScavs.length > 0 ? idleScavs[idleScavs.length - 1]! : scavs[scavs.length - 1]!;
    const army = armyType(ctx, p, script);
    // the human builders (a builder robot does not count: the humans also cover the robots as technicians)
    if (builders.length - t.builderRobots + t.buildersPlanned < script.builders) {
      applyCommand(ctx, {
        playerId: p,
        seq: 0,
        type: 'SetRole',
        payload: { ids: [pick], role: 'builder' },
      });
    } else if (
      army !== 0 &&
      affordable(ctx, p, army, t.militiaPlanned, t.reserve) &&
      (militia.length + t.militiaPlanned < idiv(t.units * share, 1000) || excess > 0)
    ) {
      applyCommand(ctx, {
        playerId: p,
        seq: 0,
        type: 'Craft',
        payload: { ids: [pick], loadoutId: ctx.unitType(army)!.loadoutId },
      });
    } else if (
      army !== 0 &&
      ps.scrap[p]! >= script.richScrap &&
      army !== t.roleTypes[ROLE_MILITIA]
    ) {
      upgradeOne(ctx, militia, army);
    }
  }
}

/** Steps 8b (sabotage) and 9 (waves); true when the turn ends there. */
function thinkAttack(t: ThinkTurn): boolean {
  const { ctx, p, script, tick, hq, enemySpawn, builders, idleBuilders, scavs, militia } = t;
  const { idleMilitia, robots, idleRobots, hero, heroId, wave, threat } = t;
  const w = ctx.world;
  const ps = ctx.ps;
  // 8b win route C (sim 0.25.0, ai/*.json project): an opponent close to the Bouwproject (or running his countdown)
  // draws the idle army to his part nearest to the headquarters, unless the headquarters itself is under attack
  const sabotage = sabotageTarget(ctx, p, script, hq);
  if (
    sabotage >= 0 &&
    !(
      threat >= 0 &&
      hq >= 0 &&
      distToRect2(w.x[threat]!, w.y[threat]!, w.fx[hq]!, w.fy[hq]!, w.fw[hq]!, w.fh[hq]!) <=
        script.defendRadius * script.defendRadius
    )
  ) {
    const send = [...idleMilitia, ...idleRobots];
    if (send.length >= script.project!.sabotageMinArmy && send.length > 0) {
      if (heroId >= 0 && w.orderType(hero) === ORDER_NONE) send.push(heroId);
      for (const ids of chunks(send))
        applyCommand(ctx, {
          playerId: p,
          seq: 0,
          type: 'AttackMove',
          payload: { ids, x: w.x[sabotage]!, y: w.y[sabotage]! },
        });
      return true;
    }
  }

  // 9 golven (de held loopt mee)
  if (wave !== null && !t.raidWaits) {
    const k = ps.aiAttack[p]!;
    let target: { x: number; y: number } | null = null;
    if (wave.push) target = enemySpawn;
    else if (wave.raidPt >= 0) target = { x: w.x[wave.raidPt]!, y: w.y[wave.raidPt]! };
    const jitter = script.waveJitterTicks > 0 ? ctx.rng.nextInt(script.waveJitterTicks + 1) : 0;
    if (target === null) {
      // geen push en geen dominantie te breken: deze golf overslaan, het leger blijft bij het verzamelpunt (ook dan
      // met jitter, zodat de volgende golf niet voorspelbaar is)
      ps.aiAttack[p] = k + 1;
      ps.aiWaveAt[p] = tick + script.waveIntervalTicks + jitter;
      return true;
    }
    const send = wave.allIn ? [...militia, ...scavs, ...robots] : [...militia, ...robots];
    if (heroId >= 0) send.push(heroId);
    // een raid neemt een bouwer mee (een vrije als die er is) die naast het punt een claimgebouw zet: valt het
    // claimgebouw van de vijand, dan is het punt van hem in plaats van neutraal
    if (wave.raidPt >= 0 && builders.length > 0)
      claimAt(ctx, p, idleBuilders[0] ?? builders[0]!, wave.raidPt);
    for (const ids of chunks(send))
      applyCommand(ctx, {
        playerId: p,
        seq: 0,
        type: 'AttackMove',
        payload: { ids, x: target.x, y: target.y },
      });
    ps.aiAttack[p] = k + 1;
    ps.aiWaveAt[p] = tick + script.waveIntervalTicks + jitter;
    return true;
  }
  return false;
}

/** Steps 10a (liberation, the headquarters first, creep camps) and 10b (defend or rally). */
function thinkDefend(t: ThinkTurn): void {
  const { ctx, p, script, hq, enemySpawn, fields, militia, idleMilitia } = t;
  const { robots, idleRobots, hero, heroId, threat } = t;
  const w = ctx.world;
  // 10a liberation (data 0.24.0, script.liberate): spare idle militia free a visible enemy-held slave or captive near
  // the own buildings
  if (script.liberate !== null && threat < 0 && hq >= 0)
    liberate(ctx, p, hq, script.liberate, idleMilitia);

  // 10a' the headquarters first (data 0.24.0, script.defendHqFirst): an enemy at the headquarters draws every militia
  // and robot that is not on a push, also those on their way to a threat elsewhere or on a raid (measured: the army ran
  // after a Slaver at a far node while the Raider push razed the headquarters). A unit already heading for a point
  // within defendRadius of the threat keeps its order (no new formation every tick).
  const r2 = script.defendRadius * script.defendRadius;
  const hqThreatened =
    threat >= 0 &&
    hq >= 0 &&
    distToRect2(w.x[threat]!, w.y[threat]!, w.fx[hq]!, w.fy[hq]!, w.fw[hq]!, w.fh[hq]!) <= r2;
  if (script.defendHqFirst && hqThreatened && enemySpawn !== null) {
    // an idle robot is free already; one without an order that is not idle repairs and stays
    drawToThreat(ctx, threat, enemySpawn, r2, militia, idleMilitia, true);
    drawToThreat(ctx, threat, enemySpawn, r2, robots, idleRobots, false);
  }
  // 10a2 creep camps (sim 0.20.0, ai/*.json creeps): without a threat, a big enough idle army clears the nearest camp
  if (
    threat < 0 &&
    fields !== null &&
    aiCreepRun(
      ctx,
      p,
      script,
      fields.home,
      [...idleMilitia, ...idleRobots],
      // the hero along unless he is claiming a point nearby (heroClaimNear walks him there)
      heroId >= 0 && w.orderType(hero) === ORDER_NONE && !heroClaimNear(ctx, p, hero, script)
        ? heroId
        : -1,
    )
  )
    return;

  // 10b verdedigen of verzamelen: militie (en de held) zonder taak
  const idle = [...idleMilitia, ...idleRobots];
  if (
    heroId >= 0 &&
    w.orderType(hero) === ORDER_NONE &&
    !(threat < 0 && heroClaimNear(ctx, p, hero, script))
  )
    idle.push(heroId);
  if (idle.length === 0 || fields === null) return;
  let to: { x: number; y: number };
  let r = script.rallyRadius;
  if (threat >= 0) {
    to = { x: w.x[threat]!, y: w.y[threat]! };
    r = 0;
  } else {
    const f =
      script.rallySite === AI_SITE_FRONT && fields.enemy !== null ? fields.enemy : fields.home;
    const pt = script.rallySite === AI_SITE_HQ ? -1 : ownClaimNear(ctx, p, f);
    // win route C (sim 0.25.0, project.rallyAtParts): while it holds or restores a part, the army stands there
    // (on the free cell beside it nearest to the enemy spawn: the centre of a building cannot be reached)
    const part = enemySpawn === null ? -1 : rallyPart(ctx, p, script, enemySpawn.x, enemySpawn.y);
    const beside =
      part < 0 || enemySpawn === null
        ? -1
        : nearestFreeCellAround(
            ctx,
            w.fx[part]!,
            w.fy[part]!,
            w.fw[part]!,
            w.fh[part]!,
            enemySpawn.x,
            enemySpawn.y,
          );
    if (beside >= 0) to = cellCenterOf(ctx.map, beside);
    else if (pt >= 0) to = { x: w.x[pt]!, y: w.y[pt]! };
    else if (fields.enemy !== null) {
      // voor het hoofdgebouw, op de weg naar de vijand: het midden van het gebouw zelf is niet te bereiken, dus een
      // groep die daarheen loopt komt nooit aan (en is dan nooit vrij voor verdediging of escorte)
      const c = rallyCell(ctx, hq, fields)!;
      to = { x: (c.cx << 8) + 128, y: (c.cy << 8) + 128 };
    } else to = { x: w.x[hq]!, y: w.y[hq]! };
  }
  const go: number[] = [];
  for (const id of idle) {
    const i = w.resolve(id);
    const dx = w.x[i]! - to.x;
    const dy = w.y[i]! - to.y;
    if (dx * dx + dy * dy > r * r) go.push(id);
  }
  for (const ids of chunks(go))
    applyCommand(ctx, {
      playerId: p,
      seq: 0,
      type: 'AttackMove',
      payload: { ids, x: to.x, y: to.y },
    });
}

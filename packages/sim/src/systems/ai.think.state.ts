// Split from ai.ts to stay under the 5,000-token file limit; ai.ts re-exports the public surface.
// Holds: ThinkCount, ThinkTurn, thinkCount, thinkPrelude, thinkBuild.
import { type SimContext, nodeAllowed } from './common.js';
import { type Census, isRobot } from './census.js';
import { type SimAiScript, type SimBuildingType, AI_SITE_HQ } from '../config.js';
import {
  C,
  BSTATE_DONE,
  JOB_PRODUCE,
  BSTATE_SITE,
  ORDER_NONE,
  NO_ENTITY,
  ORDER_ATTACK_MOVE,
  ORDER_CRAFT,
  ORDER_GATHER,
} from '../ecs/world.js';
import { PROVIDES_WORKSHOP, PROVIDES_HQ } from '../fromData.js';
import { DEPOT_MASK, ROLE_MILITIA } from './orders.js';
import { heroIndex } from './hero.js';
import { heroOf, HERO_DEAD, hasTechs } from '../effects.js';
import { canPlaceType, applyCommand } from './commands.js';
import { AiScratch, ROLE_BUILDER, ROLE_SCAVENGER, fieldOf } from './ai.geometry.js';
import type { Fields } from './ai.geometry.js';
import {
  RESEARCH_IMPOSSIBLE,
  claimType,
  findThreat,
  heroThink,
  raidOver,
  researchFor,
  richBuild,
  waveReady,
} from './ai.plans.js';
import type { Wave } from './ai.plans.js';
import { enemyOf, findSite } from './ai.sites.js';

/** The count of think: own units, buildings and node load, plus the turn's fixed inputs (derived, no sim state). */
interface ThinkCount {
  readonly ctx: SimContext;
  readonly census: Census;
  readonly scratch: AiScratch;
  readonly p: number;
  readonly script: SimAiScript;
  readonly tick: number;
  readonly hq: number;
  readonly factionId: number;
  readonly roleTypes: readonly number[];
  readonly enemy: number;
  readonly enemySpawn: { x: number; y: number } | null;
  readonly fields: Fields | null;
  readonly builders: number[];
  readonly idleBuilders: number[];
  readonly idleScavs: number[];
  readonly scavs: number[];
  readonly militia: number[];
  readonly idleMilitia: number[];
  readonly depots: number[];
  readonly robots: number[];
  readonly idleRobots: number[];
  readonly robotArmy: number;
  readonly producing: number;
  readonly builderRobots: number;
  readonly builderRobotsProducing: number;
  readonly units: number;
  readonly militiaPlanned: number;
  readonly buildersPlanned: number;
  readonly workshop: boolean;
  readonly workshopSite: boolean;
  readonly site: number;
  readonly housingSite: boolean;
  readonly load: Int32Array;
}

/** The state of one think turn, shared by its sequential steps; `saving` and `reserve` change along the way. */
export interface ThinkTurn extends ThinkCount {
  readonly robotWeight: number;
  readonly hero: number;
  readonly heroId: number;
  readonly nodes: number;
  readonly wave: Wave | null;
  readonly raidWaits: boolean;
  readonly holdScrap: boolean;
  readonly threat: number;
  readonly reserveOn: boolean;
  saving: boolean;
  reserve: number;
}

export function thinkCount(
  ctx: SimContext,
  census: Census,
  scratch: AiScratch,
  p: number,
  script: SimAiScript,
): ThinkCount {
  const w = ctx.world;
  const ps = ctx.ps;
  const tick = ctx.frame;
  const hq = census.hq[p]!;
  const factionId = ctx.players[p]!.factionId;
  const roleTypes = ctx.config.factions[factionId]!.roleTypeIds;
  const enemy = enemyOf(ctx, p);
  const enemySpawn = enemy < 0 ? null : ctx.map.spawns[enemy]!;
  // padafstanden over het terrein: vanaf het eigen hoofdgebouw en vanaf de spawn van de vijand
  const fields: Fields | null =
    hq < 0
      ? null
      : {
          home: fieldOf(ctx, hq),
          enemy: enemySpawn === null ? null : ctx.terrainDist.fieldAt(enemySpawn.x, enemySpawn.y),
          enemyCx: enemySpawn === null ? 0 : enemySpawn.x >> 8,
          enemyCy: enemySpawn === null ? 0 : enemySpawn.y >> 8,
        };

  // Vanaf claimFarFromTicks: wanneer hij punten neemt die niet aan zijn kant liggen, met jitter (sim.rng, één keer per
  // potje), zodat niet altijd dezelfde speler als eerste bij het midden is.
  if (ps.aiClaimAt[p] === 0 && tick >= script.claimFarFromTicks)
    ps.aiClaimAt[p] =
      tick + (script.waveJitterTicks > 0 ? ctx.rng.nextInt(script.waveJitterTicks + 1) : 0) + 1;

  // Telling van de eigen units, gebouwen en de vijanden bij eigen gebouwen.
  const builders: number[] = [];
  const idleBuilders: number[] = [];
  const idleScavs: number[] = [];
  const scavs: number[] = [];
  const militia: number[] = [];
  const idleMilitia: number[] = [];
  const depots: number[] = [];
  // robots (data 0.16.0): geen militie (niet in golfgroottes, niet omgeschoold), wel mee met golven en verdediging
  const robots: number[] = [];
  const idleRobots: number[] = [];
  // data 0.17.0 (robots.countAsArmy): de pop van de robots telt mee voor de legergrootte van golven, push en reserve
  let robotArmy = 0;
  let producing = 0;
  // data 0.26.0 (robots.builders): builder robots (canBuild) alive and in production; they work with the builders
  let builderRobots = 0;
  let builderRobotsProducing = 0;
  let units = 0;
  let militiaPlanned = 0;
  let buildersPlanned = 0;
  let workshop = false;
  let workshopSite = false;
  let site = -1;
  let housingSite = false;
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
      const isWorkshop = bt !== undefined && (bt.provides & PROVIDES_WORKSHOP) !== 0;
      if (w.bstate[i] === BSTATE_DONE) {
        if (isWorkshop) workshop = true;
        if (bt !== undefined && (bt.provides & DEPOT_MASK) !== 0) depots.push(i);
      }
      if (w.jobKind[i] === JOB_PRODUCE && w.job[i] !== 0) {
        if (ctx.unitType(w.job[i]!)?.canBuild === true) builderRobotsProducing++;
        else producing++;
      }
      if (w.bstate[i] === BSTATE_SITE) {
        if (site < 0) site = i;
        if (w.typeId[i] === script.housingTypeId) housingSite = true;
        if (isWorkshop) workshopSite = true;
      }
      continue;
    }
    if (!w.has(i, C.unit | C.orders) || w.has(i, C.hero)) continue;
    const ord = w.orderType(i);
    const id = w.idOf(i);
    if (isRobot(ctx, i)) {
      if (ctx.unitType(w.typeId[i]!)?.canBuild === true) {
        // a builder robot (data 0.26.0): one of the builders (build order, claims, help at a site), not in the army
        // and not one of the `builders` humans (those also cover the robots as technicians)
        builderRobots++;
        builders.push(id);
        if (ord === ORDER_NONE) idleBuilders.push(id);
        continue;
      }
      robots.push(id);
      robotArmy += ctx.unitType(w.typeId[i]!)?.popCost ?? 0;
      // een robot die repareert (zonder order, met een doel) is niet vrij
      const repairing = ord === ORDER_NONE && w.target[i] !== NO_ENTITY && w.damage[i]! <= 0;
      if (!repairing && (ord === ORDER_NONE || (ord === ORDER_ATTACK_MOVE && raidOver(ctx, p, i))))
        idleRobots.push(id);
      continue;
    }
    units++;
    if (ord === ORDER_CRAFT) {
      const to = ctx.unitType(w.ordX[w.currentOrder(i)]!);
      if (to?.role === ROLE_MILITIA) militiaPlanned++;
      if (to?.role === ROLE_BUILDER) buildersPlanned++;
      continue;
    }
    const role = w.role[i]!;
    if (role === ROLE_BUILDER) {
      builders.push(id);
      if (ord === ORDER_NONE) idleBuilders.push(id);
    } else if (role === ROLE_MILITIA) {
      militia.push(id);
      if (ord === ORDER_NONE || (ord === ORDER_ATTACK_MOVE && raidOver(ctx, p, i)))
        idleMilitia.push(id);
    } else if (role === ROLE_SCAVENGER) {
      scavs.push(id);
      if (ord === ORDER_NONE) idleScavs.push(id);
    }
  }
  // plunderaars per node (na de telling: een node kan een hogere index hebben dan zijn plunderaar)
  for (const id of scavs) {
    const i = w.resolve(id);
    if (w.orderType(i) !== ORDER_GATHER) continue;
    const n = w.resolve(w.ordT[w.currentOrder(i)]!);
    if (n >= 0 && w.has(n, C.resource)) load[n] = load[n]! + 1;
  }
  return {
    ctx,
    census,
    scratch,
    p,
    script,
    tick,
    hq,
    factionId,
    roleTypes,
    enemy,
    enemySpawn,
    fields,
    builders,
    idleBuilders,
    idleScavs,
    scavs,
    militia,
    idleMilitia,
    depots,
    robots,
    idleRobots,
    robotArmy,
    producing,
    builderRobots,
    builderRobotsProducing,
    units,
    militiaPlanned,
    buildersPlanned,
    workshop,
    workshopSite,
    site,
    housingSite,
    load,
  };
}

export function thinkPrelude(c: ThinkCount): ThinkTurn {
  const { ctx, p, script, tick, hq, enemy, enemySpawn, builders, militia } = c;
  const w = ctx.world;
  const ps = ctx.ps;
  // legergrootte voor golven, push en reserve: militie plus (met robots.countAsArmy) de pop van de robots
  const robotWeight = script.robots !== null && script.robots.countAsArmy ? c.robotArmy : 0;

  // 1 de held: oplappen, perk kiezen, ability. Een gesneuvelde held gaat voor: tot hij opgelapt wordt, spaart de AI
  // (geen bouwvolgorde, onderzoek, claims of omscholing die de scrap opmaken).
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
  // zonder nodes komt er geen scrap meer bij: dan wachten op het oplappen heeft geen zin
  const heroWaits =
    hq >= 0 &&
    h !== undefined &&
    ps.heroState[p] === HERO_DEAD &&
    (nodes > 0 || ps.scrap[p]! >= h.reviveScrap);

  // 9a is er een golf klaar? Vooraf bepaald: een raid neemt een bouwer mee die een claimgebouw zet, en tot de AI dat
  // kan betalen, wacht de raid en spaart hij (geen huisvesting, bouwvolgorde, onderzoek, claims of omscholing).
  const wave =
    enemy >= 0 && enemySpawn !== null
      ? waveReady(ctx, p, script, enemy, militia.length + robotWeight, nodes, hq)
      : null;
  const claimBt = claimType(ctx, p);
  const raidWaits =
    wave !== null &&
    wave.raidPt >= 0 &&
    builders.length > 0 &&
    claimBt !== undefined &&
    ps.scrap[p]! < claimBt.scrapCost;
  const holdScrap = heroWaits || raidWaits;
  const saving = holdScrap;
  // waar hij voor spaart (bouwvolgorde of een nieuwe werkplaats): omscholen tot militie gaat alleen van wat erboven zit
  const reserve = 0;

  // 10a dreiging: de vijandelijke unit bij een eigen gebouw het dichtst bij het hoofdgebouw (data 0.17.0: vooraf, want
  // onder dreiging spaart hij niet voor onderzoek of training)
  const threat = hq >= 0 ? findThreat(ctx, c.scratch, p, hq, script.defendRadius) : -1;
  // Data 0.17.0 (reserve): vanaf reserve.fromTicks spaart hij voor zijn volgende onderzoek, robot of trainingsrun als
  // alleen de scrap ontbreekt, zolang zijn leger minstens reserve.minArmy is en er geen dreiging is.
  const reserveOn =
    script.reserve !== null &&
    tick >= script.reserve.fromTicks &&
    militia.length + robotWeight >= script.reserve.minArmy &&
    threat < 0;
  return {
    ...c,
    robotWeight,
    hero,
    heroId,
    nodes,
    wave,
    raidWaits,
    holdScrap,
    threat,
    reserveOn,
    saving,
    reserve,
  };
}

/** Steps 2a (a lost workshop), 2b (housing), 3 (the build order) and 3b (rich builds). */
export function thinkBuild(t: ThinkTurn): void {
  const { ctx, census, p, script, tick, hq, factionId, fields, builders, idleBuilders } = t;
  const ps = ctx.ps;
  // 2a werkplaats kwijt (gesloopt): eerst een nieuwe, vóór alles behalve de held. Zonder werkplaats kan hij niet
  // omscholen (geen bouwers, geen leger). Alleen als de bouwvolgorde er al een had; tot hij betaald is, spaart hij.
  const order = script.buildOrder;
  let bi = ps.aiBuild[p]!;
  if (!t.saving && fields !== null && !t.workshop && !t.workshopSite) {
    let wsType: SimBuildingType | undefined;
    for (let k = 0; k < bi && k < order.length && wsType === undefined; k++) {
      const bt = ctx.buildingType(order[k]!.typeId);
      if (bt !== undefined && (bt.provides & PROVIDES_WORKSHOP) !== 0) wsType = bt;
    }
    if (wsType !== undefined && canPlaceType(ctx, p, wsType.typeId)) {
      if (ps.scrap[p]! < wsType.scrapCost) {
        t.saving = true;
        t.reserve = wsType.scrapCost;
      } else if (idleBuilders.length > 0) {
        const at = findSite(ctx, p, hq, wsType, AI_SITE_HQ, fields);
        if (
          at !== null &&
          applyCommand(ctx, {
            playerId: p,
            seq: 0,
            type: 'Build',
            payload: { ids: [idleBuilders[0]!], typeId: wsType.typeId, x: at.x, y: at.y },
          })
        )
          idleBuilders.shift();
      } else if (builders.length > 0) t.saving = true; // de bouwer is bezig: wachten tot hij vrij is
    }
  }

  // 2b huisvesting zodra de pop-cap in zicht komt (zolang de bedden onder de ruimte voor bewoners blijven: popCapMax min
  // de pop van de robots, data 0.16.0)
  const popCap = census.popCap(ctx, p);
  // de pop voor robots: wat ze nu innemen (ook in productie), en data 0.17.0 minstens robots.reservePop
  let robotRoom = census.robotPop[p]! + census.reservedPop[p]!;
  if (script.robots !== null && robotRoom < script.robots.reservePop)
    robotRoom = script.robots.reservePop;
  const hbt = script.housingTypeId === 0 ? undefined : ctx.buildingType(script.housingTypeId);
  if (
    !t.saving &&
    fields !== null &&
    hbt !== undefined &&
    !t.housingSite &&
    census.beds[p]! < ctx.config.popCapMax - robotRoom &&
    popCap - census.pop[p]! <= script.housingFreeBeds
  ) {
    if (
      canPlaceType(ctx, p, hbt.typeId) &&
      ps.scrap[p]! >= hbt.scrapCost &&
      idleBuilders.length > 0
    ) {
      const at = findSite(ctx, p, hq, hbt, AI_SITE_HQ, fields);
      if (
        at !== null &&
        applyCommand(ctx, {
          playerId: p,
          seq: 0,
          type: 'Build',
          payload: { ids: [idleBuilders[0]!], typeId: hbt.typeId, x: at.x, y: at.y },
        })
      )
        idleBuilders.shift();
    }
  }

  // 3 bouwvolgorde
  while (!t.saving && fields !== null && bi < order.length && tick >= order[bi]!.atTick) {
    const typeId = order[bi]!.typeId;
    const bt = ctx.buildingType(typeId);
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
        applyCommand(ctx, {
          playerId: p,
          seq: 0,
          type: 'Research',
          payload: { techId: r.techId },
        });
      else {
        t.saving = true;
        // data 0.17.0: wacht de keten alleen op scrap, dan spaart hij ervoor (omscholen alleen van wat erboven zit)
        t.reserve = r.cost;
      }
      break;
    }
    if (ps.scrap[p]! < bt.scrapCost) {
      t.saving = true;
      t.reserve = bt.scrapCost;
      break;
    }
    // alleen een bouwer zonder werk: een bouwer van een vorige order weghalen laat die bouwplaats half staan
    const builder = idleBuilders[0];
    if (builder === undefined) break;
    const at = findSite(ctx, p, hq, bt, order[bi]!.site ?? AI_SITE_HQ, fields);
    if (at === null) {
      bi++;
      continue;
    }
    if (
      applyCommand(ctx, {
        playerId: p,
        seq: 0,
        type: 'Build',
        payload: { ids: [builder], typeId, x: at.x, y: at.y },
      })
    ) {
      bi++;
      idleBuilders.shift();
    }
    break;
  }
  ps.aiBuild[p] = bi;

  // 3b extra gebouwen bij genoeg scrap
  if (
    !t.saving &&
    fields !== null &&
    bi >= order.length &&
    t.site < 0 &&
    ps.scrap[p]! >= script.richScrap &&
    idleBuilders.length > 0
  ) {
    const rb = richBuild(ctx, p, script);
    if (rb >= 0) {
      const o = script.richBuilds[rb]!;
      const bt = ctx.buildingType(o.typeId)!;
      const at = findSite(ctx, p, hq, bt, o.site, fields);
      if (
        at !== null &&
        applyCommand(ctx, {
          playerId: p,
          seq: 0,
          type: 'Build',
          payload: { ids: [idleBuilders[0]!], typeId: o.typeId, x: at.x, y: at.y },
        })
      )
        idleBuilders.shift();
    }
  }
}

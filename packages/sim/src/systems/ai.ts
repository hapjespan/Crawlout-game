import { MAX_ENTITIES, MAX_ENTITIES_PER_COMMAND, OWNER_NEUTRAL } from '@crawlout/protocol';
import { ROLES } from '@crawlout/data';
import type { SimAiScript, SimBuildingType } from '../config.js';
import { AI_SITE_FRONT, AI_SITE_HQ, MAX_ABILITIES } from '../config.js';
import { HERO_DEAD, hasTechs, heroOf } from '../effects.js';
import {
  BSTATE_DONE,
  BSTATE_SITE,
  C,
  ORDER_ATTACK_MOVE,
  ORDER_CRAFT,
  ORDER_GATHER,
  ORDER_NONE,
} from '../ecs/world.js';
import { footprintFree } from '../entities.js';
import { PROVIDES_HQ, PROVIDES_WORKSHOP } from '../fromData.js';
import { clampI, idiv } from '../math/int.js';
import { isqrt } from '../math/sqrt.js';
import type { Census } from './census.js';
import { takeCensus } from './census.js';
import { applyCommand, canPlaceType } from './commands.js';
import type { SimContext } from './common.js';
import {
  MAX_FREE_RING,
  NO_WINNER,
  cellCenterOf,
  distToRect2,
  isEnemy,
  nearestNode,
  nodeAllowed,
  scanRing,
} from './common.js';
import { heroIndex } from './hero.js';
import { ROLE_MILITIA } from './orders.js';

// Systeem 2 (AI-deel): de scripted tegenstander, voor elke speler met ai = true, in playerId-volgorde, voor de
// unit-orders. Geen cheats: de AI geeft gewone commando's via applyCommand (dezelfde validatie als spelers) en
// ziet alleen wat elke speler kan zien: eigen units en gebouwen, de map, de spawns, wie een claimpunt bezit, en
// vijandelijke units die bij zijn eigen gebouwen staan. Alle getallen komen uit het script (ai/*.json, balans
// speltest 14 oktober). Per tick, in deze volgorde (wie eerst komt, krijgt de vrije bouwer en de scrap):
//  1. de held: oplappen, perk kiezen, ability (heroThink); zolang de held dood is en er een hoofdgebouw is, spaart hij
//     voor het oplappen (geen bouwvolgorde, onderzoek, claims of omscholing);
//  2. huisvesting: zijn er housingFreeBeds of minder vrije bedden en is de pop-cap niet op popCapMax, dan bouwt een
//     vrije bouwer het huisvestingsgebouw (hoogstens één bouwplaats tegelijk);
//  3. bouwvolgorde uit het script (atTick, plaats hq, claim of front); een gebouw dat nooit kan slaat hij over. Mist
//     de order een prereqTech (besluit 8), dan onderzoekt hij eerst de keten en wacht hij met de order. Wacht de
//     order op scrap, dan geeft hij deze tick niets anders uit (onderzoek, claims);
//  3b. na de bouwvolgorde, boven richScrap: de eerste richBuild waarvan er nog te weinig staan (een verloren gebouw
//     komt zo terug);
//  4. onderzoek: de eerste tech uit `research` die er nog niet is, vanaf researchFromTicks;
//  5. claimen: vanaf claimFromTicks neemt een vrije bouwer het neutrale claimpunt het dichtst bij zijn hoofdgebouw;
//     verder dan claimSafeRadius pas vanaf claimFarFromTicks, met de militie zonder taak als escorte;
//  6. bouwers zonder werk helpen bij een eigen bouwplaats;
//  7. plunderaars zonder werk gaan naar een node met minder dan scavengersPerNode plunderaars, nodes die door een
//     eigen claimpunt exclusief zijn eerst, daarna de dichtstbijzijnde;
//  8. rolverdeling (met een werkplaats, één omscholing per tick): eerst `builders` bouwers, dan militie tot het
//     aandeel (militiaPermille plus militiaPermillePerMin per minuut tot militiaPermilleMax, bij dreiging minstens
//     threatMilitiaPermille); plunderaars boven scavengersPerNode maal het aantal bruikbare nodes worden ook militie.
//     Hij schoolt alleen om als hij die omscholing plus de lopende kan betalen (een omscholing betaalt pas bij de
//     werkplaats). Militie wordt het eerste loadout uit armyTypeIds waarvoor de techs er zijn; boven richScrap schoolt hij
//     bestaande militie om naar dat loadout;
//  9. golven: de eerste op attackTimersTicks, daarna elke waveIntervalTicks plus 0..waveJitterTicks (sim.rng). Een golf
//     vertrekt met minstens waveMinArmy + k maal waveArmyGrowth militie (golf k), of na waveMaxWaitTicks wachten met
//     waveMinArmy. Vanaf pushFromTicks met minstens pushMinArmy militie is het een push op het vijandelijke hoofdgebouw.
//     Anders is het een raid, maar alleen als de vijand genoeg claimpunten voor dominantie houdt: op zijn claimpunt het
//     dichtst bij huis (dat breekt de dominantie en zijn exclusieve node); daarna keren ze terug naar het verzamelpunt.
//     Zonder push of raid vervalt de golf en spaart hij zijn leger. Alle
//     militie en de held gaan mee. Zonder bruikbare scrap-node (allInWithoutNodes: geen inkomen meer) gaat elke golf,
//     hoe klein ook, naar het hoofdgebouw en de plunderaars gaan mee;
//     Een raid is voorbij zodra zijn claimpunt geen vijand meer heeft: die militie telt dan als zonder taak (stap 10).
// 10. verdedigen: staat er een vijandelijke unit binnen defendRadius van een eigen gebouw, dan gaat militie zonder
//     taak (en de held) erop af; anders verzamelen ze bij het verzamelpunt (rallySite: hoofdgebouw, eigen claimpunt
//     het dichtst bij huis of bij de vijand) zodra ze verder dan rallyRadius weg zijn.

const ROLE_SCAVENGER = ROLES.indexOf('scavenger');
const ROLE_BUILDER = ROLES.indexOf('builder');

function chunks(ids: readonly number[]): number[][] {
  const out: number[][] = [];
  for (let k = 0; k < ids.length; k += MAX_ENTITIES_PER_COMMAND)
    out.push(ids.slice(k, k + MAX_ENTITIES_PER_COMMAND));
  return out;
}

/** Afgeleide kladruimte van de AI, elke beurt opnieuw gevuld (geen state). */
export class AiScratch {
  /** Plunderaars met een Gather-order per node-index. */
  readonly nodeLoad = new Int32Array(MAX_ENTITIES);
}

export function aiSystem(ctx: SimContext, census: Census, scratch: AiScratch): void {
  if (ctx.globals.winner !== NO_WINNER) return;
  let counted = false;
  for (let p = 0; p < ctx.playerCount; p++) {
    const pl = ctx.players[p]!;
    if (!pl.ai || ctx.ps.defeated[p] !== 0) continue;
    const si = ctx.config.factions[pl.factionId]!.aiScript;
    if (si < 0) continue;
    if (!counted) {
      takeCensus(ctx, census);
      counted = true;
    }
    think(ctx, census, scratch, p, ctx.config.aiScripts[si]!);
  }
}

/** Geometrie: de escorte van een claim loopt naar een punt zoveel eenheden naast het claimpunt (zie raidOver). */
const ESCORT_OFFSET = 1;

/** Geometrie: een gebouw met een wapen zoekt zijn plek vanaf zoveel cellen voorbij de rand van zijn anker, richting de vijand. */
const TURRET_FORWARD_CELLS = 3;

/** Eigen claimpunt het dichtst bij (x, y), of -1. Tiebreak laagste index. */
function ownClaimNear(ctx: SimContext, p: number, x: number, y: number): number {
  const w = ctx.world;
  let best = -1;
  let bestD = 0;
  for (const pt of ctx.claimPoints) {
    if (w.owner[pt] !== p) continue;
    const dx = w.x[pt]! - x;
    const dy = w.y[pt]! - y;
    const d = dx * dx + dy * dy;
    if (best < 0 || d < bestD) {
      best = pt;
      bestD = d;
    }
  }
  return best;
}

/**
 * Vrije plek voor een gebouw: footprint plus een rand van één cel vrij, niet op nodes of claimpunten. Het anker is
 * het hoofdgebouw (AI_SITE_HQ), het eigen claimpunt het dichtst bij huis (AI_SITE_CLAIM) of het dichtst bij de vijand
 * (AI_SITE_FRONT); zonder eigen claimpunt het hoofdgebouw. Een gebouw met een wapen (turret) zoekt vanaf een punt voor
 * het anker richting `toward` (de spawn van de vijand), zodat een aanval binnen zijn bereik komt.
 */
function findSite(
  ctx: SimContext,
  p: number,
  hq: number,
  bt: SimBuildingType,
  site: number,
  toward: { x: number; y: number } | null,
): { x: number; y: number } | null {
  const w = ctx.world;
  const map = ctx.map;
  let cx = w.fx[hq]! + (w.fw[hq]! >> 1);
  let cy = w.fy[hq]! + (w.fh[hq]! >> 1);
  let half = w.fw[hq]! >> 1;
  if (site !== AI_SITE_HQ) {
    const from = site === AI_SITE_FRONT && toward !== null ? toward : { x: w.x[hq]!, y: w.y[hq]! };
    const pt = ownClaimNear(ctx, p, from.x, from.y);
    if (pt >= 0) {
      cx = w.x[pt]! >> 8;
      cy = w.y[pt]! >> 8;
      half = 1;
    }
  }
  if (bt.damage > 0 && toward !== null) {
    const dx = (toward.x >> 8) - cx;
    const dy = (toward.y >> 8) - cy;
    const len = isqrt(dx * dx + dy * dy);
    const reach = half + TURRET_FORWARD_CELLS + (bt.footprintW >> 1);
    if (len > reach) {
      cx = clampI(cx + idiv(dx * reach, len), 0, map.w - 1);
      cy = clampI(cy + idiv(dy * reach, len), 0, map.h - 1);
    }
  }
  // Op de eerste ring met een vrije plek: de plek het dichtst bij het midden van de map, dan het dichtst bij het anker.
  // Op een puntsymmetrische map kiezen beide spelers zo elkaars spiegelbeeld (de scanvolgorde van de ring is dat niet).
  const fw = bt.footprintW;
  const fh = bt.footprintH;
  const mx = map.w >> 1;
  const my = map.h >> 1;
  for (let d = 1; d <= MAX_FREE_RING; d++) {
    let found = -1;
    let bestM = 0;
    let bestA = 0;
    scanRing(map, cx, cy, 1, 1, d, (x, y) => {
      const fx = x - (fw >> 1);
      const fy = y - (fh >> 1);
      if (!footprintFree(ctx, fx - 1, fy - 1, fw + 2, fh + 2)) return false;
      for (let j = 0; j < w.highWater; j++) {
        if (!w.has(j, C.resource) && !w.has(j, C.claim)) continue;
        if (distToRect2(w.x[j]!, w.y[j]!, fx - 1, fy - 1, fw + 2, fh + 2) === 0) return false;
      }
      const m = (x - mx) * (x - mx) + (y - my) * (y - my);
      const a = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (found < 0 || m < bestM || (m === bestM && a < bestA)) {
        found = y * map.w + x;
        bestM = m;
        bestA = a;
      }
      return false;
    });
    if (found >= 0) return cellCenterOf(map, found);
  }
  return null;
}

/**
 * Laat bouwer `builder` het neutrale claimpunt het dichtst bij het hoofdgebouw claimen (tiebreak laagste index). Ligt
 * het verder dan claimSafeRadius, dan pas vanaf claimFarFromTicks, en de militie zonder taak gaat als escorte mee.
 */
function claimNext(
  ctx: SimContext,
  p: number,
  hq: number,
  builder: number,
  script: SimAiScript,
  idleMilitia: number[],
): boolean {
  const w = ctx.world;
  const typeId = ctx.config.factions[ctx.players[p]!.factionId]!.claimTypeId;
  const bt = typeId === 0 ? undefined : ctx.buildingType(typeId);
  if (bt === undefined || !canPlaceType(ctx, p, typeId) || ctx.ps.scrap[p]! < bt.scrapCost)
    return false;
  let best = -1;
  let bestD = 0;
  for (const pt of ctx.claimPoints) {
    if (w.owner[pt] !== OWNER_NEUTRAL) continue;
    const d = distToRect2(w.x[pt]!, w.y[pt]!, w.fx[hq]!, w.fy[hq]!, w.fw[hq]!, w.fh[hq]!);
    if (best < 0 || d < bestD) {
      best = pt;
      bestD = d;
    }
  }
  if (best < 0) return false;
  const far = bestD > script.claimSafeRadius * script.claimSafeRadius;
  if (far && ctx.frame < script.claimFarFromTicks) return false;
  if (
    !applyCommand(ctx, {
      playerId: p,
      seq: 0,
      type: 'Claim',
      payload: { ids: [builder], pointId: w.idOf(best) },
    })
  )
    return false;
  if (far) {
    // de escorte loopt naar een punt net naast het claimpunt (ESCORT_OFFSET), zodat raidOver hem niet voor een
    // afgelopen raid houdt terwijl het punt nog neutraal is
    const x = w.x[best]! + ESCORT_OFFSET;
    for (const ids of chunks(idleMilitia))
      applyCommand(ctx, {
        playerId: p,
        seq: 0,
        type: 'AttackMove',
        payload: { ids, x, y: w.y[best]! },
      });
    idleMilitia.length = 0;
  }
  return true;
}

/** Eerste tegenstander na p (cyclisch) die nog meedoet, of -1. */
function enemyOf(ctx: SimContext, p: number): number {
  for (let k = 1; k < ctx.playerCount; k++) {
    let q = p + k;
    if (q >= ctx.playerCount) q -= ctx.playerCount;
    if (ctx.ps.defeated[q] === 0) return q;
  }
  return -1;
}

/** Of node j binnen claimRadius ligt van een claimpunt van p (dan is hij exclusief van p). */
function exclusiveFor(ctx: SimContext, j: number, p: number): boolean {
  const w = ctx.world;
  const r = ctx.config.claimRadius;
  for (const pt of ctx.claimPoints) {
    if (w.owner[pt] !== p) continue;
    const dx = w.x[j]! - w.x[pt]!;
    const dy = w.y[j]! - w.y[pt]!;
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}

/** Het eerste unittype uit het script waarvoor speler p de techs heeft, of 0. */
function armyType(ctx: SimContext, p: number, script: SimAiScript): number {
  for (const t of script.armyTypeIds) {
    const u = ctx.unitType(t);
    if (
      u !== undefined &&
      u.factionId === ctx.players[p]!.factionId &&
      hasTechs(ctx, p, u.prereqTech)
    )
      return t;
  }
  return 0;
}

function think(
  ctx: SimContext,
  census: Census,
  scratch: AiScratch,
  p: number,
  script: SimAiScript,
): void {
  const w = ctx.world;
  const ps = ctx.ps;
  const tick = ctx.frame;
  const hq = census.hq[p]!;
  const factionId = ctx.players[p]!.factionId;
  const roleTypes = ctx.config.factions[factionId]!.roleTypeIds;
  const enemy = enemyOf(ctx, p);
  const enemySpawn = enemy < 0 ? null : ctx.map.spawns[enemy]!;

  // Telling van de eigen units, gebouwen en de vijanden bij eigen gebouwen.
  const builders: number[] = [];
  const idleBuilders: number[] = [];
  const idleScavs: number[] = [];
  const scavs: number[] = [];
  const militia: number[] = [];
  const idleMilitia: number[] = [];
  let units = 0;
  let militiaPlanned = 0;
  let buildersPlanned = 0;
  let workshop = false;
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
      if (
        bt !== undefined &&
        w.bstate[i] === BSTATE_DONE &&
        (bt.provides & PROVIDES_WORKSHOP) !== 0
      )
        workshop = true;
      if (w.bstate[i] === BSTATE_SITE) {
        if (site < 0) site = i;
        if (w.typeId[i] === script.housingTypeId) housingSite = true;
      }
      continue;
    }
    if (!w.has(i, C.unit | C.orders) || w.has(i, C.hero)) continue;
    units++;
    const ord = w.orderType(i);
    const id = w.idOf(i);
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

  const takeBuilder = (): number | undefined => idleBuilders.shift();

  // 1 de held: oplappen, perk kiezen, ability. Een gesneuvelde held gaat voor: tot hij opgelapt wordt, spaart de AI
  // (geen bouwvolgorde, onderzoek, claims of omscholing die de scrap opmaken).
  heroThink(ctx, p, hq);
  const hero = heroIndex(ctx, p);
  const heroId = hero < 0 ? -1 : w.idOf(hero);
  let nodes = 0;
  for (let j = 0; j < w.highWater; j++)
    if (w.has(j, C.resource) && w.amount[j]! > 0 && nodeAllowed(ctx, j, p)) nodes++;
  const h = heroOf(ctx, p);
  // zonder nodes komt er geen scrap meer bij: dan wachten op het oplappen heeft geen zin
  const heroWaits =
    hq >= 0 &&
    h !== undefined &&
    ps.heroState[p] === HERO_DEAD &&
    (nodes > 0 || ps.scrap[p]! >= h.reviveScrap);

  // 2 huisvesting zodra de pop-cap in zicht komt
  const popCap = census.popCap(ctx, p);
  const hbt = script.housingTypeId === 0 ? undefined : ctx.buildingType(script.housingTypeId);
  if (
    !heroWaits &&
    hq >= 0 &&
    hbt !== undefined &&
    !housingSite &&
    popCap < ctx.config.popCapMax &&
    popCap - census.pop[p]! <= script.housingFreeBeds
  ) {
    if (
      canPlaceType(ctx, p, hbt.typeId) &&
      ps.scrap[p]! >= hbt.scrapCost &&
      idleBuilders.length > 0
    ) {
      const at = findSite(ctx, p, hq, hbt, AI_SITE_HQ, enemySpawn);
      if (
        at !== null &&
        applyCommand(ctx, {
          playerId: p,
          seq: 0,
          type: 'Build',
          payload: { ids: [idleBuilders[0]!], typeId: hbt.typeId, x: at.x, y: at.y },
        })
      )
        takeBuilder();
    }
  }

  // 3 bouwvolgorde
  let bi = ps.aiBuild[p]!;
  const order = script.buildOrder;
  let saving = heroWaits;
  while (!heroWaits && hq >= 0 && bi < order.length && tick >= order[bi]!.atTick) {
    const typeId = order[bi]!.typeId;
    const bt = ctx.buildingType(typeId);
    if (bt === undefined || bt.factionId !== factionId || (bt.provides & PROVIDES_HQ) !== 0) {
      bi++;
      continue;
    }
    if (!hasTechs(ctx, p, bt.prereqTech)) {
      const r = researchFor(ctx, p, bt.prereqTech);
      if (r === RESEARCH_IMPOSSIBLE) {
        bi++;
        continue;
      }
      if (r >= 0)
        applyCommand(ctx, { playerId: p, seq: 0, type: 'Research', payload: { techId: r } });
      else saving = true;
      break;
    }
    if (ps.scrap[p]! < bt.scrapCost) {
      saving = true;
      break;
    }
    // alleen een bouwer zonder werk: een bouwer van een vorige order weghalen laat die bouwplaats half staan
    const builder = idleBuilders[0];
    if (builder === undefined) break;
    const at = findSite(ctx, p, hq, bt, order[bi]!.site ?? AI_SITE_HQ, enemySpawn);
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
      takeBuilder();
    }
    break;
  }
  ps.aiBuild[p] = bi;

  // 3b extra gebouwen bij genoeg scrap
  if (
    !saving &&
    hq >= 0 &&
    bi >= order.length &&
    site < 0 &&
    ps.scrap[p]! >= script.richScrap &&
    idleBuilders.length > 0
  ) {
    const rb = richBuild(ctx, p, script);
    if (rb >= 0) {
      const o = script.richBuilds[rb]!;
      const bt = ctx.buildingType(o.typeId)!;
      const at = findSite(ctx, p, hq, bt, o.site, enemySpawn);
      if (
        at !== null &&
        applyCommand(ctx, {
          playerId: p,
          seq: 0,
          type: 'Build',
          payload: { ids: [idleBuilders[0]!], typeId: o.typeId, x: at.x, y: at.y },
        })
      )
        takeBuilder();
    }
  }

  // 4 onderzoek
  if (!saving && tick >= script.researchFromTicks) {
    for (const techId of script.research) {
      if (hasTechs(ctx, p, [techId])) continue;
      const r = researchFor(ctx, p, [techId]);
      if (r === RESEARCH_IMPOSSIBLE) continue;
      if (r >= 0)
        applyCommand(ctx, { playerId: p, seq: 0, type: 'Research', payload: { techId: r } });
      break;
    }
  }

  // 5 claimen
  if (!saving && hq >= 0 && tick >= script.claimFromTicks && idleBuilders.length > 0) {
    if (claimNext(ctx, p, hq, idleBuilders[0]!, script, idleMilitia)) takeBuilder();
  }

  // 6 bouwers zonder werk helpen bij een bouwplaats
  if (site >= 0 && idleBuilders.length > 0) {
    applyCommand(ctx, {
      playerId: p,
      seq: 0,
      type: 'Build',
      payload: { ids: idleBuilders, typeId: w.typeId[site]!, x: w.x[site]!, y: w.y[site]! },
    });
  }

  // 7 plunderaars zonder werk naar een node met plek, exclusieve nodes eerst
  for (const id of idleScavs) {
    const i = w.resolve(id);
    let best = -1;
    let bestEx = false;
    let bestD = 0;
    for (let j = 0; j < w.highWater; j++) {
      if (
        !w.has(j, C.resource) ||
        w.amount[j]! <= 0 ||
        load[j]! >= script.scavengersPerNode ||
        !nodeAllowed(ctx, j, p)
      )
        continue;
      const ex = exclusiveFor(ctx, j, p);
      const dx = w.x[j]! - w.x[i]!;
      const dy = w.y[j]! - w.y[i]!;
      const d = dx * dx + dy * dy;
      if (best < 0 || (ex && !bestEx) || (ex === bestEx && d < bestD)) {
        best = j;
        bestEx = ex;
        bestD = d;
      }
    }
    if (best < 0) best = nearestNode(ctx, p, w.x[i]!, w.y[i]!);
    if (best < 0) break;
    load[best] = load[best]! + 1;
    applyCommand(ctx, {
      playerId: p,
      seq: 0,
      type: 'Gather',
      payload: { ids: [id], nodeId: w.idOf(best) },
    });
  }

  // 10a dreiging: de vijandelijke unit bij een eigen gebouw het dichtst bij het hoofdgebouw
  const threat = hq >= 0 ? findThreat(ctx, p, hq, script.defendRadius) : -1;

  // 8 rolverdeling
  if (workshop && scavs.length > 0 && !heroWaits) {
    const minutes = idiv(tick, ctx.config.ticksPerMinute);
    let share = script.militiaPermille + minutes * script.militiaPermillePerMin;
    if (share > script.militiaPermilleMax) share = script.militiaPermilleMax;
    if (threat >= 0 && share < script.threatMilitiaPermille) share = script.threatMilitiaPermille;
    const excess = scavs.length - nodes * script.scavengersPerNode;
    const pick = idleScavs.length > 0 ? idleScavs[idleScavs.length - 1]! : scavs[scavs.length - 1]!;
    const army = armyType(ctx, p, script);
    if (builders.length + buildersPlanned < script.builders) {
      applyCommand(ctx, {
        playerId: p,
        seq: 0,
        type: 'SetRole',
        payload: { ids: [pick], role: 'builder' },
      });
    } else if (
      army !== 0 &&
      affordable(ctx, p, army, militiaPlanned) &&
      (militia.length + militiaPlanned < idiv(units * share, 1000) || excess > 0)
    ) {
      applyCommand(ctx, {
        playerId: p,
        seq: 0,
        type: 'Craft',
        payload: { ids: [pick], loadoutId: ctx.unitType(army)!.loadoutId },
      });
    } else if (army !== 0 && ps.scrap[p]! >= script.richScrap && army !== roleTypes[ROLE_MILITIA]) {
      upgradeOne(ctx, militia, army);
    }
  }

  // 9 golven (de held loopt mee)
  if (enemy >= 0 && enemySpawn !== null) {
    const k = ps.aiAttack[p]!;
    const timers = script.attackTimersTicks;
    const due = k < timers.length ? timers[k]! : ps.aiWaveAt[p]!;
    const allIn = script.allInWithoutNodes && nodes === 0;
    if (tick >= due) {
      const need = allIn ? 1 : script.waveMinArmy + k * script.waveArmyGrowth;
      const waited = tick >= due + script.waveMaxWaitTicks && militia.length >= script.waveMinArmy;
      if ((militia.length > 0 || allIn) && (militia.length >= need || waited || allIn)) {
        const push =
          allIn || (tick >= script.pushFromTicks && militia.length >= script.pushMinArmy);
        // een raid alleen tegen dominantie: houdt de vijand genoeg punten, dan zijn claimpunt het dichtst bij huis
        const raid = !push && ownedBy(ctx, enemy) >= ctx.map.dominance.pointsRequired;
        const target = push ? enemySpawn : raid ? waveTarget(ctx, hq, enemy, null) : null;
        if (target === null) {
          // geen push en geen dominantie te breken: deze golf overslaan, het leger blijft bij het verzamelpunt
          ps.aiAttack[p] = k + 1;
          ps.aiWaveAt[p] = tick + script.waveIntervalTicks;
          return;
        }
        const send = allIn ? [...militia, ...scavs] : [...militia];
        if (heroId >= 0) send.push(heroId);
        for (const ids of chunks(send))
          applyCommand(ctx, {
            playerId: p,
            seq: 0,
            type: 'AttackMove',
            payload: { ids, x: target.x, y: target.y },
          });
        ps.aiAttack[p] = k + 1;
        const jitter = script.waveJitterTicks > 0 ? ctx.rng.nextInt(script.waveJitterTicks + 1) : 0;
        ps.aiWaveAt[p] = tick + script.waveIntervalTicks + jitter;
        return;
      }
    }
  }

  // 10b verdedigen of verzamelen: militie (en de held) zonder taak
  const idle = [...idleMilitia];
  if (heroId >= 0 && w.orderType(hero) === ORDER_NONE) idle.push(heroId);
  if (idle.length === 0 || hq < 0) return;
  let to: { x: number; y: number };
  let r = script.rallyRadius;
  if (threat >= 0) {
    to = { x: w.x[threat]!, y: w.y[threat]! };
    r = 0;
  } else {
    const from =
      script.rallySite === AI_SITE_FRONT && enemySpawn !== null
        ? enemySpawn
        : { x: w.x[hq]!, y: w.y[hq]! };
    const pt = script.rallySite === AI_SITE_HQ ? -1 : ownClaimNear(ctx, p, from.x, from.y);
    to = pt >= 0 ? { x: w.x[pt]!, y: w.y[pt]! } : { x: w.x[hq]!, y: w.y[hq]! };
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

/**
 * Index van de eerste richBuild die nu kan en waarvan er te weinig staan: entry k is af zolang speler p minstens zoveel
 * gebouwen (af of in aanbouw) van dat type heeft als er entries 0..k van dat type zijn. -1 als alles staat of niets kan.
 */
function richBuild(ctx: SimContext, p: number, script: SimAiScript): number {
  const w = ctx.world;
  for (let k = 0; k < script.richBuilds.length; k++) {
    const t = script.richBuilds[k]!.typeId;
    let want = 0;
    for (let q = 0; q <= k; q++) if (script.richBuilds[q]!.typeId === t) want++;
    let have = 0;
    for (let i = 0; i < w.highWater; i++)
      if (w.alive[i] === 1 && w.owner[i] === p && w.has(i, C.building) && w.typeId[i] === t) have++;
    if (have >= want) continue;
    const bt = ctx.buildingType(t);
    if (bt === undefined || !canPlaceType(ctx, p, t) || ctx.ps.scrap[p]! < bt.scrapCost) return -1;
    return k;
  }
  return -1;
}

/**
 * Of militie i op een afgelopen raid is: zijn AttackMove gaat naar een claimpunt dat geen vijand meer heeft (het is
 * neutraal of van hemzelf). Dan telt hij als zonder taak en keert hij terug naar het verzamelpunt, in plaats van achter
 * gebouwen aan de vijandelijke basis in te lopen.
 */
function raidOver(ctx: SimContext, p: number, i: number): boolean {
  const w = ctx.world;
  const o = w.currentOrder(i);
  const x = w.ordX[o]!;
  const y = w.ordY[o]!;
  for (const pt of ctx.claimPoints) {
    if (w.x[pt] !== x || w.y[pt] !== y) continue;
    const owner = w.owner[pt]!;
    return owner === OWNER_NEUTRAL || owner === p;
  }
  return false;
}

/** Of speler p nog een omscholing naar `typeId` kan betalen naast de `planned` die al onderweg zijn (die betalen pas bij de werkplaats). */
function affordable(ctx: SimContext, p: number, typeId: number, planned: number): boolean {
  const t = ctx.unitType(typeId);
  return t !== undefined && ctx.ps.scrap[p]! >= t.scrapCost * (planned + 1);
}

/** Eén militie-unit van een ander type dan `best` omscholen naar `best` (de laagste id). */
function upgradeOne(ctx: SimContext, militia: readonly number[], best: number): void {
  const w = ctx.world;
  for (const id of militia) {
    const i = w.resolve(id);
    if (w.typeId[i] === best) continue;
    applyCommand(ctx, {
      playerId: w.owner[i]!,
      seq: 0,
      type: 'Craft',
      payload: { ids: [id], loadoutId: ctx.unitType(best)!.loadoutId },
    });
    return;
  }
}

/** Index van de vijandelijke unit binnen r van een eigen gebouw van p, het dichtst bij het hoofdgebouw; -1 als er geen is. */
function findThreat(ctx: SimContext, p: number, hq: number, r: number): number {
  const w = ctx.world;
  const r2 = r * r;
  let best = -1;
  let bestD = 0;
  for (let j = 0; j < w.highWater; j++) {
    if (!w.has(j, C.unit | C.health) || w.hp[j]! <= 0) continue;
    const o = w.owner[j]!;
    if (o === p || o >= ctx.playerCount) continue;
    const x = w.x[j]!;
    const y = w.y[j]!;
    let near = false;
    for (let b = 0; b < w.highWater && !near; b++) {
      if (w.owner[b] !== p || !w.has(b, C.building)) continue;
      if (distToRect2(x, y, w.fx[b]!, w.fy[b]!, w.fw[b]!, w.fh[b]!) <= r2) near = true;
    }
    if (!near) continue;
    const d = distToRect2(x, y, w.fx[hq]!, w.fy[hq]!, w.fw[hq]!, w.fh[hq]!);
    if (best < 0 || d < bestD) {
      best = j;
      bestD = d;
    }
  }
  return best;
}

/** Aantal claimpunten van speler q. */
function ownedBy(ctx: SimContext, q: number): number {
  let n = 0;
  for (const pt of ctx.claimPoints) if (ctx.world.owner[pt] === q) n++;
  return n;
}

/** Doel van een golf: het claimpunt van de vijand het dichtst bij het eigen hoofdgebouw, anders `spawn` (of null). */
function waveTarget(
  ctx: SimContext,
  hq: number,
  enemy: number,
  spawn: { x: number; y: number } | null,
): { x: number; y: number } | null {
  const w = ctx.world;
  let best = -1;
  let bestD = 0;
  for (const pt of ctx.claimPoints) {
    if (w.owner[pt] !== enemy) continue;
    const d =
      hq >= 0 ? distToRect2(w.x[pt]!, w.y[pt]!, w.fx[hq]!, w.fy[hq]!, w.fw[hq]!, w.fh[hq]!) : 0;
    if (best < 0 || d < bestD) {
      best = pt;
      bestD = d;
    }
  }
  return best >= 0 ? { x: w.x[best]!, y: w.y[best]! } : spawn;
}

/** researchFor: er loopt al onderzoek in de keten, of het gebouw is bezet of nog niet af, of de scrap ontbreekt. */
const RESEARCH_WAIT = -1;
/** researchFor: de keten kan niet (andere factie, of geen eigen gebouw van het type, af of in aanbouw). */
const RESEARCH_IMPOSSIBLE = -2;

/**
 * De tech die speler p nu moet onderzoeken voor `need` (diepte eerst in de prereqTech-keten, in lijstvolgorde): een
 * techId als Research nu kan, anders RESEARCH_WAIT of RESEARCH_IMPOSSIBLE.
 */
function researchFor(ctx: SimContext, p: number, need: readonly number[]): number {
  const w = ctx.world;
  const seen: number[] = [];
  const visit = (techId: number): number => {
    if (seen.includes(techId)) return RESEARCH_IMPOSSIBLE; // kring in de prereqTech-keten
    seen.push(techId);
    const t = ctx.config.techs[techId];
    if (t === undefined || t.factionId !== ctx.players[p]!.factionId) return RESEARCH_IMPOSSIBLE;
    for (const q of t.prereqTech) {
      if (hasTechs(ctx, p, [q])) continue;
      return visit(q);
    }
    let exists = false;
    let free = false;
    for (let i = 0; i < w.highWater; i++) {
      if (!w.has(i, C.building) || w.owner[i] !== p) continue;
      if (w.research[i] === t.techId + 1) return RESEARCH_WAIT; // loopt al
      if (w.typeId[i] !== t.buildingTypeId) continue;
      exists = true;
      if (w.bstate[i] === BSTATE_DONE && w.research[i] === 0) free = true;
    }
    if (!exists) return RESEARCH_IMPOSSIBLE;
    return free && ctx.ps.scrap[p]! >= t.scrapCost ? t.techId : RESEARCH_WAIT;
  };
  for (const techId of need) {
    if (hasTechs(ctx, p, [techId])) continue;
    return visit(techId);
  }
  return RESEARCH_WAIT;
}

function heroThink(ctx: SimContext, p: number, hq: number): void {
  const ps = ctx.ps;
  const w = ctx.world;
  const h = heroOf(ctx, p);
  if (h === undefined) return;
  if (ps.heroState[p] === HERO_DEAD && hq >= 0 && ps.scrap[p]! >= h.reviveScrap) {
    applyCommand(ctx, {
      playerId: p,
      seq: 0,
      type: 'Recruit',
      payload: { buildingId: w.idOf(hq) },
    });
  }
  if (ps.heroPending[p]! > 0) {
    for (const perkId of h.perkPool) {
      if (
        applyCommand(ctx, {
          playerId: p,
          seq: 0,
          type: 'PickPerk',
          payload: { heroId: h.heroId, perkId },
        })
      )
        break;
    }
  }
  const i = heroIndex(ctx, p);
  if (i < 0) return;
  for (let a = 0; a < h.abilities.length; a++) {
    if (ps.abCooldown[p * MAX_ABILITIES + a]! > 0) continue;
    const ab = h.abilities[a]!;
    // de dichtstbijzijnde vijandelijke unit binnen bereik (rangeU, of de straal als de zone op de held zelf ligt)
    const r = ab.rangeU > 0 ? ab.rangeU : ab.radiusU;
    let best = -1;
    let bestD = 0;
    for (let j = 0; j < w.highWater; j++) {
      if (!w.has(j, C.unit | C.health) || !isEnemy(w, i, j)) continue;
      const dx = w.x[j]! - w.x[i]!;
      const dy = w.y[j]! - w.y[i]!;
      const d = dx * dx + dy * dy;
      if (d <= r * r && (best < 0 || d < bestD)) {
        best = j;
        bestD = d;
      }
    }
    if (best < 0) continue;
    const at = ab.rangeU > 0 ? best : i;
    applyCommand(ctx, {
      playerId: p,
      seq: 0,
      type: 'HeroAbility',
      payload: { heroId: h.heroId, abilityId: a, x: w.x[at]!, y: w.y[at]! },
    });
  }
}

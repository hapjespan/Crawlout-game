// Split from ai.ts to stay under the 5,000-token file limit; ai.ts re-exports the public surface.
// Holds: claimNext, trainNext, richBuild, raidOver, affordable, upgradeOne, +13 more.
import { type SimContext, visibleTo, distToRect2, isEnemy } from './common.js';
import { trainedOn, letterRunning, trainCost } from './training.js';
import { hasTechs, researchCost, heroOf, HERO_DEAD } from '../effects.js';
import { C, BSTATE_DONE, SLAVE_SLAVE, SLAVE_CAPTIVE } from '../ecs/world.js';
import { applyCommand, canPlaceType } from './commands.js';
import { type SimAiScript, type SimBuildingType, MAX_ABILITIES } from '../config.js';
import { campAt, campAlive } from './creeps.js';
import { sabotageOver } from './aiProject.js';
import { OWNER_NEUTRAL } from '@crawlout/protocol';
import { imod } from '../math/int.js';
import { pointsOf } from './claims.js';
import { TERRAIN_UNREACHABLE } from '../pathdist.js';
import { heroIndex } from './hero.js';
import { AiScratch, ESCORT_OFFSET, chunks, fieldOf } from './ai.geometry.js';
import type { Fields } from './ai.geometry.js';
import { isOwnSide } from './ai.sites.js';

/**
 * Laat bouwer `builder` een neutraal claimpunt claimen. Eerst de punten aan de eigen kant (dichter bij het eigen
 * hoofdgebouw dan bij de spawn van de vijand), daarna de rest; binnen elke groep het dichtst bij het hoofdgebouw, alles op
 * padafstand (tiebreak laagste index). Een onbereikbaar punt slaat hij over. Een punt verder dan claimSafeRadius (te
 * lopen) krijgt de militie zonder taak als escorte mee; ligt het niet aan de eigen kant, dan pas vanaf claimFarFromTicks.
 */
export function claimNext(
  ctx: SimContext,
  p: number,
  builder: number,
  script: SimAiScript,
  idleMilitia: number[],
  fields: Fields,
): boolean {
  const w = ctx.world;
  const bt = claimType(ctx, p);
  if (bt === undefined || !canPlaceType(ctx, p, bt.typeId) || ctx.ps.scrap[p]! < bt.scrapCost)
    return false;
  let best = -1;
  let bestD = 0;
  let bestOwn = false;
  for (const pt of ctx.claimPoints) {
    if (w.owner[pt] !== OWNER_NEUTRAL) continue;
    const d = ctx.terrainDist.at(fields.home, w.x[pt]!, w.y[pt]!);
    if (d === TERRAIN_UNREACHABLE) continue;
    const own = isOwnSide(ctx, pt, fields);
    if (best < 0 || (own && !bestOwn) || (own === bestOwn && d < bestD)) {
      best = pt;
      bestD = d;
      bestOwn = own;
    }
  }
  if (best < 0) return false;
  const far = bestD > script.claimSafeRadius >> 8;
  const farAt = ctx.ps.aiClaimAt[p]!;
  if (far && !bestOwn && (farAt === 0 || ctx.frame < farAt - 1)) return false;
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
    const x = w.x[best]! + (w.x[best]! >= ctx.map.spawns[p]!.x ? ESCORT_OFFSET : -ESCORT_OFFSET);
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

/**
 * SPECIAL-training van de AI (data 0.17.0, ai/*.json training): de eerste entry k uit de volgorde die nog niet af is
 * (speler p heeft op die letter minder punten dan het programma in entries 0..k voorkomt, en minder dan maxPoints), niet
 * al loopt en waarvoor de techs er zijn, in een vrije eigen voltooide trainingsplek. Kan hij hem betalen naast de
 * reserve, dan start hij hem (0); ontbreekt alleen de scrap, dan de prijs (om voor te sparen); anders 0.
 */
export function trainNext(
  ctx: SimContext,
  p: number,
  programIds: readonly number[],
  reserve: number,
): number {
  const w = ctx.world;
  for (let k = 0; k < programIds.length; k++) {
    const tr = ctx.config.training[programIds[k]!];
    if (tr === undefined || tr.factionId !== ctx.players[p]!.factionId) continue;
    let want = 0;
    for (let q = 0; q <= k; q++) if (programIds[q] === tr.programId) want++;
    const have = trainedOn(ctx, p, tr);
    if (have >= want || have >= tr.maxPoints || !hasTechs(ctx, p, tr.prereqTech)) continue;
    if (letterRunning(ctx, p, tr.special)) continue;
    let b = -1;
    for (let i = 0; i < w.highWater && b < 0; i++) {
      if (
        w.has(i, C.building) &&
        w.owner[i] === p &&
        w.typeId[i] === tr.buildingTypeId &&
        w.bstate[i] === BSTATE_DONE &&
        w.hp[i]! > 0 &&
        w.job[i] === 0 &&
        w.research[i] === 0
      )
        b = i;
    }
    if (b < 0) return 0;
    const cost = trainCost(ctx, p, tr);
    if (ctx.ps.scrap[p]! < cost + reserve) return cost;
    applyCommand(ctx, {
      playerId: p,
      seq: 0,
      type: 'Train',
      payload: { buildingId: w.idOf(b), programId: tr.programId },
    });
    return 0;
  }
  return 0;
}

/**
 * Index van de eerste richBuild die nu kan en waarvan er te weinig staan: entry k is af zolang speler p minstens zoveel
 * gebouwen (af of in aanbouw) van dat type heeft als er entries 0..k van dat type zijn. -1 als alles staat of niets kan.
 */
export function richBuild(ctx: SimContext, p: number, script: SimAiScript): number {
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
export function raidOver(ctx: SimContext, p: number, i: number): boolean {
  const w = ctx.world;
  const o = w.currentOrder(i);
  const x = w.ordX[o]!;
  const y = w.ordY[o]!;
  // a creep run (sim 0.20.0) is over once its camp is cleared
  const camp = campAt(ctx, x, y);
  if (camp >= 0) return !campAlive(ctx, camp);
  // a sabotage run (win route C, sim 0.25.0) is over once the part is no opponent's any more
  const part = sabotageOver(ctx, p, x, y);
  if (part !== null) return part;
  for (const pt of ctx.claimPoints) {
    if (w.x[pt] !== x || w.y[pt] !== y) continue;
    const owner = w.owner[pt]!;
    return owner === OWNER_NEUTRAL || owner === p;
  }
  return false;
}

/**
 * Of speler p nog een omscholing naar `typeId` kan betalen naast de `planned` die al onderweg zijn (die betalen pas bij
 * de werkplaats) en de `reserve` waarvoor hij spaart.
 */
export function affordable(
  ctx: SimContext,
  p: number,
  typeId: number,
  planned: number,
  reserve: number,
): boolean {
  const t = ctx.unitType(typeId);
  return t !== undefined && ctx.ps.scrap[p]! >= t.scrapCost * (planned + 1) + reserve;
}

/** Eén militie-unit van een ander type dan `best` omscholen naar `best` (de laagste id). */
export function upgradeOne(ctx: SimContext, militia: readonly number[], best: number): void {
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

/**
 * Index van de vijandelijke unit binnen r van een eigen gebouw van p, het dichtst bij het hoofdgebouw; -1 als er geen is.
 * Eerst de eigen gebouwen en hun omhullende (plus r), dan per vijandelijke unit alleen binnen die omhullende de
 * gebouwen: zelfde uitkomst als alle paren, maar op een grote map met verre vijanden bijna gratis.
 */
export function findThreat(
  ctx: SimContext,
  scratch: AiScratch,
  p: number,
  hq: number,
  r: number,
): number {
  const w = ctx.world;
  const r2 = r * r;
  const idx = ctx.index;
  idx.refresh(w);
  const own = scratch.own;
  let n = 0;
  let bx0 = 0;
  let by0 = 0;
  let bx1 = 0;
  let by1 = 0;
  for (let k = 0; k < idx.buildingCount; k++) {
    const b = idx.buildings[k]!;
    if (w.owner[b] !== p) continue;
    own[n++] = b;
    const x0 = (w.fx[b]! << 8) - r;
    const y0 = (w.fy[b]! << 8) - r;
    const x1 = ((w.fx[b]! + w.fw[b]!) << 8) + r;
    const y1 = ((w.fy[b]! + w.fh[b]!) << 8) + r;
    if (n === 1 || x0 < bx0) bx0 = x0;
    if (n === 1 || y0 < by0) by0 = y0;
    if (n === 1 || x1 > bx1) bx1 = x1;
    if (n === 1 || y1 > by1) by1 = y1;
  }
  if (n === 0) return -1;
  let best = -1;
  let bestD = 0;
  for (let j = 0; j < w.highWater; j++) {
    if (!w.has(j, C.unit | C.health) || w.hp[j]! <= 0) continue;
    const o = w.owner[j]!;
    if (o === p || o >= ctx.playerCount) continue;
    // a slave or captive (data 0.21.0) is no threat and no target: it is freed by touch (liberate)
    const st = w.slaveState[j]!;
    if (st === SLAVE_SLAVE || st === SLAVE_CAPTIVE) continue;
    // fog of war (sim 0.17.0): the AI only reacts to what its own units and buildings see
    if (!visibleTo(w, j, p)) continue;
    const x = w.x[j]!;
    const y = w.y[j]!;
    if (x < bx0 || x > bx1 || y < by0 || y > by1) continue;
    let near = false;
    for (let k = 0; k < n && !near; k++) {
      const b = own[k]!;
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

export interface Wave {
  /** Op het vijandelijke hoofdgebouw (vanaf pushFromTicks met pushMinArmy, of all-in zonder nodes). */
  readonly push: boolean;
  /** Zonder bruikbare node: alles gaat mee, ook de plunderaars. */
  readonly allIn: boolean;
  /** Raid: het claimpunt van de vijand (alleen als hij genoeg punten voor dominantie houdt), anders -1. */
  readonly raidPt: number;
}

/**
 * De golf die nu kan vertrekken, of null. De eerste op attackTimersTicks, daarna op aiWaveAt; met minstens waveMinArmy
 * + k maal waveArmyGrowth militie (golf k), of na waveMaxWaitTicks wachten met waveMinArmy; all-in zonder nodes.
 */
export function waveReady(
  ctx: SimContext,
  p: number,
  script: SimAiScript,
  enemy: number,
  militia: number,
  nodes: number,
  hq: number,
): Wave | null {
  const k = ctx.ps.aiAttack[p]!;
  const timers = script.attackTimersTicks;
  const due = k < timers.length ? timers[k]! : ctx.ps.aiWaveAt[p]!;
  const allIn = script.allInWithoutNodes && nodes === 0;
  const tick = ctx.frame;
  if (tick < due) return null;
  const need = allIn ? 1 : script.waveMinArmy + k * script.waveArmyGrowth;
  const waited = tick >= due + script.waveMaxWaitTicks && militia >= script.waveMinArmy;
  if (!((militia > 0 || allIn) && (militia >= need || waited || allIn))) return null;
  const push = allIn || (tick >= script.pushFromTicks && militia >= script.pushMinArmy);
  // een raid alleen tegen dominantie: houdt de vijand genoeg punten, dan een van zijn claimpunten (enemyClaimFor)
  const raid = !push && pointsOf(ctx, enemy) >= ctx.map.dominance.pointsRequired;
  return {
    push,
    allIn,
    raidPt: raid ? enemyClaimFor(ctx, hq >= 0 ? fieldOf(ctx, hq) : null, enemy, k) : -1,
  };
}

/**
 * Het doel van raid k: de claimpunten van de vijand op volgorde van padafstand tot het eigen hoofdgebouw (tiebreak
 * laagste index), en daarvan nummer k modulo hun aantal; -1 zonder punten. Zo valt niet elke raid hetzelfde punt aan
 * (meestal het midden, waar de vijand zijn leger heeft staan) maar ook zijn settlements: één punt breken is genoeg om
 * zijn dominantie te stoppen.
 */
export function enemyClaimFor(
  ctx: SimContext,
  home: Uint16Array | null,
  enemy: number,
  k: number,
): number {
  const w = ctx.world;
  const pts: number[] = [];
  const ds: number[] = [];
  for (const pt of ctx.claimPoints) {
    if (w.owner[pt] !== enemy) continue;
    const d = home === null ? 0 : ctx.terrainDist.at(home, w.x[pt]!, w.y[pt]!);
    let j = pts.length;
    pts.push(pt);
    ds.push(d);
    while (j > 0 && (ds[j - 1]! > d || (ds[j - 1] === d && pts[j - 1]! > pt))) {
      pts[j] = pts[j - 1]!;
      ds[j] = ds[j - 1]!;
      j--;
    }
    pts[j] = pt;
    ds[j] = d;
  }
  return pts.length === 0 ? -1 : pts[imod(k, pts.length)]!;
}

/** Het claimgebouw van de factie van speler p, of undefined. */
export function claimType(ctx: SimContext, p: number): SimBuildingType | undefined {
  const typeId = ctx.config.factions[ctx.players[p]!.factionId]!.claimTypeId;
  return typeId === 0 ? undefined : ctx.buildingType(typeId);
}

/** Bouwer `builder` zet een claimgebouw bij punt pt (Claim), als speler p het kan betalen. */
export function claimAt(ctx: SimContext, p: number, builder: number, pt: number): boolean {
  const bt = claimType(ctx, p);
  if (bt === undefined || !canPlaceType(ctx, p, bt.typeId) || ctx.ps.scrap[p]! < bt.scrapCost)
    return false;
  return applyCommand(ctx, {
    playerId: p,
    seq: 0,
    type: 'Claim',
    payload: { ids: [builder], pointId: ctx.world.idOf(pt) },
  });
}

/** researchFor: er loopt al onderzoek in de keten, of het gebouw is bezet of nog niet af, of de scrap ontbreekt. */
export const RESEARCH_WAIT = -1;

/** researchFor: de keten kan niet (andere factie, of geen eigen gebouw van het type, af of in aanbouw). */
export const RESEARCH_IMPOSSIBLE = -2;

/** Uitkomst van researchFor. */
interface ResearchStep {
  /** De tech om nu te onderzoeken, of RESEARCH_WAIT of RESEARCH_IMPOSSIBLE. */
  readonly techId: number;
  /** Bij RESEARCH_WAIT omdat alleen de scrap ontbreekt (vrij gebouw, keten klaar): de prijs; anders 0. */
  readonly cost: number;
}

const WAIT: ResearchStep = { techId: RESEARCH_WAIT, cost: 0 };

const IMPOSSIBLE: ResearchStep = { techId: RESEARCH_IMPOSSIBLE, cost: 0 };

/**
 * De tech die speler p nu moet onderzoeken voor `need` (diepte eerst in de prereqTech-keten, in lijstvolgorde): een
 * techId als Research nu kan, anders RESEARCH_WAIT (met de prijs als alleen de scrap ontbreekt) of RESEARCH_IMPOSSIBLE.
 */
export function researchFor(
  ctx: SimContext,
  p: number,
  need: readonly number[],
  reserve = 0,
): ResearchStep {
  const w = ctx.world;
  const seen: number[] = [];
  const visit = (techId: number): ResearchStep => {
    if (seen.includes(techId)) return IMPOSSIBLE; // kring in de prereqTech-keten
    seen.push(techId);
    const t = ctx.config.techs[techId];
    if (t === undefined || t.factionId !== ctx.players[p]!.factionId) return IMPOSSIBLE;
    for (const q of t.prereqTech) {
      if (hasTechs(ctx, p, [q])) continue;
      return visit(q);
    }
    let exists = false;
    let free = false;
    for (let i = 0; i < w.highWater; i++) {
      if (!w.has(i, C.building) || w.owner[i] !== p) continue;
      if (w.research[i] === t.techId + 1) return WAIT; // loopt al
      if (w.typeId[i] !== t.buildingTypeId) continue;
      exists = true;
      if (w.bstate[i] === BSTATE_DONE && w.research[i] === 0 && w.job[i] === 0) free = true;
    }
    if (!exists) return IMPOSSIBLE;
    if (!free) return WAIT;
    const cost = researchCost(ctx, p, t);
    return ctx.ps.scrap[p]! >= cost + reserve
      ? { techId: t.techId, cost: 0 }
      : { techId: RESEARCH_WAIT, cost };
  };
  for (const techId of need) {
    if (hasTechs(ctx, p, [techId])) continue;
    return visit(techId);
  }
  return WAIT;
}

export function heroThink(ctx: SimContext, p: number, hq: number): void {
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

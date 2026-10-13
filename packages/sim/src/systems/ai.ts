import { MAX_ENTITIES_PER_COMMAND, OWNER_NEUTRAL } from '@crawlout/protocol';
import { ROLES } from '@crawlout/data';
import type { SimAiScript, SimBuildingType } from '../config.js';
import { MAX_ABILITIES } from '../config.js';
import { HERO_DEAD, heroOf } from '../effects.js';
import { BSTATE_DONE, BSTATE_SITE, C, ORDER_CRAFT, ORDER_NONE } from '../ecs/world.js';
import { footprintFree } from '../entities.js';
import { PROVIDES_WORKSHOP } from '../fromData.js';
import { idiv } from '../math/int.js';
import type { Census } from './census.js';
import { takeCensus } from './census.js';
import { applyCommand, canPlaceType } from './commands.js';
import type { SimContext } from './common.js';
import { MAX_FREE_RING, NO_WINNER, cellCenterOf, distToRect2, isEnemy, nearestNode, scanRing } from './common.js';
import { heroIndex } from './hero.js';
import { ROLE_MILITIA } from './orders.js';

// Systeem 2 (AI-deel): de scripted tegenstander, voor elke speler met ai = true, in playerId-volgorde, voor de
// unit-orders. Geen cheats: de AI geeft gewone commando's via applyCommand (dezelfde validatie als spelers) en
// ziet alleen wat elke speler kan zien (eigen units, de map, de spawns). Gedrag:
//  1. bouwvolgorde uit het script (atTick); een gebouw dat nooit kan (andere factie, tech, hoofdgebouw) slaat hij over;
//  2. bouwers zonder werk helpen bij een eigen bouwplaats; is er geen bouwplaats en is de bouwvolgorde af, dan claimt
//     een vrije bouwer het neutrale claimpunt dat het dichtst bij het hoofdgebouw ligt (Claim-commando: het
//     claimgebouw van de factie, zodra hij het kan betalen). Pas na de bouwvolgorde, zodat die de bouwer niet
//     halverwege een claimpaal weghaalt;
//  3. scavengers zonder werk verzamelen bij de dichtstbijzijnde node;
//  4. met een werkplaats schoolt hij scavengers om tot militie tot militiaPermille (script) van zijn bewoners militie is,
//     en houdt hij één bouwer;
//  5. op elke attackTimersTicks stuurt hij alle militie met AttackMove naar de spawn van de eerste tegenstander die
//     nog meedoet; na de laatste golf gaat militie zonder werk ook die kant op. De held loopt mee met elke golf;
//  6. de held: een ability zonder cooldown gebruikt hij op zijn eigen plek zodra er een vijandelijke unit binnen de
//     straal staat (Lockdown); een gesneuvelde held lapt hij op bij het hoofdgebouw zodra hij het kan betalen (na de
//     bouwvolgorde van deze tick); een perk-keuze besteedt hij aan de eerste perk uit de perkPool die mag.

const ROLE_SCAVENGER = ROLES.indexOf('scavenger');
const ROLE_BUILDER = ROLES.indexOf('builder');

function chunks(ids: readonly number[]): number[][] {
  const out: number[][] = [];
  for (let k = 0; k < ids.length; k += MAX_ENTITIES_PER_COMMAND) out.push(ids.slice(k, k + MAX_ENTITIES_PER_COMMAND));
  return out;
}

export function aiSystem(ctx: SimContext, census: Census): void {
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
    think(ctx, census, p, ctx.config.aiScripts[si]!);
  }
}

/** Vrije plek voor een gebouw rond het hoofdgebouw: footprint plus een rand van één cel vrij, niet op nodes of claimpunten. */
function findSite(ctx: SimContext, hq: number, bt: SimBuildingType): { x: number; y: number } | null {
  const w = ctx.world;
  const map = ctx.map;
  const cx = w.fx[hq]! + (w.fw[hq]! >> 1);
  const cy = w.fy[hq]! + (w.fh[hq]! >> 1);
  const fw = bt.footprintW;
  const fh = bt.footprintH;
  for (let d = 1; d <= MAX_FREE_RING; d++) {
    let found = -1;
    scanRing(map, cx, cy, 1, 1, d, (x, y) => {
      const fx = x - (fw >> 1);
      const fy = y - (fh >> 1);
      if (!footprintFree(ctx, fx - 1, fy - 1, fw + 2, fh + 2)) return false;
      for (let j = 0; j < w.highWater; j++) {
        if (!w.has(j, C.resource) && !w.has(j, C.claim)) continue;
        if (distToRect2(w.x[j]!, w.y[j]!, fx - 1, fy - 1, fw + 2, fh + 2) === 0) return false;
      }
      found = y * map.w + x;
      return true;
    });
    if (found >= 0) return cellCenterOf(map, found);
  }
  return null;
}

/** Laat bouwer `builder` het neutrale claimpunt het dichtst bij het hoofdgebouw claimen (tiebreak laagste index). */
function claimNext(ctx: SimContext, p: number, hq: number, builder: number): void {
  const w = ctx.world;
  const typeId = ctx.config.factions[ctx.players[p]!.factionId]!.claimTypeId;
  const bt = typeId === 0 ? undefined : ctx.buildingType(typeId);
  if (bt === undefined || !canPlaceType(ctx, p, typeId) || ctx.ps.scrap[p]! < bt.scrapCost) return;
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
  if (best >= 0) applyCommand(ctx, { playerId: p, seq: 0, type: 'Claim', payload: { ids: [builder], pointId: w.idOf(best) } });
}

/** Spawn van de eerste tegenstander na p (cyclisch) die nog meedoet, of null. */
function enemySpawn(ctx: SimContext, p: number): { x: number; y: number } | null {
  for (let k = 1; k < ctx.playerCount; k++) {
    let q = p + k;
    if (q >= ctx.playerCount) q -= ctx.playerCount;
    if (ctx.ps.defeated[q] === 0) return ctx.map.spawns[q]!;
  }
  return null;
}

function think(ctx: SimContext, census: Census, p: number, script: SimAiScript): void {
  const w = ctx.world;
  const ps = ctx.ps;
  const tick = ctx.frame;
  const hq = census.hq[p]!;
  const roleTypes = ctx.config.factions[ctx.players[p]!.factionId]!.roleTypeIds;

  // Telling van de eigen units.
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
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] !== 1 || w.owner[i] !== p) continue;
    if (w.has(i, C.building)) {
      const bt = ctx.buildingType(w.typeId[i]!);
      if (bt !== undefined && w.bstate[i] === BSTATE_DONE && (bt.provides & PROVIDES_WORKSHOP) !== 0) workshop = true;
      if (site < 0 && w.bstate[i] === BSTATE_SITE) site = i;
      continue;
    }
    if (!w.has(i, C.unit | C.orders) || w.has(i, C.hero)) continue;
    units++;
    const ord = w.orderType(i);
    const id = w.idOf(i);
    if (ord === ORDER_CRAFT) {
      const to = w.ordX[w.currentOrder(i)]!;
      if (to === roleTypes[ROLE_MILITIA]) militiaPlanned++;
      if (to === roleTypes[ROLE_BUILDER]) buildersPlanned++;
      continue;
    }
    const role = w.role[i]!;
    if (role === ROLE_BUILDER) {
      builders.push(id);
      if (ord === ORDER_NONE) idleBuilders.push(id);
    } else if (role === ROLE_MILITIA) {
      militia.push(id);
      if (ord === ORDER_NONE) idleMilitia.push(id);
    } else if (role === ROLE_SCAVENGER) {
      scavs.push(id);
      if (ord === ORDER_NONE) idleScavs.push(id);
    }
  }

  // 1 bouwvolgorde
  let bi = ps.aiBuild[p]!;
  const order = script.buildOrder;
  while (hq >= 0 && bi < order.length && tick >= order[bi]!.atTick) {
    const typeId = order[bi]!.typeId;
    const bt = ctx.buildingType(typeId);
    if (bt === undefined || !canPlaceType(ctx, p, typeId)) {
      bi++;
      continue;
    }
    if (ps.scrap[p]! < bt.scrapCost) break;
    const builder = idleBuilders.length > 0 ? idleBuilders[0]! : builders[0];
    if (builder === undefined) break;
    const at = findSite(ctx, hq, bt);
    if (at === null) {
      bi++;
      continue;
    }
    if (applyCommand(ctx, { playerId: p, seq: 0, type: 'Build', payload: { ids: [builder], typeId, x: at.x, y: at.y } })) {
      bi++;
      const k = idleBuilders.indexOf(builder);
      if (k >= 0) idleBuilders.splice(k, 1);
    }
    break;
  }
  ps.aiBuild[p] = bi;

  // 2 bouwers zonder werk helpen bij een bouwplaats
  if (site >= 0 && idleBuilders.length > 0) {
    applyCommand(ctx, { playerId: p, seq: 0, type: 'Build', payload: { ids: idleBuilders, typeId: w.typeId[site]!, x: w.x[site]!, y: w.y[site]! } });
  }

  // 2b claimen na de bouwvolgorde
  if (hq >= 0 && site < 0 && bi >= order.length && idleBuilders.length > 0) claimNext(ctx, p, hq, idleBuilders[0]!);

  // 3 scavengers zonder werk naar de dichtstbijzijnde node
  for (const id of idleScavs) {
    const i = w.resolve(id);
    const node = nearestNode(ctx, p, w.x[i]!, w.y[i]!);
    if (node < 0) break;
    applyCommand(ctx, { playerId: p, seq: 0, type: 'Gather', payload: { ids: [id], nodeId: w.idOf(node) } });
  }

  // 4 omscholen: één bouwer houden, daarna militie tot het aandeel uit de tuning
  if (workshop && scavs.length > 0) {
    if (builders.length + buildersPlanned === 0) {
      applyCommand(ctx, { playerId: p, seq: 0, type: 'SetRole', payload: { ids: [scavs[0]!], role: 'builder' } });
    } else if (militia.length + militiaPlanned < idiv(units * script.militiaPermille, 1000)) {
      applyCommand(ctx, { playerId: p, seq: 0, type: 'SetRole', payload: { ids: [scavs[0]!], role: 'militia' } });
    }
  }

  // 6 de held: oplappen, perk kiezen, ability
  heroThink(ctx, p, hq);
  const hero = heroIndex(ctx, p);
  const heroId = hero < 0 ? -1 : w.idOf(hero);

  // 5 aanvalsgolven (de held loopt mee)
  const timers = script.attackTimersTicks;
  const ai = ps.aiAttack[p]!;
  const target = enemySpawn(ctx, p);
  if (target === null) return;
  let send: number[] = [];
  if (ai < timers.length && tick >= timers[ai]!) {
    ps.aiAttack[p] = ai + 1;
    send = [...militia];
    if (heroId >= 0) send.push(heroId);
  } else if (ai >= timers.length && timers.length > 0) {
    send = [...idleMilitia];
    if (heroId >= 0 && w.orderType(hero) === ORDER_NONE) send.push(heroId);
  }
  for (const ids of chunks(send)) applyCommand(ctx, { playerId: p, seq: 0, type: 'AttackMove', payload: { ids, x: target.x, y: target.y } });
}

function heroThink(ctx: SimContext, p: number, hq: number): void {
  const ps = ctx.ps;
  const w = ctx.world;
  const h = heroOf(ctx, p);
  if (h === undefined) return;
  if (ps.heroState[p] === HERO_DEAD && hq >= 0 && ps.scrap[p]! >= h.reviveScrap) {
    applyCommand(ctx, { playerId: p, seq: 0, type: 'Recruit', payload: { buildingId: w.idOf(hq) } });
  }
  if (ps.heroPending[p]! > 0) {
    for (const perkId of h.perkPool) {
      if (applyCommand(ctx, { playerId: p, seq: 0, type: 'PickPerk', payload: { heroId: h.heroId, perkId } })) break;
    }
  }
  const i = heroIndex(ctx, p);
  if (i < 0) return;
  for (let a = 0; a < h.abilities.length; a++) {
    if (ps.abCooldown[p * MAX_ABILITIES + a]! > 0) continue;
    const r = h.abilities[a]!.radiusU;
    let enemy = false;
    for (let j = 0; j < w.highWater && !enemy; j++) {
      if (!w.has(j, C.unit | C.health) || !isEnemy(w, i, j)) continue;
      const dx = w.x[j]! - w.x[i]!;
      const dy = w.y[j]! - w.y[i]!;
      enemy = dx * dx + dy * dy <= r * r;
    }
    if (enemy) applyCommand(ctx, { playerId: p, seq: 0, type: 'HeroAbility', payload: { heroId: h.heroId, abilityId: a, x: w.x[i]!, y: w.y[i]! } });
  }
}

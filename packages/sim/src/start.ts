import {
  createBuilding,
  createClaimPoint,
  createScrapNode,
  createUnit,
  footprintFree,
  footprintOrigin,
} from './entities.js';
import type { SimContext } from './systems/common.js';
import { MAX_FREE_RING, cellCenterOf, face, nthFreeCellAround } from './systems/common.js';
import { spawnStartHero } from './systems/hero.js';
import { heroOf } from './effects.js';
import { bindStartSlave } from './systems/slaves.js';

// Startopstelling (contract 2, besluit sprint 1): volgt deterministisch uit map, data en spelers, voor frame 0.
// Entity-ids in deze volgorde:
//  1. scrap-nodes in mapvolgorde (typeId SCRAP_NODE_TYPE_ID, eigenaar neutraal);
//  2. claimpunten in mapvolgorde (typeId CLAIM_POINT_TYPE_ID, eigenaar neutraal);
//  3. per speler in playerId-volgorde: het hoofdgebouw van zijn factie, gecentreerd op spawns[playerId], daarna
//     factions.startUnits in bestandsvolgorde, één unit per vrije cel rond het hoofdgebouw (ring voor ring,
//     rij voor rij), kijkend naar het midden van de map; daarna zijn held (als de factie er een heeft) op de
//     volgende vrije cel. Start units of a slave loadout (Raiders) are slaves bound to the headquarters (a cage).
// Elke speler krijgt startScrap.

/**
 * Footprint origin of a headquarters centred on (x, y). Survival co-op (sim 0.27.0): the zone centre comes from map
 * percentages, so when the footprint does not fit there, the free origin nearest to it (ring by ring around the cell,
 * by centre distance, then scan order) within MAX_FREE_RING; elsewhere the spawn must fit as it is.
 */
function hqOrigin(ctx: SimContext, x: number, y: number, fw: number, fh: number) {
  const o = footprintOrigin(x, y, fw, fh);
  if (ctx.map.survival === undefined || footprintFree(ctx, o.fx, o.fy, fw, fh)) return o;
  for (let d = 1; d <= MAX_FREE_RING; d++) {
    let best: { fx: number; fy: number } | null = null;
    let bestD = 0;
    for (let oy = o.fy - d; oy <= o.fy + d; oy++)
      for (let ox = o.fx - d; ox <= o.fx + d; ox++) {
        if (ox !== o.fx - d && ox !== o.fx + d && oy !== o.fy - d && oy !== o.fy + d) continue;
        if (!footprintFree(ctx, ox, oy, fw, fh)) continue;
        const dx = (ox << 8) + (fw << 7) - x;
        const dy = (oy << 8) + (fh << 7) - y;
        const dd = dx * dx + dy * dy;
        if (best === null || dd < bestD) {
          best = { fx: ox, fy: oy };
          bestD = dd;
        }
      }
    if (best !== null) return best;
  }
  return o;
}

export function setupStart(ctx: SimContext): void {
  const map = ctx.map;
  for (const n of map.scrapNodes)
    if (createScrapNode(ctx, n.x, n.y, n.amount) < 0) throw new Error('start: wereld vol');
  for (const c of map.claimPoints)
    if (createClaimPoint(ctx, c.x, c.y) < 0) throw new Error('start: wereld vol');
  const midX = map.w << 7;
  const midY = map.h << 7;
  for (let p = 0; p < ctx.playerCount; p++) {
    const faction = ctx.config.factions[ctx.players[p]!.factionId]!;
    ctx.ps.scrap[p] = faction.startScrap;
    const spawn = map.spawns[p]!;
    const bt = ctx.buildingType(faction.hqTypeId)!;
    const { fx, fy } = hqOrigin(ctx, spawn.x, spawn.y, bt.footprintW, bt.footprintH);
    if (!footprintFree(ctx, fx, fy, bt.footprintW, bt.footprintH))
      throw new Error(
        `start: hoofdgebouw van speler ${p} past niet op spawn ${spawn.x},${spawn.y}`,
      );
    const hq = createBuilding(ctx, bt, p, fx, fy, true);
    if (hq < 0) throw new Error('start: wereld vol');
    let k = 0;
    for (const su of faction.startUnits) {
      const t = ctx.unitType(su.typeId)!;
      for (let n = 0; n < su.count; n++) {
        const c = nthFreeCellAround(ctx, fx, fy, bt.footprintW, bt.footprintH, k++);
        if (c < 0) throw new Error(`start: geen vrije cel voor startunit ${k} van speler ${p}`);
        const at = cellCenterOf(map, c);
        const i = createUnit(ctx, t, p, at.x, at.y, 0);
        if (i < 0) throw new Error('start: wereld vol');
        face(ctx.world, i, midX, midY);
        // Raiders (data 0.21.0): a slave start unit is a slave of the headquarters (the Raiderkamp is a cage)
        bindStartSlave(ctx, i, hq);
      }
    }
    if (heroOf(ctx, p) !== undefined) {
      const c = nthFreeCellAround(ctx, fx, fy, bt.footprintW, bt.footprintH, k++);
      if (c < 0) throw new Error(`start: geen vrije cel voor de held van speler ${p}`);
      spawnStartHero(ctx, p, c, midX, midY);
    }
  }
}

import {
  createBuilding,
  createClaimPoint,
  createScrapNode,
  createUnit,
  footprintFree,
  footprintOrigin,
} from './entities.js';
import type { SimContext } from './systems/common.js';
import { cellCenterOf, face, nthFreeCellAround } from './systems/common.js';
import { spawnStartHero } from './systems/hero.js';
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
    const { fx, fy } = footprintOrigin(spawn.x, spawn.y, bt.footprintW, bt.footprintH);
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
    if (faction.heroId >= 0) {
      const c = nthFreeCellAround(ctx, fx, fy, bt.footprintW, bt.footprintH, k++);
      if (c < 0) throw new Error(`start: geen vrije cel voor de held van speler ${p}`);
      spawnStartHero(ctx, p, c, midX, midY);
    }
  }
}

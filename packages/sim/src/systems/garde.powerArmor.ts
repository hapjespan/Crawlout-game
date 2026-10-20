import { C } from '../ecs/world.js';
import { applyStats } from '../effects.js';
import { createUnit } from '../entities.js';
import { CLAIM_KINDS } from '../fromData.js';
import type { SimContext } from './common.js';
import { cellCenterOf, nearestFreeCellAround } from './common.js';

// The Garde, round B (sim 0.33.0, data 0.39.0 factions mapPowerArmor; proposal for the architect; docs/garde.md item 4):
// the power armour of the map. System 6, after the fusion cores. A claim point of kind powerArmor that a player holds
// (World.owner, systems/claims.ts) gives him a frame of mapPowerArmor.typeId on the free cell next to it nearest to the
// point, respawnTicks after he took the point or after his last frame of that point died. A frame for a player of another
// faction than the one with mapPowerArmor (the Dwellers and the Raiders) has otherQualityPermille of its hp and damage
// (GardeState.quality, garde.ts veteranPermille). Only where a Garde player plays (garde.active): the frames are Garde
// tech, and every other match keeps its behaviour and hash. Per point: holder + 1, his wait and the id of his frame.

const KIND_POWER_ARMOR = CLAIM_KINDS.indexOf('powerArmor');

export function mapPowerArmorSystem(ctx: SimContext): void {
  const g = ctx.garde;
  if (!g.active) return;
  const own = ctx.config.factions.find((f) => f.mapPowerArmor !== null);
  const m = own?.mapPowerArmor;
  if (own === undefined || m === undefined || m === null) return;
  const t = ctx.unitType(m.typeId);
  if (t === undefined) return;
  const w = ctx.world;
  for (let k = 0; k < ctx.claimPoints.length; k++) {
    if (ctx.map.claimPoints[k]?.kind !== KIND_POWER_ARMOR) continue;
    const pt = ctx.claimPoints[k]!;
    const o = w.owner[pt]!;
    const holder = o < ctx.playerCount && ctx.ps.defeated[o] === 0 ? o + 1 : 0;
    if (holder !== g.paHolder[pt]) {
      g.paHolder[pt] = holder;
      g.paTimer[pt] = 0;
    }
    if (holder === 0) continue;
    const f = g.paFrame[pt] === 0 ? -1 : w.resolve(g.paFrame[pt]!);
    const alive = f >= 0 && w.owner[f] === o && w.has(f, C.unit | C.health) && w.hp[f]! > 0;
    if (alive) continue;
    g.paFrame[pt] = 0;
    g.paTimer[pt] = g.paTimer[pt]! + 1;
    if (g.paTimer[pt]! < m.respawnTicks) continue;
    const c = nearestFreeCellAround(ctx, w.x[pt]! >> 8, w.y[pt]! >> 8, 1, 1, w.x[pt]!, w.y[pt]!);
    if (c < 0) continue;
    const at = cellCenterOf(ctx.map, c);
    const i = createUnit(ctx, t, o, at.x, at.y, 0);
    if (i < 0) continue;
    if (ctx.players[o]!.factionId !== own.factionId) {
      g.quality[i] = m.otherQualityPermille;
      applyStats(ctx, i, false);
      w.hp[i] = w.maxHp[i]!;
    }
    g.paFrame[pt] = w.idOf(i);
    g.paTimer[pt] = 0;
  }
}

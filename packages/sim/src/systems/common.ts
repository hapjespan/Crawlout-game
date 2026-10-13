import type { SimConfig, SimMap } from '../config.js';
import type { World } from '../ecs/world.js';
import { NO_FIELD } from '../ecs/world.js';
import type { FlowFields } from '../flowfield.js';

/** Wat de systemen van de sim nodig hebben. Eén object, zodat de systemen losse functies blijven. */
export interface SimContext {
  readonly world: World;
  readonly flow: FlowFields;
  readonly map: SimMap;
  readonly config: SimConfig;
  readonly playerCount: number;
}

/** Wisselt het flow field van een unit en houdt de refcount bij (afgeleide data). */
export function setFlowField(ctx: SimContext, i: number, slot: number): void {
  const w = ctx.world;
  const old = w.flowField[i]!;
  if (old === slot) return;
  if (old !== NO_FIELD) ctx.flow.refcount[old] = ctx.flow.refcount[old]! - 1;
  w.flowField[i] = slot;
  if (slot !== NO_FIELD) ctx.flow.refcount[slot] = ctx.flow.refcount[slot]! + 1;
}

/** Cel-index voor een positie in eenheden (moet binnen de map liggen). */
export const cellAt = (map: SimMap, x: number, y: number): number => (y >> 8) * map.w + (x >> 8);

export const inMap = (map: SimMap, x: number, y: number): boolean => x >= 0 && y >= 0 && x < map.w << 8 && y < map.h << 8;

export const passableAt = (map: SimMap, x: number, y: number): boolean => map.passable[cellAt(map, x, y)] === 1;

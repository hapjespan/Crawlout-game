import { COMMAND_PAYLOADS } from '@crawlout/protocol';
import type { CommandEnvelope } from '@crawlout/protocol';
import { C, NO_FIELD, NO_GOAL, ORDER_MOVE } from '../ecs/world.js';
import { idiv, isInt } from '../math/int.js';
import { isqrt } from '../math/sqrt.js';
import type { SimContext } from './common.js';
import { cellAt, inMap, setFlowField } from './common.js';

// Systeem 1: commando's van deze tick toepassen. Volgorde: playerId, dan seq, dan positie in de bundel.
// Elk commando wordt gevalideerd (schema, speler, eigenaar, bereik); ongeldige delen worden stil genegeerd.

export function applyCommands(ctx: SimContext, cmds: readonly CommandEnvelope[]): void {
  if (cmds.length === 0) return;
  const order: number[] = [];
  for (let i = 0; i < cmds.length; i++) order.push(i);
  order.sort((a, b) => {
    const ca = cmds[a]!;
    const cb = cmds[b]!;
    return ca.playerId - cb.playerId || ca.seq - cb.seq || a - b;
  });
  for (const k of order) applyCommand(ctx, cmds[k]!);
}

function applyCommand(ctx: SimContext, cmd: CommandEnvelope): void {
  if (!isInt(cmd.playerId) || cmd.playerId < 0 || cmd.playerId >= ctx.playerCount) return;
  switch (cmd.type) {
    case 'Move':
      applyMove(ctx, cmd);
      return;
    case 'Stop':
      applyStop(ctx, cmd);
      return;
    default:
      // Overige typen volgen in sprint 2; tot dan no-op.
      return;
  }
}

/** Indices van levende entities met deze ids die van `playerId` zijn en `needMask` hebben. */
function ownedWith(ctx: SimContext, ids: readonly number[], playerId: number, needMask: number): number[] {
  const w = ctx.world;
  const out: number[] = [];
  for (const id of ids) {
    const i = w.resolve(id);
    if (i < 0) continue;
    if (w.owner[i] !== playerId || (w.mask[i]! & C.owner) === 0) continue;
    if ((w.mask[i]! & needMask) !== needMask) continue;
    out.push(i);
  }
  return out;
}

function applyMove(ctx: SimContext, cmd: CommandEnvelope): void {
  const p = COMMAND_PAYLOADS.Move.safeParse(cmd.payload);
  if (!p.success) return;
  const { ids, x, y } = p.data;
  if (!inMap(ctx.map, x, y)) return;
  const units = ownedWith(ctx, ids, cmd.playerId, C.movement | C.orders | C.transform);
  if (units.length === 0) return;
  const w = ctx.world;
  // Eerst iedereen loskoppelen, zodat een veld dat alleen deze groep gebruikte weer beschikbaar is.
  for (const i of units) setFlowField(ctx, i, NO_FIELD);
  const slot = ctx.flow.acquire(cellAt(ctx.map, x, y));
  // Straal van de cirkel waarin de groep dicht gepakt past (pakkingsdichtheid ongeveer 0,8), plus één straal marge.
  const n = units.length;
  for (const i of units) {
    const r = w.radius[i]!;
    w.groupR[i] = isqrt(idiv(r * r * n * 5, 4)) + r;
    w.clearOrders(i);
    w.pushOrder(i, ORDER_MOVE, x, y);
    w.goalX[i] = x;
    w.goalY[i] = y;
    setFlowField(ctx, i, slot);
  }
}

function applyStop(ctx: SimContext, cmd: CommandEnvelope): void {
  const p = COMMAND_PAYLOADS.Stop.safeParse(cmd.payload);
  if (!p.success) return;
  const w = ctx.world;
  for (const i of ownedWith(ctx, p.data.ids, cmd.playerId, C.orders)) {
    w.clearOrders(i);
    w.goalX[i] = NO_GOAL;
    w.goalY[i] = NO_GOAL;
    w.groupR[i] = 0;
    setFlowField(ctx, i, NO_FIELD);
  }
}

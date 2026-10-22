// Client entry, stage 3 (see main.ts): who owns what in the latest snapshot, and the orders a right click gives.
import {
  ANIM,
  ENTITY_FLAG,
  MAX_ENTITIES_PER_COMMAND,
  OWNER_NEUTRAL,
  type CommandPayload,
  type CommandType,
} from '@crawlout/protocol';
import { ROLES, kindOfTypeId } from '@crawlout/data';
import { isProjectRuin } from './game/project.js';
import type { EntityRow } from './game/snapshot.js';
import type { ClientContext } from './main.context.js';

export function wireOrders(ctx: ClientContext): void {
  const { data, renderer, session, loadoutOf, heroOf } = ctx;

  const mine = (ids: Iterable<number>): number[] =>
    [...ids].filter((id) => ctx.entities.get(id)?.owner === session.playerId);
  /**
   * Hostile: another player's unit or building, or a neutral unit (a bandit of a creep camp, sim 0.20.0; the sim refuses
   * an Attack on a neutral wanderer for anyone but a Slaver). Neutral nodes and claim points are not.
   */
  const hostileRow = (e: EntityRow): boolean =>
    e.owner !== session.playerId &&
    (e.owner !== OWNER_NEUTRAL || kindOfTypeId(e.typeId).kind === 'unit');
  /** An enemy unit or building (not own, not a neutral node or claim point): clicking one inspects it, nothing more. */
  const isEnemyId = (id: number): boolean => {
    const e = ctx.entities.get(id);
    return e !== undefined && hostileRow(e);
  };
  /** Own entities of the latest snapshot, shared by the card and building-button deps (read at 20 Hz). */
  const own = (): EntityRow[] =>
    (ctx.ownCache ??= [...ctx.entities.values()].filter((e) => e.owner === session.playerId));
  const roleIdx = (role: string): number => ROLES.indexOf(role as (typeof ROLES)[number]);
  /** Builds like a builder (sim common.ts canBuild): role builder, or a robot with canBuild (the Bouwrobot, data 0.26.0). */
  const canBuildId = (id: number): boolean => {
    const l = loadoutOf(ctx.entities.get(id)!.typeId);
    return l !== undefined && (l.role === roleIdx('builder') || l.canBuild);
  };

  /** Commands carry at most 64 entity ids; larger selections are split. */
  function sendChunked<T extends CommandType>(
    type: T,
    ids: number[],
    extra: Omit<CommandPayload<T>, 'ids'>,
  ): void {
    for (let i = 0; i < ids.length; i += MAX_ENTITIES_PER_COMMAND) {
      session.sendCommand(type, {
        ids: ids.slice(i, i + MAX_ENTITIES_PER_COMMAND),
        ...extra,
      } as CommandPayload<T>);
    }
  }

  /** Right click: attack an enemy, gather from a scrap node, claim a point, otherwise move. */
  function orderAt(px: number, py: number): void {
    const ids = mine(ctx.selection).filter(
      (id) => loadoutOf(ctx.entities.get(id)!.typeId) || heroOf(ctx.entities.get(id)!.typeId),
    );
    if (ids.length === 0) return;
    const hit = renderer.pickAt(px, py);
    const target = hit.entityId === null ? undefined : ctx.entities.get(hit.entityId);
    if (target) {
      const kind = kindOfTypeId(target.typeId).kind;
      const hostile = hostileRow(target);
      // fog of war: a ghost (an enemy building as last seen) is no valid Attack target; attack-move to its spot
      if (hostile && (target.flags & ENTITY_FLAG.ghost) !== 0)
        return sendChunked('AttackMove', ids, { x: target.x, y: target.y });
      if (hostile && (kind === 'unit' || kind === 'building'))
        return sendChunked('Attack', ids, { target: target.id });
      if (kind === 'scrapNode') {
        const scavengers = ids.filter(
          (id) => loadoutOf(ctx.entities.get(id)!.typeId)?.role === roleIdx('scavenger'),
        );
        if (scavengers.length > 0) return sendChunked('Gather', scavengers, { nodeId: target.id });
      }
      // win route C: builders on a ruin of the strip mall restore it (Build with its type and centre)
      if (
        kind === 'building' &&
        target.owner === OWNER_NEUTRAL &&
        isProjectRuin(data, target.typeId)
      ) {
        const builders = ids.filter(canBuildId);
        if (builders.length > 0)
          return sendChunked('Build', builders, {
            typeId: target.typeId,
            x: target.x,
            y: target.y,
          });
      }
      if (kind === 'building' && target.owner === session.playerId && target.anim === ANIM.build) {
        // Unfinished own building: builders resume or help (Build on an own site of the same type helps).
        const builders = ids.filter(canBuildId);
        if (builders.length > 0)
          return sendChunked('Build', builders, {
            typeId: target.typeId,
            x: target.x,
            y: target.y,
          });
      }
      if (kind === 'claimPoint') {
        // Claim builds the faction's claim post next to the point: only builders can (sim contract 2).
        const builders = ids.filter(canBuildId);
        if (builders.length > 0) return sendChunked('Claim', builders, { pointId: target.id });
      }
    }
    if (hit.ground)
      sendChunked('Move', ids, { x: Math.round(hit.ground.x), y: Math.round(hit.ground.y) });
  }

  ctx.mine = mine;
  ctx.hostileRow = hostileRow;
  ctx.isEnemyId = isEnemyId;
  ctx.own = own;
  ctx.canBuildId = canBuildId;
  ctx.sendChunked = sendChunked;
  ctx.orderAt = orderAt;
}

// Reads what the client needs from a sim snapshot (contract 1): live entities for selection, HUD and minimap,
// plus the events that become HUD alerts. The renderer reads the same buffer on its own.
import { ENTITY_FLAG, EVENT_TYPE, readSnapshotHeader, snapshotLayout } from '@crawlout/protocol';

export interface EntityRow {
  id: number;
  typeId: number;
  owner: number;
  x: number;
  y: number;
  hpPct: number;
  /** ANIM id and ENTITY_FLAG bits from the snapshot: what the entity is doing right now. */
  anim: number;
  flags: number;
}

export interface SnapshotEvent {
  type: number;
  a: number;
  b: number;
  x: number;
  y: number;
}

export interface ParsedSnapshot {
  tick: number;
  entities: Map<number, EntityRow>;
  events: SnapshotEvent[];
}

/**
 * Parses the snapshot and stamps the client-side selection into its flags before the renderer sees it.
 * Dead entities (corpses) are left out of `entities`.
 */
export function readSnapshot(buf: ArrayBuffer, selection: ReadonlySet<number>): ParsedSnapshot {
  const { tick, entityCount, eventCount } = readSnapshotHeader(buf);
  const layout = snapshotLayout(entityCount, eventCount);
  const ids = new Uint32Array(buf, layout.entity.id, entityCount);
  const typeIds = new Uint16Array(buf, layout.entity.typeId, entityCount);
  const owners = new Uint8Array(buf, layout.entity.owner, entityCount);
  const xs = new Int32Array(buf, layout.entity.x, entityCount);
  const ys = new Int32Array(buf, layout.entity.y, entityCount);
  const hp = new Uint8Array(buf, layout.entity.hpPct, entityCount);
  const anims = new Uint8Array(buf, layout.entity.anim, entityCount);
  const flags = new Uint8Array(buf, layout.entity.flags, entityCount);

  const entities = new Map<number, EntityRow>();
  for (let i = 0; i < entityCount; i++) {
    const id = ids[i]!;
    if (selection.has(id)) flags[i] = flags[i]! | ENTITY_FLAG.selected;
    if ((flags[i]! & ENTITY_FLAG.dead) !== 0) continue;
    entities.set(id, { id, typeId: typeIds[i]!, owner: owners[i]!, x: xs[i]!, y: ys[i]!, hpPct: hp[i]!, anim: anims[i]!, flags: flags[i]! });
  }

  const evType = new Uint8Array(buf, layout.event.type, eventCount);
  const evA = new Uint32Array(buf, layout.event.a, eventCount);
  const evB = new Uint32Array(buf, layout.event.b, eventCount);
  const evX = new Int32Array(buf, layout.event.x, eventCount);
  const evY = new Int32Array(buf, layout.event.y, eventCount);
  const events: SnapshotEvent[] = [];
  for (let i = 0; i < eventCount; i++) events.push({ type: evType[i]!, a: evA[i]!, b: evB[i]!, x: evX[i]!, y: evY[i]! });

  return { tick, entities, events };
}

export { EVENT_TYPE };

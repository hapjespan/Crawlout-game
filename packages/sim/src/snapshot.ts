import { snapshotLayout, writeSnapshotHeader } from '@crawlout/protocol';
import type { World } from './ecs/world.js';
import { C } from './ecs/world.js';
import type { EventBuffer } from './events.js';
import { clampI, idiv } from './math/int.js';

/**
 * Schrijft één snapshot volgens contract 1 (packages/protocol/src/snapshot.ts) in een nieuwe ArrayBuffer,
 * geschikt als transferable. Entities in oplopende id-volgorde, daarna de events van de laatste tick.
 */
export function writeSnapshot(w: World, events: EventBuffer, tick: number, hash: number): ArrayBuffer {
  const count = w.liveCount();
  const evCount = events.count;
  const layout = snapshotLayout(count, evCount);
  const buf = new ArrayBuffer(layout.totalBytes);
  writeSnapshotHeader(buf, { tick, hash, entityCount: count, eventCount: evCount });

  const e = layout.entity;
  const id = new Uint32Array(buf, e.id, count);
  const x = new Int32Array(buf, e.x, count);
  const y = new Int32Array(buf, e.y, count);
  const typeId = new Uint16Array(buf, e.typeId, count);
  const yaw = new Uint16Array(buf, e.yaw, count);
  const animT = new Uint16Array(buf, e.animT, count);
  const owner = new Uint8Array(buf, e.owner, count);
  const anim = new Uint8Array(buf, e.anim, count);
  const hpPct = new Uint8Array(buf, e.hpPct, count);
  const flags = new Uint8Array(buf, e.flags, count);

  let k = 0;
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] !== 1) continue;
    id[k] = w.idOf(i);
    x[k] = w.x[i]!;
    y[k] = w.y[i]!;
    typeId[k] = w.typeId[i]!;
    yaw[k] = w.yaw[i]!;
    animT[k] = w.animT[i]!;
    owner[k] = w.owner[i]!;
    anim[k] = w.anim[i]!;
    const max = w.maxHp[i]!;
    hpPct[k] = (w.mask[i]! & C.health) !== 0 && max > 0 ? clampI(idiv(w.hp[i]! * 100, max), 0, 100) : 100;
    flags[k] = w.flags[i]!;
    k++;
  }

  const v = layout.event;
  new Uint8Array(buf, v.type, evCount).set(events.type.subarray(0, evCount));
  new Uint32Array(buf, v.a, evCount).set(events.a.subarray(0, evCount));
  new Uint32Array(buf, v.b, evCount).set(events.b.subarray(0, evCount));
  new Int32Array(buf, v.x, evCount).set(events.x.subarray(0, evCount));
  new Int32Array(buf, v.y, evCount).set(events.y.subarray(0, evCount));
  return buf;
}

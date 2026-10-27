// The per-tick step of FakeSnapshotSource (next()), as a function taking the source instance.
import { ANGLE_FULL, ANIM, ENTITY_FLAG } from '@crawlout/protocol';
import { CLIPS } from '../units/rig.js';
import {
  RUN_UNITS_PER_TICK,
  TICKS_PER_SECOND,
  WALK_UNITS_PER_TICK,
  type FakeSourceInternals,
} from './fakeSnapshots.shared.js';
import { allocSnapshot, type EventRecord } from './snapshotWriter.js';

/** Advances one tick and returns the snapshot for it. */
export function fakeNext(src: FakeSourceInternals): ArrayBuffer {
  src.tick++;
  const n = src.count;
  const events: EventRecord[] = [];
  for (let i = 0; i < n; i++) {
    const mode = src.mode[i]!;
    const clip = CLIPS[src.anim[i]!]!;
    const before = src.animT[i]!;
    let t = before + 1 / (clip.duration * TICKS_PER_SECOND);
    if (t >= 1) t = clip.loop ? t - 1 : 1;
    src.animT[i] = t;
    if (mode === 'attack2' && t < before) src.shoot(i, events);

    if (mode === 'walk' || mode === 'run') {
      const dx = src.tx[i]! - src.x[i]!;
      const dy = src.ty[i]! - src.y[i]!;
      const dist = Math.hypot(dx, dy);
      const speed = mode === 'run' ? RUN_UNITS_PER_TICK : WALK_UNITS_PER_TICK;
      if (dist <= speed) {
        src.x[i] = src.tx[i]!;
        src.y[i] = src.ty[i]!;
        src.arrive(i);
      } else {
        src.x[i] = src.x[i]! + Math.round((dx / dist) * speed);
        src.y[i] = src.y[i]! + Math.round((dy / dist) * speed);
        src.face(i, dx, dy);
      }
    } else {
      src.timer[i] = src.timer[i]! - 1;
      if (src.timer[i]! <= 0) {
        if (mode === 'dead') src.respawn(i, events);
        else src.startLeg(i);
      }
    }
  }
  if (src.combat) {
    src.worldEvents(events);
    src.turretFire(events);
    src.heroZones(events);
  }
  src.advanceStructures(events);
  for (let k = src.pending.length - 1; k >= 0; k--) {
    if (src.pending[k]!.atTick > src.tick) continue;
    events.push(src.pending[k]!.event);
    src.pending.splice(k, 1);
  }

  const structures = src.structures;
  const total = n + structures.length;
  const snap = allocSnapshot(src.tick, Math.imul(src.tick, 2654435761) >>> 0, total, events.length);
  const e = snap.entities;
  for (let i = 0; i < n; i++) {
    const id = src.ids[i]!;
    e.id[i] = id;
    e.x[i] = src.x[i]!;
    e.y[i] = src.y[i]!;
    e.typeId[i] = src.typeIdOf(i);
    e.yaw[i] = src.yaw[i]!;
    e.animT[i] = Math.min(ANGLE_FULL - 1, Math.floor(src.animT[i]! * ANGLE_FULL));
    e.owner[i] = src.owner[i]!;
    e.anim[i] = src.anim[i]!;
    const dead = src.mode[i] === 'dead';
    e.hpPct[i] = dead ? 0 : 100;
    const isFighting = src.mode[i] === 'attack1' || src.mode[i] === 'attack2';
    e.flags[i] =
      (src.selected.has(id) ? ENTITY_FLAG.selected : 0) |
      (isFighting ? ENTITY_FLAG.inCombat : 0) |
      (dead ? ENTITY_FLAG.dead : 0);
  }
  structures.forEach((s, k) => {
    const i = n + k;
    e.id[i] = s.id;
    e.x[i] = s.x;
    e.y[i] = s.y;
    e.typeId[i] = s.typeId;
    e.owner[i] = s.owner;
    const site = s.site;
    const progress = site ? Math.max(0, src.tick - site.start) / site.ticks : 0;
    e.anim[i] = site ? ANIM.build : ANIM.idle;
    e.animT[i] = site ? Math.min(ANGLE_FULL - 1, Math.floor(progress * ANGLE_FULL)) : 0;
    e.hpPct[i] = s.stock ?? 100;
    e.flags[i] = src.selected.has(s.id) ? ENTITY_FLAG.selected : 0;
  });
  events.forEach((r, k) => {
    snap.events.type[k] = r.type;
    snap.events.a[k] = r.a ?? 0;
    snap.events.b[k] = r.b ?? 0;
    snap.events.x[k] = r.x ?? 0;
    snap.events.y[k] = r.y ?? 0;
  });
  return snap.buffer;
}

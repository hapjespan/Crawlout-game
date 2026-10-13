// Fake snapshot source for the render demo and tests: units wandering over the map, no sim involved.
// Output follows contract 1 exactly (snapshotLayout); positions in sim units, yaw 0..65535, animT 0..65535.
// Yaw convention (protocol, YAW_PLUS_X / YAW_PLUS_Y): 0 faces sim +x, increasing towards sim +y,
// so a direction (dx, dy) has yaw atan2(dy, dx).
import { ANGLE_FULL, ENTITY_FLAG, EVENT_TYPE, TICK_MS, UNITS_PER_METER } from '@crawlout/protocol';
import { CLIP, CLIPS } from '../units/rig.js';
import { allocSnapshot } from './snapshotWriter.js';

export interface FakeSnapshotOptions {
  /** Number of units. Default 200. */
  count?: number;
  /** Owners 0..players-1. Default 4. */
  players?: number;
  /** World edge length in meters. Default 128 (slice map Rustbelt). */
  worldSize?: number;
  seed?: number;
}

export const FAKE_UNIT_TYPE_ID = 1;
const WALK_UNITS_PER_TICK = Math.round((1.5 * UNITS_PER_METER * TICK_MS) / 1000);
const RUN_UNITS_PER_TICK = Math.round((4.2 * UNITS_PER_METER * TICK_MS) / 1000);
const TICKS_PER_SECOND = 1000 / TICK_MS;

type Mode = 'walk' | 'run' | 'idle' | 'gather' | 'build' | 'attack1' | 'attack2';

/** What a unit does on arrival: cumulative probability thresholds, the remainder is attack2. */
const ARRIVAL_ACTIVITIES: readonly { upTo: number; mode: Mode }[] = [
  { upTo: 0.5, mode: 'walk' },
  { upTo: 0.65, mode: 'idle' },
  { upTo: 0.77, mode: 'gather' },
  { upTo: 0.87, mode: 'build' },
  { upTo: 0.94, mode: 'attack1' },
];

export class FakeSnapshotSource {
  tick = 0;
  readonly count: number;
  readonly ids: Uint32Array;
  private readonly x: Int32Array;
  private readonly y: Int32Array;
  private readonly tx: Int32Array;
  private readonly ty: Int32Array;
  private readonly yaw: Uint16Array;
  private readonly owner: Uint8Array;
  private readonly anim: Uint8Array;
  private readonly animT: Float64Array; // fraction 0..1, float so slow clips don't stall on rounding
  private readonly timer: Int32Array; // ticks left in a stationary activity
  private readonly mode: Mode[];
  private readonly selected = new Set<number>();
  private readonly size: number;
  private rng: number;

  constructor(opts: FakeSnapshotOptions = {}) {
    const n = (this.count = opts.count ?? 200);
    const players = opts.players ?? 4;
    this.size = Math.round((opts.worldSize ?? 128) * UNITS_PER_METER);
    this.rng = (opts.seed ?? 0x2f6b3a1d) >>> 0 || 1;
    this.ids = new Uint32Array(n);
    this.x = new Int32Array(n);
    this.y = new Int32Array(n);
    this.tx = new Int32Array(n);
    this.ty = new Int32Array(n);
    this.yaw = new Uint16Array(n);
    this.owner = new Uint8Array(n);
    this.anim = new Uint8Array(n);
    this.animT = new Float64Array(n);
    this.timer = new Int32Array(n);
    this.mode = new Array<Mode>(n).fill('walk');
    for (let i = 0; i < n; i++) {
      this.ids[i] = i + 1;
      this.owner[i] = i % players;
      // Each team starts in its own quadrant so team colors read as groups.
      const qx = (i % players) & 1;
      const qy = ((i % players) >> 1) & 1;
      const half = this.size >> 1;
      this.x[i] = qx * half + this.randInt(half >> 3, half - (half >> 3));
      this.y[i] = qy * half + this.randInt(half >> 3, half - (half >> 3));
      this.startLeg(i);
      this.animT[i] = this.rand(); // desync the gaits
    }
  }

  private rand(): number {
    let s = this.rng;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.rng = s >>> 0;
    return this.rng / 4294967296;
  }

  private randInt(min: number, max: number): number {
    return min + Math.floor(this.rand() * (max - min));
  }

  private startLeg(i: number, tx?: number, ty?: number): void {
    const margin = 4 * UNITS_PER_METER;
    const r = 24 * UNITS_PER_METER;
    this.tx[i] = tx ?? Math.min(this.size - margin, Math.max(margin, this.x[i]! + this.randInt(-r, r)));
    this.ty[i] = ty ?? Math.min(this.size - margin, Math.max(margin, this.y[i]! + this.randInt(-r, r)));
    this.mode[i] = this.rand() < 0.2 ? 'run' : 'walk';
    this.setAnim(i, this.mode[i] === 'run' ? CLIP.run : CLIP.walk);
  }

  private setAnim(i: number, clip: number): void {
    if (this.anim[i] !== clip) this.animT[i] = 0;
    this.anim[i] = clip;
  }

  private arrive(i: number): void {
    const r = this.rand();
    const pick = ARRIVAL_ACTIVITIES.find((a) => r < a.upTo)?.mode ?? 'attack2';
    if (pick === 'walk') {
      this.startLeg(i);
      return;
    }
    this.mode[i] = pick;
    this.timer[i] = this.randInt(1 * TICKS_PER_SECOND, 4 * TICKS_PER_SECOND);
    this.setAnim(i, CLIP[pick]);
  }

  /** Mirrors a selection command: the sim would set the selected flag on these ids. */
  setSelected(ids: Iterable<number>): void {
    this.selected.clear();
    for (const id of ids) this.selected.add(id);
  }

  /** Mirrors a move command: send the given ids towards (x, y) in sim units. */
  moveTo(ids: Iterable<number>, x: number, y: number): void {
    const want = new Set(ids);
    let k = 0;
    for (let i = 0; i < this.count; i++) {
      if (!want.has(this.ids[i]!)) continue;
      // Spread the group on a small spiral so they don't stack on one point.
      const a = k * 2.4;
      const rr = Math.sqrt(k) * 0.9 * UNITS_PER_METER;
      this.startLeg(i, Math.round(x + Math.cos(a) * rr), Math.round(y + Math.sin(a) * rr));
      this.mode[i] = 'run';
      this.setAnim(i, CLIP.run);
      k++;
    }
  }

  /** Advances one tick and returns the snapshot for it. */
  next(): ArrayBuffer {
    this.tick++;
    const n = this.count;
    const shots: number[] = [];
    for (let i = 0; i < n; i++) {
      const mode = this.mode[i]!;
      const clip = CLIPS[this.anim[i]!]!;
      const before = this.animT[i]!;
      let t = before + 1 / (clip.duration * TICKS_PER_SECOND);
      if (t >= 1) t = clip.loop ? t - 1 : 1;
      this.animT[i] = t;
      if (mode === 'attack2' && t < before) shots.push(i);

      if (mode === 'walk' || mode === 'run') {
        const dx = this.tx[i]! - this.x[i]!;
        const dy = this.ty[i]! - this.y[i]!;
        const dist = Math.hypot(dx, dy);
        const speed = mode === 'run' ? RUN_UNITS_PER_TICK : WALK_UNITS_PER_TICK;
        if (dist <= speed) {
          this.x[i] = this.tx[i]!;
          this.y[i] = this.ty[i]!;
          this.arrive(i);
        } else {
          this.x[i] = this.x[i]! + Math.round((dx / dist) * speed);
          this.y[i] = this.y[i]! + Math.round((dy / dist) * speed);
          const a = Math.round((Math.atan2(dy, dx) / (Math.PI * 2)) * ANGLE_FULL);
          this.yaw[i] = ((a % ANGLE_FULL) + ANGLE_FULL) % ANGLE_FULL;
        }
      } else {
        this.timer[i] = this.timer[i]! - 1;
        if (this.timer[i]! <= 0) this.startLeg(i);
      }
    }

    const snap = allocSnapshot(this.tick, Math.imul(this.tick, 2654435761) >>> 0, n, shots.length);
    const e = snap.entities;
    for (let i = 0; i < n; i++) {
      const id = this.ids[i]!;
      e.id[i] = id;
      e.x[i] = this.x[i]!;
      e.y[i] = this.y[i]!;
      e.typeId[i] = FAKE_UNIT_TYPE_ID;
      e.yaw[i] = this.yaw[i]!;
      e.animT[i] = Math.min(ANGLE_FULL - 1, Math.floor(this.animT[i]! * ANGLE_FULL));
      e.owner[i] = this.owner[i]!;
      e.anim[i] = this.anim[i]!;
      e.hpPct[i] = 100;
      const isFighting = this.mode[i] === 'attack1' || this.mode[i] === 'attack2';
      e.flags[i] = (this.selected.has(id) ? ENTITY_FLAG.selected : 0) | (isFighting ? ENTITY_FLAG.inCombat : 0);
    }
    shots.forEach((i, k) => {
      snap.events.type[k] = EVENT_TYPE.shotFired;
      snap.events.a[k] = this.ids[i]!;
      snap.events.b[k] = 0;
      snap.events.x[k] = this.x[i]!;
      snap.events.y[k] = this.y[i]!;
    });
    return snap.buffer;
  }
}

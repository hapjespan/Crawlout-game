// Interpolation between the last two snapshots. The renderer runs one tick behind the sim:
// when snapshot N arrives at time t, we show N-1 at t and reach N at t + TICK_MS.
import { ANGLE_FULL, MAX_ENTITIES, TICK_MS, UNITS_PER_METER, YAW_PLUS_Y } from '@crawlout/protocol';
import { parseSnapshot, type SnapshotView } from './parse.js';

/** Render-side state for one frame, in world units: meters and radians. Preallocated, reused every frame. */
export interface InterpolatedFrame {
  count: number;
  id: Uint32Array;
  /** World x in meters (sim x / 256). */
  x: Float32Array;
  /** World height in meters. Interpolation leaves it at 0; the renderer fills it from the terrain. */
  y: Float32Array;
  /** World z in meters (sim y / 256). */
  z: Float32Array;
  /**
   * Heading in radians around +Y for a model that faces world +Z at 0 (rotY in unitMaterial.ts).
   * Sim yaw (protocol): 0 = sim +x = world +x, 16384 = sim +y = world +z, so radians = PI/2 - yaw * 2PI/65536.
   */
  yaw: Float32Array;
  /** Clip progress 0..1. */
  animT: Float32Array;
  anim: Uint8Array;
  owner: Uint8Array;
  typeId: Uint16Array;
  hpPct: Uint8Array;
  flags: Uint8Array;
}

export function createInterpolatedFrame(capacity: number = MAX_ENTITIES): InterpolatedFrame {
  return {
    count: 0,
    id: new Uint32Array(capacity),
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    z: new Float32Array(capacity),
    yaw: new Float32Array(capacity),
    animT: new Float32Array(capacity),
    anim: new Uint8Array(capacity),
    owner: new Uint8Array(capacity),
    typeId: new Uint16Array(capacity),
    hpPct: new Uint8Array(capacity),
    flags: new Uint8Array(capacity),
  };
}

const HALF_ANGLE = ANGLE_FULL / 2;
const RAD_PER_ANGLE = (Math.PI * 2) / ANGLE_FULL;
/** Model forward (+Z) at render yaw 0 corresponds to sim yaw YAW_PLUS_Y; sim angles grow from +x towards +y. */
const MODEL_FORWARD_RAD = YAW_PLUS_Y * RAD_PER_ANGLE;
const INV_UNITS = 1 / UNITS_PER_METER;
/** Moves larger than this (sim units per tick) are teleports and snap instead of sliding. */
export const TELEPORT_UNITS_PER_TICK = 16 * UNITS_PER_METER;

/** Sim yaw (uint16, protocol convention) to render radians for a model facing +Z at 0. */
export function simYawToRender(yaw: number): number {
  return MODEL_FORWARD_RAD - yaw * RAD_PER_ANGLE;
}

/** Shortest-arc interpolation of two uint16 angles. Returns an angle in [0, 65536). */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % ANGLE_FULL;
  if (d > HALF_ANGLE) d -= ANGLE_FULL;
  else if (d < -HALF_ANGLE) d += ANGLE_FULL;
  const r = (a + d * t) % ANGLE_FULL;
  return r < 0 ? r + ANGLE_FULL : r;
}

/** Interpolates clip progress (uint16) and returns 0..1. Within one clip a backwards step means the loop wrapped. */
export function lerpAnimT(a: number, b: number, t: number): number {
  const target = b < a ? b + ANGLE_FULL : b;
  const r = (a + (target - a) * t) % ANGLE_FULL;
  return r / ANGLE_FULL;
}

/**
 * Writes the interpolated state of `curr` into `out`. Entities are matched on id via `prevIndex` (id to index in prev).
 * Entities without a match in prev (just spawned) take their curr state; entities only in prev are gone.
 */
export function interpolateInto(
  out: InterpolatedFrame,
  prev: SnapshotView | null,
  prevIndex: ReadonlyMap<number, number> | null,
  curr: SnapshotView,
  alpha: number,
): void {
  const c = curr.entities;
  const n = Math.min(curr.entityCount, out.id.length);
  const ticks = prev ? Math.max(1, curr.tick - prev.tick) : 1;
  const teleport = TELEPORT_UNITS_PER_TICK * ticks;
  for (let i = 0; i < n; i++) {
    const id = c.id[i]!;
    const cx = c.x[i]!;
    const cy = c.y[i]!;
    const cYaw = c.yaw[i]!;
    const cAnim = c.anim[i]!;
    const cAnimT = c.animT[i]!;
    let x = cx;
    let y = cy;
    let yaw = cYaw;
    let animT = cAnimT / ANGLE_FULL;
    const j = prev && prevIndex && alpha < 1 ? prevIndex.get(id) : undefined;
    if (j !== undefined && prev) {
      const p = prev.entities;
      const px = p.x[j]!;
      const py = p.y[j]!;
      if (Math.abs(cx - px) + Math.abs(cy - py) <= teleport) {
        x = px + (cx - px) * alpha;
        y = py + (cy - py) * alpha;
      }
      yaw = lerpAngle(p.yaw[j]!, cYaw, alpha);
      if (p.anim[j] === cAnim) animT = lerpAnimT(p.animT[j]!, cAnimT, alpha);
    }
    out.id[i] = id;
    out.x[i] = x * INV_UNITS;
    out.y[i] = 0;
    out.z[i] = y * INV_UNITS;
    out.yaw[i] = simYawToRender(yaw);
    out.animT[i] = animT;
    out.anim[i] = cAnim;
    out.owner[i] = c.owner[i]!;
    out.typeId[i] = c.typeId[i]!;
    out.hpPct[i] = c.hpPct[i]!;
    out.flags[i] = c.flags[i]!;
  }
  out.count = n;
}

interface Entry {
  view: SnapshotView;
  receivedAt: number;
  index: Map<number, number>;
}

function indexInto(map: Map<number, number>, view: SnapshotView): Map<number, number> {
  map.clear();
  const ids = view.entities.id;
  for (let i = 0; i < view.entityCount; i++) map.set(ids[i]!, i);
  return map;
}

/** Keeps the last two snapshots and samples them at a wall-clock time (performance.now). */
export class SnapshotInterpolator {
  private prev: Entry | null = null;
  private curr: Entry | null = null;
  private spareIndex = new Map<number, number>();

  /** Parses and stores a snapshot. Returns false (and drops it) when its tick is not newer than the current one. */
  push(buf: ArrayBuffer, now: number): boolean {
    const view = parseSnapshot(buf);
    if (this.curr && view.tick <= this.curr.view.tick) return false;
    const index = indexInto(this.prev ? this.prev.index : this.spareIndex, view);
    if (!this.prev) this.spareIndex = new Map();
    this.prev = this.curr;
    this.curr = { view, receivedAt: now, index };
    return true;
  }

  /** Interpolation factor between prev (0) and curr (1). One tick behind: reaches 1 one tick after curr arrived. */
  alpha(now: number): number {
    if (!this.curr || !this.prev) return 1;
    const span = TICK_MS * Math.max(1, this.curr.view.tick - this.prev.view.tick);
    const a = (now - this.curr.receivedAt) / span;
    return Math.min(1, Math.max(0, a));
  }

  /** Fills `out` for time `now`. Returns false when no snapshot has arrived yet. */
  sample(now: number, out: InterpolatedFrame): boolean {
    if (!this.curr) {
      out.count = 0;
      return false;
    }
    interpolateInto(
      out,
      this.prev?.view ?? null,
      this.prev?.index ?? null,
      this.curr.view,
      this.alpha(now),
    );
    return true;
  }

  /** Index of entity `id` in the latest snapshot, or -1. */
  latestIndex(id: number): number {
    return this.curr?.index.get(id) ?? -1;
  }

  get latest(): SnapshotView | null {
    return this.curr?.view ?? null;
  }

  clear(): void {
    this.prev = null;
    this.curr = null;
  }
}

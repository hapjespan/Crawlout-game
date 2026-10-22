// Split from shapes.ts to stay under the 5,000-token file limit; shapes.ts re-exports the public surface.
// Holds: Vec2, Builder, normalize, makeBoxOpen, makeCylinderClean, makeCone, +9 more.
import { type Vec3, type Mesh, makeBox } from './geometry.js';

export type Vec2 = readonly [number, number];

/** Collects triangles. `face` fixes the winding against a hint for the outside, so callers need not get it right. */
export class Builder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  /** A flat polygon (fan from the first vertex; convex), wound so that its normal points along `outward`. */
  face(vertices: readonly Vec3[], outward: Vec3): void {
    const [a, b, c] = vertices as [Vec3, Vec3, Vec3];
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let n: Vec3 = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    if (n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2] < 0) {
      vertices = [...vertices].reverse();
      n = [-n[0], -n[1], -n[2]];
    }
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len < 1e-12) return; // a degenerate face (a collapsed edge)
    const base = this.vertexCount;
    for (const v of vertices) {
      this.positions.push(v[0], v[1], v[2]);
      this.normals.push(n[0] / len, n[1] / len, n[2] / len);
    }
    for (let i = 1; i < vertices.length - 1; i++) this.indices.push(base, base + i, base + i + 1);
  }

  /** A smooth-shaded vertex (position and normal given), for the round shapes. */
  vertex(p: Vec3, n: Vec3): number {
    this.positions.push(p[0], p[1], p[2]);
    this.normals.push(n[0], n[1], n[2]);
    return this.vertexCount - 1;
  }

  triangle(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  build(): Mesh {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      uvs: null,
      indices: new Uint32Array(this.indices),
    };
  }
}

export const normalize = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Box without the bottom face (for parts that sit on a surface): 10 triangles instead of 12. */
export function makeBoxOpen(size: Vec3): Mesh {
  const box = makeBox(size);
  // makeBox emits the faces in the order top, bottom, front, back, right, left: drop face 1 (the bottom).
  const keep = Array.from(box.indices).filter((_, i) => Math.floor(i / 6) !== 1);
  return { ...box, indices: Uint32Array.from(keep) };
}

/**
 * Cylinder or frustum along y (foot at the bottom centre) with smooth sides, flat caps and the sides wound
 * counter-clockwise seen from outside. `open` leaves out the bottom cap.
 */
export function makeCylinderClean(
  radius: number,
  radiusTop: number,
  height: number,
  segments: number,
  open: boolean,
): Mesh {
  const out = new Builder();
  const slope = (radius - radiusTop) / height;
  const len = Math.hypot(1, slope);
  const ring = (i: number): [number, number] => {
    const a = (i / segments) * Math.PI * 2;
    return [Math.cos(a), Math.sin(a)];
  };
  const bottom: number[] = [];
  const top: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const [c, s] = ring(i);
    const n: Vec3 = [c / len, slope / len, s / len];
    bottom.push(out.vertex([c * radius, 0, s * radius], n));
    top.push(out.vertex([c * radiusTop, height, s * radiusTop], n));
  }
  for (let i = 0; i < segments; i++) {
    out.triangle(bottom[i]!, top[i + 1]!, bottom[i + 1]!);
    if (radiusTop > 0) out.triangle(bottom[i]!, top[i]!, top[i + 1]!);
  }
  const cap = (y: number, r: number, up: boolean): void => {
    for (let i = 0; i < segments; i++) {
      const [c0, s0] = ring(i);
      const [c1, s1] = ring(i + 1);
      out.face(
        [
          [0, y, 0],
          [c0 * r, y, s0 * r],
          [c1 * r, y, s1 * r],
        ],
        [0, up ? 1 : -1, 0],
      );
    }
  };
  if (!open) cap(0, radius, false);
  if (radiusTop > 0) cap(height, radiusTop, true);
  return out.build();
}

/**
 * Cone with smooth sides: `segments` triangles for the sides plus `segments` for the base unless `open`. A cylinder with a
 * top radius of 0 would spend half of its side triangles on degenerate slivers; this one does not.
 */
export function makeCone(radius: number, height: number, segments: number, open: boolean): Mesh {
  const out = new Builder();
  const slope = radius / height;
  const len = Math.hypot(1, slope);
  const ring = (i: number): [number, number] => {
    const a = (i / segments) * Math.PI * 2;
    return [Math.cos(a), Math.sin(a)];
  };
  for (let i = 0; i < segments; i++) {
    const [c0, s0] = ring(i);
    const [c1, s1] = ring(i + 1);
    const [cm, sm] = ring(i + 0.5);
    const a = out.vertex([c0 * radius, 0, s0 * radius], [c0 / len, slope / len, s0 / len]);
    const b = out.vertex([c1 * radius, 0, s1 * radius], [c1 / len, slope / len, s1 / len]);
    const apex = out.vertex([0, height, 0], [cm / len, slope / len, sm / len]);
    out.triangle(a, apex, b);
  }
  if (!open)
    for (let i = 0; i < segments; i++) {
      const [c0, s0] = ring(i);
      const [c1, s1] = ring(i + 1);
      out.face(
        [
          [0, 0, 0],
          [c0 * radius, 0, s0 * radius],
          [c1 * radius, 0, s1 * radius],
        ],
        [0, -1, 0],
      );
    }
  return out.build();
}

/**
 * Box with all twelve edges chamfered by `chamfer` meters (44 triangles): six inset faces, twelve 45 degree strips and
 * eight corner triangles. Same frame as makeBox: centered in x and z, the bottom at y = 0.
 */
export function makeBevelBox(size: Vec3, chamfer: number): Mesh {
  const c = Math.min(chamfer, Math.min(size[0], size[1], size[2]) * 0.45);
  const half: Vec3 = [size[0] / 2, size[1] / 2, size[2] / 2];
  const centre: Vec3 = [0, size[1] / 2, 0];
  const out = new Builder();
  // Corner (sx, sy, sz) of the box, with the chamfer inset applied to every axis except `axis` (the face it lies on).
  const corner = (signs: Vec3, axis: number): Vec3 => {
    const p: [number, number, number] = [0, 0, 0];
    for (let k = 0; k < 3; k++) p[k] = centre[k]! + signs[k]! * (half[k]! - (k === axis ? 0 : c));
    return p;
  };
  const sign = [-1, 1] as const;
  // Faces: for axis a and sign s, the four corners that lie on that face.
  for (let a = 0; a < 3; a++)
    for (const s of sign) {
      const b = (a + 1) % 3;
      const d = (a + 2) % 3;
      const verts: Vec3[] = [];
      for (const [sb, sd] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        const signs: [number, number, number] = [0, 0, 0];
        signs[a] = s;
        signs[b] = sb;
        signs[d] = sd;
        verts.push(corner(signs, a));
      }
      const hint: [number, number, number] = [0, 0, 0];
      hint[a] = s;
      out.face(verts, hint);
    }
  // Edge strips: along axis e, between the two faces of axes a and b.
  for (let e = 0; e < 3; e++) {
    const a = (e + 1) % 3;
    const b = (e + 2) % 3;
    for (const sa of sign)
      for (const sb of sign) {
        const lo: [number, number, number] = [0, 0, 0];
        lo[a] = sa;
        lo[b] = sb;
        lo[e] = -1;
        const hi: [number, number, number] = [lo[0], lo[1], lo[2]];
        hi[e] = 1;
        const hint: [number, number, number] = [0, 0, 0];
        hint[a] = sa;
        hint[b] = sb;
        out.face([corner(lo, a), corner(hi, a), corner(hi, b), corner(lo, b)], hint);
      }
  }
  // Corner triangles.
  for (const sx of sign)
    for (const sy of sign)
      for (const sz of sign) {
        const signs: Vec3 = [sx, sy, sz];
        out.face([corner(signs, 0), corner(signs, 1), corner(signs, 2)], signs);
      }
  return out.build();
}

/** Signed area of a 2D polygon (positive when counter-clockwise in the usual x right, y up reading). */
function area2(poly: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]!;
    const [x2, y2] = poly[(i + 1) % poly.length]!;
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/** Ear clipping of a simple polygon (convex or not); triangles as index triples, wound like the input polygon. */
export function triangulate(poly: readonly Vec2[]): [number, number, number][] {
  const n = poly.length;
  if (n < 3) return [];
  const ccw = area2(poly) > 0;
  const order = Array.from({ length: n }, (_, i) => (ccw ? i : n - 1 - i));
  const cross = (o: Vec2, a: Vec2, b: Vec2): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inside = (p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean =>
    cross(a, b, p) >= -1e-12 && cross(b, c, p) >= -1e-12 && cross(c, a, p) >= -1e-12;
  const result: [number, number, number][] = [];
  let guard = n * n;
  while (order.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < order.length; i++) {
      const ia = order[(i + order.length - 1) % order.length]!;
      const ib = order[i]!;
      const ic = order[(i + 1) % order.length]!;
      const a = poly[ia]!;
      const b = poly[ib]!;
      const c = poly[ic]!;
      if (cross(a, b, c) <= 1e-12) continue; // reflex or flat corner
      let ear = true;
      for (const other of order) {
        if (other === ia || other === ib || other === ic) continue;
        if (inside(poly[other]!, a, b, c)) {
          ear = false;
          break;
        }
      }
      if (!ear) continue;
      result.push(ccw ? [ia, ib, ic] : [ic, ib, ia]);
      order.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // a self-touching polygon: stop rather than loop
  }
  if (order.length === 3) {
    const [ia, ib, ic] = order as [number, number, number];
    result.push(ccw ? [ia, ib, ic] : [ic, ib, ia]);
  }
  return result;
}

export type PrismAxis = 'x' | 'y' | 'z';

export type PrismCaps = 'both' | 'start' | 'end' | 'none';

export interface PrismOptions {
  axis: PrismAxis;
  /** Scale of the profile at the far end of the extrusion (about the profile origin), per profile axis. */
  taper?: Vec2 | undefined;
  caps?: PrismCaps | undefined;
}

/**
 * A polygon extruded `length` meters. The profile lies in (x, z) for axis y (extruded from y = 0 up), in (z, y) for
 * axis x and in (x, y) for axis z; those two axes are centered on the origin along the extrusion (x and z run from
 * -length/2 to length/2). `taper` shrinks or grows the far end, `caps` leaves out end faces that nobody sees.
 */
export function makePrism(profile: readonly Vec2[], length: number, options: PrismOptions): Mesh {
  const taper = options.taper ?? [1, 1];
  const caps = options.caps ?? 'both';
  const ccw = area2(profile) > 0;
  const poly = ccw ? profile : [...profile].reverse();
  const near = (p: Vec2): Vec3 => [p[0], 0, p[1]];
  const far = (p: Vec2): Vec3 => [p[0] * taper[0], length, p[1] * taper[1]];
  const out = new Builder();
  if (caps === 'both' || caps === 'start')
    for (const [i, j, k] of triangulate(poly))
      out.face([near(poly[i]!), near(poly[j]!), near(poly[k]!)], [0, -1, 0]);
  if (caps === 'both' || caps === 'end')
    for (const [i, j, k] of triangulate(poly))
      out.face([far(poly[i]!), far(poly[j]!), far(poly[k]!)], [0, 1, 0]);
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    // Counter-clockwise polygon: the outside is to the right of the edge direction.
    out.face([near(p), near(q), far(q), far(p)], [q[1] - p[1], 0, p[0] - q[0]]);
  }
  const mesh = out.build();
  if (options.axis === 'y') return mesh;
  // Map (X, Y, Z) of the y-axis build to the wanted axis; an odd permutation flips the winding.
  const half = length / 2;
  const positions = new Float32Array(mesh.positions.length);
  const normals = new Float32Array(mesh.normals.length);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const [x, y, z] = [mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!];
    const [nx, ny, nz] = [mesh.normals[i]!, mesh.normals[i + 1]!, mesh.normals[i + 2]!];
    if (options.axis === 'x') {
      positions.set([y - half, z, x], i);
      normals.set([ny, nz, nx], i);
    } else {
      positions.set([x, z, y - half], i);
      normals.set([nx, nz, ny], i);
    }
  }
  const indices = Uint32Array.from(mesh.indices);
  if (options.axis === 'z')
    for (let i = 0; i < indices.length; i += 3) {
      const t = indices[i + 1]!;
      indices[i + 1] = indices[i + 2]!;
      indices[i + 2] = t;
    }
  return { positions, normals, uvs: null, indices };
}

export interface TrackOptions {
  /** Distance between the two wheel axles (meters). */
  length: number;
  /** Outer radius at the tooth tips; the track is `2 * radius` high and stands on y = 0. */
  radius: number;
  width: number;
  /** Number of treads around the loop; 0 gives a smooth belt. */
  teeth: number;
  toothHeight: number;
  /** Segments per half circle at the two ends. */
  arcSegments: number;
  caps?: PrismCaps | undefined;
}

/**
 * A tank track seen from the side: a stadium (two wheel arcs joined by two straight runs) with a trapezoid tread
 * around it, extruded across `width` (centered on x, running along z, standing on y = 0). One closed prism, so a track
 * is `teeth * 8` triangles plus the arcs.
 */
export function makeTrack(options: TrackOptions): Mesh {
  const { length, radius, width, teeth, toothHeight, arcSegments } = options;
  const r0 = radius - (teeth > 0 ? toothHeight : 0);
  const half = length / 2;
  const arcLength = Math.PI * r0;
  const total = 2 * length + 2 * arcLength;
  // Path from the rear end of the top run: top run (z up), front arc, bottom run, rear arc. s in [0, total).
  const at = (s: number): { p: Vec2; n: Vec2 } => {
    if (s < length) return { p: [-half + s, r0], n: [0, 1] };
    if (s < length + arcLength) {
      const a = Math.PI / 2 - (s - length) / r0; // 90 deg (top) clockwise to -90 deg (bottom)
      return { p: [half + Math.cos(a) * r0, Math.sin(a) * r0], n: [Math.cos(a), Math.sin(a)] };
    }
    if (s < 2 * length + arcLength)
      return { p: [half - (s - length - arcLength), -r0], n: [0, -1] };
    const a = -Math.PI / 2 - (s - 2 * length - arcLength) / r0;
    return { p: [-half + Math.cos(a) * r0, Math.sin(a) * r0], n: [Math.cos(a), Math.sin(a)] };
  };
  // Breakpoints along the path with the tread offset at each: tooth edges, the four joins, arc subdivisions.
  const offsetAt = new Map<number, number>();
  const mark = (s: number, offset: number): void => {
    offsetAt.set(Math.round((((s % total) + total) % total) * 1e6), offset);
  };
  const pitch = teeth > 0 ? total / teeth : total;
  for (let k = 0; k < teeth; k++) {
    const s0 = k * pitch;
    mark(s0, 0);
    mark(s0 + 0.12 * pitch, toothHeight);
    mark(s0 + 0.45 * pitch, toothHeight);
    mark(s0 + 0.57 * pitch, 0);
  }
  const offsetFrom = (s: number): number => {
    if (teeth === 0) return 0;
    const t = (s % pitch) / pitch;
    if (t < 0.12) return (t / 0.12) * toothHeight;
    if (t < 0.45) return toothHeight;
    if (t < 0.57) return ((0.57 - t) / 0.12) * toothHeight;
    return 0;
  };
  const joins = [0, length, length + arcLength, 2 * length + arcLength];
  for (const s of joins) if (!offsetAt.has(Math.round(s * 1e6))) mark(s, offsetFrom(s));
  for (let k = 1; k < arcSegments; k++)
    for (const s0 of [length, 2 * length + arcLength]) {
      const s = s0 + (k / arcSegments) * arcLength;
      if (
        ![...offsetAt.keys()].some((key) => Math.abs(key / 1e6 - s) < arcLength / arcSegments / 4)
      )
        mark(s, offsetFrom(s));
    }
  const keys = [...offsetAt.keys()].sort((a, b) => a - b);
  const profile: Vec2[] = keys.map((key) => {
    const s = key / 1e6;
    const { p, n } = at(Math.min(s, total - 1e-9));
    const o = offsetAt.get(key)!;
    // (z, y) profile of the prism along x; the stadium sits on y = 0 with its centre at height `radius`.
    return [p[0] + n[0] * o, radius + p[1] + n[1] * o] as Vec2;
  });
  return makePrism(profile, width, { axis: 'x', caps: options.caps ?? 'both' });
}

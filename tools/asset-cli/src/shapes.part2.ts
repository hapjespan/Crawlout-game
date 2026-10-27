// Split from shapes.ts to stay under the 5,000-token file limit; shapes.ts re-exports the public surface.
// Holds: makeCorrugated, makeTube, makeSphere.
import type { Mesh, Vec3 } from './geometry.js';
import { Builder, normalize } from './shapes.part1.js';
import { distance, metresV, ringU } from './uvmap.js';

/**
 * A corrugated sheet as one wave strip (single sided, `4` triangles per period): `length` along x (centered), `height`
 * along y from 0, the crests `depth` meters out along +z (the outside). Put it on a wall or a roof over a plain box.
 */
export function makeCorrugated(
  length: number,
  height: number,
  period: number,
  depth: number,
): Mesh {
  const out = new Builder();
  const waves = Math.max(1, Math.round(length / period));
  const steps = waves * 2;
  const x = (i: number): number => -length / 2 + (i / steps) * length;
  const z = (i: number): number => (i % 2 === 0 ? 0 : depth);
  for (let i = 0; i < steps; i++)
    out.face(
      [
        [x(i), 0, z(i)],
        [x(i + 1), 0, z(i + 1)],
        [x(i + 1), height, z(i + 1)],
        [x(i), height, z(i)],
      ],
      [0, 0, 1],
    );
  return out.build();
}

/**
 * A swept tube along a polyline of `points` (cables, pipes): `sides` around, smooth shaded, mitred at the bends, closed
 * with a flat cap at both ends. 2 * sides triangles per segment.
 */
export function makeTube(points: readonly Vec3[], radius: number, sides: number): Mesh {
  const out = new Builder();
  const count = points.length;
  const dirs: Vec3[] = [];
  for (let i = 0; i + 1 < count; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    dirs.push(normalize([b[0] - a[0], b[1] - a[1], b[2] - a[2]]));
  }
  const rings: number[][] = [];
  const ringPositions: Vec3[][] = [];
  let normal: Vec3 | null = null;
  // v runs along the path in metres, u around the ring in metres: a pipe keeps the grain of its material.
  const along: number[] = [0];
  for (let i = 1; i < count; i++) along.push(along[i - 1]! + distance(points[i - 1]!, points[i]!));
  for (let i = 0; i < count; i++) {
    const before = dirs[Math.max(0, i - 1)]!;
    const after = dirs[Math.min(dirs.length - 1, i)]!;
    const t = normalize([before[0] + after[0], before[1] + after[1], before[2] + after[2]]);
    // Parallel transport of a reference normal, so the ring does not twist along the path.
    let ref: Vec3 = normal ?? (Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
    const dot = ref[0] * t[0] + ref[1] * t[1] + ref[2] * t[2];
    ref = normalize([ref[0] - dot * t[0], ref[1] - dot * t[1], ref[2] - dot * t[2]]);
    normal = ref;
    const side: Vec3 = [
      t[1] * ref[2] - t[2] * ref[1],
      t[2] * ref[0] - t[0] * ref[2],
      t[0] * ref[1] - t[1] * ref[0],
    ];
    const miter =
      1 / Math.max(0.4, before[0] * after[0] + before[1] * after[1] + before[2] * after[2]);
    const ring: number[] = [];
    const positions: Vec3[] = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const n: Vec3 = [
        ref[0] * Math.cos(a) + side[0] * Math.sin(a),
        ref[1] * Math.cos(a) + side[1] * Math.sin(a),
        ref[2] * Math.cos(a) + side[2] * Math.sin(a),
      ];
      const r = radius * (i === 0 || i === count - 1 ? 1 : Math.sqrt(miter));
      const p: Vec3 = [
        points[i]![0] + n[0] * r,
        points[i]![1] + n[1] * r,
        points[i]![2] + n[2] * r,
      ];
      positions.push(p);
      ring.push(out.vertex(p, n, [ringU(k / sides, radius), metresV(along[i]!)]));
    }
    rings.push(ring);
    ringPositions.push(positions);
  }
  for (let i = 0; i + 1 < count; i++)
    for (let k = 0; k < sides; k++) {
      const a = rings[i]![k]!;
      const b = rings[i]![(k + 1) % sides]!;
      const c = rings[i + 1]![(k + 1) % sides]!;
      const d = rings[i + 1]![k]!;
      out.triangle(a, b, c);
      out.triangle(a, c, d);
    }
  // End caps: fans around the ring with a flat normal along the path.
  const cap = (end: number, direction: number): void => {
    const d = dirs[end === 0 ? 0 : dirs.length - 1]!;
    const n: Vec3 = [d[0] * direction, d[1] * direction, d[2] * direction];
    const centre = out.vertex(points[end]!, n);
    const fresh = ringPositions[end]!.map((p) => out.vertex(p, n));
    for (let k = 0; k < fresh.length; k++)
      if (direction > 0) out.triangle(centre, fresh[k]!, fresh[(k + 1) % fresh.length]!);
      else out.triangle(centre, fresh[(k + 1) % fresh.length]!, fresh[k]!);
  };
  cap(0, -1);
  cap(count - 1, 1);
  return out.build();
}

/** UV sphere (smooth shaded) centered on the origin; `half: 'top'` keeps the upper hemisphere (a dome, open below). */
export function makeSphere(
  radius: number,
  segments: number,
  rings: number,
  half: 'full' | 'top',
): Mesh {
  const out = new Builder();
  const latSteps = half === 'top' ? rings : rings * 2;
  const grid: number[][] = [];
  // uv in metres: v is the arc from the pole, u the arc of the ring at that latitude, so the texels stay the same
  // size per metre of surface instead of piling up at the poles (an equirectangular u measured on the equator put
  // the density 65 percent over the band). The sin is floored so the last row before a pole keeps a uv area.
  for (let i = 0; i <= latSteps; i++) {
    const lat = (i / (rings * 2)) * Math.PI; // 0 at the top pole
    const row: number[] = [];
    const count = i === 0 || i === rings * 2 ? 1 : segments;
    const ringRadius = radius * Math.max(Math.sin(lat), 0.4);
    for (let k = 0; k < count; k++) {
      const lon = (k / segments) * Math.PI * 2;
      const n: Vec3 = [Math.sin(lat) * Math.cos(lon), Math.cos(lat), Math.sin(lat) * Math.sin(lon)];
      row.push(
        out.vertex([n[0] * radius, n[1] * radius, n[2] * radius], n, [
          ringU(count === 1 ? 0.5 : k / segments, ringRadius),
          metresV(lat * radius),
        ]),
      );
    }
    grid.push(row);
  }
  for (let i = 0; i < latSteps; i++) {
    const upper = grid[i]!;
    const lower = grid[i + 1]!;
    for (let k = 0; k < segments; k++) {
      const k2 = (k + 1) % segments;
      if (upper.length === 1) out.triangle(upper[0]!, lower[k2]!, lower[k]!);
      else if (lower.length === 1) out.triangle(upper[k]!, upper[k2]!, lower[0]!);
      else {
        out.triangle(upper[k]!, lower[k2]!, lower[k]!);
        out.triangle(upper[k]!, upper[k2]!, lower[k2]!);
      }
    }
  }
  return out.build();
}

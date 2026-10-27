// Procedural ground vegetation meshes, at real scale against a 1.8 m person: grass tufts (0.3 to 0.5 m), weeds with
// small flower heads (0.3 m), shrubs (0.6 to 1.3 m) and reed clumps (1.1 to 1.7 m). No textures and no alpha test:
// every blade and leaf is a few opaque triangles, so they stay sharp at any zoom and cost no overdraw.
//
// Attributes (model space, y up, the base on y = 0, meters):
//   position, normal  the normal is bent towards a soft shape normal (up for grass and reeds, out from the clump's
//                     centre for a shrub), so a clump lights as one volume instead of a confetti of faces (the
//                     stylized look: one readable shape, detail inside it)
//   color (vec4)      rgb: the vertex's own shading (root and interior darker); a: how far the vertex bends in wind
//                     (0 at the root, 1 at the tip)
//   flower (float)    1 where rgb is the absolute colour of a flower or seed head, 0 where it multiplies the palette
import { BufferAttribute, BufferGeometry } from 'three/webgpu';
import { hash2 } from '../terrain/noiseTexture.js';

export type VegetationKind = 'grass' | 'weed' | 'shrub' | 'reed';

class MeshBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly col: number[] = [];
  readonly flower: number[] = [];
  readonly idx: number[] = [];

  vertex(
    p: readonly [number, number, number],
    n: readonly [number, number, number],
    shade: number | readonly [number, number, number],
    bend: number,
    flower = 0,
  ): number {
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0] / len, n[1] / len, n[2] / len);
    const c = typeof shade === 'number' ? [shade, shade, shade] : shade;
    this.col.push(c[0]!, c[1]!, c[2]!, bend);
    this.flower.push(flower);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 4));
    g.setAttribute('flower', new BufferAttribute(new Float32Array(this.flower), 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

type V3 = [number, number, number];
const mixV = (a: V3, b: V3, t: number): V3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * One blade: a tapered, curved strip from root to tip (root quad, mid quad, tip triangle: 5 triangles). The shading
 * normal leans `up` towards straight up, so a blade lights like the ground it grows from.
 */
function blade(
  m: MeshBuilder,
  root: V3,
  dirAngle: number,
  lean: number,
  height: number,
  width: number,
  up: number,
  rootShade: number,
  flowerColor: V3 | null = null,
  tipShade = 1,
): V3 {
  const dx = Math.cos(dirAngle);
  const dz = Math.sin(dirAngle);
  // Width runs across the lean direction.
  const wx = -dz;
  const wz = dx;
  const pts: V3[] = [];
  for (const t of [0, 0.45, 0.8, 1]) {
    const out = lean * height * t * t; // curves outward towards the tip
    pts.push([
      root[0] + dx * out,
      root[1] + height * t * (1 - 0.15 * lean * t),
      root[2] + dz * out,
    ]);
  }
  const widths = [width, width * 0.8, width * 0.45, 0];
  const n: V3 = [dx * (1 - up) * 0.6, up + 0.3, dz * (1 - up) * 0.6];
  const ids: [number, number][] = pts.map((p, i) => {
    const t = i / 3;
    const shade = rootShade + (tipShade - rootShade) * t;
    const w = widths[i]! / 2;
    const bend = [0, 0.3, 0.7, 1][i]!;
    if (w === 0) {
      const tip = m.vertex(p, n, shade, bend);
      return [tip, tip];
    }
    return [
      m.vertex([p[0] - wx * w, p[1], p[2] - wz * w], n, shade, bend),
      m.vertex([p[0] + wx * w, p[1], p[2] + wz * w], n, shade, bend),
    ];
  });
  for (let i = 0; i < 2; i++) {
    const [a, b] = ids[i]!;
    const [c, d] = ids[i + 1]!;
    m.tri(a, b, d);
    m.tri(a, d, c);
  }
  m.tri(ids[2]![0], ids[2]![1], ids[3]![0]);
  if (flowerColor) head(m, pts[3]!, 0.03, flowerColor);
  return pts[3]!;
}

/** A small diamond-shaped head (two crossed quads) of an absolute colour: a flower, a seed head, a cattail. */
function head(m: MeshBuilder, at: V3, r: number, color: V3, tall = 1): void {
  for (const [ax, az] of [
    [1, 0],
    [0, 1],
  ] as const) {
    const n: V3 = [0, 1, 0];
    const a = m.vertex([at[0] - ax * r, at[1], at[2] - az * r], n, color, 1, 1);
    const b = m.vertex([at[0], at[1] + r * tall, at[2]], n, color, 1, 1);
    const c = m.vertex([at[0] + ax * r, at[1], at[2] + az * r], n, color, 1, 1);
    const d = m.vertex([at[0], at[1] - r * tall, at[2]], n, color, 1, 1);
    m.tri(a, b, c);
    m.tri(a, c, d);
  }
}

/** A grass tuft: a dozen blades from a small root disc, leaning out, 0.42 m tall. */
export function grassTuft(seed = 1): BufferGeometry {
  const m = new MeshBuilder();
  const blades = 11;
  for (let i = 0; i < blades; i++) {
    const a = hash2(i, 1, seed) * Math.PI * 2;
    const r = 0.08 * Math.sqrt(hash2(i, 2, seed));
    const h = 0.26 + 0.2 * hash2(i, 3, seed);
    // Sunlit tips, each blade its own tone: seen from above the tuft reads as light strokes over darker soil.
    const tone = 0.8 + 0.4 * hash2(i, 6, seed);
    blade(
      m,
      [Math.cos(a) * r, 0, Math.sin(a) * r],
      a + (hash2(i, 4, seed) - 0.5),
      0.4 + 0.5 * hash2(i, 5, seed),
      h,
      0.032,
      0.7,
      0.4 * tone,
      null,
      1.3 * tone,
    );
  }
  return m.build();
}

/** A weed: broad short leaves and a few thin stalks with small flower heads (the colour comes per variant). */
export function weed(seed = 1, flower: V3 = [0.55, 0.42, 0.08]): BufferGeometry {
  const m = new MeshBuilder();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + hash2(i, 1, seed);
    blade(m, [0, 0, 0], a, 0.9, 0.14 + 0.06 * hash2(i, 2, seed), 0.05, 0.55, 0.4);
  }
  for (let i = 0; i < 4; i++) {
    const a = hash2(i, 7, seed) * Math.PI * 2;
    const tone = 0.8 + 0.2 * hash2(i, 8, seed);
    blade(
      m,
      [Math.cos(a) * 0.03, 0, Math.sin(a) * 0.03],
      a,
      0.2,
      0.26 + 0.1 * hash2(i, 9, seed),
      0.008,
      0.8,
      0.5,
      mixV([0, 0, 0], flower, tone),
    );
  }
  return m.build();
}

/**
 * A shrub: leaves (diamonds of 10 to 18 cm) over an ellipsoid crown on a few stems, normals bent out from the crown's
 * centre; the inside and the underside are darker. `spread` widens it, `tall` lifts it.
 */
export function shrub(seed = 1, spread = 1, tall = 1): BufferGeometry {
  const m = new MeshBuilder();
  const rx = 0.55 * spread;
  const ry = 0.45 * tall;
  const cy = 0.42 * tall;
  // Stems: a few thin dark blades from the root into the crown.
  for (let i = 0; i < 4; i++) {
    const a = hash2(i, 31, seed) * Math.PI * 2;
    blade(m, [0, 0, 0], a, 0.35, cy + 0.1, 0.03, 0.2, 0.25);
  }
  const leaves = 110;
  for (let i = 0; i < leaves; i++) {
    // A point in the crown, pushed towards its surface (the outside carries the shape).
    const u = hash2(i, 11, seed) * 2 - 1;
    const t = hash2(i, 12, seed) * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const depth = 0.55 + 0.45 * Math.sqrt(hash2(i, 13, seed));
    const dir: V3 = [s * Math.cos(t), u, s * Math.sin(t)];
    if (dir[1] < -0.55) dir[1] = -0.55; // a flat-ish underside
    const c: V3 = [dir[0] * rx * depth, cy + dir[1] * ry * depth, dir[2] * rx * depth];
    const size = (0.1 + 0.08 * hash2(i, 14, seed)) * (0.8 + 0.2 * spread);
    // Leaf plane: facing out with a random twist; a and b span it.
    const tw = hash2(i, 15, seed) * Math.PI;
    const ref: V3 = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const a0: V3 = [
      dir[1] * ref[2] - dir[2] * ref[1],
      dir[2] * ref[0] - dir[0] * ref[2],
      dir[0] * ref[1] - dir[1] * ref[0],
    ];
    const al = Math.hypot(...a0);
    const ax: V3 = [a0[0] / al, a0[1] / al, a0[2] / al];
    const bx: V3 = [
      dir[1] * ax[2] - dir[2] * ax[1],
      dir[2] * ax[0] - dir[0] * ax[2],
      dir[0] * ax[1] - dir[1] * ax[0],
    ];
    const ca = Math.cos(tw);
    const sa = Math.sin(tw);
    const A: V3 = [ax[0] * ca + bx[0] * sa, ax[1] * ca + bx[1] * sa, ax[2] * ca + bx[2] * sa];
    const B: V3 = [bx[0] * ca - ax[0] * sa, bx[1] * ca - ax[1] * sa, bx[2] * ca - ax[2] * sa];
    // Shading normal: mostly the crown's (soft volume), a little the leaf's own, a lift towards the sky.
    const n: V3 = [dir[0] * 0.8, dir[1] * 0.8 + 0.35, dir[2] * 0.8];
    const inner = 0.62 + 0.38 * ((depth - 0.55) / 0.45);
    const low = 0.72 + 0.28 * Math.min(1, Math.max(0, (c[1] / (cy + ry)) * 1.3));
    const shade = Math.min(1.15, inner * low * 1.12);
    const bend = Math.min(1, c[1] / (cy + ry));
    const tone = 0.85 + 0.3 * hash2(i, 16, seed);
    const sh: V3 = [shade * tone, shade * (0.95 + 0.1 * hash2(i, 17, seed)) * tone, shade * tone];
    const p0 = m.vertex([c[0] - A[0] * size, c[1] - A[1] * size, c[2] - A[2] * size], n, sh, bend);
    const p1 = m.vertex(
      [c[0] + B[0] * size * 0.45, c[1] + B[1] * size * 0.45, c[2] + B[2] * size * 0.45],
      n,
      sh,
      bend,
    );
    const p2 = m.vertex([c[0] + A[0] * size, c[1] + A[1] * size, c[2] + A[2] * size], n, sh, bend);
    const p3 = m.vertex(
      [c[0] - B[0] * size * 0.45, c[1] - B[1] * size * 0.45, c[2] - B[2] * size * 0.45],
      n,
      sh,
      bend,
    );
    m.tri(p0, p1, p2);
    m.tri(p0, p2, p3);
  }
  return m.build();
}

/** A reed clump: tall, nearly straight blades, a few with a brown cattail head, 1.1 to 1.7 m. */
export function reedClump(seed = 1): BufferGeometry {
  const m = new MeshBuilder();
  for (let i = 0; i < 16; i++) {
    const a = hash2(i, 21, seed) * Math.PI * 2;
    const r = 0.14 * Math.sqrt(hash2(i, 22, seed));
    const h = 1.0 + 0.6 * hash2(i, 23, seed);
    const tip = blade(
      m,
      [Math.cos(a) * r, 0, Math.sin(a) * r],
      a,
      0.08 + 0.15 * hash2(i, 24, seed),
      h,
      0.03,
      0.85,
      0.4,
    );
    if (hash2(i, 25, seed) > 0.68)
      head(m, [tip[0], tip[1] - 0.12, tip[2]], 0.022, [0.09, 0.05, 0.025], 3.5);
  }
  return m.build();
}

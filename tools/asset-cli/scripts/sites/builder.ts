// Part builder for the site generator (scripts/gen-sites.ts): boxes, tubes, cylinders and prisms in meters, optionally
// inside a rotated frame (a fallen canopy section, a hanging roof panel: everything in the frame turns about one pivot),
// plus deterministic rubble. The output is plain `parts` JSON for assets/src/sites.json (same format as raiders.json).
export type V3 = [number, number, number];
export type V2 = [number, number];
/** Highest LOD a part is on: 0 = LOD0 only, 1 = LOD0 and LOD1, 2 = all LODs (default). */
export type LodMax = 0 | 1 | 2;
export type Part = Record<string, unknown>;

export interface Opts {
  /** Highest LOD the part is on (default: all). */
  lod?: LodMax;
  /** Lowest LOD the part is on (a simpler stand-in for the far LODs). */
  min?: 1 | 2;
  /** Leave out the bottom face (a part that sits on something). */
  open?: boolean;
  chamfer?: number;
  /** `count` copies, each `step` metres further (ribs, slats); the copies are not rotated with a turned frame. */
  repeat?: { count: number; step: V3 };
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000;
const r3v = (v: readonly number[]): V3 => [r3(v[0]!), r3(v[1]!), r3(v[2]!)];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const isZero = (v: readonly number[]): boolean => v.every((a) => a === 0);

/** The rotation of the generator (src/geometry.ts rotationMatrix): R = Ry * Rx * Rz, degrees. */
export function rotMat(deg: V3): number[] {
  const [rx, ry, rz] = deg.map((d) => (d * Math.PI) / 180) as V3;
  const [cx, sx, cy, sy, cz, sz] = [
    Math.cos(rx),
    Math.sin(rx),
    Math.cos(ry),
    Math.sin(ry),
    Math.cos(rz),
    Math.sin(rz),
  ] as const;
  const mul = (a: number[], b: number[]): number[] => {
    const out = new Array<number>(9).fill(0);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++)
        for (let k = 0; k < 3; k++) out[r * 3 + c]! += a[r * 3 + k]! * b[k * 3 + c]!;
    return out;
  };
  return mul(mul([cy, 0, sy, 0, 1, 0, -sy, 0, cy], [1, 0, 0, 0, cx, -sx, 0, sx, cx]), [
    cz,
    -sz,
    0,
    sz,
    cz,
    0,
    0,
    0,
    1,
  ]);
}

export function mulVec(m: number[], v: V3): V3 {
  return [
    m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
    m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
    m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
  ];
}

/** A small deterministic generator (LCG), so a rebuild gives the same rubble. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Where parts go. The frame maps frame-local coordinates to the world: a point `p` lands on `pivotWorld + R (p - pivotLocal)`
 * and every part is rotated by R as a whole. The default frame is the identity. Part positions are the foot (bottom centre)
 * of a box, cylinder or cone, the centre of a sphere, the base point of a prism (centre along its axis) and the first
 * point of a tube.
 */
export class Frame {
  private readonly matrix: number[];
  constructor(
    private readonly out: Part[],
    private readonly rot: V3 = [0, 0, 0],
    private readonly pivotLocal: V3 = [0, 0, 0],
    private readonly pivotWorld: V3 = [0, 0, 0],
  ) {
    this.matrix = rotMat(rot);
  }

  /** A frame in the same output that turns by `rot` about the local point `pivotLocal`, which stays at `pivotWorld`. */
  turned(rot: V3, pivotLocal: V3, pivotWorld: V3): Frame {
    return new Frame(this.out, rot, pivotLocal, pivotWorld);
  }

  /** The world position of a frame-local point. */
  point(p: V3): V3 {
    if (isZero(this.rot) && isZero(this.pivotLocal) && isZero(this.pivotWorld)) return p;
    return add(this.pivotWorld, mulVec(this.matrix, sub(p, this.pivotLocal)));
  }

  private push(part: Part, position: V3, o: Opts): void {
    this.out.push({
      ...part,
      ...(o.chamfer ? { chamfer: o.chamfer } : {}),
      ...(o.open ? { open: true } : {}),
      position: r3v(position),
      ...(isZero(this.rot) ? {} : { rotation: r3v(this.rot) }),
      ...(o.lod !== undefined && o.lod < 2 ? { maxLod: o.lod } : {}),
      ...(o.min ? { minLod: o.min } : {}),
      ...(o.repeat ? { repeat: { count: o.repeat.count, step: r3v(o.repeat.step) } } : {}),
    });
  }

  /** A part written out in full (world coordinates, no frame): corrugated sheet and other one-offs. */
  raw(part: Part): this {
    this.out.push(part);
    return this;
  }

  /** An axis-aligned box from corner to corner (in the frame). */
  box(material: string, min: V3, max: V3, o: Opts = {}): this {
    const size: V3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    if (size.some((s) => s <= 0)) throw new Error(`empty box ${material} ${min} ${max}`);
    this.push(
      { type: 'box', material, size: r3v(size) },
      this.point([(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2]),
      o,
    );
    return this;
  }

  /** A cylinder (or frustum) standing on `foot`; `radiusTop` defaults to `radius`. */
  cyl(
    material: string,
    radius: number,
    height: number,
    foot: V3,
    segments: number,
    o: Opts & { radiusTop?: number } = {},
  ): this {
    this.push(
      {
        type: 'cylinder',
        material,
        radius: r3(radius),
        height: r3(height),
        segments,
        ...(o.radiusTop !== undefined ? { radiusTop: r3(o.radiusTop) } : {}),
      },
      this.point(foot),
      o,
    );
    return this;
  }

  cone(
    material: string,
    radius: number,
    height: number,
    foot: V3,
    segments: number,
    o: Opts = {},
  ): this {
    this.push(
      { type: 'cone', material, radius: r3(radius), height: r3(height), segments },
      this.point(foot),
      o,
    );
    return this;
  }

  sphere(
    material: string,
    radius: number,
    centre: V3,
    segments: number,
    rings: number,
    o: Opts = {},
  ): this {
    this.push(
      { type: 'sphere', material, radius: r3(radius), segments, rings, half: 'full' },
      this.point(centre),
      o,
    );
    return this;
  }

  /** An extruded polygon; `axis` y: profile (x, z) up from the foot; x: profile (z, y); z: profile (x, y), centred on `pos`. */
  prism(
    material: string,
    axis: 'x' | 'y' | 'z',
    profile: V2[],
    length: number,
    pos: V3,
    o: Opts & { caps?: 'both' | 'start' | 'end' | 'none' } = {},
  ): this {
    this.push(
      {
        type: 'prism',
        material,
        profile: profile.map(([a, b]) => [r3(a), r3(b)]),
        height: r3(length),
        ...(axis !== 'y' ? { axis } : {}),
        ...(o.caps ? { caps: o.caps } : {}),
      },
      this.point(pos),
      o,
    );
    return this;
  }

  /** A swept tube through frame points (a beam, a brace, a rail, a cable); its points are placed in the world directly. */
  tube(material: string, points: V3[], radius: number, sides: number, o: Opts = {}): this {
    const world = points.map((p) => this.point(p));
    const origin = world[0]!;
    this.out.push({
      type: 'tube',
      material,
      points: world.map((p) => r3v(sub(p, origin))),
      radius: r3(radius),
      sides,
      position: r3v(origin),
      ...(o.lod !== undefined && o.lod < 2 ? { maxLod: o.lod } : {}),
      ...(o.min ? { minLod: o.min } : {}),
    });
    return this;
  }

  /** A box with its own rotation and an explicit centre; with `floor` it is lifted so its lowest corner stands exactly there. */
  tilted(material: string, size: V3, centre: V3, rot: V3, o: Opts = {}, floor?: number): this {
    const m = rotMat(rot);
    let c = centre;
    if (floor !== undefined) {
      let low = Infinity;
      for (const sx of [-1, 1])
        for (const sy of [-1, 1])
          for (const sz of [-1, 1])
            low = Math.min(
              low,
              mulVec(m, [(sx * size[0]) / 2, (sy * size[1]) / 2, (sz * size[2]) / 2])[1],
            );
      c = [centre[0], floor - low, centre[2]];
    }
    const foot = sub(c, mulVec(m, [0, size[1] / 2, 0]));
    this.out.push({
      type: 'box',
      material,
      size: r3v(size),
      ...(o.chamfer ? { chamfer: o.chamfer } : {}),
      position: r3v(foot),
      rotation: r3v(rot),
      ...(o.lod !== undefined && o.lod < 2 ? { maxLod: o.lod } : {}),
      ...(o.min ? { minLod: o.min } : {}),
    });
    return this;
  }
}

/**
 * A pile of broken chunks on the ground around (cx, cz): `count` tilted boxes, the first `keep.all` on every LOD, the
 * next `keep.mid` on LOD0 and LOD1, the rest on LOD0 only. Chunks near the middle lie higher (a mound). Deterministic.
 */
export function rubble(
  frame: Frame,
  materials: string[],
  centre: [number, number],
  radius: [number, number],
  count: number,
  seed: number,
  keep: { all: number; mid: number },
  scale = 1,
): void {
  const rng = makeRng(seed);
  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = Math.sqrt(rng());
    const x = centre[0] + Math.cos(angle) * dist * radius[0];
    const z = centre[1] + Math.sin(angle) * dist * radius[1];
    const big = i < keep.all;
    const size: V3 = [
      (big ? 0.9 : 0.35) * scale + rng() * 0.6 * scale,
      (big ? 0.5 : 0.25) * scale + rng() * 0.35 * scale,
      (big ? 0.8 : 0.3) * scale + rng() * 0.6 * scale,
    ];
    const rot: V3 = [(rng() - 0.5) * 50, rng() * 180, (rng() - 0.5) * 50];
    const mound = (1 - dist) * 0.6 * scale * rng();
    const lod: LodMax = i < keep.all ? 2 : i < keep.all + keep.mid ? 1 : 0;
    frame.tilted(materials[i % materials.length]!, size, [x, 0, z], rot, { lod }, mound);
  }
}

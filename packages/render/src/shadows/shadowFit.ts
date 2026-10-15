// Fits the sun's orthographic shadow camera to the ground the RTS camera sees (shadows guide: a frustum sized to the
// scene, not a fixed square that wastes texels). Pure math, no three objects, so it is tested on its own.
//
// The four corner rays of the view are cut with the slab of terrain heights [groundLo, groundHi] and clamped at
// maxDistance from the eye; those points span the visible ground. In light space their bounding rectangle is the
// shadow camera's left/right/bottom/top: a caster outside the view whose shadow falls into it has the same light-space
// xy as that shadow, so the rectangle already holds it; only the depth range grows towards the sun by casterHeight.
// The light camera stays at a fixed point (the sun direction times LIGHT_DISTANCE from the origin), so light-space
// coordinates are absolute: the rectangle snaps to whole texels and its size to SIZE_STEP steps, and panning or a
// small zoom does not make shadow edges crawl.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ShadowFitInput {
  /** Camera position, world space. */
  eye: Vec3;
  /** Directions of the view's four corner rays (any length), world space. */
  corners: readonly Vec3[];
  /** Lowest and highest terrain height under the view (m). */
  groundLo: number;
  groundHi: number;
  /** No shadow beyond this distance from the eye (m). */
  maxDistance: number;
  /** Unit vector towards the sun. */
  sunDir: Vec3;
  /** Shadow map edge in texels. */
  mapSize: number;
  /** Tallest caster above groundHi (m): the depth range reaches this far towards the sun. Default 30. */
  casterHeight?: number;
}

export interface ShadowFit {
  /** Light camera position (target is the origin). */
  position: Vec3;
  left: number;
  right: number;
  bottom: number;
  top: number;
  near: number;
  far: number;
  /** World size of one shadow texel along light x and y (m). */
  texelX: number;
  texelY: number;
  /** The ground points the fit covers (world space), for tests and debugging. */
  points: Vec3[];
}

/** Distance of the light camera from the origin (m): beyond any map, so every caster is in front of it. */
export const LIGHT_DISTANCE = 2000;
/** The rectangle's sides grow in steps of this share (a zoom changes the texel size only every few percent). */
export const SIZE_STEP = 1.06;
/** Smallest rectangle side (m). */
export const MIN_SIDE = 16;

/** Light-space basis as three's Camera.lookAt builds it (up +Y): z towards the sun, x = up x z, y = z x x. */
export function lightBasis(sunDir: Vec3): { x: Vec3; y: Vec3; z: Vec3 } {
  const z = normalize(sunDir);
  let x = cross({ x: 0, y: 1, z: 0 }, z);
  if (Math.hypot(x.x, x.y, x.z) < 1e-6) x = { x: 1, y: 0, z: 0 }; // sun straight overhead
  x = normalize(x);
  const y = cross(z, x);
  return { x, y, z };
}

/** Rounds a side up to the SIZE_STEP ladder (MIN_SIDE * SIZE_STEP^k). */
export function quantizeSide(side: number): number {
  if (side <= MIN_SIDE) return MIN_SIDE;
  const k = Math.ceil(Math.log(side / MIN_SIDE) / Math.log(SIZE_STEP) - 1e-9);
  return MIN_SIDE * Math.pow(SIZE_STEP, k);
}

export function fitShadowFrustum(input: ShadowFitInput): ShadowFit {
  const { eye, groundLo, groundHi, maxDistance, mapSize } = input;
  const casterHeight = input.casterHeight ?? 30;
  const lo = Math.min(groundLo, groundHi);
  const hi = Math.max(groundLo, groundHi);
  const points: Vec3[] = [];
  for (const c of input.corners) {
    const d = normalize(c);
    for (const h of [hi, lo]) {
      let t = maxDistance;
      if (d.y < -1e-6) t = Math.min(maxDistance, Math.max(0, (h - eye.y) / d.y));
      // On the plane, or (clamped at maxDistance) above it: still the farthest ground that gets a shadow.
      const p = { x: eye.x + d.x * t, y: eye.y + d.y * t, z: eye.z + d.z * t };
      points.push(p);
    }
  }

  const basis = lightBasis(input.sunDir);
  const position = scale(basis.z, LIGHT_DISTANCE);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minT = Infinity;
  let maxT = -Infinity;
  for (const p of points) {
    const r = { x: p.x - position.x, y: p.y - position.y, z: p.z - position.z };
    const vx = dot(r, basis.x);
    const vy = dot(r, basis.y);
    const t = -dot(r, basis.z); // distance in front of the light camera
    minX = Math.min(minX, vx);
    maxX = Math.max(maxX, vx);
    minY = Math.min(minY, vy);
    maxY = Math.max(maxY, vy);
    minT = Math.min(minT, t);
    maxT = Math.max(maxT, t);
  }
  // Snap: the side to the size ladder (with room for the snap), the corner to whole texels.
  const w = quantizeSide(maxX - minX + 2);
  const h = quantizeSide(maxY - minY + 2);
  const texelX = w / mapSize;
  const texelY = h / mapSize;
  const left = Math.floor((minX - 1) / texelX) * texelX;
  const bottom = Math.floor((minY - 1) / texelY) * texelY;
  return {
    position,
    left,
    right: left + w,
    bottom,
    top: bottom + h,
    near: Math.max(0.5, minT - casterHeight - 2),
    far: maxT + 2,
    texelX,
    texelY,
    points,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function normalize(a: Vec3): Vec3 {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

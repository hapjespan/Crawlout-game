// Kleine 4x4- en quaternion-wiskunde voor de bakker, de fit-stap en het retargeten. Matrices zijn column-major
// (glTF en three.js Matrix4.elements), quaternions [x, y, z, w].
export type Mat = Float64Array; // 16, column-major
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface Pose {
  t: Vec3;
  r: Quat;
  s: Vec3;
}

export function identity(): Mat {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function compose({ t, r, s }: Pose): Mat {
  const [x, y, z, w] = r;
  const m = new Float64Array(16);
  m[0] = (1 - 2 * (y * y + z * z)) * s[0];
  m[1] = 2 * (x * y + z * w) * s[0];
  m[2] = 2 * (x * z - y * w) * s[0];
  m[4] = 2 * (x * y - z * w) * s[1];
  m[5] = (1 - 2 * (x * x + z * z)) * s[1];
  m[6] = 2 * (y * z + x * w) * s[1];
  m[8] = 2 * (x * z + y * w) * s[2];
  m[9] = 2 * (y * z - x * w) * s[2];
  m[10] = (1 - 2 * (x * x + y * y)) * s[2];
  m[12] = t[0];
  m[13] = t[1];
  m[14] = t[2];
  m[15] = 1;
  return m;
}

export function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Mat {
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

/** Inverse van een affiene matrix (laatste rij 0, 0, 0, 1). */
export function invertAffine(m: ArrayLike<number>): Mat {
  const [a, b, c, d, e, f, g, h, i] = [
    m[0]!,
    m[1]!,
    m[2]!,
    m[4]!,
    m[5]!,
    m[6]!,
    m[8]!,
    m[9]!,
    m[10]!,
  ];
  const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  if (Math.abs(det) < 1e-20) throw new Error('matrix is niet inverteerbaar');
  const inv = 1 / det;
  const out = new Float64Array(16);
  out[0] = (e * i - f * h) * inv;
  out[1] = (c * h - b * i) * inv;
  out[2] = (b * f - c * e) * inv;
  out[4] = (f * g - d * i) * inv;
  out[5] = (a * i - c * g) * inv;
  out[6] = (c * d - a * f) * inv;
  out[8] = (d * h - e * g) * inv;
  out[9] = (b * g - a * h) * inv;
  out[10] = (a * e - b * d) * inv;
  const [tx, ty, tz] = [m[12]!, m[13]!, m[14]!];
  out[12] = -(out[0] * tx + out[4] * ty + out[8] * tz);
  out[13] = -(out[1] * tx + out[5] * ty + out[9] * tz);
  out[14] = -(out[2] * tx + out[6] * ty + out[10] * tz);
  out[15] = 1;
  return out;
}

export function transformPoint(m: ArrayLike<number>, p: ArrayLike<number>): Vec3 {
  return [
    m[0]! * p[0]! + m[4]! * p[1]! + m[8]! * p[2]! + m[12]!,
    m[1]! * p[0]! + m[5]! * p[1]! + m[9]! * p[2]! + m[13]!,
    m[2]! * p[0]! + m[6]! * p[1]! + m[10]! * p[2]! + m[14]!,
  ];
}

export function transformDirection(m: ArrayLike<number>, p: ArrayLike<number>): Vec3 {
  return [
    m[0]! * p[0]! + m[4]! * p[1]! + m[8]! * p[2]!,
    m[1]! * p[0]! + m[5]! * p[1]! + m[9]! * p[2]!,
    m[2]! * p[0]! + m[6]! * p[1]! + m[10]! * p[2]!,
  ];
}

export function quatMultiply(a: readonly number[], b: readonly number[]): Quat {
  const [ax, ay, az, aw] = a as Quat;
  const [bx, by, bz, bw] = b as Quat;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatInvert(q: readonly number[]): Quat {
  return [-q[0]!, -q[1]!, -q[2]!, q[3]!];
}

export function quatNormalize(q: readonly number[]): Quat {
  const len = Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!) || 1;
  return [q[0]! / len, q[1]! / len, q[2]! / len, q[3]! / len];
}

export function quatRotate(q: readonly number[], v: readonly number[]): Vec3 {
  const p = quatMultiply(quatMultiply(q, [v[0]!, v[1]!, v[2]!, 0]), quatInvert(q));
  return [p[0], p[1], p[2]];
}

export function quatFromAxisAngle(axis: readonly number[], angle: number): Quat {
  const len = Math.hypot(axis[0]!, axis[1]!, axis[2]!) || 1;
  const s = Math.sin(angle / 2) / len;
  return [axis[0]! * s, axis[1]! * s, axis[2]! * s, Math.cos(angle / 2)];
}

/** Kortste rotatie die richting `from` op richting `to` legt. */
export function quatFromTo(from: readonly number[], to: readonly number[]): Quat {
  const a = normalize3(from);
  const b = normalize3(to);
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (dot > 1 - 1e-9) return [0, 0, 0, 1];
  if (dot < -1 + 1e-9) {
    const axis = Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]);
    return quatFromAxisAngle(axis, Math.PI);
  }
  const c = cross(a, b);
  return quatNormalize([c[0], c[1], c[2], 1 + dot]);
}

/** Rotatie van een matrix met (ongeveer) uniforme positieve schaal, plus die schaal. */
export function rotationOf(m: ArrayLike<number>): { q: Quat; scale: number } {
  const sx = Math.hypot(m[0]!, m[1]!, m[2]!);
  const sy = Math.hypot(m[4]!, m[5]!, m[6]!);
  const sz = Math.hypot(m[8]!, m[9]!, m[10]!);
  const det =
    m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) -
    m[4]! * (m[1]! * m[10]! - m[2]! * m[9]!) +
    m[8]! * (m[1]! * m[6]! - m[2]! * m[5]!);
  const scale = Math.cbrt(det);
  if (!(scale > 0) || Math.max(sx, sy, sz) / Math.min(sx, sy, sz) > 1.001)
    throw new Error('matrix heeft geen uniforme positieve schaal (gespiegeld of scheef)');
  const r = [
    m[0]! / sx,
    m[1]! / sx,
    m[2]! / sx,
    m[4]! / sy,
    m[5]! / sy,
    m[6]! / sy,
    m[8]! / sz,
    m[9]! / sz,
    m[10]! / sz,
  ];
  // Kolommen x, y, z; element (rij, kolom) = r[kolom * 3 + rij].
  const [m00, m10, m20, m01, m11, m21, m02, m12, m22] = r as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const trace = m00 + m11 + m22;
  let q: Quat;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return { q: quatNormalize(q), scale };
}

export function slerp(a: readonly number[], b: readonly number[], f: number): Quat {
  let dot = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!;
  const sign = dot < 0 ? -1 : 1;
  dot *= sign;
  let k0 = 1 - f;
  let k1 = f * sign;
  if (dot < 0.9995) {
    const theta = Math.acos(dot);
    const sin = Math.sin(theta);
    k0 = Math.sin((1 - f) * theta) / sin;
    k1 = (Math.sin(f * theta) / sin) * sign;
  }
  return quatNormalize([0, 1, 2, 3].map((i) => k0 * a[i]! + k1 * b[i]!));
}

export function cross(a: readonly number[], b: readonly number[]): Vec3 {
  return [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
}

export function normalize3(v: readonly number[]): Vec3 {
  const len = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
  return [v[0]! / len, v[1]! / len, v[2]! / len];
}

export function sub3(a: readonly number[], b: readonly number[]): Vec3 {
  return [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
}

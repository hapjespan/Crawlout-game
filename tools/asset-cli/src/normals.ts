// Gladde vertex-normalen voor primitives die ze missen. Bronnen zonder NORMAL (of met alleen nul-vectoren, zoals
// mergeSkinnedPrimitives die zou achterlaten) krijgen er een, zodat render's toon-materiaal altijd iets te belichten
// heeft. Hoekpunten op dezelfde plek (UV-naden) delen hun normaal, anders ziet een naad als een rand.
import type { Accessor, Document, Primitive } from '@gltf-transform/core';

/** Sleutel voor "dezelfde plek": positie afgerond op 1e-5 van de grootste afmeting van de primitive. */
function weldKeys(position: Accessor): string[] {
  const p = [0, 0, 0];
  let size = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < position.getCount(); i++) {
    position.getElement(i, p);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, p[k]!);
      max[k] = Math.max(max[k]!, p[k]!);
    }
  }
  for (let k = 0; k < 3; k++) size = Math.max(size, max[k]! - min[k]!);
  const step = Math.max(size, 1e-9) * 1e-5;
  const keys: string[] = [];
  for (let i = 0; i < position.getCount(); i++) {
    position.getElement(i, p);
    keys.push(
      `${Math.round(p[0]! / step)},${Math.round(p[1]! / step)},${Math.round(p[2]! / step)}`,
    );
  }
  return keys;
}

/** Of de primitive geen bruikbare normalen heeft: geen attribuut, of alleen nul-vectoren. */
function lacksNormals(prim: Primitive): boolean {
  const normal = prim.getAttribute('NORMAL');
  if (!normal) return true;
  const n = [0, 0, 0];
  for (let i = 0; i < normal.getCount(); i++) {
    normal.getElement(i, n);
    if (n[0] !== 0 || n[1] !== 0 || n[2] !== 0) return false;
  }
  return true;
}

/** Oppervlak-gewogen gladde normalen voor één TRIANGLES-primitive (genormaliseerd, Float32). */
export function computeSmoothNormals(prim: Primitive): Float32Array {
  const position = prim.getAttribute('POSITION')!;
  const indices = prim.getIndices();
  const count = position.getCount();
  const keys = weldKeys(position);
  const sums = new Map<string, [number, number, number]>();
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  const c = [0, 0, 0];
  const n = indices ? indices.getCount() : count;
  for (let i = 0; i + 2 < n; i += 3) {
    const ia = indices ? indices.getScalar(i) : i;
    const ib = indices ? indices.getScalar(i + 1) : i + 1;
    const ic = indices ? indices.getScalar(i + 2) : i + 2;
    position.getElement(ia, a);
    position.getElement(ib, b);
    position.getElement(ic, c);
    const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
    const v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    // Het uitproduct heeft als lengte het dubbele oppervlak: grotere driehoeken wegen zwaarder.
    const cross = [
      u[1]! * v[2]! - u[2]! * v[1]!,
      u[2]! * v[0]! - u[0]! * v[2]!,
      u[0]! * v[1]! - u[1]! * v[0]!,
    ];
    for (const index of [ia, ib, ic]) {
      const key = keys[index]!;
      const sum = sums.get(key) ?? [0, 0, 0];
      sum[0] += cross[0]!;
      sum[1] += cross[1]!;
      sum[2] += cross[2]!;
      sums.set(key, sum);
    }
  }
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const s = sums.get(keys[i]!) ?? [0, 0, 0];
    const length = Math.hypot(s[0], s[1], s[2]);
    if (length > 0) out.set([s[0] / length, s[1] / length, s[2] / length], i * 3);
    else out.set([0, 1, 0], i * 3);
  }
  return out;
}

/**
 * Per-vertex VEC4 tangents from the UV gradient (Lengyel's method, averaged per vertex and made orthogonal to the
 * normal; w is the handedness of the bitangent). For a primitive whose source carries no TANGENT: the renderer then
 * gets one frame for every surface instead of rebuilding half of them from screen-space derivatives.
 */
export function computeTangents(
  positions: Float64Array,
  normals: Float64Array,
  uvs: Float32Array,
  indices: Uint32Array,
): Float64Array {
  const count = positions.length / 3;
  const tan = new Float64Array(count * 3);
  const bit = new Float64Array(count * 3);
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const [i0, i1, i2] = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
    const e1 = [0, 1, 2].map((k) => positions[i1 * 3 + k]! - positions[i0 * 3 + k]!);
    const e2 = [0, 1, 2].map((k) => positions[i2 * 3 + k]! - positions[i0 * 3 + k]!);
    const u1 = uvs[i1 * 2]! - uvs[i0 * 2]!;
    const v1 = uvs[i1 * 2 + 1]! - uvs[i0 * 2 + 1]!;
    const u2 = uvs[i2 * 2]! - uvs[i0 * 2]!;
    const v2 = uvs[i2 * 2 + 1]! - uvs[i0 * 2 + 1]!;
    const det = u1 * v2 - u2 * v1;
    if (Math.abs(det) < 1e-12) continue;
    const r = 1 / det;
    for (const i of [i0, i1, i2])
      for (let k = 0; k < 3; k++) {
        tan[i * 3 + k]! += (e1[k]! * v2 - e2[k]! * v1) * r;
        bit[i * 3 + k]! += (e2[k]! * u1 - e1[k]! * u2) * r;
      }
  }
  const out = new Float64Array(count * 4);
  for (let i = 0; i < count; i++) {
    const n = [normals[i * 3]!, normals[i * 3 + 1]!, normals[i * 3 + 2]!];
    const t = [tan[i * 3]!, tan[i * 3 + 1]!, tan[i * 3 + 2]!];
    const d = n[0]! * t[0]! + n[1]! * t[1]! + n[2]! * t[2]!;
    const o = t.map((v, k) => v - n[k]! * d);
    let l = Math.hypot(o[0]!, o[1]!, o[2]!);
    // A vertex with no usable UV gradient: any direction across the normal will do.
    if (!(l > 1e-9)) {
      const a = Math.abs(n[0]!) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      o[0] = n[1]! * a[2]! - n[2]! * a[1]!;
      o[1] = n[2]! * a[0]! - n[0]! * a[2]!;
      o[2] = n[0]! * a[1]! - n[1]! * a[0]!;
      l = Math.hypot(o[0]!, o[1]!, o[2]!) || 1;
    }
    const cx = (n[1]! * o[2]!) / l - (n[2]! * o[1]!) / l;
    const cy = (n[2]! * o[0]!) / l - (n[0]! * o[2]!) / l;
    const cz = (n[0]! * o[1]!) / l - (n[1]! * o[0]!) / l;
    const handed = cx * bit[i * 3]! + cy * bit[i * 3 + 1]! + cz * bit[i * 3 + 2]! < 0 ? -1 : 1;
    out.set([o[0]! / l, o[1]! / l, o[2]! / l, handed], i * 4);
  }
  return out;
}

/** Geeft elke TRIANGLES-primitive zonder normalen gladde normalen. Geeft het aantal primitives dat er een kreeg. */
export function ensureSmoothNormals(document: Document): number {
  let fixed = 0;
  const root = document.getRoot();
  for (const mesh of root.listMeshes())
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4 || !prim.getAttribute('POSITION') || !lacksNormals(prim)) continue;
      const position = prim.getAttribute('POSITION')!;
      const accessor = document
        .createAccessor()
        .setType('VEC3')
        .setArray(computeSmoothNormals(prim))
        .setBuffer(position.getBuffer() ?? root.listBuffers()[0] ?? document.createBuffer());
      prim.setAttribute('NORMAL', accessor);
      fixed++;
    }
  return fixed;
}

// Atlas-bouwstenen: sharp lazy laden, de emissive-als-diffuse-stap, het inpakken van vierkante cellen en het
// tegelwerk op UV's. textures.part3.ts bouwt de atlas er zelf mee; textures.ts re-exporteert wat publiek is.
// Holds: loadSharp, emissiveAsBaseColor, packSquares, linearToSrgbByte, surfaceArea, triangleTile, +4 more.
import { type Document, type Primitive, type Accessor } from '@gltf-transform/core';

type Sharp = (typeof import('sharp'))['default'];

let sharpModule: Promise<Sharp> | null = null;

export const loadSharp = (): Promise<Sharp> =>
  (sharpModule ??= import('sharp').then((m) => m.default));

/** Materialen zonder diffuse maar met een emissive textuur (Sketchfab-unlit): de emissive wordt de diffuse. */
export function emissiveAsBaseColor(document: Document): number {
  let changed = 0;
  for (const material of document.getRoot().listMaterials()) {
    const emissive = material.getEmissiveTexture();
    if (material.getBaseColorTexture() || !emissive) continue;
    material
      .setBaseColorTexture(emissive)
      .setBaseColorFactor([1, 1, 1, 1])
      .setEmissiveTexture(null)
      .setEmissiveFactor([0, 0, 0]);
    changed++;
  }
  return changed;
}

/** Pakt vierkante cellen (macht van 2) in een vierkant van `size`; quadtree, grootste eerst. Null als het niet past. */
export function packSquares(
  cells: readonly number[],
  size: number,
): { x: number; y: number }[] | null {
  const order = cells.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const free: { x: number; y: number; size: number }[] = [{ x: 0, y: 0, size }];
  const out: { x: number; y: number }[] = new Array(cells.length);
  for (const [cell, index] of order) {
    // Kleinste vrije vak dat past, dan opsplitsen tot de celmaat.
    free.sort((a, b) => a.size - b.size || a.y - b.y || a.x - b.x);
    const slot = free.findIndex((f) => f.size >= cell);
    if (slot < 0) return null;
    let box = free.splice(slot, 1)[0]!;
    while (box.size > cell) {
      const half = box.size / 2;
      free.push(
        { x: box.x + half, y: box.y, size: half },
        { x: box.x, y: box.y + half, size: half },
        { x: box.x + half, y: box.y + half, size: half },
      );
      box = { x: box.x, y: box.y, size: half };
    }
    out[index] = { x: box.x, y: box.y };
  }
  return out;
}

/** glTF-factoren zijn lineair, een basiskleurtextuur is sRGB; deze omrekening zet er een texelwaarde van. */
export function linearToSrgbByte(linear: number): number {
  const c = Math.min(1, Math.max(0, linear));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

/** Oppervlak in modelruimte van de primitives die een textuur gebruiken (bepaalt wie eerst kleiner moet). */
export function surfaceArea(prims: readonly Primitive[]): number {
  let area = 0;
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  const c = [0, 0, 0];
  for (const prim of prims) {
    const pos = prim.getAttribute('POSITION');
    const idx = prim.getIndices();
    if (!pos) continue;
    const n = idx ? idx.getCount() : pos.getCount();
    for (let i = 0; i + 2 < n; i += 3) {
      pos.getElement(idx ? idx.getScalar(i) : i, a);
      pos.getElement(idx ? idx.getScalar(i + 1) : i + 1, b);
      pos.getElement(idx ? idx.getScalar(i + 2) : i + 2, c);
      const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
      const v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
      area +=
        Math.hypot(
          u[1]! * v[2]! - u[2]! * v[1]!,
          u[2]! * v[0]! - u[0]! * v[2]!,
          u[0]! * v[1]! - u[1]! * v[0]!,
        ) / 2;
    }
  }
  return area;
}

/** Een UV-overschrijding tot deze afstand buiten een tegel van 0 tot 1 telt niet als tegelen maar wordt afgeklemd. */
const UV_TILE_TOLERANCE = 0.03;

interface TriangleTile {
  /** Tegel (gehele UV-verschuiving) per as. */
  base: [number, number];
  /** Aantal tegels dat de driehoek per as raakt (1 = binnen één tegel). */
  touched: [number, number];
}

/**
 * De tegel van een driehoek, uit zijn UV-omhullende. Een driehoek die binnen een tegel past (met `tolerance` marge
 * naar buiten) hoort bij die tegel; een driehoek die een tegelgrens echt overspant raakt meerdere tegels en vraagt
 * dat de textuur in de atlascel herhaald wordt.
 */
export function triangleTile(
  uvs: readonly [number, number][],
  tolerance = UV_TILE_TOLERANCE,
): TriangleTile {
  const base: [number, number] = [0, 0];
  const touched: [number, number] = [1, 1];
  for (const axis of [0, 1] as const) {
    let min = Infinity;
    let max = -Infinity;
    for (const uv of uvs) {
      const value = Number.isFinite(uv[axis]) ? uv[axis] : 0;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    base[axis] = Math.floor(min + tolerance);
    touched[axis] = Math.max(1, Math.floor(max - tolerance) - base[axis] + 1);
  }
  return { base, touched };
}

/** Bron-UV's van een primitive als paren (Float32 uit elke opslagvorm). */
function readUvs(uv: Accessor): [number, number][] {
  const out: [number, number][] = [];
  const e = [0, 0];
  for (let i = 0; i < uv.getCount(); i++) {
    uv.getElement(i, e);
    out.push([e[0]!, e[1]!]);
  }
  return out;
}

function triangleIndices(prim: Primitive): number[] {
  const idx = prim.getIndices();
  const count = idx ? idx.getCount() : (prim.getAttribute('POSITION')?.getCount() ?? 0);
  const out: number[] = [];
  for (let i = 0; i + 2 < count; i += 3)
    out.push(
      idx ? idx.getScalar(i) : i,
      idx ? idx.getScalar(i + 1) : i + 1,
      idx ? idx.getScalar(i + 2) : i + 2,
    );
  return out;
}

/** Aantal herhalingen dat een textuur in zijn cel nodig heeft, uit de driehoeken die tegelgrenzen overspannen. */
export function requiredRepeat(
  prims: readonly Primitive[],
  clampedAxes: readonly [boolean, boolean],
): number {
  let repeat = 1;
  for (const prim of prims) {
    const uv = prim.getAttribute('TEXCOORD_0');
    if (!uv) continue;
    const uvs = readUvs(uv);
    const tri = triangleIndices(prim);
    for (let i = 0; i < tri.length; i += 3) {
      const { touched } = triangleTile([uvs[tri[i]!]!, uvs[tri[i + 1]!]!, uvs[tri[i + 2]!]!]);
      for (const axis of [0, 1] as const)
        if (!clampedAxes[axis]) repeat = Math.max(repeat, touched[axis]);
    }
  }
  return repeat;
}

/**
 * Zet de primitive om naar de atlas: elke driehoek schuift naar zijn eigen tegel (hoekpunten die in driehoeken met
 * verschillende tegels zitten worden gedupliceerd), daarna naar de cel `(x, y, size)` van de atlas (`used` px breed).
 * `repeat` is het aantal herhalingen van de textuur in de cel; assen met wrap CLAMP_TO_EDGE klemmen per hoekpunt.
 * Alle attributen krijgen nieuwe accessors (de bron kan door andere primitives gedeeld worden).
 */
export function remapPrimitiveToAtlas(
  document: Document,
  prim: Primitive,
  cell: { x: number; y: number; size: number },
  used: number,
  repeat: number,
  clampedAxes: readonly [boolean, boolean],
): void {
  const uvAccessor = prim.getAttribute('TEXCOORD_0')!;
  const uvs = readUvs(uvAccessor);
  const tri = triangleIndices(prim);
  const keyToNew = new Map<string, number>();
  const sourceOf: number[] = [];
  const tileOf: [number, number][] = [];
  const indices: number[] = [];
  for (let i = 0; i < tri.length; i += 3) {
    const corners = [tri[i]!, tri[i + 1]!, tri[i + 2]!];
    const { base } = triangleTile(corners.map((c) => uvs[c]!));
    const tile: [number, number] = [clampedAxes[0] ? 0 : base[0], clampedAxes[1] ? 0 : base[1]];
    for (const corner of corners) {
      const key = `${corner}:${tile[0]}:${tile[1]}`;
      let index = keyToNew.get(key);
      if (index === undefined) {
        index = sourceOf.length;
        keyToNew.set(key, index);
        sourceOf.push(corner);
        tileOf.push(tile);
      }
      indices.push(index);
    }
  }
  const count = sourceOf.length;
  const buffer =
    prim.getAttribute('POSITION')!.getBuffer() ??
    document.getRoot().listBuffers()[0] ??
    document.createBuffer();

  // UV: tegel eraf, delen door het aantal herhalingen, naar het midden van de texels van de cel (geen bloeden).
  const out = new Float32Array(count * 2);
  const scale = (cell.size - 1) / used;
  for (let v = 0; v < count; v++) {
    const src = uvs[sourceOf[v]!]!;
    for (const axis of [0, 1] as const) {
      const local = Number.isFinite(src[axis]) ? src[axis] - tileOf[v]![axis] : 0;
      const t = Math.min(1, Math.max(0, local)) / (clampedAxes[axis] ? 1 : repeat);
      out[v * 2 + axis] = ((axis === 0 ? cell.x : cell.y) + 0.5) / used + t * scale;
    }
  }

  for (const semantic of prim.listSemantics()) {
    const old = prim.getAttribute(semantic)!;
    if (semantic === 'TEXCOORD_0') {
      prim.setAttribute(
        semantic,
        document.createAccessor().setType('VEC2').setArray(out).setBuffer(buffer),
      );
      continue;
    }
    const array = old.getArray()!;
    const size = old.getElementSize();
    const next = new (array.constructor as new (n: number) => typeof array)(count * size);
    for (let v = 0; v < count; v++)
      next.set(array.subarray(sourceOf[v]! * size, (sourceOf[v]! + 1) * size), v * size);
    prim.setAttribute(semantic, old.clone().setArray(next));
  }
  prim.setIndices(
    document
      .createAccessor()
      .setType('SCALAR')
      .setArray(count > 65535 ? new Uint32Array(indices) : new Uint16Array(indices))
      .setBuffer(buffer),
  );
}

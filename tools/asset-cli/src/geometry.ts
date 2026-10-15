// Kleine meshgereedschappen voor de gebouwengenerator (buildings.ts): vertices samenvoegen, transformeren,
// selecteren, vereenvoudigen en de eenvoudige vormen box, cylinder en cone. Geen vormgetallen hier: alles wat een
// gebouw eruit laat zien staat in assets/src/buildings/variants.json.
import { MeshoptSimplifier, type SimplifierFlags } from 'meshoptimizer';

/** Geindexeerde mesh. `uvs` is null voor effen materialen; normalen zijn altijd aanwezig. */
export interface Mesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array | null;
  indices: Uint32Array;
}

export type Vec3 = readonly [number, number, number];

export function triangleCount(mesh: Mesh): number {
  return mesh.indices.length / 3;
}

/** Transform als schaal, dan rotatie (graden, volgorde Y, X, Z), dan translatie. Rij-major 3x3 plus translatie. */
export interface Transform {
  /** Bovenste 3x3 (R * S), rij-major. */
  m: number[];
  /** Normaalmatrix (inverse transpose van `m`), rij-major. */
  n: number[];
  t: Vec3;
}

function rotationMatrix(degrees: Vec3): number[] {
  const [rx, ry, rz] = degrees.map((d) => (d * Math.PI) / 180) as [number, number, number];
  const [cx, sx, cy, sy, cz, sz] = [
    Math.cos(rx),
    Math.sin(rx),
    Math.cos(ry),
    Math.sin(ry),
    Math.cos(rz),
    Math.sin(rz),
  ] as const;
  // R = Ry * Rx * Rz
  const rY = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const rX = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const rZ = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return mul3(mul3(rY, rX), rZ);
}

function mul3(a: number[], b: number[]): number[] {
  const out = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      for (let k = 0; k < 3; k++) out[r * 3 + c]! += a[r * 3 + k]! * b[k * 3 + c]!;
  return out;
}

export function inverseTranspose3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m as [
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
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const inv = 1 / det;
  // inverse = adjugate / det; de transpose van de inverse is de cofactormatrix / det.
  return [
    (e * i - f * h) * inv,
    (f * g - d * i) * inv,
    (d * h - e * g) * inv,
    (c * h - b * i) * inv,
    (a * i - c * g) * inv,
    (b * g - a * h) * inv,
    (b * f - c * e) * inv,
    (c * d - a * f) * inv,
    (a * e - b * d) * inv,
  ];
}

export function makeTransform(options: {
  scale?: Vec3;
  rotation?: Vec3;
  translation?: Vec3;
}): Transform {
  const [sx, sy, sz] = options.scale ?? [1, 1, 1];
  const r = rotationMatrix(options.rotation ?? [0, 0, 0]);
  // R * S: schaal de kolommen van R.
  const m = [
    r[0]! * sx,
    r[1]! * sy,
    r[2]! * sz,
    r[3]! * sx,
    r[4]! * sy,
    r[5]! * sz,
    r[6]! * sx,
    r[7]! * sy,
    r[8]! * sz,
  ];
  return { m, n: inverseTranspose3(m), t: options.translation ?? [0, 0, 0] };
}

export function transformMesh(mesh: Mesh, transform: Transform): Mesh {
  const { m, n, t } = transform;
  const positions = new Float32Array(mesh.positions.length);
  const normals = new Float32Array(mesh.normals.length);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i]!;
    const y = mesh.positions[i + 1]!;
    const z = mesh.positions[i + 2]!;
    positions[i] = m[0]! * x + m[1]! * y + m[2]! * z + t[0];
    positions[i + 1] = m[3]! * x + m[4]! * y + m[5]! * z + t[1];
    positions[i + 2] = m[6]! * x + m[7]! * y + m[8]! * z + t[2];
    const nx = mesh.normals[i]!;
    const ny = mesh.normals[i + 1]!;
    const nz = mesh.normals[i + 2]!;
    const ox = n[0]! * nx + n[1]! * ny + n[2]! * nz;
    const oy = n[3]! * nx + n[4]! * ny + n[5]! * nz;
    const oz = n[6]! * nx + n[7]! * ny + n[8]! * nz;
    const len = Math.hypot(ox, oy, oz) || 1;
    normals[i] = ox / len;
    normals[i + 1] = oy / len;
    normals[i + 2] = oz / len;
  }
  return { positions, normals, uvs: mesh.uvs, indices: mesh.indices };
}

/** Houdt de driehoeken waarvan het zwaartepunt de test haalt; ongebruikte vertices vallen weg. */
export function selectTriangles(mesh: Mesh, keep: (centroid: Vec3) => boolean): Mesh {
  const kept: number[] = [];
  const p = mesh.positions;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i]! * 3;
    const b = mesh.indices[i + 1]! * 3;
    const c = mesh.indices[i + 2]! * 3;
    const centroid: Vec3 = [
      (p[a]! + p[b]! + p[c]!) / 3,
      (p[a + 1]! + p[b + 1]! + p[c + 1]!) / 3,
      (p[a + 2]! + p[b + 2]! + p[c + 2]!) / 3,
    ];
    if (keep(centroid)) kept.push(mesh.indices[i]!, mesh.indices[i + 1]!, mesh.indices[i + 2]!);
  }
  return compact(mesh, new Uint32Array(kept));
}

interface Component {
  root: string;
  area: number;
}

/** Verdeelt de driehoeken in samenhangende delen (hoekpunten binnen `weldDistance` tellen als gelijk), met oppervlak. */
function connectedComponents(
  mesh: Mesh,
  weldDistance: number,
): { components: Component[]; rootOfTriangle: string[] } {
  const key = (vertex: number): string =>
    [0, 1, 2].map((k) => Math.round(mesh.positions[vertex * 3 + k]! / weldDistance)).join(',');
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    let root = a;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cursor = a;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const triangles = mesh.indices.length / 3;
  for (let i = 0; i < mesh.indices.length; i++) {
    const k = key(mesh.indices[i]!);
    if (!parent.has(k)) parent.set(k, k);
  }
  for (let t = 0; t < triangles; t++) {
    const a = find(key(mesh.indices[t * 3]!));
    parent.set(find(key(mesh.indices[t * 3 + 1]!)), a);
    parent.set(find(key(mesh.indices[t * 3 + 2]!)), a);
  }
  const area = new Map<string, number>();
  const rootOfTriangle: string[] = [];
  const p = mesh.positions;
  for (let t = 0; t < triangles; t++) {
    const [a, b, c] = [0, 1, 2].map((k) => mesh.indices[t * 3 + k]! * 3) as [
      number,
      number,
      number,
    ];
    const ux = p[b]! - p[a]!;
    const uy = p[b + 1]! - p[a + 1]!;
    const uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!;
    const vy = p[c + 1]! - p[a + 1]!;
    const vz = p[c + 2]! - p[a + 2]!;
    const r = find(key(mesh.indices[t * 3]!));
    rootOfTriangle.push(r);
    area.set(
      r,
      (area.get(r) ?? 0) + Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2,
    );
  }
  // Groot naar klein; bij gelijk oppervlak beslist de volgorde van eerste voorkomen (Map-volgorde), dus deterministisch.
  const components = [...area.entries()]
    .map(([root, a]) => ({ root, area: a }))
    .sort((x, y) => y.area - x.area);
  return { components, rootOfTriangle };
}

function keepComponents(mesh: Mesh, keep: Set<string>, rootOfTriangle: string[]): Mesh {
  const kept: number[] = [];
  for (let t = 0; t < rootOfTriangle.length; t++)
    if (keep.has(rootOfTriangle[t]!))
      kept.push(mesh.indices[t * 3]!, mesh.indices[t * 3 + 1]!, mesh.indices[t * 3 + 2]!);
  return compact(mesh, new Uint32Array(kept));
}

/**
 * Houdt de `count` grootste samenhangende delen (naar oppervlak). Delen hangen samen als driehoeken een hoekpunt delen;
 * hoekpunten tellen als gelijk binnen `weldDistance` (uv-naden splitsen vertices op dezelfde plek).
 */
export function largestComponents(mesh: Mesh, count: number, weldDistance: number): Mesh {
  const { components, rootOfTriangle } = connectedComponents(mesh, weldDistance);
  return keepComponents(
    mesh,
    new Set(components.slice(0, count).map((c) => c.root)),
    rootOfTriangle,
  );
}

/** Laat samenhangende delen vallen die samen minder dan `fraction` van het totale oppervlak hebben (klein detail). */
export function dropSmallComponents(mesh: Mesh, fraction: number, weldDistance: number): Mesh {
  if (fraction <= 0) return mesh;
  const { components, rootOfTriangle } = connectedComponents(mesh, weldDistance);
  const total = components.reduce((sum, c) => sum + c.area, 0);
  const keep = new Set(components.filter((c) => c.area >= total * fraction).map((c) => c.root));
  // Nooit alles laten vallen: het grootste deel blijft.
  if (keep.size === 0 && components[0]) keep.add(components[0].root);
  return keepComponents(mesh, keep, rootOfTriangle);
}

/** Nieuwe mesh met alleen de vertices die `indices` gebruikt, in volgorde van eerste gebruik. */
export function compact(mesh: Mesh, indices: Uint32Array): Mesh {
  const remap = new Map<number, number>();
  const order: number[] = [];
  const next = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const old = indices[i]!;
    let id = remap.get(old);
    if (id === undefined) {
      id = order.length;
      remap.set(old, id);
      order.push(old);
    }
    next[i] = id;
  }
  const positions = new Float32Array(order.length * 3);
  const normals = new Float32Array(order.length * 3);
  const uvs = mesh.uvs ? new Float32Array(order.length * 2) : null;
  order.forEach((old, id) => {
    positions.set(mesh.positions.subarray(old * 3, old * 3 + 3), id * 3);
    normals.set(mesh.normals.subarray(old * 3, old * 3 + 3), id * 3);
    if (uvs && mesh.uvs) uvs.set(mesh.uvs.subarray(old * 2, old * 2 + 2), id * 2);
  });
  return { positions, normals, uvs, indices: next };
}

/**
 * Vereenvoudigt tot hooguit `targetTriangles` driehoeken (meshopt, met uv en normaal als gewogen attributen zodat
 * naden en vlakken netjes blijven). Een mesh die al onder het doel zit blijft ongewijzigd. Een paar passes met strakker
 * doel als meshopt er te weinig uit haalt.
 */
export interface SimplifyOptions {
  flags: readonly SimplifierFlags[];
  /** Gewicht van de uv in de foutmaat (elk van u en v) en van de normaal (elke component). */
  uvWeight: number;
  normalWeight: number;
}

export function simplifyMesh(mesh: Mesh, targetTriangles: number, options: SimplifyOptions): Mesh {
  const target = Math.max(1, Math.floor(targetTriangles));
  if (triangleCount(mesh) <= target) return mesh;
  const stride = mesh.uvs ? 5 : 3;
  const attributes = new Float32Array((mesh.positions.length / 3) * stride);
  for (let v = 0; v < mesh.positions.length / 3; v++) {
    attributes.set(mesh.normals.subarray(v * 3, v * 3 + 3), v * stride);
    if (mesh.uvs) attributes.set(mesh.uvs.subarray(v * 2, v * 2 + 2), v * stride + 3);
  }
  const nw = options.normalWeight;
  const weights = mesh.uvs ? [nw, nw, nw, options.uvWeight, options.uvWeight] : [nw, nw, nw];
  const run = (flags: readonly string[]): Uint32Array => {
    let indices = mesh.indices;
    let goal = target;
    for (let pass = 0; pass < 6; pass++) {
      const [simplified] = MeshoptSimplifier.simplifyWithAttributes(
        indices,
        mesh.positions,
        3,
        attributes,
        stride,
        weights,
        null,
        goal * 3,
        1,
        [...flags] as SimplifyOptions['flags'][number][],
      );
      indices = simplified;
      if (indices.length / 3 <= target) break;
      goal = Math.max(1, Math.floor(goal * 0.85));
    }
    return indices;
  };
  let indices = run(options.flags);
  // `Prune` laat losse delen vallen zodra het budget krap is en kan daardoor ver onder het doel eindigen. Eindigt het
  // onder 90 procent van het doel, probeer dan zonder `Prune` en neem dat resultaat als het dichter bij het doel zit.
  if (indices.length / 3 < target * 0.9 && options.flags.includes('Prune')) {
    const gentle = run(options.flags.filter((flag) => flag !== 'Prune'));
    if (gentle.length / 3 <= target && gentle.length > indices.length) indices = gentle;
  }
  return compact(mesh, indices);
}

/** Verzamelt meshes met hetzelfde materiaal tot een mesh. Alle onderdelen moeten wel of geen uv hebben. */
export class MeshAccumulator {
  private positions: number[] = [];
  private normals: number[] = [];
  private uvs: number[] = [];
  private indices: number[] = [];
  private hasUv: boolean | null = null;

  add(mesh: Mesh): void {
    const textured = mesh.uvs !== null;
    if (this.hasUv !== null && this.hasUv !== textured)
      throw new Error('een materiaal kan niet tegelijk met en zonder uv gevuld worden');
    this.hasUv = textured;
    const base = this.positions.length / 3;
    for (const v of mesh.positions) this.positions.push(v);
    for (const v of mesh.normals) this.normals.push(v);
    if (mesh.uvs) for (const v of mesh.uvs) this.uvs.push(v);
    for (const i of mesh.indices) this.indices.push(i + base);
  }

  build(): Mesh {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      uvs: this.hasUv ? new Float32Array(this.uvs) : null,
      indices: new Uint32Array(this.indices),
    };
  }
}

/** Box met zijden langs de assen, voet in het midden onder (y van 0 tot `size[1]`), vlakke normalen. */
export function makeBox(size: Vec3): Mesh {
  const [sx, sy, sz] = size;
  const hx = sx / 2;
  const hz = sz / 2;
  // [normaal, vier hoekpunten tegen de klok in gezien van buiten]
  // prettier-ignore
  const faces: [Vec3, Vec3[]][] = [
    [[0, 1, 0], [[-hx, sy, hz], [hx, sy, hz], [hx, sy, -hz], [-hx, sy, -hz]]],
    [[0, -1, 0], [[-hx, 0, -hz], [hx, 0, -hz], [hx, 0, hz], [-hx, 0, hz]]],
    [[0, 0, 1], [[-hx, 0, hz], [hx, 0, hz], [hx, sy, hz], [-hx, sy, hz]]],
    [[0, 0, -1], [[hx, 0, -hz], [-hx, 0, -hz], [-hx, sy, -hz], [hx, sy, -hz]]],
    [[1, 0, 0], [[hx, 0, hz], [hx, 0, -hz], [hx, sy, -hz], [hx, sy, hz]]],
    [[-1, 0, 0], [[-hx, 0, -hz], [-hx, 0, hz], [-hx, sy, hz], [-hx, sy, -hz]]],
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const [normal, corners] of faces) {
    const base = positions.length / 3;
    for (const corner of corners) {
      positions.push(...corner);
      normals.push(...normal);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: null,
    indices: new Uint32Array(indices),
  };
}

/**
 * Cilinder of kegelstomp langs y, voet in het midden onder. `radiusTop` 0 geeft een kegel. Zijkanten met gladde
 * normalen, de bodem en (bij radiusTop > 0) de bovenkant vlak.
 */
export function makeCylinder(
  radius: number,
  radiusTop: number,
  height: number,
  segments: number,
): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  // Zijnormaal van een kegelstomp: horizontaal naar buiten, omhoog in verhouding tot de helling.
  const slope = (radius - radiusTop) / height;
  const ring = (i: number): [number, number] => {
    const angle = (i / segments) * Math.PI * 2;
    return [Math.cos(angle), Math.sin(angle)];
  };
  for (let i = 0; i <= segments; i++) {
    const [c, s] = ring(i);
    const len = Math.hypot(1, slope);
    positions.push(c * radius, 0, s * radius, c * radiusTop, height, s * radiusTop);
    normals.push(c / len, slope / len, s / len, c / len, slope / len, s / len);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    // onder(i), boven(i), onder(i+1), boven(i+1); tegen de klok in gezien van buiten.
    indices.push(a, a + 3, a + 1, a, a + 2, a + 3);
  }
  const cap = (y: number, r: number, up: boolean): void => {
    const center = positions.length / 3;
    positions.push(0, y, 0);
    normals.push(0, up ? 1 : -1, 0);
    for (let i = 0; i <= segments; i++) {
      const [c, s] = ring(i);
      positions.push(c * r, y, s * r);
      normals.push(0, up ? 1 : -1, 0);
    }
    for (let i = 0; i < segments; i++)
      indices.push(
        center,
        up ? center + 2 + i : center + 1 + i,
        up ? center + 1 + i : center + 2 + i,
      );
  };
  cap(0, radius, false);
  if (radiusTop > 0) cap(height, radiusTop, true);
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: null,
    indices: new Uint32Array(indices),
  };
}

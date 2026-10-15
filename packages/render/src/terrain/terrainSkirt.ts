// The map edge (sky-and-clouds guide): a low-detail ground skirt around the terrain so the map does not end in a
// void. Rings of quads run outward from the terrain's bounds; the first ring sits on the edge heights, a little inside
// and lower so it tucks under the terrain's last row, the outer rings settle on the median edge height with a few
// gentle swells. One draw call, no shadow pass, no picking. The fog's edge term (lighting/atmosphere.ts) fades it into
// the haze within a few tens of meters, so the far rings only have to exist, not look like anything.
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  type Scene,
  type Vector3,
} from 'three/webgpu';
import {
  attribute,
  mx_noise_float,
  normalize,
  positionWorld,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import { toonLight } from '../units/unitMaterial.js';

/** Ring offsets outside the bounds (m). The last one is far enough that the fog has long hidden it. */
export const SKIRT_RINGS = [-0.6, 3, 8, 16, 30, 55, 100, 180, 320, 600] as const;
/** Spacing of the vertices along the bounds (m). */
export const SKIRT_STEP = 4;
/** The first ring sits this far below the edge height. */
const TUCK = 0.12;
/** Dusty ground, linear rgb: a little lighter than the terrain's mean, already on its way to the haze. */
const SKIRT_GROUND = [0.25, 0.215, 0.17] as const;

export interface SkirtBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Points along the rectangle's boundary, counter-clockwise from (minX, minZ), corners included once each. */
export function skirtPerimeter(
  b: SkirtBounds,
  step = SKIRT_STEP,
): { x: number; z: number; nx: number; nz: number }[] {
  const out: { x: number; z: number; nx: number; nz: number }[] = [];
  const side = (x0: number, z0: number, x1: number, z1: number, nx: number, nz: number): void => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / step));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      out.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, nx, nz });
    }
  };
  // Along the -z edge (z = minZ) towards +x, then the +x, +z and -x edges. Then every point gets the outward normal of
  // the sides it lies on: a corner points diagonally (both components), so the rings keep square corners.
  side(b.minX, b.minZ, b.maxX, b.minZ, 0, -1);
  side(b.maxX, b.minZ, b.maxX, b.maxZ, 1, 0);
  side(b.maxX, b.maxZ, b.minX, b.maxZ, 0, 1);
  side(b.minX, b.maxZ, b.minX, b.minZ, -1, 0);
  for (const p of out) {
    const onMinX = Math.abs(p.x - b.minX) < 1e-6;
    const onMaxX = Math.abs(p.x - b.maxX) < 1e-6;
    const onMinZ = Math.abs(p.z - b.minZ) < 1e-6;
    const onMaxZ = Math.abs(p.z - b.maxZ) < 1e-6;
    p.nx = onMinX ? -1 : onMaxX ? 1 : 0;
    p.nz = onMinZ ? -1 : onMaxZ ? 1 : 0;
  }
  return out;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
}

/** Skirt geometry: positions, normals and indices, rings outward from the bounds. */
export function buildSkirtGeometry(
  b: SkirtBounds,
  heightAt: (x: number, z: number) => number,
): BufferGeometry {
  const perim = skirtPerimeter(b);
  const n = perim.length;
  const rings = SKIRT_RINGS.length;
  const edge = perim.map((p) => heightAt(p.x - p.nx * 0.01, p.z - p.nz * 0.01));
  const base = median(edge);
  const pos = new Float32Array(n * rings * 3);
  for (let r = 0; r < rings; r++) {
    const o = SKIRT_RINGS[r]!;
    // 0 at the edge, 1 from about 40 m out: the skirt leaves the edge heights for the base height.
    const settle = Math.min(1, Math.max(0, o / 40));
    const blend = settle * settle * (3 - 2 * settle);
    for (let i = 0; i < n; i++) {
      const p = perim[i]!;
      const x = p.x + p.nx * o;
      const z = p.z + p.nz * o;
      const swell =
        (Math.sin(x * 0.031 + 1.3) * Math.cos(z * 0.027 - 0.4) + 0.5 * Math.sin((x + z) * 0.013)) *
        2.2;
      const y = edge[i]! * (1 - blend) + (base + swell * blend) * blend - (r === 0 ? TUCK : 0);
      const k = (r * n + i) * 3;
      pos[k] = x;
      pos[k + 1] = y;
      pos[k + 2] = z;
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < rings - 1; r++) {
    for (let i = 0; i < n; i++) {
      const a = r * n + i;
      const c = r * n + ((i + 1) % n);
      const a2 = a + n;
      const c2 = c + n;
      // Perimeter runs counter-clockwise seen from above (+y), the outer ring lies outside: these face up.
      idx.push(a, a2, c, c, a2, c2);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Normals of a mostly flat ring that faces up: flip the whole set if the winding came out the other way.
  const nrm = geo.getAttribute('normal') as BufferAttribute;
  let up = 0;
  for (let i = 0; i < nrm.count; i++) up += nrm.getY(i);
  if (up < 0) {
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1]!;
      idx[i + 1] = idx[i + 2]!;
      idx[i + 2] = t;
    }
    geo.setIndex(idx);
    geo.computeVertexNormals();
  }
  geo.computeBoundingSphere();
  return geo;
}

export class TerrainSkirt {
  private mesh: Mesh | null = null;
  private readonly material: MeshBasicNodeMaterial;

  constructor(
    private readonly scene: Scene,
    lightDir: Vector3,
  ) {
    const light = uniform(lightDir.clone().normalize());
    const N = normalize(attribute('normal', 'vec3'));
    const wp = positionWorld;
    // Two octaves of value noise so the haze does not lie over a flat colour.
    const grain = mx_noise_float(wp.xz.mul(0.045))
      .mul(0.14)
      .add(mx_noise_float(wp.xz.mul(0.21)).mul(0.07))
      .add(1);
    const m = new MeshBasicNodeMaterial();
    m.colorNode = vec4(
      vec3(...SKIRT_GROUND)
        .mul(grain)
        .mul(toonLight(N, light)),
      1,
    );
    m.name = 'crawlout-terrain-skirt';
    this.material = m;
  }

  /** Rebuilds the skirt around these bounds; null removes it. */
  set(bounds: SkirtBounds | null, heightAt: (x: number, z: number) => number): void {
    this.clear();
    if (!bounds) return;
    const mesh = new Mesh(buildSkirtGeometry(bounds, heightAt), this.material);
    mesh.name = 'terrain-skirt';
    mesh.raycast = () => {};
    this.scene.add(mesh);
    this.mesh = mesh;
  }

  /** Triangles of the skirt. */
  get triangles(): number {
    return (this.mesh?.geometry.getIndex()?.count ?? 0) / 3;
  }

  private clear(): void {
    if (!this.mesh) return;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh = null;
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
  }
}

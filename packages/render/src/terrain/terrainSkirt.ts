// The map edge (sky-and-clouds guide): a ground skirt around the terrain so the map does not end at a border. Rings of
// quads run outward from the terrain's bounds and carry on as the same ground: the skirt is drawn with the terrain's own
// material (the albedo mirror-tiles past the map's edge, the detail layer, grass tint and sun shadow all apply), and its
// heights start on the edge heights (clamp to edge) and loosen into low hills and swells further out, so rock and
// ground simply keep going. The first ring sits on the edge heights, a little inside and lower so it tucks under the
// terrain's last row. One draw call, no shadow pass, no picking. The fog's edge term (lighting/atmosphere.ts) fades it
// into the haze over a long distance, so there is no line where the map stops.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  type Material,
  type Scene,
} from 'three/webgpu';

/** Ring offsets outside the bounds (m): dense near the edge, where it is seen, sparse far out. The last is hidden by the fog. */
export const SKIRT_RINGS = [
  -0.6, 3, 8, 14, 22, 32, 44, 58, 75, 95, 120, 150, 190, 240, 300, 380, 480, 600,
] as const;
/** Spacing of the vertices along the bounds (m). */
export const SKIRT_STEP = 4;
/** The first ring sits this far below the edge height. */
const TUCK = 0.12;
/** Distance (m) over which the heights leave the clamped edge heights for the hills around the median edge height. */
const SETTLE = 140;
/** Hills: amplitude (m) reached far out, and the small swell already present at the edge so it is not a pure clamp. */
const HILL_AMPLITUDE = 7;
const NEAR_SWELL = 0.9;

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

const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** Low hills and swells in world space, about -1..1: a few incommensurate waves, no two edges alike. */
export function skirtHills(x: number, z: number): number {
  return (
    0.55 * Math.sin(x * 0.019 + 1.3) * Math.cos(z * 0.016 - 0.4) +
    0.3 * Math.sin((x + z) * 0.011 + 2.1) +
    0.25 * Math.sin(x * 0.043 + z * 0.029) * Math.cos(z * 0.037 - x * 0.021 + 0.7) +
    0.12 * Math.sin(x * 0.097 - z * 0.081 + 4.2)
  );
}

/**
 * Height of a skirt vertex `offset` meters outside the bounds: the clamped edge height at the start, the median edge
 * height plus hills far out, with a small swell all along so the edge is not a visible extrusion of the last row.
 */
export function skirtHeight(
  edgeHeight: number,
  baseHeight: number,
  offset: number,
  x: number,
  z: number,
): number {
  const blend = smooth(offset / SETTLE);
  const hills = skirtHills(x, z) * HILL_AMPLITUDE * blend;
  const swell = skirtHills(z * 1.7 + 11, x * 1.3 - 5) * NEAR_SWELL * smooth(offset / 12);
  return edgeHeight * (1 - blend) + (baseHeight + hills) * blend + swell;
}

/** Skirt geometry: positions, normals, the terrain material's vertex colors and occlusion, indices; rings outward from the bounds. */
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
    for (let i = 0; i < n; i++) {
      const p = perim[i]!;
      const x = p.x + p.nx * o;
      const z = p.z + p.nz * o;
      const y = skirtHeight(edge[i]!, base, Math.max(0, o), x, z) - (r === 0 ? TUCK : 0);
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
  // What the terrain material reads per vertex: the map's vertex colors (the neutral sand it is measured against)
  // and the sky occlusion of the refined grid (open sky).
  const sand = new Color().setRGB(150 / 255, 128 / 255, 94 / 255, 'srgb');
  const colors = new Float32Array(n * rings * 3);
  for (let v = 0; v < n * rings; v++) {
    colors[v * 3] = sand.r;
    colors[v * 3 + 1] = sand.g;
    colors[v * 3 + 2] = sand.b;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  geo.setAttribute('occlusion', new BufferAttribute(new Float32Array(n * rings).fill(1), 1));
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

  /** `material` is the terrain's own (TerrainLayer.material): the skirt keeps the ground going. The caller owns it. */
  constructor(
    private readonly scene: Scene,
    private readonly material: Material,
  ) {}

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
  }
}

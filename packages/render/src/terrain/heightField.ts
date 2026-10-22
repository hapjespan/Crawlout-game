// Height lookup on arbitrary terrain triangles, so units stand on the ground the map agent delivers.
// Triangles are binned into a uniform XZ grid once; a query tests only the triangles in one cell.

export interface TerrainGeometry {
  /** xyz per vertex, meters, world space: x east, y up, z = sim y. */
  positions: Float32Array;
  /** Three indices per triangle. */
  indices: Uint32Array | Uint16Array;
  /** Optional rgb per vertex in sRGB: Float32Array in 0..1 or Uint8Array in 0..255. Defaults to a dusty grey. */
  colors?: Float32Array | Uint8Array;
  /** Optional xyz normal per vertex; computed when absent. */
  normals?: Float32Array;
}

/** Result of TerrainHeightField.locate. */
export interface TerrainHit {
  tri: number;
  u: number;
  v: number;
  y: number;
}

export class TerrainHeightField {
  private readonly scratch: TerrainHit = { tri: 0, u: 0, v: 0, y: 0 };
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
  private readonly cell: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly cellStart: Uint32Array;
  private readonly cellTris: Uint32Array;

  constructor(
    private readonly positions: Float32Array,
    private readonly indices: Uint32Array | Uint16Array,
    cellSize = 2,
  ) {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i]!;
      const z = positions[i + 2]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    if (!Number.isFinite(minX)) minX = minZ = maxX = maxZ = 0;
    this.minX = minX;
    this.minZ = minZ;
    this.maxX = maxX;
    this.maxZ = maxZ;
    this.cell = cellSize;
    this.cols = Math.max(1, Math.ceil((maxX - minX) / cellSize) + 1);
    this.rows = Math.max(1, Math.ceil((maxZ - minZ) / cellSize) + 1);

    // Two passes (count, fill) into a compressed cell list.
    const triCount = Math.floor(indices.length / 3);
    const counts = new Uint32Array(this.cols * this.rows + 1);
    this.forEachTriCell(triCount, (cellIdx) => {
      counts[cellIdx + 1]!++;
    });
    for (let i = 1; i < counts.length; i++) counts[i]! += counts[i - 1]!;
    this.cellStart = counts;
    this.cellTris = new Uint32Array(counts[counts.length - 1]!);
    const fill = counts.slice(0, -1);
    this.forEachTriCell(triCount, (cellIdx, tri) => {
      this.cellTris[fill[cellIdx]!++] = tri;
    });
  }

  private forEachTriCell(triCount: number, fn: (cellIdx: number, tri: number) => void): void {
    const p = this.positions;
    const idx = this.indices;
    for (let t = 0; t < triCount; t++) {
      const a = idx[t * 3]! * 3;
      const b = idx[t * 3 + 1]! * 3;
      const c = idx[t * 3 + 2]! * 3;
      const c0 = this.colOf(Math.min(p[a]!, p[b]!, p[c]!));
      const c1 = this.colOf(Math.max(p[a]!, p[b]!, p[c]!));
      const r0 = this.rowOf(Math.min(p[a + 2]!, p[b + 2]!, p[c + 2]!));
      const r1 = this.rowOf(Math.max(p[a + 2]!, p[b + 2]!, p[c + 2]!));
      for (let r = r0; r <= r1; r++)
        for (let col = c0; col <= c1; col++) fn(r * this.cols + col, t);
    }
  }

  private colOf(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.minX) / this.cell)));
  }

  private rowOf(z: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((z - this.minZ) / this.cell)));
  }

  /** Highest terrain point at (x, z), or `fallback` outside the terrain. */
  heightAt(x: number, z: number, fallback = 0): number {
    return this.locate(x, z, this.scratch) ? this.scratch.y : fallback;
  }

  /**
   * The topmost triangle over (x, z): its index, the barycentric weights of its second and third corner (u, v) and
   * the height there. False outside the terrain. For sampling per-vertex attributes (terrain/terrainRefine.ts).
   */
  locate(x: number, z: number, out: TerrainHit): boolean {
    if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) return false;
    const cellIdx = this.rowOf(z) * this.cols + this.colOf(x);
    const p = this.positions;
    const idx = this.indices;
    let best = -Infinity;
    for (let k = this.cellStart[cellIdx]!; k < this.cellStart[cellIdx + 1]!; k++) {
      const t = this.cellTris[k]!;
      const a = idx[t * 3]! * 3;
      const b = idx[t * 3 + 1]! * 3;
      const c = idx[t * 3 + 2]! * 3;
      const ax = p[a]!;
      const az = p[a + 2]!;
      const v0x = p[b]! - ax;
      const v0z = p[b + 2]! - az;
      const v1x = p[c]! - ax;
      const v1z = p[c + 2]! - az;
      const v2x = x - ax;
      const v2z = z - az;
      const den = v0x * v1z - v1x * v0z;
      if (Math.abs(den) < 1e-12) continue;
      const u = (v2x * v1z - v1x * v2z) / den;
      const v = (v0x * v2z - v2x * v0z) / den;
      const eps = -1e-6;
      if (u < eps || v < eps || u + v > 1 - eps) continue;
      const h = p[a + 1]! + u * (p[b + 1]! - p[a + 1]!) + v * (p[c + 1]! - p[a + 1]!);
      if (h > best) {
        best = h;
        out.tri = t;
        out.u = u;
        out.v = v;
        out.y = h;
      }
    }
    return best !== -Infinity;
  }

  /** Vertex indices of triangle `tri`. */
  corners(tri: number): [number, number, number] {
    const idx = this.indices;
    return [idx[tri * 3]!, idx[tri * 3 + 1]!, idx[tri * 3 + 2]!];
  }

  /** Lowest and highest vertex height, meters. */
  heightRange(): [number, number] {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 1; i < this.positions.length; i += 3) {
      const y = this.positions[i]!;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    return Number.isFinite(lo) ? [lo, hi] : [0, 0];
  }
}

/** A flat grid, used as ground until the map agent's terrain arrives and by the demo. */
export function createGridTerrain(
  sizeX: number,
  sizeZ: number,
  step: number,
  height: (x: number, z: number) => number = () => 0,
  color: (x: number, z: number, y: number) => readonly [number, number, number] = () => [
    0.55, 0.5, 0.42,
  ],
): TerrainGeometry {
  const nx = Math.round(sizeX / step) + 1;
  const nz = Math.round(sizeZ / step) + 1;
  const positions = new Float32Array(nx * nz * 3);
  const colors = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = i * step;
      const z = j * step;
      const y = height(x, z);
      const o = (j * nx + i) * 3;
      positions[o] = x;
      positions[o + 1] = y;
      positions[o + 2] = z;
      colors.set(color(x, z, y), o);
    }
  }
  const indices = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let k = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // Counter-clockwise seen from above (+Y), so faces point up.
      indices.set([a, c, b, b, c, d], k);
      k += 6;
    }
  }
  return { positions, indices, colors };
}

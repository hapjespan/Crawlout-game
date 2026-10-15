import { describe, expect, it } from 'vitest';
import { MeshBasicNodeMaterial, PerspectiveCamera, Scene, Vector3 } from 'three/webgpu';
import { createGridTerrain, TerrainHeightField } from './heightField.js';
import { buildChunkGeometry, TerrainChunks, type TerrainChunk } from './terrainChunks.js';
import { wantsDetailLayer } from './terrainLayer.js';
import {
  buildTerrainField,
  GridHeightField,
  raycastHeight,
  type TerrainField,
} from './terrainField.js';
import { fieldMesh } from './terrainRefine.js';

const hills = (x: number, z: number): number =>
  2 * Math.sin(x * 0.11) * Math.cos(z * 0.07) + (x > 70 ? 3 : 0) + 0.3 * Math.sin(x + z);

function field(size: number, height = hills, subdivide = 2): TerrainField {
  const t = createGridTerrain(size, size, 1, height);
  return buildTerrainField(t, new TerrainHeightField(t.positions, t.indices), { subdivide });
}

function camera(at: Vector3, lookAt: Vector3): PerspectiveCamera {
  const c = new PerspectiveCamera(45, 16 / 9, 0.5, 2000);
  c.position.copy(at);
  c.lookAt(lookAt);
  c.updateMatrixWorld();
  return c;
}

/** Field-sample rectangles of the drawn nodes never overlap (open interiors). */
function overlaps(nodes: readonly TerrainChunk[]): boolean {
  for (let a = 0; a < nodes.length; a++)
    for (let b = a + 1; b < nodes.length; b++) {
      const p = nodes[a]!;
      const q = nodes[b]!;
      if (p.i0 < q.i1 && q.i0 < p.i1 && p.j0 < q.j1 && q.j0 < p.j1) return true;
    }
  return false;
}

const material = new MeshBasicNodeMaterial();

describe('terrain field', () => {
  const f = field(64);
  it('looks up the same triangles the whole-field mesh draws', () => {
    const mesh = fieldMesh(f);
    const exact = new TerrainHeightField(mesh.positions, mesh.indices, 1);
    const grid = new GridHeightField(f);
    for (let k = 0; k < 400; k++) {
      const x = (k * 7.31) % 64;
      const z = (k * 3.97) % 64;
      expect(grid.heightAt(x, z)).toBeCloseTo(exact.heightAt(x, z), 4);
    }
    expect(grid.heightAt(-1, 5, 42)).toBe(42);
  });

  it('marches a ray onto the ground and misses the sky', () => {
    const flat = new GridHeightField(field(32, () => 1.5));
    const out = { x: 0, y: 0, z: 0 };
    const dir = new Vector3(1, -1, 0.5).normalize();
    expect(raycastHeight(flat, { x: 2, y: 20, z: 3 }, dir, out)).toBe(true);
    expect(out.y).toBeCloseTo(1.5, 3);
    expect(out.x).toBeCloseTo(2 + 18.5, 2);
    expect(out.z).toBeCloseTo(3 + 18.5 * 0.5, 2);
    expect(raycastHeight(flat, { x: 2, y: 20, z: 3 }, { x: 0, y: 1, z: 0 }, out)).toBe(false);
    // From outside the bounds the ray is clipped to them first.
    expect(raycastHeight(flat, { x: -10, y: 5, z: 16 }, { x: 1, y: -0.1, z: 0 }, out)).toBe(true);
    expect(out.x).toBeCloseTo(25, 2);
  });
});

describe('TerrainChunks', () => {
  const f = field(128);
  const make = (opts = {}): TerrainChunks =>
    new TerrainChunks(new Scene(), f, material, {
      chunkSize: 16,
      levels: 2,
      splitDistances: [30, 60],
      farDistance: 150,
      ...opts,
    });

  it('builds a quadtree with the same quads per node on every level', () => {
    const t = make();
    expect(t.roots.length).toBe(4); // 128 m in roots of 64 m
    expect(t.quadsPerEdge).toBe(32);
    const leaves = t.nodes.filter((n) => n.level === 0 && !n.far);
    expect(leaves.length).toBe(64);
    // Coarser levels and the far twins are built up front, leaves on demand.
    expect(t.nodes.filter((n) => n.mesh).length).toBe(4 + 16 + 4);
    expect(leaves.every((n) => !n.mesh)).toBe(true);
  });

  it('draws only the far roots in an overview', () => {
    const t = make();
    t.update(camera(new Vector3(64, 400, 64.01), new Vector3(64, 0, 64)));
    expect(t.drawn.length).toBe(4);
    expect(t.drawn.every((n) => n.far)).toBe(true);
    expect(t.triangles).toBeLessThan(4 * (16 * 16 * 2 + 4 * 16 * 2) + 1);
  });

  it('is fine near the camera, coarse far away, without overlap or holes in the view', () => {
    const t = make({ buildsPerFrame: 1000 });
    const cam = camera(new Vector3(10, 18, 10), new Vector3(60, 0, 60));
    t.update(cam);
    const drawn = [...t.drawn];
    expect(overlaps(drawn)).toBe(false);
    const levelAt = (x: number, z: number): number => {
      const i = x / f.step;
      const j = z / f.step;
      const n = drawn.find((d) => i >= d.i0 && i <= d.i1 && j >= d.j0 && j <= d.j1);
      return n ? (n.far ? 3 : n.level) : -1;
    };
    expect(levelAt(30, 30)).toBe(0);
    expect(levelAt(120, 120)).toBeGreaterThan(0);
    // Every point straight ahead is covered by some drawn node.
    for (let k = 28; k < 124; k += 4) expect(levelAt(k, k)).toBeGreaterThanOrEqual(0);
  });

  it('builds a few leaves per frame and draws the parent until its children are there', () => {
    const t = make({ buildsPerFrame: 2 });
    const cam = camera(new Vector3(32, 10, 32), new Vector3(32, 0, 20));
    t.update(cam);
    expect(t.leafBuilds).toBeLessThanOrEqual(2);
    expect(overlaps(t.drawn)).toBe(false);
    expect(t.drawn.some((n) => n.level === 1)).toBe(true);
    for (let k = 0; k < 20; k++) t.update(cam);
    expect(t.drawn.some((n) => n.level === 0)).toBe(true);
    expect(overlaps(t.drawn)).toBe(false);
  });

  it('keeps at most maxLeaves leaves built while the camera travels', () => {
    const t = make({ buildsPerFrame: 100, maxLeaves: 12 });
    for (let x = 0; x <= 128; x += 8) t.update(camera(new Vector3(x, 8, 4), new Vector3(x, 0, 30)));
    const built = t.nodes.filter((n) => n.level === 0 && !n.far && n.mesh).length;
    expect(built).toBeLessThanOrEqual(12);
    expect(t.leafBuilds).toBeGreaterThan(12);
  });

  it('hides nothing behind the camera and nothing outside the frustum', () => {
    const t = make({ buildsPerFrame: 1000 });
    t.update(camera(new Vector3(64, 5, -5), new Vector3(64, 5, -50))); // looking off the map
    expect(t.drawn.length).toBe(0);
    expect(t.triangles).toBe(0);
  });

  it('hangs a skirt below every border deep enough for the coarsest neighbor', () => {
    const cliff = field(64, (x) => (x >= 20 ? 5 : 0));
    const geo = buildChunkGeometry(cliff, 0, 0, 32, 32, 1, 2.5);
    const pos = geo.getAttribute('position');
    const grid = 33 * 33;
    expect(pos.count).toBe(grid + 4 * 32);
    // The skirt vertices sit 2.5 m below their border vertex.
    expect(pos.getY(grid)).toBeCloseTo(pos.getY(0) - 2.5, 5);
    const t = new TerrainChunks(new Scene(), cliff, material, { chunkSize: 16, levels: 1 });
    const leaf = t.nodes.find((n) => n.level === 0 && n.i0 === 32 && n.j0 === 0)!; // x 16..32, across the cliff
    // Its box reaches below the ground by the skirt (twice the worst gap to a 4 m neighbor plus a margin).
    expect(leaf.box.min.y).toBeLessThan(-0.3);
  });
});

describe('wantsDetailLayer', () => {
  it('is on by default and off on the cheaper detail path', () => {
    expect(wantsDetailLayer({})).toBe(true);
    expect(wantsDetailLayer({ detail: { subdivide: 2 } })).toBe(true);
    expect(wantsDetailLayer({ detail: { subdivide: 1 } })).toBe(false);
    expect(wantsDetailLayer({ detail: { subdivide: 0 } })).toBe(false);
    expect(wantsDetailLayer({ detail: { subdivide: 1 }, detailLayer: true })).toBe(true);
    expect(wantsDetailLayer({ detailLayer: false })).toBe(false);
  });
});

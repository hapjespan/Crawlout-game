import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, MeshBasicNodeMaterial, Scene } from 'three/webgpu';
import { createGridTerrain, TerrainHeightField } from './heightField.js';
import { safeNormalize, sanitizeNormals } from './safeNormal.js';
import { buildChunkGeometry, TerrainChunks } from './terrainChunks.js';
import { buildTerrainField, type TerrainField } from './terrainField.js';
import { fieldMesh } from './terrainRefine.js';
import { buildSkirtGeometry } from './terrainSkirt.js';

/** Every normal of the geometry is finite and unit length (the shader normalises it, a zero one would give NaN). */
function expectUnitNormals(geo: BufferGeometry, label: string): void {
  const n = geo.getAttribute('normal') as BufferAttribute;
  expect(n, label).toBeDefined();
  let worst = 0;
  for (let i = 0; i < n.count; i++) {
    const len = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
    expect(Number.isFinite(len), `${label} vertex ${i} finite`).toBe(true);
    worst = Math.max(worst, Math.abs(len - 1));
  }
  expect(worst, `${label} unit length`).toBeLessThan(1e-4);
}

// Heights that are hard on normals: a flat plain, a 12 m cliff, spikes, a one-cell ridge, a bowl.
const terrains: Record<string, (x: number, z: number) => number> = {
  flat: () => 3,
  cliff: (x) => (x >= 40 ? 12 : 0),
  spikes: (x, z) => ((Math.round(x) + Math.round(z)) % 7 === 0 ? 9 : 0),
  ridge: (x) => (Math.abs(x - 50) < 1 ? 6 : 0),
  bowl: (x, z) => 0.02 * ((x - 48) ** 2 + (z - 48) ** 2),
};

function fieldOf(height: (x: number, z: number) => number, size = 96, subdivide = 2): TerrainField {
  const t = createGridTerrain(size, size, 1, height);
  return buildTerrainField(t, new TerrainHeightField(t.positions, t.indices), { subdivide });
}

describe('terrain normals are finite and unit length', () => {
  for (const [name, height] of Object.entries(terrains)) {
    it(`chunks of every level, the far twins and their skirts: ${name}`, () => {
      const field = fieldOf(height);
      const tree = new TerrainChunks(new Scene(), field, new MeshBasicNodeMaterial(), {
        chunkSize: 16,
        levels: 2,
        farDistance: 100,
      });
      for (const node of tree.nodes)
        expectUnitNormals(
          buildChunkGeometry(field, node.i0, node.j0, node.i1, node.j1, node.stride, 0.5),
          `${name} node ${node.level}${node.far ? 'f' : ''} ${node.i0},${node.j0}`,
        );
    });

    it(`the whole-field mesh: ${name}`, () => {
      const field = fieldOf(height, 64);
      const mesh = fieldMesh(field);
      expect(mesh.normals).toBeDefined();
      const geo = new BufferGeometry();
      geo.setAttribute('normal', new BufferAttribute(mesh.normals!, 3));
      expectUnitNormals(geo, `${name} field mesh`);
    });

    it(`the map-edge skirt: ${name}`, () => {
      for (const bounds of [
        { minX: 0, maxX: 96, minZ: 0, maxZ: 96 },
        { minX: -3.3, maxX: 127.7, minZ: 11, maxZ: 255.4 },
        { minX: 0, maxX: 4, minZ: 0, maxZ: 4 },
        { minX: 0, maxX: 1024, minZ: 0, maxZ: 128 },
      ])
        expectUnitNormals(
          buildSkirtGeometry(bounds, height),
          `${name} skirt ${JSON.stringify(bounds)}`,
        );
    });
  }

  it('survives a height that is NaN (a hole in the source) and one that is huge', () => {
    const field = fieldOf((x, z) => (x === 30 && z === 30 ? NaN : 1));
    const geo = buildChunkGeometry(field, 0, 0, 96, 96, 1, 0.5);
    sanitizeNormals(geo);
    expectUnitNormals(geo, 'nan height');
    expectUnitNormals(
      buildSkirtGeometry({ minX: 0, maxX: 96, minZ: 0, maxZ: 96 }, () => 1e7),
      'huge skirt',
    );
  });
});

describe('safeNormalize', () => {
  const out = { x: 0, y: 0, z: 0 };

  it('turns a zero vector into straight up instead of 0 / 0', () => {
    expect(safeNormalize(0, 0, 0, out)).toBe(true);
    expect(out).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('turns tiny and non-finite vectors into straight up', () => {
    for (const v of [
      [1e-6, 0, 0],
      [NaN, 1, 0],
      [0, Infinity, 0],
      [-0, -0, -0],
    ] as const) {
      expect(safeNormalize(v[0], v[1], v[2], out)).toBe(true);
      expect(out).toEqual({ x: 0, y: 1, z: 0 });
    }
  });

  it('keeps the direction of a sound vector and gives it unit length', () => {
    expect(safeNormalize(3, 0, 4, out)).toBe(false);
    expect(out.x).toBeCloseTo(0.6, 6);
    expect(out.z).toBeCloseTo(0.8, 6);
    expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(1, 6);
    safeNormalize(0, -2e-3, 0, out); // short but real: stays pointing down
    expect(out.y).toBe(-1);
  });

  it('sanitizeNormals repairs a geometry in place and counts the repairs', () => {
    const geo = new BufferGeometry();
    geo.setAttribute(
      'normal',
      new BufferAttribute(new Float32Array([0, 0, 0, 0, 2, 0, NaN, 0, 0]), 3),
    );
    expect(sanitizeNormals(geo)).toBe(2);
    expectUnitNormals(geo, 'repaired');
    expect(sanitizeNormals(geo)).toBe(0);
  });
});

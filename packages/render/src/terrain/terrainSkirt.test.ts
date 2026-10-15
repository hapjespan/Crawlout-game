import { describe, expect, it } from 'vitest';
import { Vector3, type BufferAttribute } from 'three/webgpu';
import {
  buildSkirtGeometry,
  SKIRT_RINGS,
  skirtHeight,
  skirtHills,
  skirtPerimeter,
} from './terrainSkirt.js';

const bounds = { minX: 0, maxX: 64, minZ: 0, maxZ: 32 };

describe('terrain skirt', () => {
  it('walks the bounds once with outward normals, corners diagonal', () => {
    const p = skirtPerimeter(bounds, 4);
    expect(p.length).toBe((64 / 4) * 2 + (32 / 4) * 2);
    for (const q of p) {
      expect(q.x === 0 || q.x === 64 || q.z === 0 || q.z === 32).toBe(true);
      expect(Math.abs(q.nx) + Math.abs(q.nz)).toBeGreaterThan(0);
    }
    const corner = p.find((q) => q.x === 64 && q.z === 32)!;
    expect([corner.nx, corner.nz]).toEqual([1, 1]);
    const side = p.find((q) => q.x === 16 && q.z === 0)!;
    expect([side.nx, side.nz]).toEqual([0, -1]);
  });

  it('starts on the edge heights, tucked under, and lies outside the bounds beyond the first ring', () => {
    const geo = buildSkirtGeometry(bounds, (x) => 3 + x * 0.05);
    const pos = geo.getAttribute('position') as BufferAttribute;
    const n = pos.count / SKIRT_RINGS.length;
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i);
      expect(pos.getY(i)).toBeLessThan(3 + x * 0.05 + 0.05);
      expect(pos.getY(i)).toBeGreaterThan(3 + x * 0.05 - 0.5);
    }
    for (let i = n; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      expect(x < 0 || x > 64 || z < 0 || z > 32).toBe(true);
    }
  });

  it('faces up: normals and triangle winding point to +y', () => {
    const geo = buildSkirtGeometry(bounds, () => 0);
    const nrm = geo.getAttribute('normal') as BufferAttribute;
    for (let i = 0; i < nrm.count; i++) expect(nrm.getY(i)).toBeGreaterThan(0.5);
    const pos = geo.getAttribute('position') as BufferAttribute;
    const idx = geo.getIndex()!;
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    for (let t = 0; t < idx.count; t += 3) {
      a.fromBufferAttribute(pos, idx.getX(t));
      b.fromBufferAttribute(pos, idx.getX(t + 1));
      c.fromBufferAttribute(pos, idx.getX(t + 2));
      // Counter-clockwise seen from above (three's front face): (b - a) x (c - a) points up.
      const n = b.clone().sub(a).cross(c.clone().sub(a));
      expect(n.y).toBeGreaterThan(0);
    }
  });

  it('carries the vertex colors of the terrain material and open-sky occlusion', () => {
    const geo = buildSkirtGeometry(bounds, () => 0);
    const color = geo.getAttribute('color') as BufferAttribute;
    const occlusion = geo.getAttribute('occlusion') as BufferAttribute;
    const pos = geo.getAttribute('position') as BufferAttribute;
    expect(color.count).toBe(pos.count);
    expect(color.itemSize).toBe(3);
    expect(occlusion.count).toBe(pos.count);
    for (let i = 0; i < occlusion.count; i++) expect(occlusion.getX(i)).toBe(1);
  });

  it('continues the edge heights, then loosens into hills around the median', () => {
    // At the edge: the clamped edge height (plus a vanishing swell). Far out: the base plus hills, not the edge.
    expect(skirtHeight(10, 4, 0, 5, 5)).toBeCloseTo(10, 6);
    expect(Math.abs(skirtHeight(10, 4, 3, 5, 5) - 10)).toBeLessThan(0.5);
    const far = skirtHeight(10, 4, 600, 300, -200);
    expect(Math.abs(far - 4)).toBeLessThan(9);
    expect(far).not.toBeCloseTo(10, 0);
    // Hills stay in a bounded band and are not flat.
    const samples = Array.from({ length: 200 }, (_, i) => skirtHills(i * 13.7, i * 7.1));
    expect(Math.max(...samples)).toBeLessThanOrEqual(1.22);
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(-1.22);
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.8);
  });

  it('lets the ground rise and fall gently: no step between neighbouring rings', () => {
    const geo = buildSkirtGeometry({ minX: 0, maxX: 384, minZ: 0, maxZ: 384 }, (x) => 5 + x * 0.01);
    const pos = geo.getAttribute('position') as BufferAttribute;
    const n = pos.count / SKIRT_RINGS.length;
    for (let r = 1; r < SKIRT_RINGS.length; r++)
      for (let i = 0; i < n; i++) {
        const gap = SKIRT_RINGS[r]! - SKIRT_RINGS[r - 1]!;
        const dy = Math.abs(pos.getY(r * n + i) - pos.getY((r - 1) * n + i));
        // Slope along the ring step stays under about 40 percent.
        expect(dy).toBeLessThan(gap * 0.4 + 0.3);
      }
  });
});

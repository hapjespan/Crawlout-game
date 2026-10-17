import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three/webgpu';
import { layerOfMesh, triangleBreakdown } from './triangleBreakdown.js';

const category = (id: string): string | null => (id === 'rock_set2_01' ? 'rock' : null);

describe('layerOfMesh', () => {
  it('names the layer of each batch', () => {
    expect(layerOfMesh('terrain-0-12-34', category)).toBe('terrain');
    expect(layerOfMesh('terrain-far-0-0', category)).toBe('terrain');
    expect(layerOfMesh('terrain-skirt', category)).toBe('terrain skirt');
    expect(layerOfMesh('props-rock_set2_01-1', category)).toBe('props: rock');
    expect(layerOfMesh('props-tree-x-0', category)).toBe('props: unknown');
    expect(layerOfMesh('building-dweller_building_hq-0', category)).toBe('buildings');
    expect(layerOfMesh('buildings-lod1', category)).toBe('buildings');
    expect(layerOfMesh('units-dweller_body_human-lod0', category)).toBe('units');
    expect(layerOfMesh('rigid-dweller_robot_guard-lod0', category)).toBe('robots');
    expect(layerOfMesh('claim-points', category)).toBe('scrap and claims');
    expect(layerOfMesh('mystery', category)).toBe('other');
  });
});

describe('triangleBreakdown', () => {
  it('multiplies triangles by instances and counts casters in the shadow pass too', () => {
    const root = new Group();
    const box = new BoxGeometry(); // 12 triangles, indexed
    const rock = new Mesh(box, new MeshBasicMaterial());
    rock.name = 'props-rock_set2_01-0';
    rock.count = 10;
    rock.castShadow = true;
    const unit = new Mesh(box, new MeshBasicMaterial());
    unit.name = 'units-human-lod0';
    unit.count = 3;
    const hidden = new Mesh(box, new MeshBasicMaterial());
    hidden.name = 'units-human-lod1';
    hidden.visible = false;
    const terrain = new Mesh(box, new MeshBasicMaterial());
    terrain.name = 'terrain-0-0-0';
    root.add(rock, unit, hidden, terrain);

    const b = triangleBreakdown(root, category);
    expect(b.main).toEqual({ 'props: rock': 120, units: 36, terrain: 12 });
    expect(b.shadow).toEqual({ 'props: rock': 120 });
  });

  it('skips an instanced mesh with no instances', () => {
    const root = new Group();
    const m = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    m.name = 'units-human-lod0';
    m.count = 0;
    root.add(m);
    expect(triangleBreakdown(root, category).main).toEqual({});
  });
});

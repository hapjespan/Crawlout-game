import type { DecalLayer } from '../decals/decalLayer.js';
import {
  Vector3,
  PerspectiveCamera,
  BoxGeometry,
  Scene,
  MeshBasicNodeMaterial,
  type InstancedBufferAttribute,
  Raycaster,
  Vector2,
} from 'three/webgpu';
import {
  type PropVisual,
  PropLayer,
  type RenderProp,
  PROP_CHUNK_SIZE,
  SHADOW_MIN_SIZE,
} from './propLayer.js';
import { PROP_LOD_PX, TREE_LOD_PX } from '../lod/screenLod.js';
import { describe, it, expect } from 'vitest';
import { propKindOf, propFitScale, PROP_TARGET_HEIGHT, propTargetHeight } from './propFit.js';

const heightAt = (x: number, z: number): number => 0.1 * x + 0.05 * z;

function fakeDecals(): DecalLayer & { pushed: number } {
  const d = { pushed: 0, push: () => void d.pushed++, pushContact: () => void d.pushed++ };
  return d as unknown as DecalLayer & { pushed: number };
}

function camera(at: Vector3, lookAt: Vector3): PerspectiveCamera {
  const c = new PerspectiveCamera(45, 1, 0.5, 800);
  c.position.copy(at);
  c.lookAt(lookAt);
  c.updateMatrixWorld();
  return c;
}

function visual(height = 2, lods?: PropVisual['lods']): PropVisual {
  const g = new BoxGeometry(1, height, 1).translate(0, height / 2, 0);
  return { lods: lods ?? [g, g, g], map: null, fit: 1, height, radius: 0.7 };
}

function layer(scene = new Scene()): PropLayer {
  return new PropLayer(scene, {
    heightAt,
    treeLodPixels: PROP_LOD_PX,
    material: () => new MeshBasicNodeMaterial(),
  });
}

const props: RenderProp[] = [
  { asset: 'treehigh001', x: 10, y: 10, yaw: 0, scale: 1 },
  { asset: 'treehigh001', x: 12, y: 30, yaw: 16384, scale: 1.2 },
  { asset: 'treehigh001', x: 40, y: 12, yaw: 0, scale: 0.8 },
  { asset: 'rock001', x: 20, y: 20, yaw: 0, scale: 1 },
  { asset: 'rock001', x: 50, y: 50, yaw: 0, scale: 1 },
  { asset: 'grass001', x: 30, y: 25, yaw: 0, scale: 1 },
];

const overview = (): PerspectiveCamera =>
  camera(new Vector3(30, 120, 30.01), new Vector3(30, 0, 30));

describe('PropLayer', () => {
  it('draws one instanced draw per prop asset when its LODs are identical', () => {
    const scene = new Scene();
    const l = layer(scene);
    l.setProps(props);
    expect(l.assetIds()).toEqual(['treehigh001', 'rock001', 'grass001']);
    for (const id of l.assetIds()) l.setVisual(id, visual());
    l.update(overview(), fakeDecals());
    expect(l.drawCount()).toBe(3);
    const counts = l.meshes().map((m) => m.count);
    expect(counts).toEqual([3, 2, 1]);
    expect(scene.children.length).toBe(3);
  });

  it('splits an asset into one draw per distinct LOD geometry, by chunk distance', () => {
    const l = layer();
    const near = new BoxGeometry();
    const far = new BoxGeometry();
    l.setProps([
      { asset: 'rock001', x: 2, y: 2, yaw: 0, scale: 1 },
      { asset: 'rock001', x: 2 + PROP_CHUNK_SIZE * 8, y: 2, yaw: 0, scale: 1 },
    ]);
    l.setVisual('rock001', visual(1, [near, far, far]));
    expect(l.meshes().length).toBe(2);
    l.update(camera(new Vector3(-10, 6, 2), new Vector3(200, 0, 2)), fakeDecals());
    expect(l.lodCounts).toEqual([1, 0, 1]);
    expect(l.meshes().map((m) => m.count)).toEqual([1, 1]);
  });

  it('stands every prop on the terrain, with its yaw and scale times the fit', () => {
    const l = layer();
    l.setProps([{ asset: 'rock001', x: 20, y: 8, yaw: 16384, scale: 1.25 }]);
    l.setVisual('rock001', { ...visual(), fit: 0.5 });
    l.update(overview(), fakeDecals());
    const geo = l.meshes()[0]!.geometry;
    const pos = geo.getAttribute('iPos') as InstancedBufferAttribute;
    const scale = geo.getAttribute('iScale') as InstancedBufferAttribute;
    expect(pos.getX(0)).toBeCloseTo(20, 5);
    expect(pos.getZ(0)).toBeCloseTo(8, 5);
    expect(pos.getY(0)).toBeCloseTo(heightAt(20, 8) - 0.06, 5); // slightly sunk, no gap on slopes
    expect(pos.getW(0)).toBeCloseTo(0, 5); // sim yaw 16384 (sim +y = world +z) is render yaw 0 (model +Z)
    expect(scale.getX(0)).toBeCloseTo(0.625, 5);
  });

  it('follows a new terrain after relayout', () => {
    let h = 0;
    const l = new PropLayer(new Scene(), {
      heightAt: () => h,
      material: () => new MeshBasicNodeMaterial(),
    });
    l.setProps([{ asset: 'rock001', x: 5, y: 5, yaw: 0, scale: 1 }]);
    l.setVisual('rock001', visual());
    l.update(overview(), fakeDecals());
    h = 3;
    l.relayout();
    l.update(overview(), fakeDecals());
    const pos = l.meshes()[0]!.geometry.getAttribute('iPos') as InstancedBufferAttribute;
    expect(pos.getY(0)).toBeCloseTo(3 - 0.06, 5);
  });

  it('culls whole chunks outside the view and only rewrites the buffers when that changes', () => {
    const l = layer();
    l.setProps(props);
    for (const id of l.assetIds()) l.setVisual(id, visual());
    const decals = fakeDecals();
    l.update(overview(), decals);
    const attr = l.meshes()[0]!.geometry.getAttribute('iPos') as InstancedBufferAttribute;
    const version = attr.version;
    l.update(overview(), decals);
    expect(attr.version).toBe(version); // still camera: no upload
    l.update(camera(new Vector3(30, 20, 30), new Vector3(30, 60, 30)), decals); // looking at the sky
    expect(l.drawCount()).toBe(0);
    expect(l.lodCounts).toEqual([0, 0, 0]);
  });

  it('pushes a blob shadow per visible nearby prop, except ground cover (grass, plants)', () => {
    const l = layer();
    l.setProps(props);
    for (const id of l.assetIds()) l.setVisual(id, visual());
    const decals = fakeDecals();
    l.update(camera(new Vector3(30, 70, 30.01), new Vector3(30, 0, 30)), decals);
    expect(l.lodCounts[2]).toBe(0);
    expect(decals.pushed).toBe(props.filter((p) => !p.asset.startsWith('grass')).length);
  });

  it('is never hit by a raycast, so it neither picks nor blocks a pick', () => {
    const scene = new Scene();
    const l = layer(scene);
    l.setProps([{ asset: 'rock001', x: 0, y: 0, yaw: 0, scale: 1 }]);
    l.setVisual('rock001', visual(4));
    const cam = overview();
    l.update(cam, fakeDecals());
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2(0, 0), cam);
    ray.ray.origin.set(0, 50, 0);
    ray.ray.direction.set(0, -1, 0);
    expect(l.meshes().length).toBe(1);
    expect(ray.intersectObjects(scene.children, true)).toEqual([]);
  });

  it('keeps the visuals of assets that stay when the props are replaced, and drops the rest', () => {
    const scene = new Scene();
    const l = layer(scene);
    l.setProps(props);
    for (const id of l.assetIds()) l.setVisual(id, visual());
    l.setProps(props.filter((p) => p.asset === 'rock001'));
    l.update(overview(), fakeDecals());
    expect(l.assetIds()).toEqual(['rock001']);
    expect(scene.children.length).toBe(1);
    expect(l.drawCount()).toBe(1);
    l.setProps([]);
    expect(scene.children.length).toBe(0);
  });
});

describe('PropLayer LOD and shadow culling', () => {
  const lodVisual = (height: number): PropVisual => {
    const g = (): BoxGeometry => new BoxGeometry(1, height, 1).translate(0, height / 2, 0);
    return { lods: [g(), g(), g()], map: null, fit: 1, height, radius: 0.7 };
  };
  const defaults = (): PropLayer =>
    new PropLayer(new Scene(), { heightAt, material: () => new MeshBasicNodeMaterial() });

  it('drops a tree to its lighter LOD at a larger screen size than any other prop (TREE_LOD_PX)', () => {
    expect(TREE_LOD_PX.lod1).toBeGreaterThan(PROP_LOD_PX.lod1);
    // A 10 m object seen from 240 m is about 91 px tall at the default 1800 px viewport: between the two thresholds.
    const view = camera(new Vector3(30, 240, 30.01), new Vector3(30, 0, 30));
    const tree = defaults();
    tree.setProps([{ asset: 'treehigh001', x: 30, y: 30, yaw: 0, scale: 1 }]);
    tree.setVisual('treehigh001', lodVisual(10));
    tree.update(view, fakeDecals());
    expect(tree.lodCounts).toEqual([0, 1, 0]);
    const rock = defaults();
    rock.setProps([{ asset: 'rock001', x: 30, y: 30, yaw: 0, scale: 1 }]);
    rock.setVisual('rock001', lodVisual(10));
    rock.update(view, fakeDecals());
    expect(rock.lodCounts).toEqual([1, 0, 0]);
  });

  it('keeps props lower than SHADOW_MIN_SIZE out of the shadow pass', () => {
    const l = new PropLayer(new Scene(), {
      heightAt: () => 0,
      material: () => new MeshBasicNodeMaterial(),
      shadow: { smallProps: true },
    });
    l.setProps([
      { asset: 'rock_small', x: 1, y: 1, yaw: 0, scale: 1 },
      { asset: 'rock_big', x: 2, y: 2, yaw: 0, scale: 1 },
    ]);
    l.setVisual('rock_small', lodVisual(SHADOW_MIN_SIZE - 0.1));
    l.setVisual('rock_big', lodVisual(SHADOW_MIN_SIZE + 0.5));
    expect(l.meshes().length).toBe(6); // three distinct LOD geometries per asset
    for (const m of l.meshes()) {
      if (m.name.startsWith('props-rock_small')) expect(m.castShadow).toBe(false);
    }
    // The big rock's finest LOD casts (its coarsest does not: a small prop's far LOD leaves the pass anyway).
    expect(l.meshes().find((m) => m.name === 'props-rock_big-0')!.castShadow).toBe(true);
  });

  it('with the sun shadow on, draws a tree outside the view only on the side its shadow falls from', () => {
    // Looking straight down at x, z around (0, 0) from 40 m (the view is about 33 m across at the ground, z within 16.6). The sun is
    // on the -z side, so shadows fall towards +z: a tree 13 m beyond the -z edge shades the view, one beyond +z does not.
    const sunDir = new Vector3(0, 0.64, -0.77).normalize();
    const l = new PropLayer(new Scene(), {
      heightAt: () => 0,
      material: () => new MeshBasicNodeMaterial(),
      shadow: { smallProps: false, sunDir },
    });
    l.setProps([
      { asset: 'treehigh001', x: 0, y: -30, yaw: 0, scale: 1 },
      { asset: 'treehigh001', x: 0, y: 30, yaw: 0, scale: 1 },
      { asset: 'treehigh001', x: 0, y: 0, yaw: 0, scale: 1 },
    ]);
    l.setVisual('treehigh001', lodVisual(12));
    const cam = camera(new Vector3(0, 40, 0.01), new Vector3(0, 0, 0));
    l.update(cam, fakeDecals());
    // Chunks are 16 m: the middle tree is in view, the tree at z = -30 is swept into view by its 15 m shadow, z = +30 is not.
    expect(l.visibleCount).toBe(2);
  });
});

describe('PropLayer at scale', () => {
  /** 8000 trees over a 384 m map: a dense border and a scatter. */
  function forest(): RenderProp[] {
    const out: RenderProp[] = [];
    for (let k = 0; out.length < 8000; k++) {
      const x = (k * 7.13) % 384;
      const y = (k * 3.71 + (k % 7) * 11.3) % 384;
      out.push({
        asset: k % 3 === 0 ? 'treehigh001' : 'treemed001',
        x,
        y,
        yaw: (k * 977) % 65536,
        scale: 1,
      });
    }
    return out;
  }
  const make = (opts = {}): PropLayer => {
    const l = new PropLayer(new Scene(), {
      heightAt,
      material: () => new MeshBasicNodeMaterial(),
      ...opts,
    });
    l.setProps(forest());
    for (const id of l.assetIds()) l.setVisual(id, visual(5));
    return l;
  };

  it('draws at most about maxVisible props in an overview of the whole map', () => {
    const l = make();
    l.update(camera(new Vector3(192, 420, 300), new Vector3(192, 0, 192)), fakeDecals());
    expect(l.visibleCount).toBeLessThanOrEqual(3000 + 300); // rounded per chunk and asset
    expect(l.visibleCount).toBeGreaterThan(2000);
    expect(l.drawCount()).toBe(2); // still one draw per asset
  });

  /** Drawn instances as "x,z" keys plus their scales. */
  const drawn = (l: PropLayer): Map<string, number> => {
    const out = new Map<string, number>();
    for (const m of l.meshes()) {
      const pos = m.geometry.getAttribute('iPos') as InstancedBufferAttribute;
      const scale = m.geometry.getAttribute('iScale') as InstancedBufferAttribute;
      for (let k = 0; k < m.count; k++)
        out.set(`${pos.getX(k).toFixed(3)},${pos.getZ(k).toFixed(3)}`, scale.getX(k));
    }
    return out;
  };

  it('keeps every prop near the camera and thins the far ones, drawing those a little larger', () => {
    const l = make({ maxVisible: 100_000 });
    l.update(camera(new Vector3(100, 60, 100.01), new Vector3(100, 0, 100)), fakeDecals());
    const shown = drawn(l);
    const close = forest().filter((p) => Math.hypot(p.x - 100, p.y - 100) < 15);
    expect(close.length).toBeGreaterThan(20);
    for (const p of close) expect(shown.get(`${p.x.toFixed(3)},${p.y.toFixed(3)}`)).toBe(1);
    l.update(camera(new Vector3(20, 40, 20), new Vector3(300, 0, 300)), fakeDecals());
    const scales = [...drawn(l).values()];
    expect(Math.max(...scales)).toBeGreaterThan(1.05);
    expect(Math.max(...scales)).toBeLessThanOrEqual(1.6 + 1e-6);
  });

  it('thins to the same props: a smaller budget draws a subset of a larger one', () => {
    const cam = camera(new Vector3(192, 420, 300), new Vector3(192, 0, 192));
    const small = make({ maxVisible: 1500 });
    const large = make({ maxVisible: 3000 });
    small.update(cam, fakeDecals());
    large.update(cam, fakeDecals());
    const a = drawn(small);
    const b = drawn(large);
    expect(a.size).toBeLessThanOrEqual(1500 * 1.15);
    expect(b.size).toBeGreaterThan(a.size);
    let kept = 0;
    for (const id of a.keys()) if (b.has(id)) kept++;
    expect(kept).toBe(a.size);
  });

  it('pushes at most maxBlobs blob shadows, nearest first', () => {
    const l = make({ maxBlobs: 20 });
    const decals = fakeDecals();
    l.update(camera(new Vector3(190, 30, 190), new Vector3(200, 0, 200)), decals);
    expect(decals.pushed).toBe(20);
  });
});

describe('prop fit', () => {
  it('reads the kind from the asset id', () => {
    expect(propKindOf('treehigh001')).toBe('tree');
    expect(propKindOf('Rock003')).toBe('rock');
    expect(propKindOf('bush002')).toBe('bush');
    expect(propKindOf('grass001')).toBe('grass');
    expect(propKindOf('reed001')).toBe('reed');
    expect(propKindOf('lamp_post')).toBe('other');
  });

  it('fits the Gobkit sizes next to a 1.8 m character', () => {
    // Manifest heights (m) of the Gobkit Nature Kit after the asset-cli.
    expect(propFitScale('grass001', 3.842866) * 3.842866).toBeCloseTo(0.45, 6);
    expect(propFitScale('treehigh001', 8.491107) * 8.491107).toBeCloseTo(
      PROP_TARGET_HEIGHT.treehigh001!,
      6,
    );
    for (const h of Object.values(PROP_TARGET_HEIGHT)) expect(h).toBeLessThanOrEqual(6);
    expect(propTargetHeight('pine_big')).toBe(5); // kind fallback
    expect(propTargetHeight('rock001', { rock001: 2 })).toBe(2); // override
    expect(propFitScale('lamp_post', 4)).toBe(1); // unknown kind keeps its size
  });
});

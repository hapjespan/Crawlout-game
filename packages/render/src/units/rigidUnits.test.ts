import { describe, expect, it } from 'vitest';
import { ANIM, ENTITY_FLAG, MAX_PLAYERS } from '@crawlout/protocol';
import { manifestSchema } from '@crawlout/asset-cli/manifest';
import {
  DataArrayTexture,
  PerspectiveCamera,
  Scene,
  Vector3,
  type InstancedBufferAttribute,
  type Mesh,
  type MeshBasicNodeMaterial,
} from 'three/webgpu';
import type { DecalLayer, DecalStyle } from '../decals/decalLayer.js';
import { drawsAsUnit } from '../entities/typeIds.js';
import { NEUTRAL_TEAM } from '../palette.js';
import {
  pickEntity,
  pickNearestOnScreen,
  selectInRect,
  type PickShape,
} from '../picking/selection.js';
import { createInterpolatedFrame, type InterpolatedFrame } from '../snapshot/interpolate.js';
import { SYNTHETIC_ROBOT_TYPE_IDS, syntheticRobots } from '../dev/syntheticRobots.js';
import { createGltfIO, resolveManifestPath, UnitAssetLoader } from './unitAssetLoader.js';
import { UnitAssetRegistry } from './unitAssets.js';
import { UnitLayer } from './unitLayer.js';
import { RigidUnitLayer } from './rigidUnitLayer.js';
import { createRigidUnitMaterial } from './rigidUnitMaterial.js';
import { RigidUnitRegistry } from './rigidUnitAssets.js';
import { splitRigidEntries } from './rigidUnitManifest.js';
import {
  DRONE_ID,
  FIXTURE_ID,
  GUARD_ID,
  rigidFiles,
  rigidManifest,
  SENTINEL_ID,
  type RigidFixtureEntry,
  TRIANGLES,
} from './testing/rigidFixture.js';
import { fixtureAnimF32, fixtureGlb } from './testing/skinnedFixture.js';

const GUARD_TYPE = SYNTHETIC_ROBOT_TYPE_IDS.guard;
const DRONE_TYPE = SYNTHETIC_ROBOT_TYPE_IDS.drone;
const SENTINEL_TYPE = SYNTHETIC_ROBOT_TYPE_IDS.sentinel;

interface Placed {
  id: number;
  typeId: number;
  x: number;
  z: number;
  owner?: number;
  anim?: number;
  animT?: number;
  yaw?: number;
  flags?: number;
}

function frameOf(units: Placed[]): InterpolatedFrame {
  const frame = createInterpolatedFrame(64);
  frame.count = units.length;
  units.forEach((u, i) => {
    frame.id[i] = u.id;
    frame.typeId[i] = u.typeId;
    frame.x[i] = u.x;
    frame.z[i] = u.z;
    frame.y[i] = 0;
    frame.owner[i] = u.owner ?? 0;
    frame.anim[i] = u.anim ?? ANIM.idle;
    frame.animT[i] = u.animT ?? 0;
    frame.yaw[i] = u.yaw ?? 0;
    frame.flags[i] = u.flags ?? 0;
  });
  return frame;
}

interface Blob {
  x: number;
  z: number;
  half: number;
  style: DecalStyle;
}

function recorder(): { decals: DecalLayer; blobs: Blob[] } {
  const blobs: Blob[] = [];
  const decals = {
    push(x: number, z: number, half: number, _half: number, style: DecalStyle) {
      blobs.push({ x, z, half, style });
    },
  } as unknown as DecalLayer;
  return { decals, blobs };
}

/** An RTS camera 12 m up and 12 m south, looking at the origin: everything around the origin is LOD 0. */
function camera(
  position: [number, number, number] = [0, 12, 12],
  target: [number, number, number] = [0, 0, 0],
): PerspectiveCamera {
  const c = new PerspectiveCamera(45, 16 / 9, 0.5, 2000);
  c.position.set(...position);
  c.lookAt(...target);
  c.updateMatrixWorld();
  return c;
}

function robotLayer(scene = new Scene(), capacity = 32) {
  const layer = new RigidUnitLayer(scene, { capacity, lightDir: new Vector3(-0.4, 0.8, 0.3) });
  const robots = syntheticRobots();
  for (const r of robots) layer.assign([r.typeId], layer.addAsset(r.source));
  return { layer, scene, robots };
}

const meshes = (scene: Scene): Mesh[] => {
  const out: Mesh[] = [];
  scene.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh);
  });
  return out;
};
const attr = (mesh: Mesh, name: string): InstancedBufferAttribute =>
  mesh.geometry.getAttribute(name) as InstancedBufferAttribute;
const row = (mesh: Mesh, name: string, k: number): number[] => {
  const a = attr(mesh, name);
  return [a.getX(k), a.getY(k), a.getZ(k), a.getW(k)];
};
const byName = (scene: Scene, name: string): Mesh => scene.getObjectByName(name) as Mesh;

describe('RigidUnitLayer', () => {
  it('draws one batch per asset per LOD, and one draw call per batch however many units use it', () => {
    const { layer, scene } = robotLayer();
    expect(layer.assetCount).toBe(3);
    // Each synthetic robot has three different LODs: nine meshes, none visible before the first update.
    const all = meshes(scene);
    expect(all).toHaveLength(9);
    expect(all.every((m) => !m.visible)).toBe(true);
    for (const name of ['synthetic_guard', 'synthetic_drone', 'synthetic_sentinel'])
      for (const lod of [0, 1, 2]) expect(byName(scene, `rigid-${name}-lod${lod}`)).toBeDefined();

    // 5 guards, 3 drones, 1 sentinel close to the camera: all LOD 0, so three draws for nine units.
    const near: Placed[] = [
      ...[0, 1, 2, 3, 4].map((i) => ({ id: 10 + i, typeId: GUARD_TYPE, x: -4 + i * 2, z: 0 })),
      ...[0, 1, 2].map((i) => ({ id: 20 + i, typeId: DRONE_TYPE, x: -3 + i * 3, z: -3 })),
      { id: 30, typeId: SENTINEL_TYPE, x: 6, z: -2 },
    ];
    layer.update(frameOf(near), camera(), recorder().decals, 0);
    expect(layer.visibleCount).toBe(9);
    expect(layer.drawCount).toBe(3);
    expect(byName(scene, 'rigid-synthetic_guard-lod0').count).toBe(5);
    expect(byName(scene, 'rigid-synthetic_drone-lod0').count).toBe(3);
    expect(byName(scene, 'rigid-synthetic_sentinel-lod0').count).toBe(1);
    expect(byName(scene, 'rigid-synthetic_guard-lod1').visible).toBe(false);
    expect(layer.lodCounts).toEqual([9, 0, 0]);
  });

  it('picks the LOD from the projected size: a unit far away draws the light mesh', () => {
    const { layer, scene } = robotLayer();
    // Looking along the ground from 10 m up: a guard (2.2 m) is 151 px tall at 30 m, 48 px at 100 m and 19 px at 250 m.
    const frame = frameOf([
      { id: 1, typeId: GUARD_TYPE, x: 0, z: -30 },
      { id: 2, typeId: GUARD_TYPE, x: 0, z: -100 },
      { id: 3, typeId: GUARD_TYPE, x: 0, z: -250 },
      { id: 4, typeId: GUARD_TYPE, x: 3, z: -250 },
    ]);
    layer.update(frame, camera([0, 10, 0], [0, 0, -60]), recorder().decals, 0);
    const counts = [0, 1, 2].map((lod) => byName(scene, `rigid-synthetic_guard-lod${lod}`).count);
    expect(counts).toEqual([1, 1, 2]);
    expect(layer.lodCounts).toEqual([1, 1, 2]);
    // Draws never exceed assets * LODs, whatever the crowd.
    expect(layer.drawCount).toBeLessThanOrEqual(layer.drawCapacity);
  });

  it('writes position and yaw from the frame, the owner as the team slot and the pose per instance', () => {
    const { layer, scene } = robotLayer();
    const frame = frameOf([
      { id: 1, typeId: GUARD_TYPE, x: 3, z: -2, yaw: 1.25, owner: 2 },
      { id: 2, typeId: GUARD_TYPE, x: -3, z: 1, owner: 255 }, // unowned: the neutral slot
      { id: 3, typeId: GUARD_TYPE, x: 0, z: 0, owner: 5, anim: ANIM.death, animT: 1 },
    ]);
    frame.y[0] = 0.5; // terrain height
    layer.update(frame, camera(), recorder().decals, 2.0);
    const guard = byName(scene, 'rigid-synthetic_guard-lod0');
    expect(guard.count).toBe(3);
    const pos0 = row(guard, 'iPos', 0);
    expect(pos0[0]).toBeCloseTo(3, 5);
    expect(pos0[1]).toBeGreaterThanOrEqual(0.5); // terrain height plus a lift of a few cm at most
    expect(pos0[1]).toBeLessThan(0.55);
    expect(pos0[2]).toBeCloseTo(-2, 5);
    expect(pos0[3]).toBeCloseTo(1.25, 5);
    expect(row(guard, 'iScale', 0)[3]).toBe(2); // team slot = owner
    expect(row(guard, 'iScale', 1)[3]).toBe(NEUTRAL_TEAM); // clamped
    expect(NEUTRAL_TEAM).toBe(MAX_PLAYERS);
    expect(row(guard, 'iScale', 2)[3]).toBe(5);
    // iAnim: pitch, roll, dim, glow. The idle guards barely tilt; the dead one lies down and is dimmed.
    const idle = row(guard, 'iAnim', 0);
    expect(Math.abs(idle[0]!)).toBeLessThan(0.02);
    expect(idle[2]).toBe(0);
    const dead = row(guard, 'iAnim', 2);
    expect(Math.abs(dead[1]!)).toBeGreaterThan(1.3);
    expect(dead[2]).toBeGreaterThan(0.75);
  });

  it('floats a drone above the ground and pushes the recoil of an attack back along the facing', () => {
    const { layer, scene } = robotLayer();
    const frame = frameOf([
      { id: 1, typeId: DRONE_TYPE, x: 0, z: 0 },
      { id: 2, typeId: GUARD_TYPE, x: 5, z: 0, yaw: 0, anim: ANIM.attack1, animT: 0.1 },
      { id: 3, typeId: GUARD_TYPE, x: -5, z: 0, yaw: Math.PI / 2, anim: ANIM.attack1, animT: 0.1 },
    ]);
    layer.update(frame, camera(), recorder().decals, 0);
    const drone = byName(scene, 'rigid-synthetic_drone-lod0');
    expect(row(drone, 'iPos', 0)[1]).toBeGreaterThan(1.2);
    expect(row(drone, 'iPos', 0)[1]).toBeLessThan(1.5);
    const guard = byName(scene, 'rigid-synthetic_guard-lod0');
    // Facing +z (yaw 0): kicked back to smaller z. Facing +x (yaw pi/2): kicked back to smaller x.
    expect(row(guard, 'iPos', 0)[2]).toBeLessThan(-0.05);
    expect(row(guard, 'iPos', 0)[0]).toBeCloseTo(5, 5);
    expect(row(guard, 'iPos', 1)[0]).toBeLessThan(-5.05);
    expect(row(guard, 'iPos', 1)[2]).toBeCloseTo(0, 5);
  });

  it('shows the owner on the team mask of every robot model', () => {
    const { robots } = robotLayer();
    for (const r of robots) {
      for (const g of r.source.lods) {
        const color = g.getAttribute('color');
        expect(color.itemSize).toBe(4); // rgb + team mask
        let team = 0;
        for (let i = 0; i < color.count; i++) if (color.getW(i) > 0.5) team++;
        expect(team).toBeGreaterThan(0); // every LOD keeps a team-colored part
      }
    }
  });

  it('pushes a blob shadow per robot at its ground point, with a ring when selected, none for off-screen units', () => {
    const { layer } = robotLayer();
    const { decals, blobs } = recorder();
    layer.update(
      frameOf([
        { id: 1, typeId: SENTINEL_TYPE, x: 0, z: 0, flags: ENTITY_FLAG.selected },
        { id: 2, typeId: DRONE_TYPE, x: 4, z: 0 },
        { id: 3, typeId: GUARD_TYPE, x: 0, z: 200 }, // behind the camera
        { id: 4, typeId: GUARD_TYPE, x: -4, z: 0, flags: ENTITY_FLAG.selected | ENTITY_FLAG.dead },
      ]),
      camera(),
      decals,
      0,
    );
    expect(blobs).toHaveLength(3);
    expect(blobs[0]).toMatchObject({ x: 0, z: 0 });
    expect(blobs[0]!.style.ring).toBe(1);
    expect(blobs[0]!.half).toBeGreaterThan(blobs[1]!.half); // the sentinel's blob is wider than the drone's
    expect(blobs[1]!.style.ring).toBe(0);
    expect(blobs[1]).toMatchObject({ x: 4, z: 0 }); // on the ground, below the floating drone
    expect(blobs[2]!.style.ring).toBe(0); // a dead robot shows no ring
  });

  it('claims only the typeIds it was given: others fall back to the humanoid', () => {
    const { layer } = robotLayer();
    expect(layer.owns(GUARD_TYPE)).toBe(true);
    expect(layer.owns(1)).toBe(false);
    expect(layer.owns(1000)).toBe(false); // a hero
    expect(layer.owns(5000)).toBe(false);
    expect(layer.assetFor(DRONE_TYPE)).toBe(1);
    layer.assign([GUARD_TYPE], null);
    expect(layer.owns(GUARD_TYPE)).toBe(false);
    expect(() => layer.assign([1], 9)).toThrow(/no rigid unit asset/);
  });

  it('is skipped by the humanoid layer for its typeIds, which draws the unknown ones', () => {
    const scene = new Scene();
    const humanoids = new UnitLayer(scene, { capacity: 32, lightDir: new Vector3(0, 1, 0) });
    const rigid = new RigidUnitLayer(scene, { capacity: 32, lightDir: new Vector3(0, 1, 0) });
    const robot = syntheticRobots()[0]!;
    rigid.assign([robot.typeId], rigid.addAsset(robot.source));
    humanoids.setSkip((t) => rigid.owns(t));
    const frame = frameOf([
      { id: 1, typeId: robot.typeId, x: 0, z: 0 },
      { id: 2, typeId: 1, x: 2, z: 0 }, // a regular unit
      { id: 3, typeId: 777, x: -2, z: 0 }, // a unit type nobody gave art: the humanoid draws it
    ]);
    const c = camera();
    const { decals } = recorder();
    humanoids.update(frame, c, decals);
    rigid.update(frame, c, decals, 0);
    expect(humanoids.lodCounts.reduce((a, b) => a + b, 0)).toBe(2);
    expect(rigid.visibleCount).toBe(1);
    humanoids.setSkip(null);
    humanoids.update(frame, c, decals);
    expect(humanoids.lodCounts.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('stops a batch at its capacity', () => {
    const { layer, scene } = robotLayer(new Scene(), 4);
    const units = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      typeId: GUARD_TYPE,
      x: i * 0.5 - 2,
      z: 0,
    }));
    layer.update(frameOf(units), camera(), recorder().decals, 0);
    expect(byName(scene, 'rigid-synthetic_guard-lod0').count).toBe(4);
    expect(layer.visibleCount).toBe(4);
    expect(layer.totalCount).toBe(10);
  });

  it('shares one draw between LODs that use the same geometry', () => {
    const scene = new Scene();
    const layer = new RigidUnitLayer(scene, { capacity: 8, lightDir: new Vector3(0, 1, 0) });
    const robot = syntheticRobots()[0]!.source;
    const lod0 = robot.lods[0];
    layer.addAsset({ ...robot, name: 'flat', lods: [lod0, lod0, lod0] });
    expect(meshes(scene)).toHaveLength(1);
    expect(layer.drawCapacity).toBe(1);
  });

  it('stays within the 8 vertex buffers of WebGPU and builds its toon material without a GPU', () => {
    const { scene } = robotLayer();
    for (const mesh of meshes(scene)) {
      expect(Object.keys(mesh.geometry.attributes).sort()).toEqual(
        ['color', 'iAnim', 'iPos', 'iScale', 'iTint', 'normal', 'position'].sort(),
      );
      const material = mesh.material as MeshBasicNodeMaterial;
      expect(material.name).toMatch(/^crawlout-rigid-synthetic_/);
      expect(material.positionNode).toBeTruthy();
      expect(material.colorNode).toBeTruthy();
    }
    // One material (so one pipeline) per asset, shared by its LODs.
    const guard = [0, 1, 2].map((lod) => byName(scene, `rigid-synthetic_guard-lod${lod}`).material);
    expect(new Set(guard).size).toBe(1);
    const textured = createRigidUnitMaterial({
      lightDir: new Vector3(0, 1, 0),
      name: 'textured',
      layers: new DataArrayTexture(new Uint8Array(4 * 4 * 4 * 2), 4, 4, 2),
      layerLuma: [0.4, 0.6],
      pivotY: 0.4,
      grade: 0.1,
    });
    expect(textured.colorNode).toBeTruthy();
  });

  it('removes its meshes on dispose', () => {
    const { layer, scene } = robotLayer();
    layer.dispose();
    expect(meshes(scene)).toHaveLength(0);
    expect(layer.owns(GUARD_TYPE)).toBe(false);
  });
});

describe('picking and selecting rigid units', () => {
  const { layer } = robotLayer();
  const shape = (frame: InterpolatedFrame) => (i: number, out: PickShape) =>
    layer.pickShape(frame.typeId[i]!, out);

  it('gives each robot a pick sphere that fits its size, a floating drone one up where it floats', () => {
    const out: PickShape = { radius: 0, height: 0 };
    layer.pickShape(GUARD_TYPE, out);
    expect(out.height).toBeCloseTo(1.1, 2);
    expect(out.radius).toBeGreaterThan(0.75); // larger than a 1.8 m human's
    layer.pickShape(SENTINEL_TYPE, out);
    expect(out.height).toBeCloseTo(1.75, 2);
    expect(out.radius).toBeGreaterThan(1.2);
    layer.pickShape(DRONE_TYPE, out);
    expect(out.height).toBeCloseTo(1.35 + 0.4, 2);
    expect(out.radius).toBeGreaterThanOrEqual(0.55); // small, but still clickable
    expect(layer.pickShape(1, out)).toBeNull();
  });

  it('picks the robot under a ray, where a floating drone really is, and not the empty air below it', () => {
    const frame = frameOf([
      { id: 7, typeId: DRONE_TYPE, x: 0, z: 0 },
      { id: 8, typeId: GUARD_TYPE, x: 5, z: 0 },
      { id: 9, typeId: SENTINEL_TYPE, x: 10, z: 0, flags: ENTITY_FLAG.dead },
    ]);
    const s = shape(frame);
    // A ray from the south at drone height hits the drone; one at ground level passes below it.
    expect(pickEntity(frame, 0, 1.75, 20, 0, 0, -1, s)).toBe(0);
    expect(pickEntity(frame, 0, 0.2, 20, 0, 0, -1, s)).toBe(-1);
    // Without the rigid shape the default unit sphere (center 0.9 m) would have taken the ground ray.
    expect(pickEntity(frame, 0, 0.9, 20, 0, 0, -1)).toBe(0);
    // A guard: center 1.1 m. A dead robot is not pickable.
    expect(pickEntity(frame, 5, 1.1, 20, 0, 0, -1, s)).toBe(1);
    expect(pickEntity(frame, 10, 1.75, 20, 0, 0, -1, s)).toBe(-1);
    // Along the row of robots the nearer hit wins (the drone, then the guard behind it).
    expect(pickEntity(frame, -5, 1.5, 0, 1, 0, 0, s)).toBe(0);
  });

  it('box-selects robots by where they are on screen, skips the dead and filters by owner', () => {
    const frame = frameOf([
      { id: 1, typeId: DRONE_TYPE, x: 0, z: 0, owner: 0 },
      { id: 2, typeId: GUARD_TYPE, x: 3, z: 0, owner: 0 },
      { id: 3, typeId: SENTINEL_TYPE, x: -3, z: 0, owner: 1 },
      { id: 4, typeId: GUARD_TYPE, x: 1.5, z: 1, owner: 0, flags: ENTITY_FLAG.dead },
      { id: 5, typeId: 1, x: 6, z: 0, owner: 0 }, // a humanoid, selectable too
    ]);
    const c = camera();
    c.updateMatrixWorld();
    const viewProj = c.projectionMatrix.clone().multiply(c.matrixWorldInverse).elements;
    const w = 1600;
    const h = 900;
    const everything = { x0: 0, y0: 0, x1: w, y1: h };
    const s = shape(frame);
    expect(selectInRect(frame, viewProj, w, h, everything, { shape: s }).sort()).toEqual([
      1, 2, 3, 5,
    ]);
    expect(selectInRect(frame, viewProj, w, h, everything, { shape: s, owner: 0 }).sort()).toEqual([
      1, 2, 5,
    ]);
    expect(
      selectInRect(frame, viewProj, w, h, everything, { shape: s, includeDead: true }).sort(),
    ).toEqual([1, 2, 3, 4, 5]);

    // A drone is selected through its floating center: a box around where its feet would be misses it.
    const project = (x: number, y: number, z: number) => {
      const v = new Vector3(x, y, z).project(c);
      return { sx: (v.x + 1) * 0.5 * w, sy: (1 - v.y) * 0.5 * h };
    };
    const floating = project(0, 1.75, 0);
    const feet = project(0, 0.9, 0);
    expect(feet.sy).toBeGreaterThan(floating.sy + 10); // the drone is drawn higher up the screen
    const around = (p: { sx: number; sy: number }) => ({
      x0: p.sx - 4,
      y0: p.sy - 4,
      x1: p.sx + 4,
      y1: p.sy + 4,
    });
    expect(selectInRect(frame, viewProj, w, h, around(floating), { shape: s })).toEqual([1]);
    expect(selectInRect(frame, viewProj, w, h, around(feet), { shape: s })).toEqual([]);
    expect(selectInRect(frame, viewProj, w, h, around(feet))).toEqual([1]); // the default center, for contrast
  });

  it('falls back to the nearest robot on screen for a click that just misses', () => {
    const frame = frameOf([{ id: 1, typeId: DRONE_TYPE, x: 0, z: 0 }]);
    const c = camera();
    const viewProj = c.projectionMatrix.clone().multiply(c.matrixWorldInverse).elements;
    const v = new Vector3(0, 1.75, 0).project(c);
    const sx = (v.x + 1) * 0.5 * 1600;
    const sy = (1 - v.y) * 0.5 * 900;
    expect(pickNearestOnScreen(frame, viewProj, 1600, 900, sx + 6, sy + 6, 16, shape(frame))).toBe(
      0,
    );
    expect(pickNearestOnScreen(frame, viewProj, 1600, 900, sx + 40, sy, 16, shape(frame))).toBe(-1);
  });

  it('keeps robots in the unit kind, so the sim ids it selects are the ones the HUD expects', () => {
    for (const t of Object.values(SYNTHETIC_ROBOT_TYPE_IDS)) expect(drawsAsUnit(t)).toBe(true);
  });
});

describe('rigid entries of the manifest', () => {
  it('takes rigid entries, in either spelling, out of the manifest the schema sees', () => {
    const raw = rigidManifest();
    expect(manifestSchema.safeParse(raw).success).toBe(false); // the schema does not know the robots
    const { rest, rigid } = splitRigidEntries(raw);
    expect(manifestSchema.safeParse(rest).success).toBe(true);
    expect([...rigid.keys()].sort()).toEqual([DRONE_ID, GUARD_ID, SENTINEL_ID].sort());
    const drone = rigid.get(DRONE_ID)!;
    expect(drone).toMatchObject({ id: DRONE_ID, hover: 1.35, teamMaterials: ['Team_Plate'] });
    expect(typeof drone).toBe('object');
    expect(rigid.get(GUARD_ID)).toMatchObject({ hover: 0 });
    // The skinned character stays in the manifest.
    expect(manifestSchema.parse(rest).assets.map((a) => a.id)).toContain(FIXTURE_ID);
  });

  it('reports an unusable rigid entry as a reason, not as a broken manifest', () => {
    const raw = rigidManifest([{ id: GUARD_ID, height: 2.2 }]) as {
      assets: Record<string, unknown>[];
    };
    const guard = raw.assets.find((a) => a.id === GUARD_ID)!;
    const bad = (patch: Record<string, unknown>) => {
      const copy = {
        ...raw,
        assets: raw.assets.map((a) => (a.id === GUARD_ID ? { ...guard, ...patch } : a)),
      };
      return splitRigidEntries(copy).rigid.get(GUARD_ID);
    };
    expect(bad({ bounds: undefined })).toMatch(/bounds/);
    expect(bad({ lods: [] })).toMatch(/three LODs/);
    expect(bad({ hover: -1 })).toMatch(/hover/);
    expect(bad({ teamMaterials: 'team' })).toMatch(/teamMaterials/);
    expect(bad({ bounds: { min: [0, 1, 0], max: [1, 1, 1] } })).toMatch(/height/);
    expect(splitRigidEntries({ nonsense: true }).rest).toEqual({ nonsense: true });
  });
});

const MANIFEST_URL = 'https://assets.test/dist/manifest.json';
const encode = (value: unknown): ArrayBuffer =>
  new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer;

/** In-memory dist folder with the skinned fixture character and the robots, three's real GLTFLoader behind it. */
async function fakeDist(
  opts: { raw?: unknown; broken?: string; entries?: readonly RigidFixtureEntry[] } = {},
) {
  const files = new Map<string, ArrayBuffer>();
  const at = (path: string) => resolveManifestPath(MANIFEST_URL, path);
  files.set(MANIFEST_URL, encode(opts.raw ?? rigidManifest(opts.entries)));
  const skinned = (await fixtureGlb()).slice().buffer as ArrayBuffer;
  files.set(at(`${FIXTURE_ID}/${FIXTURE_ID}.anim.f32`), fixtureAnimF32());
  for (const level of [0, 1, 2]) files.set(at(`${FIXTURE_ID}/lod${level}.glb`), skinned);
  for (const [path, bytes] of await rigidFiles(opts.entries)) files.set(at(path), bytes);
  if (opts.broken) files.set(at(`${opts.broken}/lod0.glb`), new ArrayBuffer(16));
  const fetchBytes = async (url: string): Promise<ArrayBuffer> => {
    const f = files.get(url);
    if (!f) throw new Error(`404 ${url}`);
    return f;
  };
  return new UnitAssetLoader(createGltfIO(fetchBytes));
}

describe('rigid unit assets', () => {
  it('loads the LODs as static team-masked geometry on y = 0, merging identical LODs', async () => {
    const loader = await fakeDist();
    const guard = await loader.loadRigid(MANIFEST_URL, GUARD_ID);
    expect(guard.triangles).toEqual(TRIANGLES);
    expect(new Set(guard.lods).size).toBe(3);
    expect(guard.height).toBeCloseTo(2.2, 5);
    expect(guard.teamVertices).toBeGreaterThan(0);
    for (const g of guard.lods) {
      for (const name of ['position', 'normal', 'color', 'uvl'])
        expect(g.getAttribute(name)).toBeDefined();
      expect(g.getAttribute('skinIndex')).toBeUndefined();
    }
    // The drone's model has its origin in the middle of the body (lowest point -0.4): lowered onto the ground.
    const drone = await loader.loadRigid(MANIFEST_URL, DRONE_ID);
    drone.lods[0].computeBoundingBox();
    expect(drone.lods[0].boundingBox!.min.y).toBeCloseTo(0, 4);
    expect(drone.lods[0].boundingBox!.max.y).toBeCloseTo(0.8, 4);
    expect(drone.entry.hover).toBe(1.35);
  });

  it('does not offer a rigid unit as a skinned character, and refuses a character as a rigid unit', async () => {
    const loader = await fakeDist();
    expect(await loader.has(MANIFEST_URL, GUARD_ID)).toBe(false);
    expect(await loader.has(MANIFEST_URL, FIXTURE_ID)).toBe(true);
    await expect(loader.loadRigid(MANIFEST_URL, FIXTURE_ID)).rejects.toThrow(/not a rigid unit/);
    await expect(loader.loadRigid(MANIFEST_URL, 'nope')).rejects.toThrow(/not a rigid unit/);
  });

  const loadouts = [
    { id: 0, visuals: { meshSlots: { body: FIXTURE_ID } } }, // skinned
    { id: 1, visuals: { meshSlots: { body: GUARD_ID } } }, // rigid
    { id: 2, visuals: { meshSlots: { body: DRONE_ID, tool: 'wrench' } } }, // rigid
    { id: 3, visuals: { meshSlots: { body: 'not_made_yet' } } }, // unknown
    { id: 4, visuals: { meshSlots: { weapon: 'pipe' } } }, // no body
    { id: 5, visuals: { meshSlots: { body: SENTINEL_ID } } }, // rigid
  ];

  it('takes the loadouts whose body is a rigid asset and leaves the others to the skinned registry', async () => {
    const loader = await fakeDist();
    const scene = new Scene();
    const humanoids = new UnitLayer(scene, { capacity: 16, lightDir: new Vector3(0, 1, 0) });
    const rigid = new RigidUnitLayer(scene, { capacity: 16, lightDir: new Vector3(0, 1, 0) });
    humanoids.setSkip((t) => rigid.owns(t));
    const config = { manifestUrl: MANIFEST_URL };
    const rigidUnits = new RigidUnitRegistry(rigid, loader, { config, maxTextureSize: 4096 });
    const skinned = new UnitAssetRegistry(humanoids, loader, {
      config,
      maxTextureSize: 4096,
      rigidIds: (url) => rigidUnits.rigidIds(url),
    });
    await Promise.all([skinned.setLoadouts(loadouts), rigidUnits.setLoadouts(loadouts)]);

    // typeId = 1 + loadout id. Rigid: loadouts 1, 2, 5.
    expect(rigid.owns(2)).toBe(true);
    expect(rigid.owns(3)).toBe(true);
    expect(rigid.owns(6)).toBe(true);
    expect(rigid.owns(1)).toBe(false); // skinned
    expect(rigid.owns(4)).toBe(false); // body not in the manifest
    expect(rigid.owns(5)).toBe(false); // no body slot
    expect(rigid.owns(1000)).toBe(false);
    expect(rigid.assetName(rigid.assetFor(3)!)).toBe(DRONE_ID);

    // The skinned registry loaded only its character, which became the default rig; a robot never did.
    expect(skinned.statuses().map((s) => s.assetId)).toEqual([FIXTURE_ID]);
    expect(humanoids.rigName(humanoids.rigFor(1))).toBe(FIXTURE_ID);
    expect(humanoids.rigCount).toBe(2);

    const statuses = rigidUnits.statuses();
    expect(statuses.map((s) => s.assetId).sort()).toEqual([DRONE_ID, GUARD_ID, SENTINEL_ID].sort());
    const drone = statuses.find((s) => s.assetId === DRONE_ID)!;
    expect(drone).toMatchObject({
      state: 'ready',
      typeIds: [3],
      hover: 1.35,
      triangles: TRIANGLES,
    });
    expect(drone.height).toBeCloseTo(0.8, 5);
  });

  it('keeps a robot loadout with a first-in-line body from taking the default rig of the humanoids', async () => {
    const loader = await fakeDist();
    const humanoids = new UnitLayer(new Scene(), { capacity: 4, lightDir: new Vector3(0, 1, 0) });
    const rigid = new RigidUnitLayer(new Scene(), { capacity: 4, lightDir: new Vector3(0, 1, 0) });
    const config = { manifestUrl: MANIFEST_URL };
    const rigidUnits = new RigidUnitRegistry(rigid, loader, { config, maxTextureSize: 4096 });
    const skinned = new UnitAssetRegistry(humanoids, loader, {
      config,
      maxTextureSize: 4096,
      rigidIds: (url) => rigidUnits.rigidIds(url),
    });
    await skinned.setLoadouts([
      { id: 0, visuals: { meshSlots: { body: GUARD_ID } } },
      { id: 1, visuals: { meshSlots: { body: FIXTURE_ID } } },
    ]);
    expect(humanoids.rigName(humanoids.rigFor(777))).toBe(FIXTURE_ID);
  });

  it('keeps the humanoid for a rigid asset that fails to load, and says why', async () => {
    const loader = await fakeDist({ broken: GUARD_ID });
    const rigid = new RigidUnitLayer(new Scene(), { capacity: 4, lightDir: new Vector3(0, 1, 0) });
    const warnings: string[] = [];
    const registry = new RigidUnitRegistry(rigid, loader, {
      config: { manifestUrl: MANIFEST_URL },
      maxTextureSize: 4096,
      warn: (m) => warnings.push(m),
    });
    await registry.setLoadouts(loadouts);
    const failed = registry.statuses().find((s) => s.assetId === GUARD_ID)!;
    expect(failed.state).toBe('failed');
    expect(failed.reason).toBeTruthy();
    expect(failed.typeIds).toEqual([]);
    expect(rigid.owns(2)).toBe(false); // typeId of loadout 1: back to the humanoid
    expect(rigid.owns(3)).toBe(true); // the drone loaded fine
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/humanoid/);
  });

  it('reports a rigid entry that is unusable as failed with its reason', async () => {
    const raw = rigidManifest([{ id: GUARD_ID, height: 2.2 }]) as {
      assets: Record<string, unknown>[];
    };
    for (const a of raw.assets) if (a.id === GUARD_ID) delete a.bounds;
    const loader = await fakeDist({ raw });
    const registry = new RigidUnitRegistry(
      new RigidUnitLayer(new Scene(), { capacity: 4, lightDir: new Vector3(0, 1, 0) }),
      loader,
      { config: { manifestUrl: MANIFEST_URL }, maxTextureSize: 4096, warn: () => {} },
    );
    const status = await registry.load(MANIFEST_URL, GUARD_ID);
    expect(status).toMatchObject({ state: 'failed' });
    expect(status.reason).toMatch(/bounds/);
  });

  it('binds a rigid asset to typeIds without a loadout through config.bind', async () => {
    const loader = await fakeDist();
    const rigid = new RigidUnitLayer(new Scene(), { capacity: 4, lightDir: new Vector3(0, 1, 0) });
    const registry = new RigidUnitRegistry(rigid, loader, {
      config: { manifestUrl: MANIFEST_URL, bind: { [GUARD_ID]: [1003] } },
      maxTextureSize: 4096,
    });
    await registry.start();
    expect(rigid.owns(1003)).toBe(true);
    expect(registry.statuses().map((s) => [s.assetId, s.typeIds])).toEqual([[GUARD_ID, [1003]]]);
    await registry.setLoadouts(loadouts); // the loadout body reuses the loaded asset and keeps the binding
    expect(rigid.owns(1003)).toBe(true);
    expect(rigid.owns(2)).toBe(true);
    expect(registry.statuses().find((s) => s.assetId === GUARD_ID)!.typeIds).toEqual([1003, 2]);
  });

  it('notes a model without a team material in its status', async () => {
    const entries = [
      { id: GUARD_ID, height: 2.2, glbMaterial: 'Hull' }, // the manifest lists Team_Plate, the GLB has no such material
      { id: DRONE_ID, height: 0.8, hover: 1.2, teamName: 'Hull', glbMaterial: 'Hull' }, // listed by the manifest: masked
    ];
    const loader = await fakeDist({ entries });
    const registry = new RigidUnitRegistry(
      new RigidUnitLayer(new Scene(), { capacity: 4, lightDir: new Vector3(0, 1, 0) }),
      loader,
      { config: { manifestUrl: MANIFEST_URL }, maxTextureSize: 4096 },
    );
    expect((await registry.load(MANIFEST_URL, GUARD_ID)).reason).toMatch(/no team material/);
    const drone = await registry.load(MANIFEST_URL, DRONE_ID);
    expect(drone.state).toBe('ready');
    expect(drone.reason).toBeUndefined();
  });

  it('draws what the registry loaded: one batch per LOD of the manifest asset', async () => {
    const loader = await fakeDist();
    const scene = new Scene();
    const rigid = new RigidUnitLayer(scene, { capacity: 8, lightDir: new Vector3(0, 1, 0) });
    const registry = new RigidUnitRegistry(rigid, loader, {
      config: { manifestUrl: MANIFEST_URL },
      maxTextureSize: 4096,
    });
    await registry.setLoadouts(loadouts);
    expect(meshes(scene)).toHaveLength(9); // three assets, three distinct LODs each
    rigid.update(
      frameOf([
        { id: 1, typeId: 2, x: 0, z: 0 },
        { id: 2, typeId: 2, x: 2, z: 0 },
        { id: 3, typeId: 3, x: -2, z: 0, owner: 3 },
      ]),
      camera(),
      recorder().decals,
      0,
    );
    expect(rigid.drawCount).toBe(2);
    const drone = byName(scene, `rigid-${DRONE_ID}-lod0`);
    expect(drone.count).toBe(1);
    expect(row(drone, 'iScale', 0)[3]).toBe(3);
    expect(row(drone, 'iPos', 0)[1]).toBeGreaterThan(1.2); // hover from the manifest
  });
});

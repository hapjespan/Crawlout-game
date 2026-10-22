import { describe, it, expect } from 'vitest';
import { ANIM, MAX_PLAYERS, ENTITY_FLAG } from '@crawlout/protocol';
import { NEUTRAL_TEAM } from '../palette.js';
import { Scene, Vector3, type MeshBasicNodeMaterial, DataArrayTexture } from 'three/webgpu';
import { UnitLayer } from './unitLayer.js';
import { RigidUnitLayer } from './rigidUnitLayer.js';
import { syntheticRobots } from '../dev/syntheticRobots.js';
import { createRigidUnitMaterial } from './rigidUnitMaterial.js';
import {
  DRONE_TYPE,
  GUARD_TYPE,
  SENTINEL_TYPE,
  byName,
  camera,
  frameOf,
  meshes,
  recorder,
  robotLayer,
  row,
} from './rigidUnits.helpers.js';
import type { Placed } from './rigidUnits.helpers.js';

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
    expect(Math.abs(pos0[3]! - 1.25)).toBeLessThan(0.08); // the heading plus the small jitter of a unit at rest
    expect(row(guard, 'iScale', 0)[3]).toBe(2); // team slot = owner
    expect(row(guard, 'iScale', 1)[3]).toBe(NEUTRAL_TEAM); // clamped
    expect(NEUTRAL_TEAM).toBe(MAX_PLAYERS);
    expect(row(guard, 'iScale', 2)[3]).toBe(5);
    // iMotion: pitch, roll, dim, glow. The idle guards barely tilt; the dead one lies down and is dimmed.
    const idle = row(guard, 'iMotion', 0);
    expect(Math.abs(idle[0]!)).toBeLessThan(0.02);
    expect(idle[2]).toBe(0);
    const dead = row(guard, 'iMotion', 2);
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
    // The hover height is baked into the model (lowest point at 1.35 m): the instance stays at the ground point plus
    // the bob, it is not lifted a second time.
    const lod0 = drone.geometry;
    lod0.computeBoundingBox();
    expect(lod0.boundingBox!.min.y).toBeCloseTo(1.35, 4);
    expect(Math.abs(row(drone, 'iPos', 0)[1]!)).toBeLessThan(0.1);
    const guard = byName(scene, 'rigid-synthetic_guard-lod0');
    // Facing +z (yaw 0): kicked back to smaller z. Facing +x (yaw pi/2): kicked back to smaller x.
    expect(row(guard, 'iPos', 0)[2]).toBeLessThan(-0.05);
    expect(row(guard, 'iPos', 0)[0]).toBeCloseTo(5, 1);
    expect(row(guard, 'iPos', 1)[0]).toBeLessThan(-5.05);
    expect(row(guard, 'iPos', 1)[2]).toBeCloseTo(0, 1);
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
        ['color', 'iMotion', 'iPos', 'iScale', 'iTint', 'normal', 'position'].sort(),
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

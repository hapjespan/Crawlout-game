import { describe, expect, it } from 'vitest';
import { ANIM } from '@crawlout/protocol';
import { Mesh, MeshBasicNodeMaterial, PerspectiveCamera, Scene, type InstancedBufferAttribute } from 'three/webgpu';
import type { DecalLayer } from '../decals/decalLayer.js';
import { buildingWallHeight, FootprintTable } from '../entities/footprint.js';
import { buildingTypeId, TYPE_ID_SCRAP_NODE } from '../entities/typeIds.js';
import { createInterpolatedFrame, type InterpolatedFrame } from '../snapshot/interpolate.js';
import { createScaffoldGeometry } from './structureGeometry.js';
import { StructureLayer } from './structureLayer.js';
import { constructionHeight, constructionTint, SCAFFOLD_HEIGHT, SITE_MIN_HEIGHT, scrapHeapScale } from './structureVisuals.js';

describe('structure visuals', () => {
  it('grows a site from a visible stub to the full height', () => {
    expect(constructionHeight(0)).toBe(SITE_MIN_HEIGHT);
    expect(constructionHeight(1)).toBe(1);
    expect(constructionHeight(-1)).toBe(SITE_MIN_HEIGHT);
    expect(constructionHeight(0.5)).toBeGreaterThan(constructionHeight(0.25));
  });

  it('tints a site raw and lands on the building tint when done', () => {
    const tint = [0.9, 0.8, 0.7] as const;
    const raw = constructionTint(0, tint, [0, 0, 0]);
    expect(raw[0]).toBeGreaterThan(1);
    expect(constructionTint(1, tint, [0, 0, 0])).toEqual([0.9, 0.8, 0.7].map((v) => expect.closeTo(v, 6)));
  });

  it('shrinks and flattens a scrap heap with its remaining stock', () => {
    const full = scrapHeapScale(100, [0, 0]);
    expect(full).toEqual([1, 1]);
    const half = scrapHeapScale(50, [0, 0]);
    const low = scrapHeapScale(1, [0, 0]);
    expect(half[0]).toBeLessThan(1);
    expect(low[0]).toBeLessThan(half[0]);
    expect(low[1]).toBeLessThan(half[1]);
    expect(low[1]).toBeLessThan(low[0]); // flatter than narrow
    expect(scrapHeapScale(0, [0, 0])[0]).toBeGreaterThan(0); // never vanishes before the node is removed
    expect(scrapHeapScale(255, [0, 0])).toEqual([1, 1]);
  });

  it('builds a scaffold inside its footprint box with a team-masked banner', () => {
    const g = createScaffoldGeometry();
    g.computeBoundingBox();
    const box = g.boundingBox!;
    expect(box.min.y).toBeGreaterThanOrEqual(-0.05);
    expect(box.max.y).toBeLessThan(1.1);
    expect(Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z)).toBeLessThan(0.56);
    const color = g.getAttribute('color');
    let team = 0;
    for (let i = 0; i < color.count; i++) team += color.getW(i);
    expect(team).toBeGreaterThan(0);
  });
});

describe('StructureLayer', () => {
  const material = (): MeshBasicNodeMaterial => new MeshBasicNodeMaterial();
  const decals = { push() {} } as unknown as DecalLayer;

  function setup(): { layer: StructureLayer; scene: Scene; frame: InterpolatedFrame; camera: PerspectiveCamera } {
    const scene = new Scene();
    const footprints = new FootprintTable(() => ({ w: 4, h: 4 }));
    const layer = new StructureLayer(scene, {
      capacity: 16,
      footprints,
      heightAt: () => 0,
      materials: { building: material(), scrap: material(), claim: material() },
    });
    const camera = new PerspectiveCamera(45, 1, 0.5, 800);
    camera.position.set(0, 30, 30);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    return { layer, scene, frame: createInterpolatedFrame(16), camera };
  }

  const batch = (scene: Scene, name: string): Mesh => scene.getObjectByName(name) as Mesh;
  const instance = (mesh: Mesh, attr: string, k: number): number[] => {
    const a = mesh.geometry.getAttribute(attr) as InstancedBufferAttribute;
    return [a.getX(k), a.getY(k), a.getZ(k), a.getW(k)];
  };

  it('draws a site lower than a finished building, inside a scaffold', () => {
    const { layer, scene, frame, camera } = setup();
    const typeId = buildingTypeId(0);
    frame.count = 2;
    for (const i of [0, 1]) {
      frame.id[i] = 100 + i;
      frame.typeId[i] = typeId;
      frame.x[i] = i * 8 - 4;
      frame.z[i] = 0;
      frame.owner[i] = 0;
      frame.hpPct[i] = 100;
    }
    frame.anim[0] = ANIM.build;
    frame.animT[0] = 0.25;
    frame.anim[1] = ANIM.idle;
    frame.animT[1] = 0;
    layer.update(frame, camera, decals);

    const lod0 = batch(scene, 'buildings-lod0');
    const scaffolds = batch(scene, 'building-scaffolds');
    expect(lod0.count).toBe(2);
    expect(scaffolds.count).toBe(1);
    const wall = buildingWallHeight({ w: 4, h: 4 });
    expect(instance(lod0, 'iScale', 0)[1]).toBeCloseTo(wall * constructionHeight(0.25));
    expect(instance(lod0, 'iScale', 1)[1]).toBeCloseTo(wall);
    const s = instance(scaffolds, 'iScale', 0);
    expect(s[0]).toBeGreaterThan(4);
    expect(s[1]).toBeCloseTo(wall * SCAFFOLD_HEIGHT);
    expect(instance(scaffolds, 'iPos', 0)[0]).toBeCloseTo(-4);
  });

  it('scales scrap nodes by hpPct', () => {
    const { layer, scene, frame, camera } = setup();
    frame.count = 2;
    for (const i of [0, 1]) {
      frame.id[i] = 200 + i;
      frame.typeId[i] = TYPE_ID_SCRAP_NODE;
      frame.x[i] = i * 6 - 3;
      frame.owner[i] = 255;
      frame.anim[i] = ANIM.idle;
    }
    frame.hpPct[0] = 100;
    frame.hpPct[1] = 20;
    layer.update(frame, camera, decals);
    const heaps = batch(scene, 'scrap-nodes');
    expect(heaps.count).toBe(2);
    expect(instance(heaps, 'iScale', 0)[0]).toBeCloseTo(1);
    expect(instance(heaps, 'iScale', 1)[0]).toBeCloseTo(scrapHeapScale(20, [0, 0])[0]);
    expect(instance(heaps, 'iScale', 1)[1]).toBeCloseTo(scrapHeapScale(20, [0, 0])[1]);
  });
});

import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three/webgpu';
import { bakeAnimations } from './bake.js';
import { createHumanoidGeometry, HERO_PART_ALPHA, UNIT_LODS } from './humanoidGeometry.js';
import { ANIM, ANIM_NAMES } from '@crawlout/protocol';
import { BONES, CLIPS } from './rig.js';

describe('bakeAnimations', () => {
  const baked = bakeAnimations();

  it('lays out one row per frame and four texels per bone', () => {
    expect(baked.boneCount).toBe(BONES.length);
    expect(BONES.length).toBeLessThanOrEqual(28); // artist brief: max 28 bones
    expect(baked.width).toBe(BONES.length * 4);
    expect(baked.data.length).toBe(baked.width * baked.height * 4);
    expect(baked.clips.map((c) => c.name)).toEqual(CLIPS.map((c) => c.name));
    expect(CLIPS.map((c) => c.name)).toEqual(ANIM_NAMES); // protocol clip order
    for (const name of ANIM_NAMES) expect(CLIPS[ANIM[name]]!.name).toBe(name);
    let row = 0;
    for (const c of baked.clips) {
      expect(c.startRow).toBe(row);
      row += c.frameCount;
    }
    expect(row).toBe(baked.height);
    expect(baked.clipTable.length).toBe(baked.clips.length * 4);
    expect(baked.clipTable[ANIM.death * 4 + 2]).toBe(0); // death does not loop
    expect(baked.clipTable[ANIM.walk * 4 + 2]).toBe(1);
  });

  it('only holds finite numbers', () => {
    expect(baked.data.every(Number.isFinite)).toBe(true);
  });

  it('keeps the feet near the ground in walk and lays the body down in death', () => {
    const shinL = BONES.findIndex((b) => b.name === 'LeftLeg');
    const head = BONES.findIndex((b) => b.name === 'Head');
    const skinAt = (clip: number, frame: number, bone: number) => {
      const row = baked.clips[clip]!.startRow + frame;
      const o = (row * baked.width + bone * 4) * 4;
      return new Matrix4().fromArray(baked.data, o);
    };
    const ankle = new Vector3(0.1, 0.05, 0);
    const walk = baked.clips[ANIM.walk]!;
    let minY = Infinity;
    for (let f = 0; f < walk.frameCount; f++)
      minY = Math.min(minY, ankle.clone().applyMatrix4(skinAt(ANIM.walk, f, shinL)).y);
    expect(minY).toBeGreaterThan(-0.1);
    expect(minY).toBeLessThan(0.2);

    const death = baked.clips[ANIM.death]!;
    const headTop = new Vector3(0, 1.8, 0);
    const lying = headTop.applyMatrix4(skinAt(ANIM.death, death.frameCount - 1, head));
    expect(lying.y).toBeLessThan(0.6);
  });
});

describe('createHumanoidGeometry', () => {
  it('builds three LODs with decreasing triangle counts and valid skin data', () => {
    const tris = UNIT_LODS.map((lod) => {
      const g = createHumanoidGeometry(lod);
      const skin = g.getAttribute('skinIndex');
      const weight = g.getAttribute('skinWeight');
      for (let i = 0; i < skin.count; i++) {
        expect(skin.getX(i)).toBeLessThan(BONES.length);
        expect(weight.getX(i) + weight.getY(i) + weight.getZ(i) + weight.getW(i)).toBeCloseTo(1);
      }
      const color = g.getAttribute('color');
      const position = g.getAttribute('position');
      // Height of a regular unit, without the hero parts (drawn only on a hero).
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < position.count; i++) {
        if (color.getW(i) >= HERO_PART_ALPHA - 0.5) continue;
        minY = Math.min(minY, position.getY(i));
        maxY = Math.max(maxY, position.getY(i));
      }
      expect(minY).toBeGreaterThanOrEqual(-0.01); // feet on y = 0
      expect(maxY).toBeGreaterThan(1.7);
      expect(maxY).toBeLessThan(1.9);
      expect(color.itemSize).toBe(4); // rgb + team mask
      expect(color.count).toBe(skin.count);
      // WebGPU allows 8 vertex buffers; the unit pipeline adds iPose and iAnim to these.
      expect(Object.keys(g.attributes).length + 2).toBeLessThanOrEqual(8);
      return g.getIndex()!.count / 3;
    });
    expect(tris[0]).toBeGreaterThan(tris[1]!);
    expect(tris[1]).toBeGreaterThan(tris[2]!);
  });
});

describe('hero parts of the placeholder', () => {
  it('puts a team-colored cap on top in every LOD, and collar and pauldrons up close', () => {
    for (const lod of UNIT_LODS) {
      const g = createHumanoidGeometry(lod);
      const color = g.getAttribute('color');
      const position = g.getAttribute('position');
      const skin = g.getAttribute('skinIndex');
      let heroVerts = 0;
      let heroTop = -Infinity;
      let regularTop = -Infinity;
      const bones = new Set<number>();
      for (let i = 0; i < color.count; i++) {
        const a = color.getW(i);
        if (a >= HERO_PART_ALPHA - 0.5) {
          heroVerts++;
          expect(a - HERO_PART_ALPHA).toBe(1); // fully team-masked
          heroTop = Math.max(heroTop, position.getY(i));
          bones.add(skin.getX(i));
        } else {
          expect(a).toBeLessThanOrEqual(1);
          regularTop = Math.max(regularTop, position.getY(i));
        }
      }
      expect(heroVerts).toBeGreaterThan(0);
      expect(heroTop).toBeGreaterThan(regularTop); // the cap sits above the hair
      expect(bones.has(BONES.findIndex((b) => b.name === 'Head'))).toBe(true);
      if (lod < 2) expect(bones.size).toBeGreaterThan(1); // collar on the chest, pauldrons on the arms
    }
  });
});

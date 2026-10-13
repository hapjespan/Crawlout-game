import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document } from '@gltf-transform/core';
import { ANIM_NAMES } from '@crawlout/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bakeAnimations } from '../src/bake.js';
import { buildAssets } from '../src/build.js';
import { resolveClips, parseClipmap } from '../src/clipmap.js';
import { manifestSchema } from '../src/manifest.js';
import { validateAsset } from '../src/validate.js';
import { makeHumanoid } from './fixtures.js';

/** Twee bones (root op de grond, kind 1 m hoger met correcte inverse bind); elke clip draait de root 90 graden om Z. */
function makeRig(durations: Partial<Record<string, number>> = {}, names: readonly string[] = ANIM_NAMES): Document {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const root = doc.createNode('root');
  const child = doc.createNode('child').setTranslation([0, 1, 0]);
  root.addChild(child);
  doc.createScene().addChild(root);
  const ibm = new Float32Array(32);
  ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 0);
  ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1], 16);
  doc.createSkin().addJoint(root).addJoint(child).setInverseBindMatrices(doc.createAccessor().setArray(ibm).setType('MAT4').setBuffer(buffer));
  const q = Math.SQRT1_2;
  for (const name of names) {
    const input = doc.createAccessor().setArray(new Float32Array([0, durations[name] ?? 1])).setType('SCALAR').setBuffer(buffer);
    const output = doc.createAccessor().setArray(new Float32Array([0, 0, 0, 1, 0, 0, q, q])).setType('VEC4').setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output);
    const channel = doc.createAnimationChannel().setTargetNode(root).setTargetPath('rotation').setSampler(sampler);
    doc.createAnimation(name).addSampler(sampler).addChannel(channel);
  }
  return doc;
}

const identityMap = (n: number): Map<(typeof ANIM_NAMES)[number], number> => new Map(ANIM_NAMES.map((name, i) => [name, i] as const).slice(0, n));

describe('bakeAnimations', () => {
  it('schrijft afmetingen en clipblokken volgens sectie 12', () => {
    const { baked, data } = bakeAnimations({ assetId: 'rig', document: makeRig({ death: 2 }), clips: identityMap(8) });
    expect(baked.width).toBe(8);
    expect(baked.fps).toBe(30);
    expect(baked.clips.map((c) => c.name)).toEqual([...ANIM_NAMES]);
    expect(baked.clips.map((c) => c.frames)).toEqual([30, 30, 30, 30, 30, 30, 30, 60]);
    expect(baked.clips.map((c) => c.startRow)).toEqual([0, 30, 60, 90, 120, 150, 180, 210]);
    expect(baked.clips.map((c) => c.loop)).toEqual([true, true, true, true, true, true, true, false]);
    expect(baked.clips[7]!.durationSeconds).toBe(2);
    expect(baked.height).toBe(270);
    expect(baked.path).toBe('rig/rig.anim.f32');
    expect(data.byteLength).toBe(baked.width * baked.height * 16);
  });

  it('roundtrip: leest de skin-matrix van een bekende pose terug', () => {
    const { baked, data } = bakeAnimations({ assetId: 'rig', document: makeRig({ death: 2 }), clips: identityMap(8) });
    const f32 = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
    const texel = (bone: number, c: number, row: number): number[] => {
      const at = (row * baked.width + bone * 4 + c) * 4;
      return [...f32.subarray(at, at + 4)];
    };
    // idle (loop, 1 s, 30 frames), frame 15 = p 0.5 = 45 graden om Z: kolom 0 = (cos, sin, 0, 0), kolom 1 = (-sin, cos, 0, 0).
    const s = Math.SQRT1_2;
    for (const bone of [0, 1]) {
      expect(texel(bone, 0, 15)[0]).toBeCloseTo(s, 5);
      expect(texel(bone, 0, 15)[1]).toBeCloseTo(s, 5);
      expect(texel(bone, 1, 15)[0]).toBeCloseTo(-s, 5);
      expect(texel(bone, 3, 15).map(Math.abs)).toEqual([0, 0, 0, 1]);
    }
    // Rustpose (rij 0): identiteit; het kind valt na inverse bind terug op de root-draaiing (translatie 0).
    expect(texel(1, 0, 0)).toEqual([1, 0, 0, 0]);
    expect(texel(1, 3, 0)).toEqual([0, 0, 0, 1]);
    // Loop sluit af voor p = 1: laatste idle-frame (29) is nog niet 90 graden.
    expect(texel(0, 0, 29)[1]).toBeLessThan(1);
    // death (one-shot, 60 frames vanaf rij 210) sluit de laatste pose op p = 1 in: 90 graden, kolom 0 = (0, 1, 0, 0).
    const last = baked.clips[7]!.startRow + baked.clips[7]!.frames - 1;
    expect(texel(0, 0, last)[0]).toBeCloseTo(0, 5);
    expect(texel(0, 0, last)[1]).toBeCloseTo(1, 5);
  });
});

describe('validatie van clips', () => {
  it('meldt precies welke clip ontbreekt', async () => {
    const bytes = await makeHumanoid({ clips: ['idle', 'walk', 'run', 'attack1', 'gather', 'build', 'death'] });
    const { NodeIO } = await import('@gltf-transform/core');
    const result = validateAsset(await new NodeIO().readBinary(bytes));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/animatieclip "attack2" ontbreekt/);
  });

  it('lost clipnamen op via de clipmap en meldt dubbelzinnigheid', () => {
    const map = parseClipmap({ clips: { Walk_Loop: 'walk', Jog_Fwd_Loop: 'run', Jog_Alt: 'run' } });
    const names = ['idle', 'WALK_LOOP', 'Jog_Fwd_Loop', 'attack1', 'attack2', 'gather', 'build', 'death'];
    const ok = resolveClips(names, map);
    expect(ok.errors).toEqual([]);
    expect(ok.found.get('walk')).toBe(1);
    expect(resolveClips([...names, 'Jog_Alt'], map).errors.join()).toMatch(/"run" is dubbelzinnig/);
    expect(() => parseClipmap({ clips: { x: 'sprint' } })).toThrow();
  });
});

describe('buis met baked', () => {
  let root: string;
  let src: string;
  let dist: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'asset-cli-bake-'));
    src = join(root, 'src');
    dist = join(root, 'dist');
    mkdirSync(src);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('schrijft <id>.anim.f32 en baked in het manifest, via clipmap voor afwijkende namen', async () => {
    writeFileSync(join(src, 'hero.glb'), await makeHumanoid({ clips: ['Idle_Loop', 'Walk_Loop', 'run', 'attack1', 'attack2', 'gather', 'build', 'death'] }));
    writeFileSync(join(src, 'clipmap.json'), JSON.stringify({ clips: { Idle_Loop: 'idle', Walk_Loop: 'walk' } }));
    const result = await buildAssets({ srcDir: src, distDir: dist, toktx: null });
    expect(result.reports.flatMap((r) => r.errors)).toEqual([]);
    const manifest = manifestSchema.parse(JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8')));
    const hero = manifest.assets[0]!;
    expect(hero.baked?.path).toBe('hero/hero.anim.f32');
    expect(hero.baked?.width).toBe(hero.boneCount * 4);
    expect(hero.baked?.clips.map((c) => c.name)).toEqual([...ANIM_NAMES]);
    const bytes = readFileSync(join(dist, 'hero/hero.anim.f32'));
    expect(bytes.byteLength).toBe(hero.baked!.width * hero.baked!.height * 16);
  });

  it('faalt zonder clipmap met de naam van de ontbrekende clip en schrijft niets', async () => {
    writeFileSync(join(src, 'hero.glb'), await makeHumanoid({ clips: ['Idle_Loop', 'walk', 'run', 'attack1', 'attack2', 'gather', 'build', 'death'] }));
    const result = await buildAssets({ srcDir: src, distDir: dist, toktx: null });
    expect(result.ok).toBe(false);
    expect(result.reports[0]!.errors.join()).toMatch(/animatieclip "idle" ontbreekt/);
    expect(existsSync(join(dist, 'manifest.json'))).toBe(false);
  });

  it('manifest-schema weigt een verkeerde clipvolgorde', async () => {
    writeFileSync(join(src, 'hero.glb'), await makeHumanoid());
    await buildAssets({ srcDir: src, distDir: dist, toktx: null });
    const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
    manifest.assets[0].baked.clips.reverse();
    expect(manifestSchema.safeParse(manifest).success).toBe(false);
  });
});

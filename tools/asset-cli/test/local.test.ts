// De lokale buis (pnpm assets --local) met synthetische bestanden in een tijdelijke map: een "scène" met een karakter
// onder een andere naam, verkeerde schaal, eigen botnamen, geen clips en een extra mesh, plus een retarget-bron met
// UE-namen en clips. Geen fanart of andere bronassets in de repo.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ANIM_NAMES } from '@crawlout/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildAssets } from '../src/build.js';
import { manifestSchema } from '../src/manifest.js';
import { makeHumanoid, makeProp, makeUeSource, UE_CLIPMAP, UE_TO_MIXAMO } from './fixtures.js';

const MIXAMO_NAMES = [
  'Hips',
  'Spine',
  'Spine1',
  'Spine2',
  'Neck',
  'Head',
  'LeftShoulder',
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'RightShoulder',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
];

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'asset-cli-local-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Karakter van 0,9 m met botnamen `bone_<Mixamo>`, zonder clips, plus een losse mesh "Door" in de scène. */
async function makeScene(): Promise<Uint8Array> {
  const io = new NodeIO();
  const doc = await io.readBinary(
    await makeHumanoid({ height: 0.9, boneNamePrefix: 'bone_', clips: [] }),
  );
  const buffer = doc.getRoot().listBuffers()[0]!;
  const prim = doc.createPrimitive().setAttribute(
    'POSITION',
    doc
      .createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array([3, 0, 0, 4, 0, 0, 3, 2, 0]))
      .setBuffer(buffer),
  );
  const scene = doc.getRoot().listScenes()[0]!;
  scene.addChild(doc.createNode('Door').setMesh(doc.createMesh('Door').addPrimitive(prim)));
  return io.writeBinary(doc);
}

async function setup(): Promise<{ local: string; dist: string }> {
  const src = join(root, 'src');
  const local = join(root, 'local');
  mkdirSync(join(src, 'characters'), { recursive: true });
  mkdirSync(local);
  writeFileSync(
    join(src, 'characters', 'ue_source.glb'),
    await makeUeSource({ segments: 12, rings: 12 }),
  );
  writeFileSync(
    join(src, 'rigmap.json'),
    JSON.stringify({ rigs: { ue: { bones: UE_TO_MIXAMO } }, assets: { ue_source: { rig: 'ue' } } }),
  );
  writeFileSync(join(src, 'clipmap.json'), JSON.stringify({ assets: { ue_source: UE_CLIPMAP } }));
  writeFileSync(join(local, 'scene_fanart.glb'), await makeScene());
  writeFileSync(join(local, 'terrain.glb'), await makeProp()); // andere lokale bron zonder entry
  writeFileSync(
    join(local, 'rigmap.json'),
    JSON.stringify({
      rigs: { fan: { bones: Object.fromEntries(MIXAMO_NAMES.map((n) => [`bone_${n}`, n])) } },
      assets: {
        scene_fanart: {
          id: 'dweller_body_human',
          meshes: ['body'],
          fit: { height: 1.8 },
          rig: 'fan',
          retarget: {
            from: '../src/characters/ue_source.glb',
            rigmap: '../src/rigmap.json',
            clipmap: '../src/clipmap.json',
          },
        },
      },
    }),
  );
  writeFileSync(join(local, 'clipmap.json'), JSON.stringify({ clips: {}, assets: {} }));
  return { local, dist: join(root, 'dist-local') };
}

describe('lokale buis', () => {
  it('extraheert, schaalt, hernoemt, retarget en publiceert onder de repo-id met een eigen manifest', async () => {
    const { local, dist } = await setup();
    const result = await buildAssets({
      srcDir: local,
      distDir: dist,
      toktx: null,
      onlyConfigured: true,
    });
    expect(result.reports.flatMap((r) => r.errors)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.notices.join('\n')).toMatch(/terrain\.glb overgeslagen/);

    const manifest = manifestSchema.parse(
      JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8')),
    );
    expect(manifest.assets.map((a) => a.id)).toEqual(['dweller_body_human']);
    const entry = manifest.assets[0]!;
    expect(entry.kind).toBe('character');
    expect(entry.boneCount).toBe(20);
    expect(entry.bounds.max[1] - entry.bounds.min[1]).toBeCloseTo(1.8, 3);
    expect(entry.bounds.min[1]).toBeCloseTo(0, 4);
    expect(entry.baked!.clips.map((c) => c.name)).toEqual([...ANIM_NAMES]);
    expect(existsSync(join(dist, entry.baked!.path))).toBe(true);
    expect(entry.baked!.path).toBe('dweller_body_human/dweller_body_human.anim.f32');

    const report = JSON.parse(readFileSync(join(dist, 'validation-report.json'), 'utf8'));
    const asset = report.assets[0];
    expect(asset.source).toBe('scene_fanart.glb');
    expect(asset.meshesRemoved).toEqual(['Door']);
    expect(asset.fit.scale).toBeGreaterThan(1); // bron was kleiner dan 1,8 m
    expect(asset.retarget.unmapped).toEqual([]);
    expect(asset.retarget.clips).toHaveLength(8);

    // LOD0 bevat alleen het karakter: geen "Door" meer.
    const io = new NodeIO();
    const { MeshoptDecoder } = await import('meshoptimizer');
    await MeshoptDecoder.ready;
    const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
    const lod0 = await io
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
      .read(join(dist, entry.lods[0].path));
    expect(
      lod0
        .getRoot()
        .listMeshes()
        .map((m) => m.getName()),
    ).not.toContain('Door');
    // Runs the whole local pipeline off disk: ~930 ms alone, but under the full parallel suite the default 5 s is not
    // enough headroom and it times out on a loaded machine.
  }, 30_000);

  // Een geleverd model met een eigen skelet staat onder delivered/, waar de buis zelf niet kijkt; `source` wijst het aan
  // zodat het door rig en retarget gaat (geskind en lopend) in plaats van door de starre delivered-buis.
  it('pakt via "source" een geleverd model met eigen skelet op, op zijn eigen hoogte', async () => {
    const { local, dist } = await setup();
    mkdirSync(join(local, 'delivered'));
    writeFileSync(
      join(local, 'delivered', 'armor.glb'),
      await makeHumanoid({ height: 2.25, boneNamePrefix: 'bone_', clips: [] }),
    );
    const rigmap = JSON.parse(readFileSync(join(local, 'rigmap.json'), 'utf8'));
    rigmap.assets.armor = {
      id: 'garde_body_power_armor',
      source: 'delivered/armor.glb',
      fit: { height: 2.25 },
      rig: 'fan',
      retarget: {
        from: '../src/characters/ue_source.glb',
        rigmap: '../src/rigmap.json',
        clipmap: '../src/clipmap.json',
      },
    };
    writeFileSync(join(local, 'rigmap.json'), JSON.stringify(rigmap));

    const result = await buildAssets({
      srcDir: local,
      distDir: dist,
      toktx: null,
      onlyConfigured: true,
    });
    expect(result.reports.flatMap((r) => r.errors)).toEqual([]);
    const manifest = manifestSchema.parse(
      JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8')),
    );
    const armor = manifest.assets.find((a) => a.id === 'garde_body_power_armor')!;
    expect(armor.kind).toBe('character');
    expect(armor.boneCount).toBe(20);
    expect(armor.bounds.max[1] - armor.bounds.min[1]).toBeCloseTo(2.25, 2);
    expect(armor.baked!.clips.map((c) => c.name)).toEqual([...ANIM_NAMES]);
  });

  it('cli --local doet niets zonder lokale map (CI blijft groen)', () => {
    const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
    const dist = join(root, 'dist-local');
    const out = execFileSync(
      process.execPath,
      ['--import', 'tsx', cli, '--local', '--src', join(root, 'bestaat-niet'), '--dist', dist],
      { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' },
    );
    expect(out).toMatch(/geen lokale assets/);
    expect(existsSync(dist)).toBe(false);
  });
});

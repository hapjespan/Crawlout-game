// De gecommitte pack-props in assets/dist tegen assets/src/packs.json: per categorie redelijke hoogtes (echte schaal naast
// een poppetje van 1,8 m), de voet op y=0, gecentreerd op x en z, LOD- en textuurbudgetten en het alfagedrag.
// Leest alleen de config en de uitvoer; de bronnen (assets/src/packs) zijn er niet voor nodig.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { manifestSchema, PROP_CATEGORIES } from '../src/manifest.js';
import { listConfiguredProps, loadPacksConfig, resolveProp } from '../src/packs.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const config = loadPacksConfig(join(repo, 'assets/src/packs.json'));
const manifest = manifestSchema.parse(
  JSON.parse(readFileSync(join(repo, 'assets/dist/manifest.json'), 'utf8')),
);
const entries = new Map(manifest.assets.map((a) => [a.id, a]));
const props = listConfiguredProps(config);

describe('pack-props in assets/dist', { timeout: 60_000 }, () => {
  it('heeft voor elke categorie minstens een prop en alle 10 categorieen in de config', () => {
    expect(Object.keys(config.categories).sort()).toEqual([...PROP_CATEGORIES].sort());
    for (const category of PROP_CATEGORIES)
      expect(
        props.some((p) => p.prop.category === category),
        category,
      ).toBe(true);
  });

  it.each(props.map((p) => [p.id, p] as const))(
    '%s: echte maat, voet, midden, budgetten',
    (id, { prop }) => {
      const entry = entries.get(id);
      expect(entry, `${id} ontbreekt in manifest.json`).toBeDefined();
      const settings = resolveProp(config, prop);
      expect(entry!.kind).toBe('prop');
      expect(entry!.category).toBe(prop.category);
      const { min, max } = entry!.bounds;
      const height = max[1] - min[1];
      expect(height, `${id}: ${height.toFixed(2)} m`).toBeGreaterThanOrEqual(
        settings.heightRangeM[0],
      );
      expect(height, `${id}: ${height.toFixed(2)} m`).toBeLessThanOrEqual(settings.heightRangeM[1]);
      expect(Math.abs(min[1])).toBeLessThan(0.02);
      if (settings.centre === 'bounds') {
        expect(Math.abs((min[0] + max[0]) / 2)).toBeLessThan(0.05);
        expect(Math.abs((min[2] + max[2]) / 2)).toBeLessThan(0.05);
      }
      for (const lod of entry!.lods) {
        expect(lod.triangles).toBeGreaterThan(0);
        expect(lod.triangles).toBeLessThanOrEqual(settings.tris[lod.level]);
      }
      expect(entry!.boneCount).toBe(0);
      expect(entry!.teamMask).toBe('none');
    },
  );

  it('houdt een boom tussen 6 en 15 m, een krat rond 0,6 tot 1 m, een kist rond 0,5 m en de wachttoren tussen 6 en 10 m', () => {
    const height = (id: string): number =>
      entries.get(id)!.bounds.max[1] - entries.get(id)!.bounds.min[1];
    for (const { id, prop } of props.filter((p) => p.prop.category.startsWith('tree'))) {
      expect(height(id), id).toBeGreaterThanOrEqual(6);
      expect(height(id), id).toBeLessThanOrEqual(15);
      expect(prop.category === 'tree-leafy' || prop.category === 'tree-bare').toBe(true);
    }
    expect(height('crate_01')).toBeGreaterThanOrEqual(0.6);
    expect(height('crate_01')).toBeLessThanOrEqual(1);
    expect(height('chest_01')).toBeGreaterThanOrEqual(0.4);
    expect(height('chest_01')).toBeLessThanOrEqual(0.7);
    expect(height('watchtower_01')).toBeGreaterThanOrEqual(6);
    expect(height('watchtower_01')).toBeLessThanOrEqual(10);
  });

  it("LOD-GLB's: een materiaal, atlas binnen het maximum, MASK waar het manifest alpha: mask zegt", async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    for (const { id, prop } of props) {
      const entry = entries.get(id)!;
      const settings = resolveProp(config, prop);
      for (const lod of entry.lods) {
        const doc = await io.readBinary(
          new Uint8Array(readFileSync(join(repo, 'assets/dist', lod.path))),
        );
        const materials = doc.getRoot().listMaterials();
        expect(materials, `${id} LOD${lod.level}`).toHaveLength(1);
        const [width, height] = doc.getRoot().listTextures()[0]!.getSize()!;
        expect(Math.max(width!, height!), `${id} LOD${lod.level} atlas`).toBeLessThanOrEqual(
          settings.atlas,
        );
        expect(doc.getRoot().getAsset().copyright, id).toMatch(/DJMaesen/);
        if (entry.alpha === 'mask') {
          expect(materials[0]!.getAlphaMode(), id).toBe('MASK');
          expect(materials[0]!.getAlphaCutoff(), id).toBeGreaterThan(0);
        } else expect(materials[0]!.getAlphaMode(), id).toBe('OPAQUE');
      }
    }
    for (const { id, prop } of props) {
      if (prop.alpha === 'mask') expect(entries.get(id)!.alpha, id).toBe('mask');
      if (prop.alpha === 'none') expect(entries.get(id)!.alpha, id).toBeUndefined();
    }
  });

  it('laat de Gobkit-props en de gebouwen staan', () => {
    for (const id of [
      'bush001',
      'bush002',
      'grass001',
      'reed001',
      'rock001',
      'rock002',
      'rock003',
      'treehigh001',
      'treelow001',
      'treemed001',
    ])
      expect(entries.get(id)?.kind, id).toBe('prop');
    expect(manifest.assets.filter((a) => a.kind === 'building').length).toBeGreaterThanOrEqual(8);
  });
});

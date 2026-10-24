// The three texture arrays an asset's materials become: base colour (sRGB), normal and metallicRoughness (linear).
// They share one layer index, so a geometry's uvl.z addresses all of them (units/gltfUnitGeometry.ts).
import { describe, expect, it } from 'vitest';
import { MeshStandardMaterial, NoColorSpace, SRGBColorSpace, Texture } from 'three/webgpu';
import { NO_LAYER, TextureLayerTable, type TextureLayer } from './buildingGeometry.js';
import {
  budgetedLayerSize,
  createLayerTexture,
  MAX_LAYER_SIZE,
  MIN_LAYER_SIZE,
  UNIT_LAYER_BUDGET_BYTES,
  type Rasterize,
} from './textureArray.js';

/** A texture whose "image" is a tagged stub; `flat` below turns the tag into pixels. */
function fakeTexture(tag: string, size = 4): Texture {
  const t = new Texture();
  t.image = { width: size, height: size, tag };
  return t;
}

/** Rasterizes a fakeTexture: every texel is the rgba the tag asks for. */
const flat =
  (colors: Record<string, [number, number, number, number]>): Rasterize =>
  (image, size) => {
    const tag = (image as { tag?: string } | null)?.tag;
    const rgba = tag === undefined ? undefined : colors[tag];
    if (!rgba) return null;
    const px = new Uint8Array(size * size * 4);
    for (let i = 0; i < px.length; i += 4) px.set(rgba, i);
    return px;
  };

/** The first texel of layer `i`. */
function texelOf(data: Uint8Array, size: number, i: number): number[] {
  const at = i * size * size * 4;
  return [data[at]!, data[at + 1]!, data[at + 2]!, data[at + 3]!];
}

describe('texture layer table', () => {
  it('puts the three maps of one material on one layer index', () => {
    const table = new TextureLayerTable();
    const coat = new MeshStandardMaterial({ name: 'coat' });
    coat.map = fakeTexture('coat-base');
    coat.normalMap = fakeTexture('coat-normal');
    coat.roughnessMap = coat.metalnessMap = fakeTexture('coat-mr');
    const plain = new MeshStandardMaterial({ name: 'rope' });
    plain.map = fakeTexture('rope-base');

    expect(table.layerOf(coat)).toBe(0);
    expect(table.layerOf(plain)).toBe(1);
    expect(table.layerOf(coat)).toBe(0); // the same material keeps its layer across the LODs
    expect(table.layerOf(new MeshStandardMaterial({ name: 'team_trim' }))).toBe(NO_LAYER);
    expect(table.has('normal')).toBe(true);
    expect(table.layers[0]!.normalImage).not.toBeNull();
    expect(table.layers[1]!.normalImage).toBeNull();
  });

  it('gives two materials on the same three textures one layer', () => {
    // The Klerk: the asset-cli's team band is a second material on the body's own atlas textures. Keyed on the name
    // that was a second 2048 layer of identical pixels, 48 of the asset's 96 MB.
    const table = new TextureLayerTable();
    const base = fakeTexture('atlas', 2048);
    const normal = fakeTexture('atlas-normal', 2048);
    const mr = fakeTexture('atlas-mr', 2048);
    const dress = (m: MeshStandardMaterial): MeshStandardMaterial => {
      m.map = base;
      m.normalMap = normal;
      m.roughnessMap = m.metalnessMap = mr;
      return m;
    };
    const atlas = dress(new MeshStandardMaterial({ name: 'atlas' }));
    const band = dress(new MeshStandardMaterial({ name: 'team_trim' }));

    expect(table.layerOf(atlas)).toBe(0);
    expect(table.layerOf(band)).toBe(0);
    expect(table.size).toBe(1);
    // And the band keeps its own layer when it brings a normal map of its own: one index addresses all three arrays.
    const own = dress(new MeshStandardMaterial({ name: 'trim_own' }));
    own.normalMap = fakeTexture('trim-normal', 2048);
    expect(table.layerOf(own)).toBe(1);
  });

  it('keeps the LODs of one material on their layer, images and all', () => {
    // Every LOD is its own GLB, so its textures are other objects: the name is what holds them together, and the
    // largest image wins. A lighter LOD may still carry a map the largest one lacks.
    const table = new TextureLayerTable();
    const lod0 = new MeshStandardMaterial({ name: 'coat' });
    lod0.map = fakeTexture('coat-512', 512);
    const lod1 = new MeshStandardMaterial({ name: 'coat' });
    lod1.map = fakeTexture('coat-256', 256);
    lod1.normalMap = fakeTexture('coat-normal-256', 256);

    expect(table.layerOf(lod0)).toBe(0);
    expect(table.layerOf(lod1)).toBe(0);
    expect(table.size).toBe(1);
    expect(table.layers[0]!.width).toBe(512);
    expect(table.layers[0]!.normalImage).not.toBeNull();
    expect(table.layers[0]!.roughness).toBe(1);
  });

  it('neutralises factors that two materials sharing a map disagree over', () => {
    // A factor is baked into the texels of the metallicRoughness layer, so a layer holds one pair. The atlas material
    // sits at glTF-neutral 1 / 1 because the asset-cli baked the per-cell factors into the map; the band re-asserting
    // metalness 0 over that whole map would wipe every metal cell in it.
    const table = new TextureLayerTable();
    const base = fakeTexture('atlas', 2048);
    const mr = fakeTexture('atlas-mr', 2048);
    const atlas = new MeshStandardMaterial({ name: 'atlas', roughness: 1, metalness: 1 });
    atlas.map = base;
    atlas.roughnessMap = atlas.metalnessMap = mr;
    const band = new MeshStandardMaterial({ name: 'team_trim', roughness: 1, metalness: 0 });
    band.map = base;
    band.roughnessMap = band.metalnessMap = mr;

    expect(table.layerOf(atlas)).toBe(0);
    expect(table.layerOf(band)).toBe(0);
    expect(table.layers[0]!.roughness).toBe(1);
    expect(table.layers[0]!.metalness).toBe(1);
  });

  it('keeps the factors both materials agree on', () => {
    const table = new TextureLayerTable();
    const base = fakeTexture('hull', 1024);
    const mr = fakeTexture('hull-mr', 1024);
    const of = (name: string): MeshStandardMaterial => {
      const m = new MeshStandardMaterial({ name, roughness: 0.4, metalness: 0.9 });
      m.map = base;
      m.roughnessMap = m.metalnessMap = mr;
      return m;
    };

    expect(table.layerOf(of('hull'))).toBe(0);
    expect(table.layerOf(of('hull_trim'))).toBe(0);
    expect(table.layers[0]!.roughness).toBeCloseTo(0.4);
    expect(table.layers[0]!.metalness).toBeCloseTo(0.9);
  });
});

describe('createLayerTexture', () => {
  const layers: TextureLayer[] = [
    {
      key: 'coat',
      kind: 'cloth',
      image: { width: 4, height: 4, tag: 'coat-base' },
      width: 4,
      height: 4,
      normalImage: { width: 4, height: 4, tag: 'coat-normal' },
      mrImage: { width: 4, height: 4, tag: 'coat-mr' },
      roughness: 1,
      metalness: 0, // the Klerk's coat: its map says metal, only metallicFactor 0 says leather
    },
    {
      key: 'rope',
      kind: 'cloth',
      image: { width: 4, height: 4, tag: 'rope-base' },
      width: 4,
      height: 4,
      normalImage: null,
      mrImage: null,
      roughness: 0.7,
      metalness: 1, // glTF's default, i.e. the exporter said nothing
    },
  ];
  const rasterize = flat({
    'coat-base': [40, 25, 14, 255],
    'coat-normal': [90, 170, 240, 255],
    'coat-mr': [255, 180, 255, 255],
    'rope-base': [200, 190, 180, 255],
  });

  it('marks base colour sRGB and the data maps linear', () => {
    expect(createLayerTexture(layers, rasterize, 4, 'base').texture.colorSpace).toBe(
      SRGBColorSpace,
    );
    for (const kind of ['normal', 'mr'] as const)
      expect(createLayerTexture(layers, rasterize, 4, kind).texture.colorSpace).toBe(NoColorSpace);
  });

  it('multiplies the metallicRoughness map by the material factors', () => {
    const { texture } = createLayerTexture(layers, rasterize, 4, 'mr');
    const data = texture.image.data as Uint8Array;
    // coat: roughness 180 * 1, metalness 255 * 0. Reading the map straight would make the coat a conductor.
    expect(texelOf(data, 4, 0).slice(1, 3)).toEqual([180, 0]);
  });

  it('gives a material without a map a flat layer it can live with', () => {
    const normal = createLayerTexture(layers, rasterize, 4, 'normal');
    // rope has no normal map: flat tangent space, no relief, and it is not reported as missing.
    expect(texelOf(normal.texture.image.data as Uint8Array, 4, 1)).toEqual([128, 128, 255, 255]);
    expect(normal.missing).toEqual([]);
    const mr = createLayerTexture(layers, rasterize, 4, 'mr');
    // rope has no metallicRoughness map: its own roughnessFactor, and metalness 0 because 1 is glTF's default.
    expect(texelOf(mr.texture.image.data as Uint8Array, 4, 1)).toEqual([255, 179, 0, 255]);
  });

  it('still reports a base colour it could not read', () => {
    const { missing } = createLayerTexture(layers, flat({}), 4, 'base');
    expect(missing).toEqual(['coat', 'rope']);
  });
});

describe('budgetedLayerSize', () => {
  it('gives one merged atlas layer the full edge and holds a many-material asset to a byte budget', () => {
    // 2048^2 x 4 = 16,8 MB: past binnen het budget van 32 MB per kaartsoort.
    expect(budgetedLayerSize(1)).toBe(2048);
    // 23 lagen (de Klerk zonder atlas): 1024 zou 96 MB zijn, 512 is 24 MB.
    expect(budgetedLayerSize(23)).toBe(512);
    expect(23 * budgetedLayerSize(23) ** 2 * 4).toBeLessThanOrEqual(UNIT_LAYER_BUDGET_BYTES);
    // De ondergrens wint van het budget: onder 256 valt het gezicht uit elkaar op de dichtste zoom.
    expect(budgetedLayerSize(10_000)).toBe(MIN_LAYER_SIZE);
  });

  it('never goes above the cap the asset-cli exports', () => {
    expect(budgetedLayerSize(1, Number.MAX_SAFE_INTEGER)).toBe(MAX_LAYER_SIZE);
  });
});

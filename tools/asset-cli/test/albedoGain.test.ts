import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { albedoGainSchema, assetEntrySchema, ALBEDO_GAIN_RANGE } from '../src/manifest.js';
import { parseVariants } from '../src/variants.js';
import { parsePacksConfig } from '../src/packs.js';
import { readSplitJson } from '../src/splitJson.js';

const srcDir = fileURLToPath(new URL('../../../assets/src/', import.meta.url));
const entry = {
  id: 'crate_01',
  kind: 'prop',
  bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  lods: [0, 1, 2].map((level) => ({ level, path: `c/lod${level}.glb`, triangles: 10 })),
  sockets: {},
  animations: [],
  boneCount: 0,
};

describe('manifest albedoGain', () => {
  it('is optional and limited to the renderer range', () => {
    expect(assetEntrySchema.safeParse(entry).success).toBe(true);
    expect(assetEntrySchema.parse({ ...entry, albedoGain: 1.3 }).albedoGain).toBe(1.3);
    expect(albedoGainSchema.safeParse(ALBEDO_GAIN_RANGE[0] - 0.01).success).toBe(false);
    expect(albedoGainSchema.safeParse(ALBEDO_GAIN_RANGE[1] + 0.01).success).toBe(false);
  });

  it('can be configured per variant and per pack prop', () => {
    const variants = readSplitJson(`${srcDir}buildings/variants.json`) as {
      variants: Record<string, { albedoGain?: number }>;
    };
    const first = Object.keys(variants.variants)[0]!;
    variants.variants[first]!.albedoGain = 1.2;
    expect(parseVariants(variants).variants[first]!.albedoGain).toBe(1.2);
    variants.variants[first]!.albedoGain = 5;
    expect(() => parseVariants(variants)).toThrow();

    const packs = JSON.parse(readFileSync(`${srcDir}packs.json`, 'utf8'));
    const pack = Object.values(packs.sources)[0] as {
      props: Record<string, { albedoGain?: number }>;
    };
    Object.values(pack.props)[0]!.albedoGain = 1.4;
    expect(Object.values(parsePacksConfig(packs).sources)[0]!.props).toBeDefined();
    Object.values(pack.props)[0]!.albedoGain = 0.1;
    expect(() => parsePacksConfig(packs)).toThrow();
  });
});

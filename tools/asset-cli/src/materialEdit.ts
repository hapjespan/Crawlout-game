// A plainer variant of a textured character from the same source (rigmap `dropMaterials` and `recolor`): the parts that
// use a dropped material go, and a recoloured material gets its diffuse texture moved to a new mean colour. Runs before
// the atlas, which merges every material into one and ignores the colour factor of a textured material.
import type { Document } from '@gltf-transform/core';
import { loadSharp } from './textures.part1.js';

/** Removes every primitive whose material has one of these names; returns the number removed. */
export function dropMaterials(document: Document, names: readonly string[]): number {
  const materials = document.getRoot().listMaterials();
  const missing = names.filter((n) => !materials.some((m) => m.getName() === n));
  if (missing.length > 0) throw new Error(`dropMaterials: geen materiaal ${missing.join(', ')}`);
  const drop = new Set(names);
  let removed = 0;
  for (const mesh of document.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives())
      if (drop.has(prim.getMaterial()?.getName() ?? '')) {
        prim.dispose();
        removed++;
      }
  for (const m of materials) if (drop.has(m.getName())) m.dispose();
  return removed;
}

/**
 * Recolours the diffuse texture of each named material: every texel becomes `color` times its luminance relative to the
 * texture's mean luminance, with that relative variation scaled by `contrast` (default 1). The mean of the result is
 * `color`, the wear and folds of the source stay. The material gets a texture of its own, so a shared one is untouched.
 */
export async function recolorMaterials(
  document: Document,
  recolor: Record<string, { color: string; contrast?: number | undefined }>,
): Promise<void> {
  const sharp = await loadSharp();
  for (const [name, { color, contrast = 1 }] of Object.entries(recolor)) {
    const material = document
      .getRoot()
      .listMaterials()
      .find((m) => m.getName() === name);
    const texture = material?.getBaseColorTexture();
    const image = texture?.getImage();
    if (!material || !image)
      throw new Error(`recolor: geen materiaal "${name}" met een diffuse textuur`);
    const { data, info } = await sharp(Buffer.from(image))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const luma = (i: number): number =>
      0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += luma(i);
    const mean = Math.max(1, sum / (data.length / 4));
    const target = [1, 3, 5].map((k) => parseInt(color.slice(k, k + 2), 16));
    for (let i = 0; i < data.length; i += 4) {
      const l = Math.max(0, 1 + contrast * (luma(i) / mean - 1));
      for (let c = 0; c < 3; c++) data[i + c] = Math.min(255, Math.round(target[c]! * l));
    }
    const png = await sharp(data, { raw: info }).png().toBuffer();
    material.setBaseColorTexture(
      document
        .createTexture(`${name}_recolor`)
        .setMimeType('image/png')
        .setImage(new Uint8Array(png)),
    );
  }
}

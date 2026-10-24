// KTX2 (KHR_texture_basisu) voor de LOD-GLB's. Staat uit tot de render-buis compressed textures aankan; zie
// "Waarom dit uit staat" hieronder. De code blijft staan omdat de brief KTX2 onder Export noemt en de encoder er is.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Document } from '@gltf-transform/core';
import { KHRTextureBasisu } from '@gltf-transform/extensions';

/** Encoders die KTX2 kunnen schrijven, op volgorde van voorkeur. `basisu` vanaf 1.16 schrijft `.ktx2` met `-ktx2`. */
const ENCODERS = [
  { bin: 'toktx', version: ['--version'] },
  { bin: 'basisu', version: ['-version'] },
] as const;

export type Ktx2Encoder = { bin: string };

/**
 * Zoekt een KTX2-encoder op PATH. KTX2 is optioneel: is er geen, dan blijven textures zoals de LOD-stap ze liet
 * (WebP of PNG). `toktx` zit niet in Homebrew; `basis_universal` (de `basisu`-binary) wel.
 */
export function detectKtx2Encoder(): Ktx2Encoder | null {
  for (const encoder of ENCODERS) {
    try {
      execFileSync(encoder.bin, [...encoder.version], { stdio: 'ignore' });
      return { bin: encoder.bin };
    } catch {
      // volgende
    }
  }
  return null;
}

/** Argumenten per encoder: UASTC (hoge kwaliteit, 1 byte per texel) met mipmaps en zstd-supercompressie. */
function encodeArgs(bin: string, input: string, output: string, srgb: boolean): string[] {
  if (bin === 'basisu')
    return [
      '-ktx2',
      '-uastc',
      '-uastc_level',
      '2',
      '-ktx2_zstandard_level',
      '9',
      '-mipmap',
      ...(srgb ? [] : ['-linear']),
      '-output_file',
      output,
      input,
    ];
  return [
    '--t2',
    '--encode',
    'uastc',
    '--genmipmap',
    '--assign_oetf',
    srgb ? 'srgb' : 'linear',
    output,
    input,
  ];
}

/**
 * Zet alle PNG- en WebP-textures om naar KTX2 (UASTC) met de gevonden encoder. Normal maps en metallicRoughness gaan
 * expliciet als lineaire data mee: ETC1S op een normal map geeft banding en een scheve belichting, UASTC niet.
 *
 * **Waarom dit uit staat.** De render-buis bouwt van elke textuur een `DataArrayTexture` van RGBA8: `createLayerTexture`
 * rastert elk beeld met `imageRasterize` (WebGL2 of een 2D-canvas) naar texels. Een KTX2-textuur komt uit three's
 * GLTFLoader als een `CompressedTexture` met blokken in plaats van een `ImageBitmap`; `drawImage` en `texSubImage2D`
 * weigeren die, de laag valt terug op wit en het model is zijn textuur kwijt. KTX2 levert in deze opstelling
 * bovendien niets aan VRAM op (de array blijft RGBA8) en kost aan download juist méér dan WebP: UASTC is ongeveer
 * 1 byte per texel (1 MB voor 1024x1024) tegen 0,1 MB voor dezelfde kaart als WebP op kwaliteit 95.
 *
 * KTX2 wordt pas winst als de blokken ongecomprimeerd de GPU in gaan, dus als `CompressedArrayTexture` in plaats van
 * `DataArrayTexture`. Dat vraagt: KTX2Loader met de Basis-transcoder (wasm, ~250 kB, uit three/examples/jsm/libs),
 * `detectSupport(renderer)` per backend, en het verplaatsen van twee stappen die nu per texel in de loader gebeuren
 * naar de asset-cli (het inbakken van roughnessFactor/metallicFactor en de alfa van het teammasker).
 */
export function convertTexturesToKtx2(document: Document, encoder: string): number {
  const dir = mkdtempSync(join(tmpdir(), 'asset-cli-ktx2-'));
  let converted = 0;
  try {
    const root = document.getRoot();
    const linear = new Set(
      root
        .listMaterials()
        .flatMap((m) => [
          m.getNormalTexture(),
          m.getMetallicRoughnessTexture(),
          m.getOcclusionTexture(),
        ])
        .filter((t) => t !== null),
    );
    root.listTextures().forEach((texture, index) => {
      const image = texture.getImage();
      const mime = texture.getMimeType();
      if (!image || (mime !== 'image/png' && mime !== 'image/webp')) return;
      const input = join(dir, `t${index}.${mime === 'image/webp' ? 'webp' : 'png'}`);
      const output = join(dir, `t${index}.ktx2`);
      writeFileSync(input, image);
      execFileSync(encoder, encodeArgs(encoder, input, output, !linear.has(texture)), {
        stdio: 'pipe',
      });
      texture.setImage(new Uint8Array(readFileSync(output))).setMimeType('image/ktx2');
      converted += 1;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (converted > 0) document.createExtension(KHRTextureBasisu).setRequired(true);
  return converted;
}

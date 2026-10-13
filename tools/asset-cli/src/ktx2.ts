import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Document } from '@gltf-transform/core';
import { KHRTextureBasisu } from '@gltf-transform/extensions';

/** Zoekt toktx op PATH. KTX2 is optioneel: ontbreekt de binary, dan blijven textures PNG. */
export function detectToktx(): string | null {
  try {
    execFileSync('toktx', ['--version'], { stdio: 'ignore' });
    return 'toktx';
  } catch {
    return null;
  }
}

/**
 * Zet alle PNG-textures om naar KTX2 (UASTC) met toktx. Alleen aanroepen als detectToktx() iets gaf.
 * NB: in sprint 1 niet getest in CI (toktx ontbreekt daar); de PNG-route is de geteste.
 */
export function convertTexturesToKtx2(document: Document, toktx: string): number {
  const dir = mkdtempSync(join(tmpdir(), 'asset-cli-ktx2-'));
  let converted = 0;
  try {
    document.getRoot().listTextures().forEach((texture, index) => {
      const image = texture.getImage();
      if (!image || texture.getMimeType() !== 'image/png') return;
      const input = join(dir, `t${index}.png`);
      const output = join(dir, `t${index}.ktx2`);
      writeFileSync(input, image);
      execFileSync(toktx, ['--t2', '--encode', 'uastc', '--genmipmap', '--assign_oetf', 'srgb', output, input], { stdio: 'pipe' });
      texture.setImage(new Uint8Array(readFileSync(output))).setMimeType('image/ktx2');
      converted += 1;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (converted > 0) document.createExtension(KHRTextureBasisu).setRequired(true);
  return converted;
}

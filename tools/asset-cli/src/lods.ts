import { Logger, NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, reorder, simplify, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { BUDGETS } from './budgets.js';
import { countTriangles } from './inspect.js';
import { convertTexturesToKtx2 } from './ktx2.js';
import type { AssetKind } from './validate.js';

export function createIO(): NodeIO {
  return new NodeIO().setLogger(new Logger(Logger.Verbosity.WARN)).registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
}

export interface LodOutput {
  level: 0 | 1 | 2;
  glb: Uint8Array;
  triangles: number;
}

export interface BuildLodsOptions {
  /** Pad naar toktx als KTX2 beschikbaar is; anders blijven textures PNG. */
  toktx: string | null;
}

/** Plafond per LOD voor deze soort asset (brief voor karakters, eigen budgetten voor props). */
export function lodMaxTris(kind: AssetKind): readonly [number, number, number] {
  return kind === 'character' ? BUDGETS.characterMaxTris : BUDGETS.propMaxTris;
}

/** Triangle-doel per LOD voor een asset van `lod0Tris` driehoeken; nooit meer dan LOD0 zelf. */
export function lodTargets(kind: AssetKind, lod0Tris: number): [number, number, number] {
  if (kind === 'character') {
    const [, t1, t2] = BUDGETS.characterLodTargets;
    return [lod0Tris, Math.min(lod0Tris, t1), Math.min(lod0Tris, t2)];
  }
  const [, m1, m2] = BUDGETS.propMaxTris;
  return [lod0Tris, Math.min(lod0Tris, m1), Math.min(lod0Tris, m2)];
}

async function readFresh(source: Uint8Array): Promise<Document> {
  return createIO().readBinary(source);
}

/** Simplify tot het doel gehaald is; een paar passes met strakker ratio als meshopt er te weinig uit haalt. */
export async function simplifyToTarget(document: Document, target: number): Promise<void> {
  await MeshoptSimplifier.ready;
  const start = countTriangles(document);
  if (start <= target) return;
  let ratio = target / start;
  for (let pass = 0; pass < 6; pass++) {
    await document.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 1 }));
    const now = countTriangles(document);
    if (now <= target) return;
    ratio = Math.max(0.01, (ratio * target) / now) * 0.9;
  }
}

/** Bouwt LOD0..2 uit de bron-GLB, elk met meshopt-compressie (en KTX2 als toktx beschikbaar is). */
export async function buildLods(source: Uint8Array, kind: AssetKind, options: BuildLodsOptions): Promise<LodOutput[]> {
  await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const sourceTris = countTriangles(await readFresh(source));
  const targets = lodTargets(kind, sourceTris);
  const io = createIO();
  const outputs: LodOutput[] = [];

  for (const level of [0, 1, 2] as const) {
    const document = await readFresh(source);
    // De animaties zitten in de bone-matrix-texture; de LOD-GLB's zijn alleen mesh en skin.
    for (const animation of document.getRoot().listAnimations()) {
      for (const channel of animation.listChannels()) channel.dispose();
      for (const sampler of animation.listSamplers()) sampler.dispose();
      animation.dispose();
    }
    if (level > 0) await simplifyToTarget(document, targets[level]);
    await document.transform(dedup(), prune({ keepSolidTextures: true }), reorder({ encoder: MeshoptEncoder }));
    if (options.toktx) convertTexturesToKtx2(document, options.toktx);
    document.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
    outputs.push({ level, glb: await io.writeBinary(document), triangles: countTriangles(document) });
  }
  return outputs;
}

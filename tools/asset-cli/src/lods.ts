import { Logger, NodeIO, type Document, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, reorder, simplify, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { BUDGETS } from './budgets.js';
import { countTriangles } from './inspect.js';
import { convertTexturesToKtx2 } from './ktx2.js';
import type { AssetKind } from './validate.js';

export function createIO(): NodeIO {
  return new NodeIO()
    .setLogger(new Logger(Logger.Verbosity.WARN))
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
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

/**
 * Simplify tot het doel gehaald is; een paar passes met strakker ratio als meshopt er te weinig uit haalt.
 *
 * `simplify` werkt op de mesh zoals die er nu bij ligt, dus een vervolgpass rekent zijn ratio tegen het resultaat van de
 * vorige, niet tegen de bron. Een ratio die tegen de bron gerekend wordt, haalt er in pass twee veel te veel uit: een
 * bron van 94.000 driehoeken naar 4000 landde zo op 2145 in plaats van 3800, ver onder de ondergrens van de brief.
 */
export async function simplifyToTarget(document: Document, target: number): Promise<void> {
  await MeshoptSimplifier.ready;
  const start = countTriangles(document);
  if (start <= target) return;
  const original = snapshot(document);
  let ratio = target / start;
  for (let pass = 0; pass < 6; pass++) {
    await document.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 1 }));
    const now = countTriangles(document);
    if (now <= target) return;
    // De marge van 0,95 houdt rekening met meshopt dat per primitive naar beneden afrondt.
    ratio = Math.max(0.01, (target / now) * 0.95);
  }
  // Vastgelopen op attribuutnaden (bijvoorbeeld een atlas met veel UV-eilanden): terug naar de onvereenvoudigde mesh
  // (de herhaalde passes met foutgrens 1 hebben dan al hele delen, zoals een hoofd, weggevouwen) en in één pass over
  // naden heen ('Permissive', met uv en normaal als gewogen attributen), als laatste redmiddel simplifySloppy. Alleen
  // als het doel na de gewone passes niet gehaald is.
  restore(document, original);
  for (const mode of ['permissive', 'sloppy'] as const) {
    const now = countTriangles(document);
    if (now <= target) return;
    simplifyIndices(document, target / now, mode);
  }
}

/** Copies of every primitive's attribute arrays and indices, in document order. */
function snapshot(
  document: Document,
): { attributes: Map<string, ArrayLike<number>>; indices: ArrayLike<number> | null }[] {
  return document
    .getRoot()
    .listMeshes()
    .flatMap((m) => m.listPrimitives())
    .map((prim) => ({
      attributes: new Map(
        prim.listSemantics().map((s) => [s, prim.getAttribute(s)!.getArray()!.slice()] as const),
      ),
      indices: prim.getIndices()?.getArray()?.slice() ?? null,
    }));
}

/** Puts the arrays of `snapshot` back (weld may have merged vertices; the accessors keep their types). */
function restore(document: Document, saved: ReturnType<typeof snapshot>): void {
  const prims = document
    .getRoot()
    .listMeshes()
    .flatMap((m) => m.listPrimitives());
  prims.forEach((prim, i) => {
    const entry = saved[i];
    if (!entry) return;
    for (const [semantic, array] of entry.attributes)
      prim.getAttribute(semantic)?.setArray(array as Float32Array);
    if (entry.indices) prim.getIndices()?.setArray(entry.indices as Uint32Array);
  });
}

/** Reduceert de indexbuffer van elke primitive tot ongeveer `ratio`; vertices en attributen blijven ongewijzigd. */
function simplifyIndices(document: Document, ratio: number, mode: 'permissive' | 'sloppy'): void {
  for (const prim of document
    .getRoot()
    .listMeshes()
    .flatMap((m) => m.listPrimitives())) {
    const position = prim.getAttribute('POSITION');
    const idx = prim.getIndices();
    if (!position || !idx || prim.getMode() !== 4) continue;
    const positions = new Float32Array(position.getCount() * 3);
    const p = [0, 0, 0];
    for (let i = 0; i < position.getCount(); i++) positions.set(position.getElement(i, p), i * 3);
    const indices = new Uint32Array(idx.getCount());
    for (let i = 0; i < indices.length; i++) indices[i] = idx.getScalar(i);
    const targetCount = Math.max(3, Math.floor((indices.length * ratio) / 3) * 3);
    const [out] =
      mode === 'permissive'
        ? simplifyAcrossSeams(prim, indices, positions, targetCount)
        : MeshoptSimplifier.simplifySloppy(indices, positions, 3, null, targetCount, 1);
    if (out.length === 0 || out.length >= indices.length) continue;
    idx.setArray(position.getCount() > 65535 ? new Uint32Array(out) : new Uint16Array(out));
  }
}

/** Bouwt LOD0..2 uit de bron-GLB, elk met meshopt-compressie (en KTX2 als toktx beschikbaar is). */
export async function buildLods(
  source: Uint8Array,
  kind: AssetKind,
  options: BuildLodsOptions,
): Promise<LodOutput[]> {
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
    await document.transform(
      dedup(),
      // keepAttributes: prune gooit anders NORMAL weg bij unlit materialen (Sketchfab-unlit), en render heeft normalen nodig.
      prune({ keepSolidTextures: true, keepAttributes: true }),
      reorder({ encoder: MeshoptEncoder }),
    );
    if (options.toktx) convertTexturesToKtx2(document, options.toktx);
    document
      .createExtension(EXTMeshoptCompression)
      .setRequired(true)
      .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
    outputs.push({
      level,
      glb: await io.writeBinary(document),
      triangles: countTriangles(document),
    });
  }
  return outputs;
}

/** Permissive simplification (collapses across UV seams) with uv and normal as weighted attributes. */
function simplifyAcrossSeams(
  prim: Primitive,
  indices: Uint32Array,
  positions: Float32Array,
  targetCount: number,
): [Uint32Array, number] {
  const uv = prim.getAttribute('TEXCOORD_0');
  const normal = prim.getAttribute('NORMAL');
  const count = positions.length / 3;
  if (!uv && !normal)
    return MeshoptSimplifier.simplify(indices, positions, 3, targetCount, 1, ['Permissive']);
  const attributes = new Float32Array(count * 5);
  const t = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    if (uv) attributes.set(uv.getElement(i, t).slice(0, 2), i * 5);
    if (normal) attributes.set(normal.getElement(i, t).slice(0, 3), i * 5 + 2);
  }
  const weights = [
    uv ? 0.5 : 0,
    uv ? 0.5 : 0,
    normal ? 0.2 : 0,
    normal ? 0.2 : 0,
    normal ? 0.2 : 0,
  ];
  return MeshoptSimplifier.simplifyWithAttributes(
    indices,
    positions,
    3,
    attributes,
    5,
    weights,
    null,
    targetCount,
    1,
    ['Permissive'],
  );
}

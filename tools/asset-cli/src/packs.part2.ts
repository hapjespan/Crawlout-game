// Split from packs.ts to stay under the 5,000-token file limit; packs.ts re-exports the public surface.
// Holds: addMeshPrimitive, primitiveMesh, readPrimitive, writePrimitive, mergePrimitives, PropAlpha, +12 more.
import {
  Document,
  type Material,
  type Primitive,
  type Node,
  Logger,
  type Texture,
} from '@gltf-transform/core';
import {
  type Mesh,
  MeshAccumulator,
  simplifyMesh,
  triangleCount,
  compact,
  splitComponents,
  type Transform,
  transformMesh,
} from './geometry.js';
import { prune, dedup, reorder } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import { type AtlasInfo, buildAtlas } from './textures.js';
import { createIO } from './lods.js';
import { EXTTextureWebP, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { countTriangles } from './inspect.js';
import { baseCentre, extract, loadSharp, meshBounds, resolveProp } from './packs.part1.js';
import type { PackProp, PackSource, PacksConfig, SourceTexture } from './packs.part1.js';

// --- document, atlas en LOD's -------------------------------------------------------------------------------------

function addMeshPrimitive(document: Document, mesh: Mesh, material: Material) {
  const buffer = document.getRoot().listBuffers()[0] ?? document.createBuffer();
  const accessor = (type: 'VEC3' | 'VEC2' | 'SCALAR', array: Float32Array | Uint32Array) =>
    document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const primitive = document
    .createPrimitive()
    .setAttribute('POSITION', accessor('VEC3', mesh.positions))
    .setAttribute('NORMAL', accessor('VEC3', mesh.normals))
    .setIndices(accessor('SCALAR', mesh.indices))
    .setMaterial(material);
  if (mesh.uvs) primitive.setAttribute('TEXCOORD_0', accessor('VEC2', mesh.uvs));
  return primitive;
}

function primitiveMesh(primitive: Primitive): Mesh {
  const position = primitive.getAttribute('POSITION')!;
  const normal = primitive.getAttribute('NORMAL')!;
  const uv = primitive.getAttribute('TEXCOORD_0')!;
  const index = primitive.getIndices()!;
  const count = position.getCount();
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const tmp = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    positions.set(position.getElement(i, tmp), i * 3);
    normals.set(normal.getElement(i, tmp), i * 3);
    uvs.set(uv.getElement(i, tmp).slice(0, 2), i * 2);
  }
  const indices = new Uint32Array(index.getCount());
  for (let i = 0; i < indices.length; i++) indices[i] = index.getScalar(i);
  return { positions, normals, uvs, indices };
}

/** De enige primitive van een prop-document (na `mergePrimitives`) als Mesh. */
export function readPrimitive(document: Document): Mesh {
  return primitiveMesh(document.getRoot().listMeshes()[0]!.listPrimitives()[0]!);
}

function writePrimitive(document: Document, mesh: Mesh): void {
  const primitive = document.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
  primitive.getAttribute('POSITION')!.setArray(mesh.positions);
  primitive.getAttribute('NORMAL')!.setArray(mesh.normals);
  primitive.getAttribute('TEXCOORD_0')!.setArray(mesh.uvs!);
  primitive.getIndices()!.setArray(mesh.indices);
}

/** Na de atlas hebben alle primitives hetzelfde materiaal: voeg ze samen tot een, zodat een LOD een mesh heeft. */
async function mergePrimitives(document: Document): Promise<void> {
  const mesh = document.getRoot().listMeshes()[0]!;
  const primitives = mesh.listPrimitives();
  const material = primitives[0]!.getMaterial()!;
  const accumulator = new MeshAccumulator();
  for (const primitive of primitives) accumulator.add(primitiveMesh(primitive));
  for (const primitive of primitives) {
    mesh.removePrimitive(primitive);
    primitive.dispose();
  }
  mesh.addPrimitive(addMeshPrimitive(document, accumulator.build(), material));
  await document.transform(prune({ keepAttributes: true, keepSolidTextures: true }));
}

export interface PropAlpha {
  /** Aandeel driehoeken met een transparant materiaal. */
  triangleShare: number;
  /** Gemiddelde kleur (sRGB) van de dekkende texels van de transparante textures, gewogen naar driehoeken. */
  meanRgb: [number, number, number];
  /** Tint in graden en verzadiging van die kleur. */
  hue: number;
  saturation: number;
  /** 'leafy': groen of geelgroen blad of naalden; 'bare': bruin of grijs twijgwerk; 'none': geen transparant materiaal. */
  foliage: 'leafy' | 'bare' | 'none';
  cutoff: number;
}

function hueSaturation([r, g, b]: [number, number, number]): { hue: number; saturation: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let hue = 0;
  if (d > 0) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return { hue, saturation: max === 0 ? 0 : d / max };
}

/** Of de transparante delen blad (groen tot geelgroen, verzadigd) of twijgwerk (bruin, grijs) zijn. */
export function classifyFoliage(hue: number, saturation: number): 'leafy' | 'bare' {
  return hue >= 30 && hue <= 170 && saturation >= 0.3 ? 'leafy' : 'bare';
}

/**
 * Reduceert tot hooguit `target` driehoeken. Probeert eerst de flags uit de config, dan zonder `Prune` (dat bij een
 * krap budget een heel klein object kan weghalen) en over naden heen (`Permissive`), en neemt het resultaat dat het
 * doel het dichtst benadert zonder erover te gaan; lukt dat niet, dan een sloppy-reductie op alleen de posities.
 */
export function reduceMesh(mesh: Mesh, target: number, options: PacksConfig['simplify']): Mesh {
  const base = options.flags.filter((flag) => flag !== 'Prune' && flag !== 'Permissive');
  const attempts: PacksConfig['simplify']['flags'][] = [
    options.flags,
    [...base, 'Permissive'],
    [...base, 'Permissive', 'Prune'],
    [...base, 'Permissive', 'Sparse'],
  ];
  let best: Mesh | null = null;
  for (const flags of attempts) {
    const result = simplifyMesh(mesh, target, { ...options, flags });
    const tris = triangleCount(result);
    if (tris === 0 || tris > target) continue;
    if (!best || tris > triangleCount(best)) best = result;
    if (tris >= target * 0.9) break;
  }
  if (best) return best;
  const [indices] = MeshoptSimplifier.simplifySloppy(
    mesh.indices,
    mesh.positions,
    3,
    null,
    target * 3,
    1,
  );
  return compact(mesh, indices);
}

/** Een kaart (blad- of naaldkaart) heeft hooguit zoveel driehoeken; grotere samenhangende delen zijn stam, tak of grond. */
const CARD_MAX_TRIANGLES = 64;

/** Aandeel van het LOD-budget voor de stam; de rest gaat naar de kaarten. */
const BODY_SHARE = 0.4;

/** Hoeveel een overgebleven kaart groter wordt om het weggevallen blad te dekken. */
const CARD_GROWTH_MAX = 2.2;

/**
 * LOD voor bomen met bladkaarten. Gewone reductie laat op een klein budget de kaarten en dunne stam verdwijnen
 * (de boom wordt een stompje). Hier gaat 40 procent van het budget naar de stam (gereduceerd) en de rest naar de
 * grootste kaarten, die om hun midden groter worden naarmate er meer blad weggevallen is (tot 2,2 keer).
 */
export function reduceFoliageMesh(
  mesh: Mesh,
  target: number,
  options: PacksConfig['simplify'],
): Mesh {
  const parts = splitComponents(mesh, 0.01);
  const cards = parts.filter((p) => p.triangles <= CARD_MAX_TRIANGLES);
  const body = parts.filter((p) => p.triangles > CARD_MAX_TRIANGLES);
  if (cards.length < 3 || body.length === 0) return reduceMesh(mesh, target, options);
  const bodyTarget = Math.max(24, Math.round(target * BODY_SHARE));
  const merge = (list: Mesh[]): Mesh => {
    const accumulator = new MeshAccumulator();
    for (const item of list) accumulator.add(item);
    return accumulator.build();
  };
  const reducedBody = reduceMesh(merge(body.map((p) => p.mesh)), bodyTarget, options);
  const budget = target - triangleCount(reducedBody);
  const picked: typeof cards = [];
  let used = 0;
  for (const card of cards) {
    if (used + card.triangles > budget) continue;
    picked.push(card);
    used += card.triangles;
  }
  if (picked.length === 0) return reducedBody;
  const totalArea = cards.reduce((sum, c) => sum + c.area, 0);
  const pickedArea = picked.reduce((sum, c) => sum + c.area, 0);
  const growth = Math.min(CARD_GROWTH_MAX, Math.max(1, Math.sqrt(totalArea / pickedArea)));
  const grown = picked.map(({ mesh: card }) => {
    const centre = [0, 0, 0];
    const count = card.positions.length / 3;
    for (let i = 0; i < card.positions.length; i++) centre[i % 3]! += card.positions[i]! / count;
    const positions = card.positions.slice();
    for (let i = 0; i < positions.length; i++)
      positions[i] = centre[i % 3]! + (positions[i]! - centre[i % 3]!) * growth;
    return { ...card, positions };
  });
  return merge([reducedBody, ...grown]);
}

export interface Prepared {
  /** Atlas-document in meter, voet op y=0, bij het midden; LOD0 voor de simplify. */
  glb: Uint8Array;
  atlas: AtlasInfo;
  sourceTriangles: number;
  sourceHeightM: number;
  scale: number;
  alpha: PropAlpha;
  cutoff: number;
  doubleSided: boolean;
  materials: string[];
}

export async function prepareProp(
  config: PacksConfig,
  source: PackSource,
  unit: number,
  propNode: Node,
  prop: PackProp,
): Promise<Prepared> {
  const settings = resolveProp(config, prop);
  // Eerst op bron-eenheden (unit) om de ruwe maat te meten, dan de uniforme schaal naar de echte maat.
  const raw = extract(propNode, unit);
  const rawBox = meshBounds([...raw.groups.values()].map((g) => g.build()));
  const rawSize = [0, 1, 2].map((k) => rawBox.max[k]! - rawBox.min[k]!);
  if (!(rawSize[1]! > 0)) throw new Error('het prop heeft geen hoogte');
  let fit = 1;
  if (prop.heightM) fit = prop.heightM / rawSize[1]!;
  else if (prop.longestM) fit = prop.longestM / Math.max(...rawSize);
  const extracted = fit === 1 ? raw : extract(propNode, unit * fit);
  const meshes = new Map(
    [...extracted.groups].map(([material, group]) => [material, group.build()] as const),
  );
  const box = meshBounds(meshes.values());
  const [cx, cz] =
    settings.centre === 'base'
      ? baseCentre([...meshes.values()], box)
      : [(box.min[0] + box.max[0]) / 2, (box.min[2] + box.max[2]) / 2];
  const move: Transform = {
    m: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    n: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    t: [-cx, -box.min[1], -cz],
  };

  const document = new Document().setLogger(new Logger(Logger.Verbosity.WARN));
  document.createBuffer();
  const textures = new Map<SourceTexture, Texture>();
  const sceneMesh = document.createMesh(propNode.getName());
  let alphaTriangles = 0;
  let totalTriangles = 0;
  const colour = [0, 0, 0];
  let cutoff = 0.5;
  let doubleSided = false;
  const materialNames: string[] = [];
  for (const [material, mesh] of meshes) {
    const info = source.materials.get(material)!;
    if (!info.texture) throw new Error(`materiaal "${info.name}" heeft geen diffuse textuur`);
    if (info.factor.slice(0, 3).some((f) => Math.abs(f - 1) > 0.02))
      throw new Error(
        `materiaal "${info.name}" heeft een diffuse factor ${info.factor.join(', ')}; alleen 1 wordt ondersteund`,
      );
    let texture = textures.get(info.texture);
    if (!texture) {
      texture = document
        .createTexture(`${info.name}`)
        .setMimeType('image/png')
        .setImage(info.texture.image);
      textures.set(info.texture, texture);
    }
    const out = document
      .createMaterial(info.name)
      .setBaseColorTexture(texture)
      .setBaseColorFactor([1, 1, 1, 1]);
    out
      .getBaseColorTextureInfo()!
      .setWrapS(info.wrap[0] as 10497)
      .setWrapT(info.wrap[1] as 10497);
    materialNames.push(info.name);
    const triangles = triangleCount(mesh);
    totalTriangles += triangles;
    if (info.texture.hasAlpha) {
      alphaTriangles += triangles;
      for (let k = 0; k < 3; k++) colour[k]! += info.texture.opaqueMean[k]! * triangles;
      if (info.alphaMode === 'MASK') cutoff = info.cutoff;
    }
    if (info.doubleSided) doubleSided = true;
    sceneMesh.addPrimitive(addMeshPrimitive(document, transformMesh(mesh, move), out));
  }
  const meanRgb = (alphaTriangles > 0 ? colour.map((c) => c / alphaTriangles) : [0, 0, 0]) as [
    number,
    number,
    number,
  ];
  const { hue, saturation } = hueSaturation(meanRgb);
  const alpha: PropAlpha = {
    triangleShare: totalTriangles > 0 ? alphaTriangles / totalTriangles : 0,
    meanRgb: meanRgb.map((c) => Math.round(c * 10) / 10) as [number, number, number],
    hue: Math.round(hue),
    saturation: Math.round(saturation * 100) / 100,
    foliage: alphaTriangles === 0 ? 'none' : classifyFoliage(hue, saturation),
    cutoff,
  };

  const node = document.createNode(propNode.getName()).setMesh(sceneMesh);
  document.createScene('scene').addChild(node);
  const atlas = await buildAtlas(document, settings.atlas, { keepAlpha: alphaTriangles > 0 });
  await mergePrimitives(document);
  const material = document.getRoot().listMaterials()[0]!;
  if (alphaTriangles > 0) material.setAlphaMode('MASK').setAlphaCutoff(cutoff);
  material.setDoubleSided(doubleSided);
  document.getRoot().getAsset().copyright = config.attribution;
  return {
    glb: await createIO().writeBinary(document),
    atlas,
    sourceTriangles: extracted.sourceTriangles,
    sourceHeightM: rawSize[1]!,
    scale: unit * fit,
    alpha,
    cutoff,
    doubleSided,
    materials: [...new Set(materialNames)],
  };
}

export interface PropLod {
  level: 0 | 1 | 2;
  glb: Uint8Array;
  triangles: number;
  textureSize: number;
  textureBytes: number;
  textureFormat: 'jpeg' | 'webp';
  document: Document;
}

/** LOD `level` uit het atlas-document: simplify op het doel, atlas op de maat van de LOD, meshopt-compressie. */
export async function buildLod(
  config: PacksConfig,
  prepared: Prepared,
  level: 0 | 1 | 2,
  targets: readonly [number, number, number],
): Promise<PropLod> {
  await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready]);
  const io = createIO();
  const document = await io.readBinary(prepared.glb);
  const mesh = readPrimitive(document);
  const target = Math.min(targets[level], triangleCount(mesh));
  const reduce = prepared.alpha.foliage === 'leafy' && level > 0 ? reduceFoliageMesh : reduceMesh;
  const reduced = triangleCount(mesh) > target ? reduce(mesh, target, config.simplify) : mesh;
  // De reductie kan de onderste hoekpunten weghalen: elke LOD zet zijn eigen voet weer op y=0.
  let minY = Infinity;
  for (let i = 1; i < reduced.positions.length; i += 3)
    minY = Math.min(minY, reduced.positions[i]!);
  if (minY !== 0 && Number.isFinite(minY)) {
    reduced.positions = reduced.positions.slice();
    for (let i = 1; i < reduced.positions.length; i += 3)
      reduced.positions[i] = reduced.positions[i]! - minY;
  }
  writePrimitive(document, reduced);

  const texture = document.getRoot().listTextures()[0]!;
  const sharp = await loadSharp();
  const atlasSize = Math.max(64, prepared.atlas.size >> level);
  const resized = sharp(Buffer.from(texture.getImage()!)).resize(atlasSize, atlasSize, {
    fit: 'fill',
    kernel: 'lanczos3',
  });
  const transparent = prepared.alpha.foliage !== 'none';
  const encoded = transparent
    ? await resized
        .webp({ quality: config.textureQuality.webp, alphaQuality: 100, effort: 6 })
        .toBuffer()
    : await resized
        .removeAlpha()
        .jpeg({ quality: config.textureQuality.jpeg, mozjpeg: true })
        .toBuffer();
  texture.setImage(new Uint8Array(encoded)).setMimeType(transparent ? 'image/webp' : 'image/jpeg');
  if (transparent) document.createExtension(EXTTextureWebP).setRequired(true);

  await document.transform(
    dedup(),
    prune({ keepSolidTextures: true, keepAttributes: true }),
    reorder({ encoder: MeshoptEncoder }),
  );
  document
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  return {
    level,
    glb: await io.writeBinary(document),
    triangles: countTriangles(document),
    textureSize: atlasSize,
    textureBytes: encoded.length,
    textureFormat: transparent ? 'webp' : 'jpeg',
    document,
  };
}

// --- controles ----------------------------------------------------------------------------------------------------

export const HEIGHT_TOLERANCE_M = 0.02;

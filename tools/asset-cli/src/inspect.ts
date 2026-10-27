import { ImageUtils, type Document, type Node } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/functions';
import { BUDGETS } from './budgets.js';
import type { AssetAnimation, AssetBounds, AssetSockets, Vec3 } from './manifest.js';

/** Aantal driehoeken in alle meshes van het document (alleen TRIANGLES-primitives). */
export function countTriangles(document: Document): number {
  let total = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      const indices = prim.getIndices();
      const position = prim.getAttribute('POSITION');
      total += indices
        ? Math.floor(indices.getCount() / 3)
        : Math.floor((position?.getCount() ?? 0) / 3);
    }
  }
  return total;
}

export function maxBoneCount(document: Document): number {
  return document
    .getRoot()
    .listSkins()
    .reduce((max, skin) => Math.max(max, skin.listJoints().length), 0);
}

export function hasSkin(document: Document): boolean {
  return document.getRoot().listSkins().length > 0;
}

export function computeBounds(document: Document): AssetBounds {
  const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0];
  if (!scene) return { min: [0, 0, 0], max: [0, 0, 0] };
  const { min, max } = getBounds(scene);
  const round = (v: number[]): Vec3 => [round6(v[0] ?? 0), round6(v[1] ?? 0), round6(v[2] ?? 0)];
  return { min: round(min), max: round(max) };
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export interface TextureSize {
  name: string;
  width: number;
  height: number;
}

export function textureSizes(document: Document): TextureSize[] {
  const sizes: TextureSize[] = [];
  for (const texture of document.getRoot().listTextures()) {
    const image = texture.getImage();
    const size = image ? ImageUtils.getSize(image, texture.getMimeType()) : null;
    if (size)
      sizes.push({
        name: texture.getName() || texture.getURI() || '(naamloos)',
        width: size[0],
        height: size[1],
      });
  }
  return sizes;
}

export type MaterialMap = 'normal' | 'metallicRoughness' | 'occlusion' | 'emissive';

const MATERIAL_MAPS = ['normal', 'metallicRoughness', 'occlusion', 'emissive'] as const;

/** Welke PBR-kaarten naast de diffuse op de materialen staan (manifest `maps`), in vaste volgorde. */
export function materialMaps(document: Document): MaterialMap[] {
  const found = new Set<MaterialMap>();
  for (const material of document.getRoot().listMaterials()) {
    if (material.getNormalTexture()) found.add('normal');
    if (material.getMetallicRoughnessTexture()) found.add('metallicRoughness');
    if (material.getOcclusionTexture()) found.add('occlusion');
    if (material.getEmissiveTexture()) found.add('emissive');
  }
  return MATERIAL_MAPS.filter((m) => found.has(m));
}

/** Aantal TEXCOORD-sets dat in gebruik is (max over alle primitives). */
export function uvSetCount(document: Document): number {
  let max = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const sets = prim.listSemantics().filter((s) => s.startsWith('TEXCOORD_')).length;
      max = Math.max(max, sets);
    }
  }
  return max;
}

export function boneNames(document: Document): string[] {
  const names = new Set<string>();
  for (const skin of document.getRoot().listSkins())
    for (const joint of skin.listJoints()) names.add(joint.getName());
  return [...names];
}

const MIXAMO_PREFIX = /^mixamorig[:_]?/i;
export function stripMixamoPrefix(name: string): string {
  return name.replace(MIXAMO_PREFIX, '');
}

/** Ontbrekende kern-bones volgens de Mixamo-naamgeving (prefix `mixamorig:` is optioneel). */
export function missingMixamoBones(names: string[]): string[] {
  const present = new Set(names.map(stripMixamoPrefix));
  return BUDGETS.mixamoCoreBones.filter((bone) => !present.has(bone));
}

export function animationIndex(document: Document): AssetAnimation[] {
  return document
    .getRoot()
    .listAnimations()
    .map((animation, index) => {
      let duration = 0;
      for (const sampler of animation.listSamplers()) {
        const input = sampler.getInput();
        if (!input || input.getCount() === 0) continue;
        duration = Math.max(duration, input.getScalar(input.getCount() - 1));
      }
      return {
        name: animation.getName() || `animation_${index}`,
        durationSeconds: round6(duration),
      };
    });
}

function findJoint(document: Document, matchers: RegExp[]): Node | null {
  const nodes = document.getRoot().listNodes();
  for (const matcher of matchers) {
    const hit = nodes.find((node) => matcher.test(stripMixamoPrefix(node.getName())));
    if (hit) return hit;
  }
  return null;
}

/** Socketposities uit botnamen: eerst expliciete socket-bones, daarna de Mixamo-fallback. */
export function findSockets(document: Document): AssetSockets {
  const toVec = (node: Node | null): Vec3 | undefined => {
    if (!node) return undefined;
    const t = node.getWorldTranslation();
    return [round6(t[0]), round6(t[1]), round6(t[2])];
  };
  const hand = toVec(findJoint(document, [/socket[_-]?hand/i, /^RightHand$/]));
  // Same order as render's slot fallback (attachmentSockets.ts): a rig with one spine bone still gets a back socket.
  const back = toVec(
    findJoint(document, [/socket[_-]?(back|rug)/i, /^Spine2$/, /^Spine1$/, /^Spine$/]),
  );
  const head = toVec(findJoint(document, [/socket[_-]?head/i, /^Head$/]));
  const sockets: AssetSockets = {};
  if (hand) sockets.hand = hand;
  if (back) sockets.back = back;
  if (head) sockets.head = head;
  return sockets;
}

/**
 * Richting van het model langs Z: gemiddelde z van de zoolvertices (onderste 5 procent van de hoogte) min de z van de
 * enkel-bones (LeftFoot en RightFoot, rustpose). Positief = voeten wijzen naar +Z. `null` als het niet te bepalen is.
 */
export function facingZ(document: Document): number | null {
  const ankles = ['LeftFoot', 'RightFoot']
    .map((name) =>
      document
        .getRoot()
        .listNodes()
        .find((n) => stripMixamoPrefix(n.getName()) === name),
    )
    .filter((n): n is Node => n !== undefined);
  if (ankles.length === 0) return null;
  const ankleZ = ankles.reduce((sum, n) => sum + n.getWorldTranslation()[2]!, 0) / ankles.length;
  const { min, max } = computeBounds(document);
  const limit = min[1] + (max[1] - min[1]) * 0.05;
  let sum = 0;
  let count = 0;
  const p = [0, 0, 0];
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION');
      if (!position) continue;
      for (let i = 0; i < position.getCount(); i++) {
        position.getElement(i, p);
        const y = m[1]! * p[0]! + m[5]! * p[1]! + m[9]! * p[2]! + m[13]!;
        if (y > limit) continue;
        sum += m[2]! * p[0]! + m[6]! * p[1]! + m[10]! * p[2]! + m[14]!;
        count++;
      }
    }
  }
  return count === 0 ? null : sum / count - ankleZ;
}

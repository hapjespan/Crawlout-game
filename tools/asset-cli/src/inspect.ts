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
      total += indices ? Math.floor(indices.getCount() / 3) : Math.floor((position?.getCount() ?? 0) / 3);
    }
  }
  return total;
}

export function maxBoneCount(document: Document): number {
  return document.getRoot().listSkins().reduce((max, skin) => Math.max(max, skin.listJoints().length), 0);
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
    if (size) sizes.push({ name: texture.getName() || texture.getURI() || '(naamloos)', width: size[0], height: size[1] });
  }
  return sizes;
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
  for (const skin of document.getRoot().listSkins()) for (const joint of skin.listJoints()) names.add(joint.getName());
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
      return { name: animation.getName() || `animation_${index}`, durationSeconds: round6(duration) };
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
  const back = toVec(findJoint(document, [/socket[_-]?(back|rug)/i, /^Spine2$/, /^Spine1$/]));
  const head = toVec(findJoint(document, [/socket[_-]?head/i, /^Head$/]));
  const sockets: AssetSockets = {};
  if (hand) sockets.hand = hand;
  if (back) sockets.back = back;
  if (head) sockets.head = head;
  return sockets;
}

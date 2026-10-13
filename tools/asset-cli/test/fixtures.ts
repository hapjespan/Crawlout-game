// Synthetische GLB's voor tests; er zijn geen bronassets en er wordt niets gedownload.
import { Document, NodeIO } from '@gltf-transform/core';
import { deflateSync } from 'node:zlib';

const MIXAMO = [
  ['Hips', null, 0.95],
  ['Spine', 'Hips', 1.05],
  ['Spine1', 'Spine', 1.2],
  ['Spine2', 'Spine1', 1.35],
  ['Neck', 'Spine2', 1.5],
  ['Head', 'Neck', 1.65],
  ['LeftShoulder', 'Spine2', 1.4],
  ['LeftArm', 'LeftShoulder', 1.4],
  ['LeftForeArm', 'LeftArm', 1.15],
  ['LeftHand', 'LeftForeArm', 0.95],
  ['RightShoulder', 'Spine2', 1.4],
  ['RightArm', 'RightShoulder', 1.4],
  ['RightForeArm', 'RightArm', 1.15],
  ['RightHand', 'RightForeArm', 0.95],
  ['LeftUpLeg', 'Hips', 0.9],
  ['LeftLeg', 'LeftUpLeg', 0.5],
  ['LeftFoot', 'LeftLeg', 0.1],
  ['RightUpLeg', 'Hips', 0.9],
  ['RightLeg', 'RightUpLeg', 0.5],
  ['RightFoot', 'RightLeg', 0.1],
] as const;

/** Minimale geldige PNG van w x h (effen grijs); alleen voor kleine maten. */
export function makePng(width: number, height: number): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Uint8Array): number => {
    let c = 0xffffffff;
    for (const byte of buf) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, width);
  iv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  const raw = new Uint8Array((width * 3 + 1) * height).fill(128);
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** PNG met alleen een geldige header (IHDR) voor maten die te groot zijn om echt te genereren. */
export function makePngHeaderOnly(width: number, height: number): Uint8Array {
  const png = makePng(1, 1);
  const view = new DataView(png.buffer, png.byteOffset);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return png;
}

export interface HumanoidOptions {
  /** Aantal ringen en segmenten van de buis; tris = segments * rings * 2. */
  segments?: number;
  rings?: number;
  height?: number;
  footY?: number;
  extraBones?: number;
  boneNamePrefix?: string;
  textureSize?: number;
  secondUv?: boolean;
  withSockets?: boolean;
  clips?: string[];
  hugeTexture?: number;
}

export async function makeHumanoid(options: HumanoidOptions = {}): Promise<Uint8Array> {
  const { segments = 40, rings = 36, height = 1.8, footY = 0, extraBones = 0, boneNamePrefix = 'mixamorig:', withSockets = false, clips = ['idle', 'walk', 'run', 'attack1', 'attack2', 'gather', 'build', 'death'] } = options;
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('scene');
  const nodes = new Map<string, ReturnType<Document['createNode']>>();
  const joints: ReturnType<Document['createNode']>[] = [];

  const defs: readonly (readonly [string, string | null, number])[] = [...MIXAMO];
  const all = [...defs, ...Array.from({ length: extraBones }, (_, i) => [`Extra${i}`, 'Hips', 1] as const)];
  for (const [name, parent, y] of all) {
    const node = doc.createNode(`${boneNamePrefix}${name}`);
    const parentNode = parent ? nodes.get(parent) : undefined;
    const parentY = parent ? (all.find((d) => d[0] === parent)?.[2] ?? 0) : 0;
    node.setTranslation([name.startsWith('Left') ? 0.2 : name.startsWith('Right') ? -0.2 : 0, (y - parentY) * (height / 1.8) + (parent ? 0 : footY), 0]);
    if (parentNode) parentNode.addChild(node);
    else scene.addChild(node);
    nodes.set(name, node);
    joints.push(node);
  }
  if (withSockets) {
    for (const [name, parent] of [['socket_hand', 'RightHand'], ['socket_back', 'Spine2'], ['socket_head', 'Head']] as const) {
      const node = doc.createNode(name);
      nodes.get(parent)?.addChild(node);
      joints.push(node);
    }
  }

  // Buis van segments x rings, hoogte van footY tot footY + height.
  const vertexCount = segments * (rings + 1);
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const jointIds = new Uint16Array(vertexCount * 4);
  const weights = new Float32Array(vertexCount * 4);
  for (let r = 0; r <= rings; r++) {
    for (let s = 0; s < segments; s++) {
      const i = r * segments + s;
      const angle = (s / segments) * Math.PI * 2;
      const radius = 0.25 + 0.08 * Math.sin((r / rings) * Math.PI * 3);
      positions.set([Math.cos(angle) * radius, footY + (r / rings) * height, Math.sin(angle) * radius], i * 3);
      uvs.set([s / segments, r / rings], i * 2);
      jointIds[i * 4] = r < rings / 2 ? 0 : 3;
      weights[i * 4] = 1;
    }
  }
  const indices = new Uint16Array(segments * rings * 6);
  let k = 0;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * segments + s;
      const b = r * segments + ((s + 1) % segments);
      const c = a + segments;
      const d = b + segments;
      indices.set([a, b, c, b, d, c], k);
      k += 6;
    }
  }

  const accessor = (array: Float32Array | Uint16Array, type: 'VEC3' | 'VEC2' | 'VEC4' | 'SCALAR') => doc.createAccessor().setArray(array).setType(type).setBuffer(buffer);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', accessor(positions, 'VEC3'))
    .setAttribute('TEXCOORD_0', accessor(uvs, 'VEC2'))
    .setAttribute('JOINTS_0', accessor(jointIds, 'VEC4'))
    .setAttribute('WEIGHTS_0', accessor(weights, 'VEC4'))
    .setIndices(accessor(indices, 'SCALAR'));
  if (options.secondUv) prim.setAttribute('TEXCOORD_1', accessor(uvs, 'VEC2'));

  const texture = doc.createTexture('atlas').setMimeType('image/png');
  texture.setImage(options.hugeTexture ? makePngHeaderOnly(options.hugeTexture, options.hugeTexture) : makePng(options.textureSize ?? 16, options.textureSize ?? 16));
  prim.setMaterial(doc.createMaterial('mat').setBaseColorTexture(texture));

  const skin = doc.createSkin('skin');
  joints.forEach((j) => skin.addJoint(j));
  const meshNode = doc.createNode('body').setMesh(doc.createMesh('body').addPrimitive(prim)).setSkin(skin);
  scene.addChild(meshNode);

  for (const name of clips) {
    const animation = doc.createAnimation(name);
    const input = accessor(new Float32Array([0, 1, 2]), 'SCALAR');
    const output = accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]), 'VEC4');
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output);
    const channel = doc.createAnimationChannel().setTargetNode(nodes.get('Hips') as never).setTargetPath('rotation').setSampler(sampler);
    animation.addSampler(sampler).addChannel(channel);
  }
  return new NodeIO().writeBinary(doc);
}

/** Statische prop: een gesloten buis zonder skin. */
export async function makeProp(options: { segments?: number; rings?: number } = {}): Promise<Uint8Array> {
  const bytes = await makeHumanoid({ ...options, clips: [] });
  const io = new NodeIO();
  const doc = await io.readBinary(bytes);
  for (const skin of doc.getRoot().listSkins()) skin.dispose();
  for (const node of doc.getRoot().listNodes()) if (node.getMesh() === null) node.dispose();
  for (const prim of doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives())) {
    prim.setAttribute('JOINTS_0', null);
    prim.setAttribute('WEIGHTS_0', null);
  }
  return io.writeBinary(doc);
}

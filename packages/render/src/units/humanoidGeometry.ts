// Procedural low-poly humanoid in bind pose, rigid-skinned to the placeholder rig.
// Attributes match what an asset-cli GLB will carry: position, normal, skinIndex (vec4), skinWeight (vec4),
// plus color: linear RGB albedo with the team mask (0..1) in alpha, standing in for the diffuse atlas and its alpha.
// Hero parts (cap, collar, pauldrons) are in every placeholder unit but only drawn for a hero instance: their alpha is
// HERO_PART_ALPHA plus the team mask, and the unit material collapses them for everyone else (unitMaterial.ts).
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  IcosahedronGeometry,
  Matrix4,
} from 'three/webgpu';
import { BONE } from './rig.js';

export type UnitLod = 0 | 1 | 2;
export const UNIT_LODS: readonly UnitLod[] = [0, 1, 2];

type Shape = 'box' | 'limb' | 'ball';

interface Part {
  bone: number;
  shape: Shape;
  /** Size in meters: box w/h/d, limb radius/height, ball radius. */
  size: readonly [number, number, number];
  center: readonly [number, number, number];
  color: number; // sRGB hex
  team?: number; // 0..1
  minLod?: UnitLod; // part is dropped above this LOD
  heroOnly?: boolean; // only drawn on a hero (typeId 1000 + heroId)
}

/** Added to the color alpha of hero-only parts; the material reads alpha >= 1.5 as "hero part", team mask = alpha - 2. */
export const HERO_PART_ALPHA = 2;

const SKIN = 0xd9a47a;
const CLOTH = 0x8a8f9a; // tinted by team color through the mask
const PANTS = 0x4a4336;
const BOOTS = 0x2b2420;
const PACK = 0x6b5032;
const HAIR = 0x3a2a1c;
const HERO_TRIM = 0xe6dfcf; // light base, so the team tint reads strongly on the hero's cap, collar and pauldrons

const PARTS: readonly Part[] = [
  { bone: BONE.hips, shape: 'box', size: [0.34, 0.2, 0.21], center: [0, 0.93, 0], color: PANTS },
  {
    bone: BONE.chest,
    shape: 'box',
    size: [0.44, 0.42, 0.25],
    center: [0, 1.25, 0],
    color: CLOTH,
    team: 1,
  },
  {
    bone: BONE.chest,
    shape: 'box',
    size: [0.3, 0.34, 0.14],
    center: [0, 1.25, -0.19],
    color: PACK,
    minLod: 1,
  },
  { bone: BONE.head, shape: 'ball', size: [0.17, 0, 0], center: [0, 1.66, 0.01], color: SKIN },
  {
    bone: BONE.head,
    shape: 'box',
    size: [0.3, 0.09, 0.3],
    center: [0, 1.79, -0.01],
    color: HAIR,
    minLod: 1,
  },
  {
    bone: BONE.upperArmL,
    shape: 'limb',
    size: [0.065, 0.32, 0],
    center: [0.27, 1.26, 0],
    color: CLOTH,
    team: 1,
  },
  {
    bone: BONE.upperArmR,
    shape: 'limb',
    size: [0.065, 0.32, 0],
    center: [-0.27, 1.26, 0],
    color: CLOTH,
    team: 1,
  },
  {
    bone: BONE.foreArmL,
    shape: 'limb',
    size: [0.055, 0.3, 0],
    center: [0.27, 0.96, 0],
    color: SKIN,
  },
  {
    bone: BONE.foreArmR,
    shape: 'limb',
    size: [0.055, 0.3, 0],
    center: [-0.27, 0.96, 0],
    color: SKIN,
  },
  {
    bone: BONE.foreArmL,
    shape: 'box',
    size: [0.11, 0.12, 0.11],
    center: [0.27, 0.77, 0],
    color: SKIN,
    minLod: 1,
  },
  {
    bone: BONE.foreArmR,
    shape: 'box',
    size: [0.11, 0.12, 0.11],
    center: [-0.27, 0.77, 0],
    color: SKIN,
    minLod: 1,
  },
  {
    bone: BONE.thighL,
    shape: 'limb',
    size: [0.085, 0.46, 0],
    center: [0.1, 0.67, 0],
    color: PANTS,
  },
  {
    bone: BONE.thighR,
    shape: 'limb',
    size: [0.085, 0.46, 0],
    center: [-0.1, 0.67, 0],
    color: PANTS,
  },
  { bone: BONE.shinL, shape: 'limb', size: [0.07, 0.4, 0], center: [0.1, 0.25, 0], color: PANTS },
  { bone: BONE.shinR, shape: 'limb', size: [0.07, 0.4, 0], center: [-0.1, 0.25, 0], color: PANTS },
  {
    bone: BONE.shinL,
    shape: 'box',
    size: [0.14, 0.1, 0.25],
    center: [0.1, 0.05, 0.04],
    color: BOOTS,
    minLod: 1,
  },
  {
    bone: BONE.shinR,
    shape: 'box',
    size: [0.14, 0.1, 0.25],
    center: [-0.1, 0.05, 0.04],
    color: BOOTS,
    minLod: 1,
  },
  // Hero: an overseer's cap (the top-down camera sees it first), a collar and pauldrons, all in the team color.
  {
    bone: BONE.head,
    shape: 'limb',
    size: [0.25, 0.035, 0],
    center: [0, 1.8, 0.02],
    color: HERO_TRIM,
    team: 1,
    heroOnly: true,
  },
  {
    bone: BONE.head,
    shape: 'limb',
    size: [0.17, 0.15, 0],
    center: [0, 1.89, -0.01],
    color: HERO_TRIM,
    team: 1,
    heroOnly: true,
  },
  {
    bone: BONE.chest,
    shape: 'limb',
    size: [0.2, 0.08, 0],
    center: [0, 1.48, 0],
    color: HERO_TRIM,
    team: 1,
    heroOnly: true,
    minLod: 1,
  },
  {
    bone: BONE.upperArmL,
    shape: 'box',
    size: [0.17, 0.08, 0.22],
    center: [0.29, 1.43, 0],
    color: HERO_TRIM,
    team: 1,
    heroOnly: true,
    minLod: 1,
  },
  {
    bone: BONE.upperArmR,
    shape: 'box',
    size: [0.17, 0.08, 0.22],
    center: [-0.29, 1.43, 0],
    color: HERO_TRIM,
    team: 1,
    heroOnly: true,
    minLod: 1,
  },
];

function shapeGeometry(
  shape: Shape,
  size: readonly [number, number, number],
  lod: UnitLod,
): BufferGeometry {
  if (shape === 'box') return new BoxGeometry(size[0], size[1], size[2]);
  if (shape === 'ball') return new IcosahedronGeometry(size[0], 2 - lod);
  if (lod === 2) return new BoxGeometry(size[0] * 1.8, size[1], size[0] * 1.8);
  const radial = lod === 0 ? 8 : 5;
  return new CylinderGeometry(size[0], size[0] * 0.9, size[1], radial, 1);
}

/** Builds one merged, indexed geometry for the given LOD. LOD0 is the most detailed. */
export function createHumanoidGeometry(lod: UnitLod): BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const skinIndex: number[] = [];
  const skinWeight: number[] = [];
  const idx: number[] = [];
  const m = new Matrix4();
  const c = new Color();

  for (const part of PARTS) {
    if (part.minLod !== undefined && lod > part.minLod) continue;
    const g = shapeGeometry(part.shape, part.size, lod);
    g.applyMatrix4(m.makeTranslation(part.center[0], part.center[1], part.center[2]));
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const base = pos.length / 3;
    c.setHex(part.color); // converted to the linear working space
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.r, c.g, c.b, (part.team ?? 0) + (part.heroOnly ? HERO_PART_ALPHA : 0));
      skinIndex.push(part.bone, 0, 0, 0);
      skinWeight.push(1, 0, 0, 0);
    }
    const gi = g.getIndex();
    if (gi) for (let i = 0; i < gi.count; i++) idx.push(base + gi.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
    g.dispose();
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 4));
  // Float bone indices keep the vertex layout identical on the WebGPU and WebGL2 backends.
  geo.setAttribute('skinIndex', new BufferAttribute(new Float32Array(skinIndex), 4));
  geo.setAttribute('skinWeight', new BufferAttribute(new Float32Array(skinWeight), 4));
  const vertexCount = pos.length / 3;
  geo.setIndex(
    new BufferAttribute(vertexCount > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1),
  );
  geo.computeBoundingSphere();
  return geo;
}

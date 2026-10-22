// Placeholder geometry for buildings, scrap heaps and claim flags, until the asset-cli delivers real meshes.
// Buildings are modeled in footprint space: x and z in [-0.5, 0.5] (scaled by the footprint in meters), y in units of
// the wall height (scaled per instance), with a foundation down to y = -0.3 so slopes do not show a gap.
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  SphereGeometry,
} from 'three/webgpu';
import { BUILDING_ROOF_TOP } from '../entities/footprint.js';
import { MeshBuilder } from './meshBuilder.js';

const WALL = 0xb9ad96;
const TRIM = 0xe8e2d6; // team-tinted band
const ROOF = 0x7a4a32;
const DARK = 0x2a2522;
const GLASS = 0x3c4d55;
const METAL = 0x5f5d58;

/** Gable roof as a flat-shaded prism: ridge along x, from y = y0 up by `height`, overhanging the walls. */
function gableRoof(overhang: number, y0: number, height: number): BufferGeometry {
  const h = 0.5 + overhang;
  const top = y0 + height;
  // prettier-ignore
  const v = [
    // slope towards +z
    -h, y0, h,   h, y0, h,   h, top, 0,
    -h, y0, h,   h, top, 0,  -h, top, 0,
    // slope towards -z
    h, y0, -h,  -h, y0, -h,  -h, top, 0,
    h, y0, -h,  -h, top, 0,   h, top, 0,
    // gable ends
    h, y0, h,    h, y0, -h,   h, top, 0,
    -h, y0, -h, -h, y0, h,   -h, top, 0,
    // underside
    -h, y0, -h,  h, y0, -h,   h, y0, h,
    -h, y0, -h,  h, y0, h,   -h, y0, h,
  ];
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(v), 3));
  g.computeVertexNormals();
  return g;
}

/** LOD0: walls, trim band, roof, door, windows and a vent. LOD1: walls, band and roof. */
export function createBuildingGeometry(lod: 0 | 1): BufferGeometry {
  const b = new MeshBuilder()
    .add(new BoxGeometry(1, 1.3, 1), { color: WALL, position: [0, 0.35, 0] })
    .add(new BoxGeometry(1.02, 0.07, 1.02), { color: TRIM, team: 1, position: [0, 0.9, 0] })
    .add(gableRoof(0.05, 1, BUILDING_ROOF_TOP - 1), { color: ROOF });
  if (lod === 0) {
    b.add(new BoxGeometry(0.24, 0.42, 0.04), { color: DARK, position: [0, 0.21, 0.5] })
      .add(new BoxGeometry(0.28, 0.05, 0.05), { color: TRIM, team: 1, position: [0, 0.45, 0.51] })
      .add(new BoxGeometry(0.03, 0.14, 0.18), { color: GLASS, position: [0.5, 0.55, -0.15] })
      .add(new BoxGeometry(0.03, 0.14, 0.18), { color: GLASS, position: [-0.5, 0.55, 0.15] })
      .add(new BoxGeometry(0.16, 0.14, 0.03), { color: GLASS, position: [0.3, 0.55, 0.5] })
      .add(new BoxGeometry(0.16, 0.14, 0.03), { color: GLASS, position: [-0.25, 0.55, -0.5] })
      .add(new BoxGeometry(0.09, 0.32, 0.09), { color: METAL, position: [0.26, 1.2, -0.18] });
  }
  return b.build();
}

const TIMBER = 0x9a7a52;
const POLE = 0x6e6a62;
const TARP = 0xd8d2c4; // team-tinted site banner

/**
 * Scaffold around a building site, in the same footprint space as the building (x, z in [-0.5, 0.5], y in units of
 * the scaffold height): corner and middle standards, three rings of ledgers, cross braces on the long sides, a
 * plank deck on top and a team-colored banner on the front. Thin members, so it reads as a frame at any size.
 */
export function createScaffoldGeometry(): BufferGeometry {
  const b = new MeshBuilder();
  const t = 0.022; // member thickness in footprint space
  for (const x of [-0.5, 0, 0.5]) {
    for (const z of [-0.5, 0.5])
      b.add(new BoxGeometry(t, 1, t), { color: POLE, position: [x, 0.5, z] });
  }
  b.add(new BoxGeometry(t, 1, t), { color: POLE, position: [-0.5, 0.5, 0] }).add(
    new BoxGeometry(t, 1, t),
    { color: POLE, position: [0.5, 0.5, 0] },
  );
  for (const y of [0.34, 0.67, 0.99]) {
    b.add(new BoxGeometry(1 + t, t, t), { color: TIMBER, position: [0, y, 0.5] })
      .add(new BoxGeometry(1 + t, t, t), { color: TIMBER, position: [0, y, -0.5] })
      .add(new BoxGeometry(t, t, 1 + t), { color: TIMBER, position: [0.5, y, 0] })
      .add(new BoxGeometry(t, t, 1 + t), { color: TIMBER, position: [-0.5, y, 0] });
  }
  const brace = Math.hypot(0.5, 0.33);
  const angle = Math.atan2(0.33, 0.5);
  for (const z of [-0.5, 0.5]) {
    for (const [x, y, dir] of [
      [-0.25, 0.17, 1],
      [0.25, 0.5, -1],
      [-0.25, 0.83, 1],
    ] as const) {
      b.add(new BoxGeometry(brace, t * 0.8, t * 0.8), {
        color: TIMBER,
        position: [x, y, z],
        rotation: [0, 0, angle * dir],
      });
    }
  }
  b.add(new BoxGeometry(1.04, t, 0.16), { color: TIMBER, position: [0, 1, 0.43] })
    .add(new BoxGeometry(1.04, t, 0.16), { color: TIMBER, position: [0, 1, -0.43] })
    .add(new BoxGeometry(0.42, 0.2, 0.01), { color: TARP, team: 1, position: [0.18, 0.78, 0.515] });
  return b.build();
}

/** Deterministic pseudo-random sequence for the heap layout. */
function seq(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Scrap heap, about 2.6 m across and 1.2 m high, in meters. */
export function createScrapHeapGeometry(): BufferGeometry {
  const rnd = seq(0x5c4a9);
  const b = new MeshBuilder().add(new IcosahedronGeometry(1.15, 1), {
    color: 0x5e3b25,
    scale: [1, 0.42, 1],
    position: [0, 0.05, 0],
  });
  const colors = [0x8a4b2a, 0x9c6a3a, 0x6f6a60, 0x7d3f22, 0x4a4a46];
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 0.25 + rnd() * 0.75;
    b.add(new BoxGeometry(0.3 + rnd() * 0.6, 0.06 + rnd() * 0.1, 0.2 + rnd() * 0.4), {
      color: colors[i % colors.length]!,
      position: [Math.cos(a) * r, 0.3 + rnd() * 0.35 - r * 0.2, Math.sin(a) * r],
      rotation: [rnd() * 1.2 - 0.6, rnd() * Math.PI, rnd() * 1.2 - 0.6],
    });
  }
  b.add(new CylinderGeometry(0.2, 0.2, 0.55, 8), {
    color: 0x7a2f1f,
    position: [0.75, 0.3, -0.4],
    rotation: [0.3, 0, 1.1],
  });
  b.add(new BoxGeometry(1.1, 0.07, 0.07), {
    color: 0x4a4a46,
    position: [-0.3, 0.55, 0.2],
    rotation: [0, 0.7, 0.35],
  });
  return b.build();
}

/** Flag length along +x, meters; the material waves the team-masked flag vertices. */
export const FLAG_LENGTH = 1.3;
export const POLE_HEIGHT = 4.2;

/** Claim marker: concrete base, pole, team-colored flag (team mask 1), in meters. */
export function createClaimGeometry(): BufferGeometry {
  return new MeshBuilder()
    .add(new CylinderGeometry(0.42, 0.5, 0.35, 10), { color: 0x8c8577, position: [0, 0.1, 0] })
    .add(new CylinderGeometry(0.055, 0.07, POLE_HEIGHT, 8), {
      color: 0x5b5b58,
      position: [0, POLE_HEIGHT / 2, 0],
    })
    .add(new SphereGeometry(0.1, 8, 6), { color: 0xc9b26a, position: [0, POLE_HEIGHT + 0.05, 0] })
    .add(new BoxGeometry(FLAG_LENGTH, 0.8, 0.035, 8, 1, 1), {
      color: 0xffffff,
      team: 1,
      position: [0.06 + FLAG_LENGTH / 2, POLE_HEIGHT - 0.45, 0],
    })
    .build();
}

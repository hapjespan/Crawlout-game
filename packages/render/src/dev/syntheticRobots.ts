// Synthetic robots for the render demo (?robots) and the tests, until the asset side delivers real ones: a security
// robot (2.2 m), a repair drone (0.8 m, floats 1.35 m above the ground) and a siege sentinel (3.5 m). Built from
// primitives in the layout of a rigid unit (position, normal, color with the team mask in alpha), three LODs each,
// the lowest point on y = 0 and the model facing +Z. They stand in for manifest assets: same RigidUnitSource, same layer.
import {
  BoxGeometry,
  CylinderGeometry,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
} from 'three/webgpu';
import { MeshBuilder } from '../structures/meshBuilder.js';
import type { RigidUnitSource } from '../units/rigidUnitLayer.js';

/** Unit typeIds of the synthetic robots: in the unit range, above every loadout and below the heroes (1000+). */
export const SYNTHETIC_ROBOT_TYPE_IDS = { guard: 900, drone: 901, sentinel: 902 } as const;

export interface SyntheticRobot {
  typeId: number;
  source: RigidUnitSource;
}

const STEEL = 0x6f7378;
const DARK = 0x3a3d42;
const PLATE = 0x8a8f95;
const VISOR = 0xe8b43a;

/** Segments of the round parts per LOD. */
const SEGMENTS = [16, 10, 6] as const;

type Lod = 0 | 1 | 2;

function box(w: number, h: number, d: number): BufferGeometry {
  return new BoxGeometry(w, h, d);
}

function cylinder(rTop: number, rBottom: number, h: number, lod: Lod): BufferGeometry {
  return new CylinderGeometry(rTop, rBottom, h, SEGMENTS[lod]);
}

function sphere(r: number, lod: Lod): BufferGeometry {
  return new SphereGeometry(r, SEGMENTS[lod], Math.max(4, SEGMENTS[lod] >> 1));
}

/** Security robot: two legs, a broad torso with a team-colored chest plate, a visor head, a baton arm and a shield arm. */
function guard(lod: Lod): BufferGeometry {
  const b = new MeshBuilder();
  for (const side of [-1, 1]) {
    b.add(box(0.26, 0.95, 0.3), { color: DARK, position: [side * 0.2, 0.475, 0] });
    b.add(box(0.3, 0.12, 0.46), { color: STEEL, position: [side * 0.2, 0.06, 0.06] });
  }
  b.add(box(0.8, 0.28, 0.46), { color: STEEL, position: [0, 1.05, 0] });
  b.add(box(0.95, 0.7, 0.55), { color: STEEL, position: [0, 1.5, 0] });
  b.add(box(0.6, 0.42, 0.06), { color: PLATE, team: 1, position: [0, 1.52, 0.3] });
  b.add(box(0.36, 0.3, 0.36), { color: DARK, position: [0, 2.0, 0] });
  b.add(box(0.28, 0.07, 0.04), { color: VISOR, position: [0, 2.02, 0.19] });
  if (lod < 2) {
    for (const side of [-1, 1]) {
      b.add(box(0.2, 0.62, 0.22), { color: DARK, position: [side * 0.58, 1.5, 0] });
      b.add(box(0.3, 0.16, 0.4), { color: PLATE, team: 1, position: [side * 0.58, 1.84, 0] });
    }
  }
  if (lod < 1)
    b.add(cylinder(0.04, 0.04, 0.9, lod), {
      color: DARK,
      position: [0.58, 1.1, 0.4],
      rotation: [Math.PI / 2, 0, 0],
    });
  return b.build();
}

/** Repair drone: a flattened body, four rotor rings on arms, a team-colored cap and a lens underneath. Bottom on y = 0. */
function drone(lod: Lod): BufferGeometry {
  const b = new MeshBuilder();
  b.add(sphere(0.26, lod), { color: STEEL, position: [0, 0.38, 0], scale: [1, 0.7, 1] });
  b.add(sphere(0.2, lod), { color: PLATE, team: 1, position: [0, 0.5, 0], scale: [1, 0.55, 1] });
  b.add(sphere(0.09, lod), { color: VISOR, position: [0, 0.16, 0.12] });
  b.add(cylinder(0.08, 0.1, 0.12, lod), { color: DARK, position: [0, 0.1, 0] });
  for (const [sx, sz] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ] as const) {
    if (lod < 2)
      b.add(box(0.34, 0.04, 0.04), {
        color: DARK,
        position: [sx * 0.2, 0.5, sz * 0.2],
        rotation: [0, sx * sz * Math.PI * 0.25, 0],
      });
    b.add(new TorusGeometry(0.15, 0.02, 4, SEGMENTS[lod]), {
      color: DARK,
      position: [sx * 0.33, 0.56, sz * 0.33],
      rotation: [Math.PI / 2, 0, 0],
    });
  }
  return b.build();
}

/** Sentinel: a wide armored base on four feet, a tall hull with team panels and a long siege barrel along +Z. */
function sentinel(lod: Lod): BufferGeometry {
  const b = new MeshBuilder();
  for (const [sx, sz] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ] as const) {
    b.add(box(0.5, 0.9, 0.5), { color: DARK, position: [sx * 0.85, 0.45, sz * 0.9] });
    b.add(box(0.7, 0.14, 0.8), { color: STEEL, position: [sx * 0.85, 0.07, sz * 0.9] });
  }
  b.add(box(2.1, 0.6, 2.2), { color: STEEL, position: [0, 1.15, 0] });
  b.add(box(1.7, 1.2, 1.5), { color: STEEL, position: [0, 2.05, -0.1] });
  b.add(box(1.5, 0.8, 0.08), { color: PLATE, team: 1, position: [0, 2.0, 0.68] });
  b.add(cylinder(0.3, 0.3, 0.55, lod), { color: DARK, position: [0, 2.9, -0.1] });
  b.add(sphere(0.34, lod), { color: PLATE, team: 1, position: [0, 3.2, -0.1] });
  b.add(cylinder(0.12, 0.16, 2.0, lod), {
    color: DARK,
    position: [0, 2.4, 1.55],
    rotation: [Math.PI / 2, 0, 0],
  });
  if (lod < 2) b.add(box(0.5, 0.5, 0.7), { color: STEEL, position: [0, 2.4, 0.8] });
  return b.build();
}

/**
 * The robot at its real height: LOD 0 sets the factor, every LOD is scaled by it and lowered onto y = 0, and the
 * width is the larger horizontal extent of LOD 0.
 */
function build(
  name: string,
  make: (lod: Lod) => BufferGeometry,
  height: number,
  hover: number,
): RigidUnitSource {
  const lods = [make(0), make(1), make(2)];
  lods[0]!.computeBoundingBox();
  const box0 = lods[0]!.boundingBox!;
  const factor = height / (box0.max.y - box0.min.y);
  for (const g of lods) {
    g.scale(factor, factor, factor);
    g.computeBoundingBox();
    g.translate(0, -g.boundingBox!.min.y, 0);
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }
  const b = lods[0]!.boundingBox!;
  return {
    name,
    lods: lods as unknown as RigidUnitSource['lods'],
    height,
    width: Math.max(b.max.x - b.min.x, b.max.z - b.min.z),
    hover,
  };
}

/** The three synthetic robots with the typeIds they are drawn for. */
export function syntheticRobots(): SyntheticRobot[] {
  return [
    {
      typeId: SYNTHETIC_ROBOT_TYPE_IDS.guard,
      source: build('synthetic_guard', guard, 2.2, 0),
    },
    {
      typeId: SYNTHETIC_ROBOT_TYPE_IDS.drone,
      source: build('synthetic_drone', drone, 0.8, 1.35),
    },
    {
      typeId: SYNTHETIC_ROBOT_TYPE_IDS.sentinel,
      source: build('synthetic_sentinel', sentinel, 3.5, 0),
    },
  ];
}

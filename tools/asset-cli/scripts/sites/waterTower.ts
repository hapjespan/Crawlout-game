// site_water_tower_ruin / site_water_tower_restored (footprint 7 x 7, about 18 m): four lattice legs with cross braces, a
// deck, the tank on top, a ladder along the +z face. The ruin keeps the legs and the silhouette but the tank is dented
// and leans, a brace has broken loose, the ladder lacks rungs and the footings are cracked.
import { Frame, rubble, type Part, type V3 } from './builder.js';

const BASE = 3.05; // leg axis at the ground, metres from the centre
const TOP = 2.3; // leg axis at the deck
const DECK_Y = 12.4;
const SIDES = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;

/** The axis of a leg (sx, sz) at height y. */
function legAt(sx: number, sz: number, y: number): V3 {
  const r = BASE + ((TOP - BASE) * y) / DECK_Y;
  return [sx * r, y, sz * r];
}

export function waterTower(ruin: boolean): Part[] {
  const parts: Part[] = [];
  const f = new Frame(parts);
  const leg = ruin ? 'rust_metal' : 'metal';
  const brace = ruin ? 'rust_dark' : 'metal_dark';
  const footing = ruin ? 'concrete_ruin' : 'concrete';
  const tankMetal = ruin ? 'rust_metal' : 'metal_light';

  // Footings: 0.9 m blocks under the legs; in the ruin one is cracked and tilted, with chunks beside it.
  for (const [sx, sz] of SIDES) {
    const c: V3 = [sx * BASE, 0, sz * BASE];
    if (ruin && sx === 1 && sz === 1) {
      f.tilted(footing, [0.9, 0.5, 0.9], [c[0], 0.25, c[2]], [0, 12, 7], {}, 0);
      f.tilted(
        'concrete_dark',
        [0.45, 0.3, 0.4],
        [c[0] - 0.1, 0, c[2] - 0.95],
        [10, 40, 20],
        { lod: 1 },
        0,
      );
    } else
      f.box(footing, [c[0] - 0.45, 0, c[2] - 0.45], [c[0] + 0.45, 0.5, c[2] + 0.45], {
        open: true,
      });
  }
  if (ruin)
    rubble(f, ['concrete_dark', 'rust_dark'], [2.3, 1.9], [1, 0.9], 6, 7, { all: 1, mid: 2 }, 0.8);

  // Legs: two rails per leg with a zigzag between them (the lattice); a single heavy tube stands in on LOD2.
  for (const [sx, sz] of SIDES) {
    const o: V3 = [-sz * 0.155, 0, sx * 0.155];
    const rail = (side: 1 | -1, y: number): V3 => {
      const p = legAt(sx, sz, y);
      return [p[0] + o[0] * side, y, p[2] + o[2] * side];
    };
    f.tube(leg, [rail(1, 0.5), rail(1, DECK_Y)], 0.09, 3, { lod: 1 });
    f.tube(leg, [rail(-1, 0.5), rail(-1, DECK_Y)], 0.09, 3, { lod: 1 });
    const bays = ruin && sx === 1 && sz === -1 ? 7 : 11;
    const zig: V3[] = [];
    for (let i = 0; i <= bays; i++) {
      const y = 0.5 + ((DECK_Y - 0.5) * i) / 11;
      zig.push(rail(i % 2 === 0 ? 1 : -1, y));
    }
    f.tube(brace, zig, 0.035, 3, { lod: 0 });
    f.tube(leg, [legAt(sx, sz, 0.5), legAt(sx, sz, DECK_Y)], 0.2, 3, { min: 2 });
    // A collar at the foot: hazard yellow in the restored tower.
    f.box(
      ruin ? 'rust_dark' : 'metal_hazard',
      [sx * BASE - 0.3, 0.5, sz * BASE - 0.3],
      [sx * BASE + 0.3, 1.2, sz * BASE + 0.3],
      {
        lod: 0,
      },
    );
  }

  // Ring beams and the X braces on the four faces, three bays between y 0.8, 4.4, 8.4 and the deck.
  const levels = [0.8, 4.4, 8.4, DECK_Y];
  for (const y of levels)
    for (let k = 0; k < 4; k++) {
      const [ax, az] = SIDES[k]!;
      const [bx, bz] = SIDES[(k + 1) % 4]!;
      const broken = ruin && y === 8.4 && ax === 1 && bx === 1; // the +x ring beam at the top bay is bent down
      const a = legAt(ax, az, y);
      const b = legAt(bx, bz, y);
      if (broken) {
        const mid: V3 = [(a[0] + b[0]) / 2 + 0.1, y - 0.55, (a[2] + b[2]) / 2];
        f.tube(brace, [a, mid], 0.07, 3);
        f.tube(brace, [mid, [b[0], y - 1.6, b[2]]], 0.07, 3, { lod: 1 });
      } else f.tube(brace, [a, b], 0.07, 3, { lod: 1 });
    }
  for (let bay = 0; bay < 3; bay++) {
    const y0 = levels[bay]!;
    const y1 = levels[bay + 1]!;
    for (let k = 0; k < 4; k++) {
      const [ax, az] = SIDES[k]!;
      const [bx, bz] = SIDES[(k + 1) % 4]!;
      const lowA = legAt(ax, az, y0);
      const highA = legAt(ax, az, y1);
      const lowB = legAt(bx, bz, y0);
      const highB = legAt(bx, bz, y1);
      // The broken brace: face +x, middle bay: one diagonal is gone, the other hangs from its top corner.
      const brokenFace = ruin && bay === 1 && ax === 1 && bx === 1;
      if (brokenFace) {
        const swing: V3 = [
          highA[0] + 0.35,
          highA[1] - 2.4,
          highA[2] + 1.0 + (highB[2] - highA[2]) * 0.15,
        ];
        f.tube(brace, [highA, swing], 0.055, 3, { lod: 1 });
        continue;
      }
      f.tube(brace, [lowA, highB], 0.055, 3, { lod: 1 });
      f.tube(brace, [lowB, highA], 0.055, 3, { lod: 1 });
    }
  }

  // Deck at the top of the legs.
  f.box(ruin ? 'rust_dark' : 'metal_dark', [-2.75, DECK_Y, -2.75], [2.75, DECK_Y + 0.25, 2.75]);

  // Ladder up the +z face (rails parallel to the splayed face), rungs every 0.45 m on LOD0.
  const zFace = (y: number): number => BASE + ((TOP - BASE) * y) / DECK_Y + 0.32;
  const ladderBottom = ruin ? 2.2 : 0.4;
  for (const x of [-0.28, 0.28])
    f.tube(
      leg,
      [
        [x, ladderBottom, zFace(ladderBottom)],
        [x, DECK_Y + 0.25, zFace(DECK_Y + 0.25)],
        [x, DECK_Y + 1.1, 3.15],
      ],
      0.04,
      3,
      {
        lod: 1,
      },
    );
  for (let i = 0, y = ladderBottom + 0.3; y < DECK_Y; i++, y += 0.45) {
    if (ruin && i % 5 === 3) continue; // missing rungs
    f.box(brace, [-0.3, y, zFace(y) - 0.025], [0.3, y + 0.04, zFace(y) + 0.025], { lod: 0 });
  }

  // The tank. In the ruin everything on it leans 7 degrees about the middle of the deck and the wall is dented.
  const pivot: V3 = [0, DECK_Y + 0.25, 0];
  const tank = ruin ? f.turned([0, 0, 7], pivot, pivot) : f;
  const up = (y: number): V3 => [0, DECK_Y + 0.25 + y, 0];
  // The round parts of the tank in three levels of detail: 16, 12 and 8 segments.
  const rounds = (build: (segments: number, o: { lod?: 0 | 1 | 2; min?: 1 | 2 }) => void): void => {
    build(16, { lod: 0 });
    build(12, { min: 1, lod: 1 });
    build(8, { min: 2 });
  };
  rounds((n, o) => tank.cyl(tankMetal, 1.6, 0.95, up(0), n, { ...o, radiusTop: 2.9 }));
  if (ruin) {
    // Dented wall: a polygon with the +z side pushed in (a 0.9 m dent), so the tank reads as crushed on the camera side.
    const radiusAt = (a: number): number => {
      const d = Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2)));
      return 2.9 - 0.9 * Math.exp(-((d / 0.55) ** 2));
    };
    const dented = (n: number): [number, number][] =>
      Array.from({ length: n }, (_, i): [number, number] => {
        const a = (i / n) * Math.PI * 2;
        return [Math.cos(a) * radiusAt(a), Math.sin(a) * radiusAt(a)];
      });
    // The wall surface at x on the +z side, for patches that must sit on it.
    const surfaceZ = (x: number): number => {
      for (let z = 3; z > 0; z -= 0.01)
        if (Math.hypot(x, z) <= radiusAt(Math.atan2(z, x))) return z;
      return 0;
    };
    rounds((n, o) => tank.prism('rust_metal', 'y', dented(n), 3.45, up(0.95), o));
    const hole = surfaceZ(0);
    tank.box('opening', [-0.5, up(2.2)[1], hole - 0.1], [0.5, up(2.2)[1] + 0.8, hole + 0.06], {
      lod: 1,
    });
    // Peeled plates hanging beside the dent.
    tank.box(
      'rust_dark',
      [0.7, up(1.5)[1], surfaceZ(1.1) - 0.05],
      [1.5, up(2.3)[1], surfaceZ(1.1) + 0.1],
      { lod: 0 },
    );
    tank.box(
      'rust_dark',
      [-1.5, up(1.2)[1], surfaceZ(-1.1) - 0.05],
      [-0.8, up(1.8)[1], surfaceZ(-1.1) + 0.1],
      { lod: 0 },
    );
    rounds((n, o) => tank.cone('rust_roof', 2.95, 1.1, up(4.4), n, o));
  } else {
    rounds((n, o) => tank.cyl(tankMetal, 2.9, 3.45, up(0.95), n, o));
    // Team band around the tank.
    rounds((n, o) =>
      tank.cyl('team_trim', 2.95, 0.75, up(1.6), n, {
        ...o,
        open: true,
        ...(o.min === 2 ? { lod: 2 } : {}),
      }),
    );
    rounds((n, o) => tank.cone('metal', 2.95, 1.1, up(4.4), n, o));
  }
  // Walkway disc around the tank belly with a rail, a vent cap and a beacon on top.
  tank.cyl(ruin ? 'rust_dark' : 'metal_dark', 3.3, 0.1, up(0.8), 12, { lod: 1 });
  const ring: V3[] = Array.from({ length: 13 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    return [Math.cos(a) * 3.3, DECK_Y + 0.25 + 1.75, Math.sin(a) * 3.3] as V3;
  });
  if (ruin) ring.splice(7, 5); // part of the rail is gone
  tank.tube(ruin ? 'rust_dark' : 'metal_dark', ring, 0.035, 3, { lod: 0 });
  tank.cyl(ruin ? 'rust_dark' : 'metal_dark', 0.28, 0.5, up(5.4), 6, { lod: 0 });
  if (!ruin) tank.sphere('lens_amber', 0.18, up(6.05), 6, 2, { lod: 1 });
  return parts;
}

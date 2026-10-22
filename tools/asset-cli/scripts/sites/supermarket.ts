// site_supermarket_ruin / site_supermarket_restored (footprint 25 x 15): a one-storey big box (walls 5 m, parapet to 5.9 m)
// with a glass shop front on the +z long side, a covered walk with a team fascia, a sign frame on the roof edge, HVAC units
// and skylights on the flat roof and a loading dock at the back (-z). The ruin lost a back corner, most of the glass and
// two roof panels, its canopy sags, the sign frame is bent and rubble lies about.
import { Frame, rubble, type Part, type V2 } from './builder.js';

const X0 = -12.5;
const X1 = 12.5;
const Z0 = -5.5; // back wall, outside face
const Z1 = 6.5; // front wall, outside face
const T = 0.35; // wall thickness
const WALL = 5.0;
const ROOF = 0.3;
const PANEL = (X1 - X0) / 6; // roof panel width of the ruin

export function supermarket(ruin: boolean): Part[] {
  const parts: Part[] = [];
  const f = new Frame(parts);
  const wall = ruin ? 'concrete_ruin' : 'concrete';
  const trim = 'concrete_dark';
  const steelDark = ruin ? 'rust_dark' : 'metal_dark';
  const steelLight = ruin ? 'rust_metal' : 'metal_light';
  const roofMat = ruin ? 'rust_roof' : 'roof_tar';

  // Plinth under the whole building.
  f.box(trim, [X0, 0, Z0], [X1, 0.35, Z1], { open: true, lod: 1 });

  // --- Walls ---
  if (!ruin) {
    f.box(wall, [X0, 0.35, Z0], [X1, WALL, Z0 + T], { open: true }); // back
    f.box(wall, [X0, 0.35, Z0 + T], [X0 + T, WALL, Z1 - T], { open: true }); // left
    f.box(wall, [X1 - T, 0.35, Z0 + T], [X1, WALL, Z1 - T], { open: true }); // right
  } else {
    // Back wall: a collapsed back-left corner (jagged top down to 1.5 m), the rest stands.
    const back: V2[] = [
      [X0, 0.35],
      [X1, 0.35],
      [X1, WALL],
      [-5.5, WALL],
      [-6.3, 3.9],
      [-7.6, 4.4],
      [-8.4, 2.7],
      [-9.8, 3.2],
      [-10.6, 1.6],
      [X0, 2.0],
    ];
    f.prism(wall, 'z', back, T, [0, 0, Z0 + T / 2]);
    // Left wall: its back end is gone too.
    const left: V2[] = [
      [Z0 + T, 0.35],
      [Z1 - T, 0.35],
      [Z1 - T, WALL],
      [0.5, WALL],
      [-0.4, 3.6],
      [-1.6, 4.0],
      [-2.4, 2.2],
      [-4.0, 2.7],
      [Z0 + T, 1.2],
    ];
    f.prism(wall, 'x', left, T, [X0 + T / 2, 0, 0]);
    f.box(wall, [X1 - T, 0.35, Z0 + T], [X1, WALL, Z1 - T], { open: true }); // right wall stands
  }

  // --- Shop front (+z): piers, header, sill, glass, mullions, entrance ---
  const gx = 9.5; // glass runs from -9.5 to 9.5
  f.box(wall, [X0, 0.35, Z1 - T], [-gx, WALL, Z1], { open: true }); // piers
  if (!ruin) {
    f.box(wall, [gx, 0.35, Z1 - T], [X1, WALL, Z1], { open: true });
    f.box(wall, [-gx, 3.6, Z1 - T], [gx, WALL, Z1], { open: true }); // header
    f.box(trim, [-gx, 0.35, Z1 - T - 0.05], [gx, 0.7, Z1 + 0.05], { lod: 1 }); // sill
    f.box('lens_glass', [-gx, 0.7, Z1 - 0.2], [gx, 3.6, Z1 - 0.12]);
    for (let k = 0; k <= 8; k++)
      f.box(
        steelDark,
        [-gx + k * 2.375 - 0.07, 0.7, Z1 - 0.28],
        [-gx + k * 2.375 + 0.07, 3.6, Z1 - 0.06],
        { lod: 1 },
      );
    f.box(steelDark, [-gx, 3.45, Z1 - 0.28], [gx, 3.6, Z1 - 0.06], { lod: 1 });
  } else {
    f.box(wall, [gx, 0.35, Z1 - T], [X1, WALL, Z1], { open: true });
    // Header: stands on the left, snapped and sagging on the right.
    f.box(wall, [-gx, 3.6, Z1 - T], [1.5, WALL, Z1], { open: true });
    f.box(wall, [1.5, 4.2, Z1 - T], [5.2, WALL, Z1], { open: true, lod: 1 });
    f.tilted(wall, [4.2, 1.0, T], [7.3, 4.0, Z1 - T / 2], [0, 0, -14], { lod: 1 }, undefined);
    f.box(trim, [-gx, 0.35, Z1 - T - 0.05], [gx, 0.6, Z1 + 0.05], { lod: 1 }); // sill
    // Dark inside where the glass was, a few shards in the frames, bent mullions.
    f.box('opening', [-gx, 0.6, Z1 - 0.5], [gx, 3.6, Z1 - 0.4]);
    const shard = (x: number, y: number, w: number, h: number, jag: number): V2[] => [
      [x, y],
      [x + w, y + jag],
      [x + w * 0.8, y + h],
      [x + w * 0.2, y + h * 0.85],
    ];
    f.prism('lens_glass', 'z', shard(-9.3, 0.7, 1.6, 1.2, 0.3), 0.05, [0, 0, Z1 - 0.18], {
      lod: 1,
    });
    f.prism('lens_glass', 'z', shard(-4.4, 2.4, 1.5, 1.1, -0.2), 0.05, [0, 0, Z1 - 0.18], {
      lod: 1,
    });
    f.prism('lens_glass', 'z', shard(7.0, 0.7, 2.2, 1.6, 0.2), 0.05, [0, 0, Z1 - 0.18], { lod: 1 });
    for (const [k, lean] of [
      [0, 0],
      [1, 3],
      [3, -5],
      [4, 0],
      [6, 8],
      [8, 0],
    ] as const) {
      const x = -gx + k * 2.375;
      const tall = k === 4 ? 1.9 : 2.9;
      f.tilted(steelDark, [0.14, tall, 0.2], [x, 0.7 + tall / 2, Z1 - 0.17], [0, 0, lean], {
        lod: 1,
      });
    }
  }
  // Entrance: dark double door 2.8 x 2.4 m with a frame.
  f.box('opening', [-1.4, 0.7, Z1 - 0.12], [1.4, 3.1, Z1 - 0.04]);
  f.box(steelDark, [-1.55, 0.7, Z1 - 0.2], [-1.4, 3.25, Z1 - 0.02], { lod: 1 });
  f.box(steelDark, [1.4, 0.7, Z1 - 0.2], [1.55, 3.25, Z1 - 0.02], { lod: 1 });
  f.box(steelDark, [-1.55, 3.1, Z1 - 0.2], [1.55, 3.25, Z1 - 0.02], { lod: 1 });

  // --- Covered walk on the front: slab, fascia (team colour when restored), posts ---
  if (!ruin) {
    f.box(steelLight, [-10, 3.45, Z1], [10, 3.7, 7.5]);
    f.box('team_trim', [-10.1, 3.3, 7.42], [10.1, 3.85, 7.54]);
    for (const x of [-9.9, -3.3, 3.3, 9.9])
      f.box(steelDark, [x - 0.1, 0, 7.3], [x + 0.1, 3.45, 7.5], { lod: 1 });
  } else {
    // The canopy slab hangs from the left end and sags to the right; two posts are down.
    const sag = f.turned([0, 0, -11], [-10, 3.7, 7.0], [-10, 3.7, 7.0]);
    sag.box(steelLight, [-10, 3.45, Z1], [3, 3.7, 7.5]);
    sag.box('rust_dark', [-10.1, 3.3, 7.42], [3, 3.85, 7.54], { lod: 1 });
    f.box(steelLight, [3, 3.45, Z1], [10, 3.7, 7.5], { lod: 1 });
    f.box('rust_dark', [3, 3.3, 7.42], [7.5, 3.85, 7.54], { lod: 1 });
    f.tilted('rust_dark', [2.6, 0.55, 0.12], [9.0, 0.3, 7.3], [0, -8, 28], { lod: 1 }, 0);
    f.box(steelDark, [-10.0, 0, 7.3], [-9.8, 3.55, 7.5], { lod: 1 });
    f.box(steelDark, [3.2, 0, 7.3], [3.4, 3.45, 7.5], { lod: 1 });
    f.tilted(steelDark, [0.2, 3.3, 0.2], [-2.3, 0.1, 7.2], [0, 12, 78], { lod: 1 }, 0);
  }
  for (const x of [-4.2, -1.4, 1.4, 4.2])
    f.cyl(ruin ? 'rust_dark' : 'metal_hazard', 0.12, 0.9, [x, 0, 7.35], 6, { lod: 0 }); // bollards in front of the walk

  // --- Roof: slab, parapet, HVAC, skylights ---
  const roofY = WALL;
  if (!ruin) {
    f.box(roofMat, [X0, roofY, Z0], [X1, roofY + ROOF, Z1]);
    f.box(wall, [X0, roofY + ROOF, Z0], [X1, 5.9, Z0 + 0.3], { lod: 1 });
    f.box(wall, [X0, roofY + ROOF, Z1 - 0.3], [X1, 5.9, Z1], { lod: 1 });
    f.box(wall, [X0, roofY + ROOF, Z0 + 0.3], [X0 + 0.3, 5.9, Z1 - 0.3], { lod: 1 });
    f.box(wall, [X1 - 0.3, roofY + ROOF, Z0 + 0.3], [X1, 5.9, Z1 - 0.3], { lod: 1 });
    for (const [x, z] of [
      [-7.5, -1.5],
      [-2.5, -3],
      [6, -1.8],
    ] as const) {
      f.box(steelLight, [x - 1.1, 5.3, z - 0.75], [x + 1.1, 6.2, z + 0.75], { lod: 1 });
      f.cyl('metal_dark', 0.45, 0.1, [x - 0.1, 6.2, z], 8, { lod: 0 });
    }
    for (const x of [-7.5, 0, 7.5])
      f.box('lens_glass', [x - 1.5, 5.3, 2.0], [x + 1.5, 5.6, 3.8], { lod: 1 });
  } else {
    // Panels 0, 1, 4 and 5 are on; panel 2 hangs into the hole from its left edge; panel 3 is gone.
    const panel = (i: number): { x0: number; x1: number } => ({
      x0: X0 + i * PANEL,
      x1: X0 + (i + 1) * PANEL,
    });
    for (const i of [1, 4, 5]) {
      const p = panel(i);
      f.box(roofMat, [p.x0, roofY, Z0], [p.x1 - 0.05, roofY + ROOF, Z1]);
    }
    // Panel 0: only its front half is left, the back half dropped over the collapsed corner.
    const p0 = panel(0);
    f.box(roofMat, [p0.x0, roofY, 0.6], [p0.x1 - 0.05, roofY + ROOF, Z1]);
    f.turned([-24, 0, 6], [p0.x0 + 2, roofY, 0.6], [p0.x0 + 2, roofY, 0.6]).box(
      roofMat,
      [p0.x0, roofY, Z0],
      [p0.x1 - 0.05, roofY + ROOF, 0.4],
      { lod: 1 },
    );
    const p2 = panel(2);
    f.turned([0, 0, -38], [p2.x0, roofY, 0], [p2.x0, roofY, 0]).box(
      roofMat,
      [p2.x0, roofY, Z0 + 0.2],
      [p2.x1 - 0.05, roofY + ROOF, Z1 - 0.3],
      { lod: 1 },
    );
    // Exposed joists across the hole.
    for (let k = 0; k <= 6; k++) {
      const x = X0 + k * PANEL;
      f.tube(
        steelDark,
        [
          [x, 4.8, Z0 + 0.3],
          [x, 4.8, Z1 - 0.3],
        ],
        0.1,
        4,
        { lod: 1 },
      );
    }
    // Parapet: front stands except for a gap, back only on the right, sides partly.
    f.box(wall, [X0, roofY + ROOF, Z1 - 0.3], [-3, 5.9, Z1], { lod: 1 });
    f.box(wall, [5, roofY + ROOF, Z1 - 0.3], [X1, 5.9, Z1], { lod: 1 });
    f.box(wall, [-4, roofY + ROOF, Z0], [X1, 5.9, Z0 + 0.3], { lod: 1 });
    f.box(wall, [X1 - 0.3, roofY + ROOF, Z0 + 0.3], [X1, 5.9, Z1 - 0.3], { lod: 1 });
    // HVAC: one stands, one fell off the roof edge.
    f.box(steelLight, [5, 5.3, -2.55], [7.2, 6.2, -1.05], { lod: 1 });
    f.tilted(steelLight, [2.2, 0.9, 1.5], [-9.5, 0, -3.8], [18, 30, 64], { lod: 1 }, 0);
    f.box('lens_glass', [6.5, 5.3, 2.0], [9.5, 5.6, 3.8], { lod: 1 });
  }

  // --- Sign frame on the roof edge (front) ---
  const signX = 6.2;
  const signZ = Z1 - 0.2;
  if (!ruin) {
    for (const x of [-signX, signX])
      f.box(steelDark, [x - 0.12, 5.9, signZ - 0.12], [x + 0.12, 7.45, signZ + 0.12]);
    f.box(steelDark, [-signX - 0.12, 7.3, signZ - 0.12], [signX + 0.12, 7.52, signZ + 0.12], {
      lod: 1,
    });
    f.box('team_trim', [-signX + 0.12, 6.1, signZ - 0.06], [signX - 0.12, 7.25, signZ + 0.06]);
    for (const x of [-signX, signX])
      f.tube(
        steelDark,
        [
          [x, 7.0, signZ],
          [x, 5.9, signZ - 1.5],
        ],
        0.05,
        3,
        { lod: 0 },
      );
  } else {
    f.box(steelDark, [signX - 0.12, 5.9, signZ - 0.12], [signX + 0.12, 7.45, signZ + 0.12]);
    const lean = f.turned([0, 0, 11], [-signX, 5.9, signZ], [-signX, 5.9, signZ]);
    lean.box(steelDark, [-signX - 0.12, 5.9, signZ - 0.12], [-signX + 0.12, 7.45, signZ + 0.12]);
    f.tube(steelDark, [lean.point([-signX, 7.4, signZ]), [signX, 7.4, signZ]], 0.11, 4, { lod: 1 });
    // A torn piece of the sign panel hangs from the right post.
    const torn: V2[] = [
      [0.6, 7.25],
      [6.0, 7.25],
      [6.0, 6.1],
      [4.6, 6.1],
      [4.1, 6.55],
      [3.1, 6.2],
      [2.4, 6.95],
      [1.4, 6.6],
    ];
    f.prism('rust_metal', 'z', torn, 0.1, [0, 0, signZ]);
  }

  // --- Loading dock at the back (-z): platform, roll-up door, bumpers, canopy ---
  const dx0 = 4.8;
  const dx1 = 11.2;
  f.box(ruin ? 'concrete_ruin' : 'concrete', [dx0, 0, -7.5], [dx1, 1.2, Z0], { open: true });
  f.box('rubber', [dx0 + 0.4, 0.4, -7.58], [dx0 + 0.9, 0.9, -7.5], { lod: 1 });
  f.box('rubber', [dx1 - 0.9, 0.4, -7.58], [dx1 - 0.4, 0.9, -7.5], { lod: 1 });
  f.prism(
    ruin ? 'concrete_dark' : 'concrete',
    'z',
    [
      [0, 0],
      [1.3, 0],
      [0, 1.2],
    ],
    1.8,
    [dx1, 0, -6.55],
    { lod: 1 },
  );
  if (!ruin) {
    f.box(steelLight, [6.3, 1.2, Z0 - 0.1], [9.7, 4.2, Z0]); // roll-up door
    for (let y = 1.5; y < 4.2; y += 0.6)
      f.box(steelDark, [6.3, y, Z0 - 0.14], [9.7, y + 0.05, Z0 - 0.1], { lod: 0 });
    f.box(steelLight, [dx0 - 0.4, 4.6, -7.5], [dx1 + 0.4, 4.8, Z0], { lod: 1 });
    for (const x of [dx0, dx1])
      f.box(steelDark, [x - 0.1, 1.2, -7.45], [x + 0.1, 4.6, -7.25], { lod: 1 });
  } else {
    f.box('opening', [6.3, 1.2, Z0 - 0.05], [9.7, 4.2, Z0 + 0.02]);
    f.tilted(steelLight, [3.4, 0.4, 0.12], [8.1, 0, -5.9], [0, 4, 22], { lod: 1 }, 1.2); // fallen door pieces
    f.box(steelLight, [dx0 - 0.4, 4.6, -7.5], [8.0, 4.8, Z0], { lod: 1 });
    f.box(steelDark, [dx0 - 0.1, 1.2, -7.45], [dx0 + 0.1, 4.6, -7.25], { lod: 1 });
    f.tilted(steelDark, [0.2, 3.2, 0.2], [dx1 - 0.7, 0, -6.9], [0, 8, 80], { lod: 1 }, 1.2);
  }
  // Pedestrian door at the back.
  f.box('opening', [-5.1, 0.35, Z0 - 0.08], [-3.9, 2.55, Z0 + 0.02], { lod: 1 });
  f.box(steelDark, [-5.25, 0.35, Z0 - 0.1], [-3.75, 2.7, Z0 - 0.04], { lod: 1 });

  // Pilasters along the back wall, only on the high-detail LOD.
  for (const x of [-10, -5, 0, 5, 10])
    if (!ruin || x > -6) f.box(trim, [x - 0.25, 0.35, Z0 - 0.12], [x + 0.25, WALL, Z0], { lod: 0 });

  if (ruin) {
    // Rubble: under the roof hole, at the collapsed corner and in front of the shop window.
    rubble(
      f,
      ['concrete_dark', 'concrete_ruin', 'rust_dark'],
      [-9.7, -5.6],
      [3.2, 1.6],
      18,
      11,
      { all: 2, mid: 3 },
      1,
    );
    rubble(f, ['concrete_dark', 'rust_dark'], [-1.5, 1], [4, 3], 12, 23, { all: 0, mid: 3 }, 0.9);
    rubble(
      f,
      ['concrete_ruin', 'concrete_dark'],
      [6.5, 4.6],
      [3.4, 1.4],
      8,
      31,
      { all: 0, mid: 2 },
      0.7,
    );
    // Overturned shelving inside.
    f.tilted('rust_metal', [0.7, 2.0, 6.5], [1.0, 0, 1.0], [0, 10, 70], { lod: 0 }, 0);
    f.tilted('rust_metal', [0.7, 2.0, 5.0], [-5.0, 0, 2.0], [14, -6, 55], { lod: 0 }, 0);
  }
  return parts;
}

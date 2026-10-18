// site_gas_station_ruin / site_gas_station_restored (footprint 15 x 11): a canopy of about 14.6 x 10 m on four pillars (5 m
// high) over two pump islands with two pumps each, and a small kiosk under the +x end at the back. The restored station has
// a team fascia round the canopy and a team band over the kiosk window; in the ruin the left canopy section lies slanted
// on a snapped pillar, the middle section hangs from the right one, the pumps are knocked about and the kiosk lost half its roof.
import { Frame, rubble, type Part, type V2, type V3 } from './builder.js';

const CX0 = -7.3;
const CX1 = 7.3;
const CZ0 = -5.0;
const CZ1 = 5.0;
const UNDER = 4.8; // underside of the canopy
const TOP = 5.2;
const PILLARS: [number, number][] = [
  [-5.2, -3.2],
  [-5.2, 3.2],
  [5.2, -3.2],
  [5.2, 3.2],
];
const PUMP_X = [-2.2, 1.2];
const ISLAND_Z = [-1.7, 1.7];

export function gasStation(ruin: boolean): Part[] {
  const parts: Part[] = [];
  const f = new Frame(parts);
  const paint = ruin ? 'rust_metal' : 'metal_light';
  const dark = ruin ? 'rust_dark' : 'metal_dark';
  const wall = ruin ? 'concrete_ruin' : 'concrete';
  const fascia = ruin ? 'rust_dark' : 'team_trim';
  const body = ruin ? 'rust_metal' : 'metal_red';

  // --- Pillars ---
  for (const [x, z] of PILLARS) {
    const broken = ruin && x < 0 && z > 0;
    if (broken) {
      f.box(paint, [x - 0.275, 0, z - 0.275], [x + 0.275, 1.3, z + 0.275], { open: true });
      f.tilted(paint, [0.55, 3.4, 0.55], [x + 1.4, 0.3, z + 1.4], [0, 10, 80], {}, 0); // the top half lies in front
    } else if (ruin) {
      const lean: V3 = x > 0 && z > 0 ? [3, 0, 0] : [0, 0, x < 0 ? 3 : -2];
      f.tilted(paint, [0.55, 4.8, 0.55], [x, 2.4, z], lean, { lod: 2 }, 0);
      f.box(dark, [x - 0.36, 0, z - 0.36], [x + 0.36, 0.6, z + 0.36], { open: true, lod: 1 });
    } else {
      f.box(paint, [x - 0.275, 0, z - 0.275], [x + 0.275, UNDER, z + 0.275], { open: true });
      f.box('metal_hazard', [x - 0.36, 0, z - 0.36], [x + 0.36, 0.6, z + 0.36], {
        open: true,
        lod: 1,
      });
    }
  }

  // --- Canopy ---
  const section = (fr: Frame, x0: number, x1: number): void => {
    fr.box(paint, [x0, UNDER, CZ0], [x1, TOP, CZ1]);
    fr.box(dark, [x0 + 0.1, UNDER - 0.05, CZ0 + 0.1], [x1 - 0.1, UNDER, CZ1 - 0.1], { lod: 1 });
    fr.box(fascia, [x0, UNDER - 0.25, CZ1], [x1, TOP + 0.15, CZ1 + 0.12]); // front strip
    fr.box(fascia, [x0, UNDER - 0.25, CZ0 - 0.12], [x1, TOP + 0.15, CZ0]); // back strip
  };
  if (!ruin) {
    section(f, CX0, CX1);
    f.box(fascia, [CX0 - 0.12, UNDER - 0.25, CZ0 - 0.12], [CX0, TOP + 0.15, CZ1 + 0.12]);
    f.box(fascia, [CX1, UNDER - 0.25, CZ0 - 0.12], [CX1 + 0.12, TOP + 0.15, CZ1 + 0.12]);
    for (const x of PUMP_X)
      for (const z of ISLAND_Z)
        f.box('lens_amber', [x - 0.45, UNDER - 0.1, z - 0.45], [x + 0.45, UNDER, z + 0.45], {
          lod: 0,
        });
  } else {
    // Left section: back edge still on the pillar, front edge lying on the ground (26 degrees).
    section(f.turned([26, 0, 0], [0, TOP, CZ0], [-4.9, TOP, CZ0]), -2.4, 2.4);
    // Middle section: hangs from the right section, its left end sags (20 degrees).
    section(f.turned([0, 0, 20], [2.5, TOP, 0], [2.5, TOP, 0]), -2.5, 2.5);
    // Right section on its two pillars; the front right corner is torn off.
    f.box(paint, [2.5, UNDER, CZ0], [CX1, TOP, 1.8]);
    f.box(paint, [2.5, UNDER, 1.8], [4.6, TOP, CZ1], { lod: 1 });
    f.box(fascia, [2.5, UNDER - 0.25, CZ0 - 0.12], [CX1, TOP + 0.15, CZ0]);
    f.box(fascia, [CX1, UNDER - 0.25, CZ0 - 0.12], [CX1 + 0.12, TOP + 0.15, 1.8], { lod: 1 });
    f.box(fascia, [2.5, UNDER - 0.25, CZ1], [4.6, TOP + 0.15, CZ1 + 0.12], { lod: 1 });
    f.tilted('rust_roof', [2.6, 0.12, 3.0], [6.0, 0, 3.6], [0, -12, 24], { lod: 1 }, 0); // the torn corner on the ground
  }

  // --- Pump islands and pumps ---
  for (const [i, z] of ISLAND_Z.entries()) {
    if (ruin && i === 1) {
      f.tilted('concrete_ruin', [6.8, 0.22, 1.3], [-0.5, 0.11, z], [0, 3, 4], {}, 0);
      f.tilted('concrete_dark', [1.4, 0.18, 0.9], [-4.7, 0, z + 0.5], [0, 30, 6], { lod: 1 }, 0);
    } else f.box(wall, [-3.9, 0, z - 0.65], [2.9, 0.22, z + 0.65], { open: true });
    for (const [j, x] of PUMP_X.entries()) {
      const pumpFor = (fr: Frame, cx: number, cz: number): void => {
        fr.box(body, [cx - 0.425, 0.22, cz - 0.25], [cx + 0.425, 1.97, cz + 0.25]);
        fr.box(
          ruin ? 'opening' : 'lens_amber',
          [cx - 0.3, 1.25, cz + 0.25],
          [cx + 0.3, 1.55, cz + 0.28],
          { lod: 1 },
        );
        fr.box(dark, [cx - 0.45, 1.97, cz - 0.28], [cx + 0.45, 2.17, cz + 0.28], { lod: 1 });
        fr.tube(
          'rubber',
          [
            [cx + 0.43, 1.4, cz],
            [cx + 0.75, 1.1, cz + 0.2],
            [cx + 0.55, 0.8, cz + 0.3],
          ],
          0.04,
          3,
          { lod: 0 },
        );
      };
      if (ruin && i === 0 && j === 1) {
        // Leaning pump (about 20 degrees about its foot).
        pumpFor(f.turned([0, 0, 20], [x, 0.22, z], [x, 0.22, z]), x, z);
      } else if (ruin && i === 1 && j === 0) {
        f.tilted(body, [0.85, 1.75, 0.5], [x - 0.3, 0.3, z + 1.3], [0, 25, 88], { lod: 1 }, 0); // knocked over
        f.tube(
          'rubber',
          [
            [x + 0.4, 0.15, z + 1.0],
            [x + 1.2, 0.05, z + 0.9],
            [x + 1.6, 0.05, z + 0.4],
          ],
          0.04,
          3,
          { lod: 0 },
        );
      } else pumpFor(f, x, z);
    }
    f.cyl(ruin ? 'rust_dark' : 'metal_hazard', 0.14, 0.9, [-4.1, 0, z], 6, { lod: 0 });
    f.cyl(ruin ? 'rust_dark' : 'metal_hazard', 0.14, 0.9, [3.1, 0, z], 6, { lod: 0 });
  }

  // --- Kiosk at the +x end, at the back, under the canopy ---
  const kx0 = 3.1;
  const kx1 = 7.3;
  const kz0 = -5.4;
  const kz1 = -1.8;
  const kh = 3.0;
  if (!ruin) {
    f.box(wall, [kx0, 0, kz0], [kx1, kh, kz1], { open: true });
    f.box('metal_dark', [kx0 - 0.1, kh, kz0 - 0.1], [kx1 + 0.1, kh + 0.2, kz1 + 0.1]);
    f.box('lens_glass', [3.5, 0.9, kz1], [5.9, 2.3, kz1 + 0.08]);
    f.box('metal_dark', [3.4, 0.8, kz1], [6.0, 0.95, kz1 + 0.1], { lod: 1 }); // counter ledge
    f.box('opening', [6.15, 0, kz1], [7.15, 2.2, kz1 + 0.08]);
    f.box('metal_dark', [6.05, 0, kz1], [7.25, 2.3, kz1 + 0.05], { lod: 1 });
    f.box('team_trim', [kx0, 2.5, kz1], [kx1, 2.9, kz1 + 0.1]);
    f.box('metal_light', [4.3, kh + 0.2, -4.6], [5.4, kh + 0.8, -3.9], { lod: 1 }); // air conditioning
  } else {
    f.box(wall, [kx0, 0, kz0], [kx1, kh, kz0 + 0.25], { open: true });
    const side: V2[] = [
      [kz0, 0],
      [kz1, 0],
      [kz1, kh],
      [-3.8, kh],
      [-3.2, 2.0],
      [-2.5, 2.4],
      [kz1, 1.0],
    ];
    f.prism(wall, 'x', side, 0.25, [kx1 - 0.125, 0, 0]);
    f.prism(
      wall,
      'x',
      side.map(([a, b]) => [a, b * 0.8] as V2),
      0.25,
      [kx0 + 0.125, 0, 0],
      { lod: 1 },
    );
    const front: V2[] = [
      [kx0, 0],
      [kx1, 0],
      [kx1, kh],
      [6.5, kh],
      [6.2, 1.9],
      [5.1, 2.6],
      [4.4, 1.1],
      [kx0, 1.7],
    ];
    f.prism(wall, 'z', front, 0.25, [0, 0, kz1 - 0.125]);
    f.box('opening', [6.15, 0, kz1], [7.15, 2.2, kz1 + 0.06], { lod: 1 });
    // Roof: the back half stays, the front half hangs down into the kiosk (20 degrees).
    f.box('rust_dark', [kx0 - 0.1, kh, kz0 - 0.1], [kx1 + 0.1, kh + 0.2, -3.6]);
    f.turned([20, 0, 0], [0, kh + 0.2, -3.6], [5.2, kh + 0.2, -3.6]).box(
      'rust_dark',
      [-2.1, kh, -3.6],
      [2.1, kh + 0.2, kz1 + 0.1],
      { lod: 1 },
    );
    rubble(
      f,
      ['concrete_dark', 'concrete_ruin', 'rust_dark'],
      [5.2, -1.1],
      [2.3, 0.9],
      9,
      5,
      { all: 0, mid: 3 },
      0.9,
    );
    rubble(
      f,
      ['concrete_dark', 'rust_dark'],
      [-4.6, 3.8],
      [2.6, 0.8],
      9,
      17,
      { all: 0, mid: 2 },
      0.9,
    );
    rubble(f, ['concrete_dark', 'rust_dark'], [0.5, -3.4], [3, 1], 6, 29, { all: 0, mid: 2 }, 0.8);
  }
  return parts;
}

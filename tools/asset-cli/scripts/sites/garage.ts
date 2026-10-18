// site_garage_ruin / site_garage_restored (footprint 13 x 11): a workshop of 9.3 x 11 m with 5.2 m walls and a low gable
// roof (ridge 6.2 m, along x), two roller doors of 3.4 x 3.5 m on the +z front (restored: with a team stripe each, a team
// sign in the header), a small office annex of 3.7 x 5 m (3.2 m high, door 1.0 x 2.2 m, team band) at the +x side and a car
// in the yard behind it. The ruin lost a roof section and a back corner, one roller door hangs torn, the other is gone.
import { Frame, rubble, type Part, type V2 } from './builder.js';

const WX0 = -6.5;
const WX1 = 2.8;
const WZ0 = -5.5;
const WZ1 = 5.5;
const T = 0.3;
const H = 5.2;
const RIDGE = 6.2;
const MID = (WX0 + WX1) / 2;

export function garage(ruin: boolean): Part[] {
  const parts: Part[] = [];
  const f = new Frame(parts);
  const sheet = ruin ? 'rust_metal' : 'metal_blue';
  const roof = ruin ? 'rust_roof' : 'metal';
  const steelDark = ruin ? 'rust_dark' : 'metal_dark';
  const steelLight = ruin ? 'rust_metal' : 'metal_light';
  const wall = ruin ? 'concrete_ruin' : 'concrete';

  // --- Workshop walls: back, left, right, front with two door openings ---
  if (!ruin) {
    f.box(sheet, [WX0, 0, WZ0], [WX1, H, WZ0 + T], { open: true });
    f.box(sheet, [WX0, 0, WZ0 + T], [WX0 + T, H, WZ1 - T], { open: true });
    f.box(sheet, [WX1 - T, 0, WZ0 + T], [WX1, H, WZ1 - T], { open: true });
    f.cyl('metal_dark', 0.15, 1.3, [-4, H, -3.2], 6, { lod: 1 }); // vent stack
    f.cyl('metal_dark', 0.22, 0.12, [-4, H + 1.3, -3.2], 6, { lod: 0 });
    // Corrugated sheet over the wall boxes, high detail only.
    f.raw({
      type: 'corrugated',
      material: sheet,
      length: 9.3,
      height: H,
      period: 0.6,
      depth: 0.1,
      position: [MID, 0, WZ0],
      rotation: [0, 180, 0],
      maxLod: 0,
    });
    f.raw({
      type: 'corrugated',
      material: sheet,
      length: 10.4,
      height: H,
      period: 0.6,
      depth: 0.1,
      position: [WX0, 0, 0],
      rotation: [0, -90, 0],
      maxLod: 0,
    });
  } else {
    // Back wall with a breach in the right corner; the left wall stands; the right wall is partly down.
    const back: V2[] = [
      [WX0, 0],
      [WX1, 0],
      [WX1, 1.6],
      [1.4, 2.4],
      [0.9, 1.5],
      [-0.2, 3.2],
      [-0.9, 2.6],
      [-2.0, H],
      [WX0, H],
    ];
    f.prism(sheet, 'z', back, T, [0, 0, WZ0 + T / 2]);
    f.box(sheet, [WX0, 0, WZ0 + T], [WX0 + T, H, WZ1 - T], { open: true });
    const right: V2[] = [
      [WZ0 + T, 0],
      [WZ1 - T, 0],
      [WZ1 - T, H],
      [2.0, H],
      [1.2, 3.3],
      [-0.5, 3.9],
      [-1.6, 1.8],
      [-3.2, 2.5],
      [-4.4, 0.9],
      [WZ0 + T, 1.1],
    ];
    f.prism(sheet, 'x', right, T, [WX1 - T / 2, 0, 0]);
    f.raw({
      type: 'corrugated',
      material: 'rust_dark',
      length: 10.4,
      height: H,
      period: 0.6,
      depth: 0.1,
      position: [WX0, 0, 0],
      rotation: [0, -90, 0],
      maxLod: 0,
    });
  }
  // Gable ends.
  const gable: V2[] = [
    [WZ0, H],
    [WZ1, H],
    [0, RIDGE],
  ];
  f.prism(sheet, 'x', gable, T, [WX0 + T / 2, 0, 0], { lod: 1 });
  if (!ruin) f.prism(sheet, 'x', gable, T, [WX1 - T / 2, 0, 0], { lod: 1 });
  else
    f.prism(
      sheet,
      'x',
      [
        [WZ0, H],
        [-1.5, H],
        [-2.6, 5.6],
        [WZ1 * -0.2, H],
      ] as V2[],
      T,
      [WX1 - T / 2, 0, 0],
      { lod: 1 },
    );

  // --- Front wall (+z): piers, header, two roller doors ---
  const fz0 = WZ1 - T;
  f.box(sheet, [WX0, 0, fz0], [-6.0, H, WZ1], { open: true });
  f.box(sheet, [-2.6, 0, fz0], [-1.3, H, WZ1], { open: true });
  f.box(sheet, [2.1, 0, fz0], [WX1, H, WZ1], { open: true });
  if (!ruin) {
    f.box(sheet, [-6.0, 3.5, fz0], [2.1, H, WZ1], { open: true });
    f.box('team_trim', [-3.0, 4.2, WZ1], [0.8, 4.85, WZ1 + 0.08]); // the team sign in the header
    for (const [x0, x1] of [
      [-6.0, -2.6],
      [-1.3, 2.1],
    ] as const) {
      f.box(steelLight, [x0, 0, WZ1 - 0.25], [x1, 3.5, WZ1 - 0.13]); // roller door
      f.box(steelDark, [x0, 0.4, WZ1 - 0.13], [x1, 0.45, WZ1 - 0.09], {
        lod: 0,
        repeat: { count: 9, step: [0, 0.35, 0] },
      });
      f.box('team_trim', [x0, 2.45, WZ1 - 0.13], [x1, 2.85, WZ1 - 0.07]); // team stripe
      f.box(steelDark, [x0 - 0.12, 0, WZ1 - 0.25], [x0, 3.65, WZ1 + 0.05], { lod: 1 });
      f.box(steelDark, [x1, 0, WZ1 - 0.25], [x1 + 0.12, 3.65, WZ1 + 0.05], { lod: 1 });
      f.box(steelDark, [x0 - 0.12, 3.5, WZ1 - 0.25], [x1 + 0.12, 3.8, WZ1 + 0.1], { lod: 1 }); // roller housing
      f.box(
        'lens_amber',
        [(x0 + x1) / 2 - 0.25, 3.9, WZ1],
        [(x0 + x1) / 2 + 0.25, 4.05, WZ1 + 0.2],
        { lod: 0 },
      );
    }
  } else {
    // Header: left part stands, right part has dropped and tilted; the left door hangs torn, the right door is gone.
    f.box(sheet, [-6.0, 3.5, fz0], [-2.2, H, WZ1], { open: true });
    f.tilted(sheet, [4.3, 1.5, T], [0.0, 4.0, WZ1 - T / 2], [0, 0, -9], { lod: 1 });
    f.box('opening', [-6.0, 0, WZ1 - 0.5], [2.1, 3.5, WZ1 - 0.4]);
    const torn: V2[] = [
      [-6.0, 3.5],
      [-2.6, 3.5],
      [-2.6, 2.2],
      [-3.4, 1.9],
      [-3.9, 2.5],
      [-4.8, 1.6],
      [-5.4, 2.4],
      [-6.0, 2.0],
    ];
    f.prism(steelLight, 'z', torn, 0.12, [0, 0, WZ1 - 0.2]);
    f.tilted(steelLight, [3.2, 0.5, 0.12], [-0.2, 0, 5.4], [10, 6, 24], { lod: 1 }, 0); // slats on the ground
    f.box(steelDark, [-6.12, 0, WZ1 - 0.25], [-6.0, 3.65, WZ1 + 0.05], { lod: 1 });
    f.tilted(steelDark, [0.12, 3.6, 0.3], [1.4, 0.2, 5.3], [0, 8, 84], { lod: 1 }, 0);
  }

  // --- Roof: two slopes as one gable prism, in sections; the ruin lost the middle ---
  const roofLen = WX1 - WX0 + 0.4;
  const slope: V2[] = [
    [WZ0 - 0.2, H],
    [WZ1 + 0.2, H],
    [0, RIDGE],
  ];
  if (!ruin) {
    f.prism(roof, 'x', slope, roofLen, [MID, 0, 0]);
  } else {
    f.prism(roof, 'x', slope, 3.3, [WX0 - 0.2 + 1.65, 0, 0]);
    f.prism(roof, 'x', slope, 2.4, [WX1 + 0.2 - 1.2, 0, 0]);
    // The middle: bare rafters and a sheet that fell inside.
    for (const x of [-3.0, -1.9, -0.8, 0.3]) {
      f.tube(
        steelDark,
        [
          [x, H, WZ0],
          [x, RIDGE, 0],
          [x, H, WZ1],
        ],
        0.08,
        3,
        { lod: 1 },
      );
    }
    f.tilted('rust_roof', [3.0, 0.12, 6.0], [-1.6, 0, -1.8], [0, 5, 24], { lod: 1 }, 0.5);
    f.tilted('rust_roof', [2.2, 0.12, 4.0], [-2.2, 0, 2.6], [-18, 20, 6], { lod: 0 }, 0.4);
  }

  // --- Office annex at the +x side (z 0.5 .. 5.5) ---
  const ax0 = WX1;
  const ax1 = 6.5;
  const az0 = 0.5;
  const ah = 3.2;
  if (!ruin) {
    f.box(wall, [ax0, 0, az0], [ax1, ah, WZ1], { open: true });
    f.box('roof_tar', [ax0, ah, az0 - 0.15], [ax1 + 0.1, ah + 0.2, WZ1 + 0.15]);
    f.box('lens_glass', [3.1, 1.0, WZ1], [4.9, 2.1, WZ1 + 0.07]);
    f.box(steelDark, [3.0, 0.9, WZ1], [5.0, 1.0, WZ1 + 0.1], { lod: 1 });
    f.box(steelDark, [3.0, 2.1, WZ1], [5.0, 2.2, WZ1 + 0.1], { lod: 1 });
    f.box('opening', [5.3, 0, WZ1], [6.3, 2.2, WZ1 + 0.07]);
    f.box(steelDark, [5.2, 0, WZ1], [6.4, 2.3, WZ1 + 0.04], { lod: 1 });
    f.box('team_trim', [ax0, 2.65, WZ1], [ax1, 3.0, WZ1 + 0.08]);
  } else {
    f.box(wall, [ax0, 0, az0], [ax1, ah, az0 + 0.25], { open: true });
    f.box(wall, [ax1 - 0.25, 0, az0], [ax1, ah, WZ1], { open: true, lod: 1 });
    const front: V2[] = [
      [ax0, 0],
      [ax1, 0],
      [ax1, ah],
      [5.7, ah],
      [5.4, 1.9],
      [4.4, 2.5],
      [3.9, 1.0],
      [ax0, 1.6],
    ];
    f.prism(wall, 'z', front, 0.25, [0, 0, WZ1 - 0.125]);
    f.box('opening', [5.3, 0, WZ1], [6.3, 2.2, WZ1 + 0.06], { lod: 1 });
    f.box('roof_tar', [ax0, ah, az0 - 0.15], [ax1 + 0.1, ah + 0.2, 2.6]);
    f.turned([24, 0, 0], [0, ah + 0.2, 2.6], [4.65, ah + 0.2, 2.6]).box(
      'roof_tar',
      [-1.9, ah, 2.6],
      [1.9, ah + 0.2, WZ1 + 0.15],
      { lod: 1 },
    );
  }

  // --- The yard behind the annex: a car, tyres, drums ---
  const car = (fr: Frame): void => {
    fr.box(ruin ? 'rust_dark' : 'metal_red', [3.7, 0.35, -4.8], [5.5, 0.95, -0.8], { lod: 1 });
    fr.box(ruin ? 'rust_metal' : 'metal_light', [3.8, 0.95, -3.7], [5.4, 1.5, -1.7], { lod: 1 });
  };
  if (!ruin) car(f);
  else {
    car(f.turned([0, 12, 7], [4.6, 0, -2.8], [4.7, 0.25, -2.8]));
    f.tilted('rust_dark', [0.6, 0.12, 1.2], [3.4, 0, -0.7], [0, 40, 18], { lod: 1 }, 0); // the bonnet
  }
  if (!ruin)
    for (const [x, z] of [
      [3.95, -4.4],
      [5.25, -4.4],
      [3.95, -1.2],
      [5.25, -1.2],
    ] as const)
      f.cyl('rubber', 0.33, 0.22, [x, 0.33, z], 8, { lod: 0 });
  for (let i = 0; i < 3; i++)
    f.cyl('rubber', 0.4, 0.2, [6.0, i * 0.2, -4.6], 8, { lod: i === 0 ? 1 : 0 });
  f.cyl(ruin ? 'rust_dark' : 'metal_hazard', 0.3, 0.9, [6.0, 0, -3.4], 8, { lod: 0 });
  f.cyl(ruin ? 'rust_metal' : 'metal_dark', 0.3, 0.9, [6.0, 0, -2.7], 8, { lod: 0 });

  if (ruin) {
    rubble(
      f,
      ['concrete_dark', 'rust_dark', 'concrete_ruin'],
      [1.0, -4.0],
      [2.0, 0.8],
      12,
      41,
      { all: 1, mid: 3 },
      1,
    );
    rubble(
      f,
      ['concrete_dark', 'rust_dark'],
      [-1.5, 2],
      [3.0, 2.2],
      10,
      53,
      { all: 0, mid: 2 },
      0.8,
    );
    rubble(
      f,
      ['concrete_dark', 'concrete_ruin'],
      [5.0, 3.0],
      [1.2, 1.0],
      6,
      67,
      { all: 0, mid: 1 },
      0.7,
    );
  }
  return parts;
}

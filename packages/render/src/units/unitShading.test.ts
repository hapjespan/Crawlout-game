import { describe, expect, it } from 'vitest';
import { DataTexture, Scene, Vector3 } from 'three/webgpu';
import { GROUND_AO, groundOcclusionAt } from '../look/groundAo.js';
import { createPropMaterial } from '../structures/propMaterial.js';
import { bakeAnimations } from './bake.js';
import { createHumanoidGeometry } from './humanoidGeometry.js';
import { UNIT_ATLAS_ANISOTROPY, UnitLayer } from './unitLayer.js';
import {
  createUnitMaterial,
  RIM,
  rimAddAt,
  rimBackWeight,
  SKY_FILL,
  silhouetteEdge,
  skyFillAt,
  TEAM,
  teamShade,
  TOON_BANDS,
  TOON_EDGE_SOFT,
} from './unitMaterial.js';

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** View vector from a surface towards an RTS camera at this pitch (degrees above the horizon), from azimuth +z. */
function view(pitchDeg: number): number[] {
  return [0, Math.sin(rad(pitchDeg)), Math.cos(rad(pitchDeg))];
}

/** Unit normal of a vertical wall turned `azDeg` away from the camera's azimuth. */
function wall(azDeg: number): number[] {
  return [Math.sin(rad(azDeg)), 0, Math.cos(rad(azDeg))];
}

/** The former 3D rim term: smoothstep(0.62, 0.8, 1 - N.V). */
function oldRim(n: number[], v: number[]): number {
  const d = Math.max(0, n[0]! * v[0]! + n[1]! * v[1]! + n[2]! * v[2]!);
  const t = Math.min(1, Math.max(0, (1 - d - 0.62) / 0.18));
  return t * t * (3 - 2 * t);
}

describe('unit shading', () => {
  it('keeps the three toon bands, with soft edges that do not overlap', () => {
    expect(TOON_BANDS.dark + TOON_BANDS.mid + TOON_BANDS.light).toBeCloseTo(1, 6);
    expect(TOON_BANDS.midAt + TOON_EDGE_SOFT).toBeLessThan(TOON_BANDS.lightAt - TOON_EDGE_SOFT);
    expect(TOON_EDGE_SOFT).toBeGreaterThan(0);
  });

  it('puts no rim on walls that face the camera, at any RTS pitch (the white sheen of the old 3D test)', () => {
    for (const pitch of [50, 60, 68, 74]) {
      const v = view(pitch);
      for (const az of [0, 30, 60, 70]) expect(silhouetteEdge(wall(az), v)).toBe(0);
      // The old term lit a wall 70 degrees off the view azimuth at every pitch, and at 74 degrees even one facing it.
      expect(oldRim(wall(70), v)).toBeGreaterThan(0.5);
    }
    expect(oldRim(wall(0), view(74))).toBeGreaterThan(0.5);
  });

  it('keeps the rim on the screen silhouette and off surfaces that face up or down', () => {
    for (const pitch of [50, 74]) {
      expect(silhouetteEdge(wall(90), view(pitch))).toBe(1);
      expect(silhouetteEdge(wall(84), view(pitch))).toBeGreaterThan(0.5);
      expect(silhouetteEdge([0, 1, 0], view(pitch))).toBe(0);
      expect(silhouetteEdge([0.15, -0.98, 0.1], view(pitch))).toBe(0);
    }
  });

  it('gives a black coat a rim of its own, cool, and strongest away from the sun', () => {
    // The Klerk's coat is linear 0.022: a rim made of albedo alone (the former RIM.floor + RIM.albedo * c) is
    // invisible on it, which is why the model sank into the haze.
    const coat = 0.022;
    const fromAlbedo = RIM.floor + RIM.albedo * coat;
    expect(fromAlbedo).toBeLessThan(0.05);
    const away = rimAddAt(coat, -1); // silhouette on the side turned away from the sun
    expect(Math.max(...away)).toBeGreaterThan(8 * coat); // reads as an edge, not as coat
    expect(away[2]).toBeGreaterThan(away[0]!); // cool against the warm haze
    // Still bounded: on a white surface the full silhouette stays under 1, so it tone-maps instead of clipping.
    expect(Math.max(...rimAddAt(1, -1))).toBeLessThan(1);
    // Back light: the sunlit side keeps only RIM.sunSide of it.
    const towards = rimAddAt(coat, 1);
    expect(towards[1]! / away[1]!).toBeCloseTo(RIM.sunSide, 6);
    expect(RIM.sunSide).toBeLessThan(1);
    expect(rimBackWeight(0)).toBeCloseTo(1 - (1 - RIM.sunSide) * 0.5, 6);
  });

  it('occludes the ambient at the ground and lets it back by the knee', () => {
    expect(groundOcclusionAt(0)).toBeCloseTo(GROUND_AO.floor, 6);
    expect(groundOcclusionAt(GROUND_AO.height)).toBeCloseTo(1, 6);
    expect(groundOcclusionAt(10)).toBeCloseTo(1, 6); // clamped, a head is not brighter than full
    // Boot (5 cm) clearly dark, calf (20 cm) halfway back, and monotone in between.
    expect(groundOcclusionAt(0.05)).toBeLessThan(0.6);
    expect(groundOcclusionAt(0.2)).toBeGreaterThan(groundOcclusionAt(0.05));
    expect(groundOcclusionAt(0.2)).toBeLessThan(0.85);
    for (let h = 0; h < 0.8; h += 0.05)
      expect(groundOcclusionAt(h + 0.05)).toBeGreaterThanOrEqual(groundOcclusionAt(h));
    // It darkens, never brightens: a lit boot may not end up brighter than the same cloth at the waist.
    expect(GROUND_AO.floor).toBeGreaterThan(0);
    expect(GROUND_AO.floor).toBeLessThan(1);
  });

  it('keeps the texture contrast under the team mask, and the pure team color on a flat base', () => {
    // A flat base (fallback team material): luminance equals the pivot, the team color times TEAM.gain.
    expect(teamShade(0.4, 0.4)).toBeCloseTo(TEAM.gain, 6);
    // A painted jumpsuit with texels from 0.05 to 0.3 around a mean of 0.15: about the texture's own ratio stays.
    const dark = teamShade(0.05, 0.15);
    const light = teamShade(0.3, 0.15);
    expect(light / dark).toBeGreaterThan(4); // the former 0.6 * l + 0.55 gave 1.27 (texture ratio 6)
    expect(dark).toBeGreaterThanOrEqual(TEAM.min * TEAM.gain - 1e-9);
    expect(teamShade(10, 0.1)).toBeCloseTo(TEAM.max * TEAM.gain, 6);
  });

  it('adds a subtle sky fill: cool from above, warm from below, never more than a fifth of the darkest band', () => {
    const up = skyFillAt(1);
    const down = skyFillAt(-1);
    const wall = skyFillAt(0);
    expect(up[2]).toBeGreaterThan(up[0]); // sky: blue over red
    expect(down[0]).toBeGreaterThan(down[2]); // ground bounce: red over blue
    for (const c of [0, 1, 2]) expect(wall[c]).toBeCloseTo((up[c]! + down[c]!) / 2, 6);
    for (const v of [...SKY_FILL.sky, ...SKY_FILL.ground])
      expect(v).toBeLessThan(TOON_BANDS.dark / 4);
    // A dark coat (albedo 0.03) in shadow stays dark: under 0.02 linear.
    expect(0.03 * (TOON_BANDS.dark + Math.max(...wall))).toBeLessThan(0.02);
  });

  it('builds the unit and structure materials with the shared shading', () => {
    const unit = createUnitMaterial(bakeAnimations(), { lightDir: new Vector3(0, 1, 0) });
    expect(unit.material.colorNode).toBeTruthy();
    const building = createPropMaterial({
      lightDir: new Vector3(0, 1, 0),
      name: 'b',
      shadow: undefined,
    });
    expect(building.colorNode).toBeTruthy();
  });

  it('turns on anisotropic filtering for a unit asset atlas', () => {
    const layer = new UnitLayer(new Scene(), { capacity: 4, lightDir: new Vector3(0, 1, 0) });
    const map = new DataTexture(new Uint8Array(4), 1, 1);
    expect(map.anisotropy).toBe(1);
    layer.addRig({
      name: 'atlas',
      anims: layer.anims,
      lods: [createHumanoidGeometry(0), createHumanoidGeometry(1), createHumanoidGeometry(2)],
      albedo: { map },
    });
    expect(map.anisotropy).toBe(UNIT_ATLAS_ANISOTROPY);
    layer.dispose();
  });
});

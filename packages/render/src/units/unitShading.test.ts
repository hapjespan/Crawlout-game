import { describe, expect, it } from 'vitest';
import { DataTexture, Scene, Vector3 } from 'three/webgpu';
import { createPropMaterial } from '../structures/propMaterial.js';
import { bakeAnimations } from './bake.js';
import { createHumanoidGeometry } from './humanoidGeometry.js';
import { UNIT_ATLAS_ANISOTROPY, UnitLayer } from './unitLayer.js';
import {
  createUnitMaterial,
  RIM,
  silhouetteEdge,
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

  it('bounds what the rim adds: a thin light edge on a dark coat, never a white band', () => {
    // Old: a fixed 0.22 linear white, seven times the lit color of a 0.03 albedo.
    const dark = RIM.floor + RIM.albedo * 0.03;
    expect(dark).toBeLessThan(0.06);
    expect(RIM.floor + RIM.albedo * 1).toBeLessThan(0.5);
    expect(RIM.shadeSide).toBeLessThan(1);
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

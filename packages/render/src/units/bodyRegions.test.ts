import { describe, expect, it } from 'vitest';
import { lumaOf } from '../look/surfaces.js';
import {
  DWELLER_PALETTE,
  hasBodyRegions,
  regionOfBone,
  resolveBodyPalette,
  teamBandMask,
  TEAM_BONES,
  vertexRegion,
} from './bodyRegions.js';
import { TEAM_FALLBACK_BASE } from './gltfUnitGeometry.js';

const MIXAMO = [
  'Hips',
  'Spine',
  'Spine1',
  'Spine2',
  'Neck',
  'Head',
  'LeftShoulder',
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'RightShoulder',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
];
const NONE = [undefined, undefined, undefined] as const;
const base = TEAM_FALLBACK_BASE;

describe('body regions of a mannequin', () => {
  it('knows every Mixamo body bone and no others', () => {
    for (const bone of MIXAMO) expect(regionOfBone(bone)).not.toBeNull();
    expect(regionOfBone('root')).toBeNull();
    expect(regionOfBone('prop_socket')).toBeNull();
    expect(hasBodyRegions(MIXAMO)).toBe(true);
    expect(hasBodyRegions(['a', 'b'])).toBe(false);
  });

  it('puts the team color on the upper chest and shoulders only', () => {
    const team = MIXAMO.filter((b) => regionOfBone(b) === 'team').sort();
    expect(team).toEqual(['LeftShoulder', 'RightShoulder', 'Spine2']);
  });

  it('masks a chest vertex fully on the neutral team base, a leg vertex not at all', () => {
    const chest = vertexRegion(['Spine2', ...NONE], [1, 0, 0, 0], base);
    expect(chest.team).toBe(1);
    expect(chest.color).toEqual([base, base, base]);
    const leg = vertexRegion(['LeftLeg', ...NONE], [1, 0, 0, 0], base);
    expect(leg.team).toBe(0);
    expect(lumaOf(...leg.color)).toBeLessThan(0.1); // dark trousers, not the light team base
  });

  it('blends a seam by skin weight', () => {
    const seam = vertexRegion(['Spine2', 'Spine1', undefined, undefined], [0.25, 0.75, 0, 0], base);
    expect(seam.team).toBeCloseTo(0.25, 6);
    const jacket = vertexRegion(['Spine1', ...NONE], [1, 0, 0, 0], base);
    expect(seam.color[0]).toBeCloseTo(0.25 * base + 0.75 * jacket.color[0], 6);
  });

  it('does not need normalized weights and survives an all-zero vertex', () => {
    const doubled = vertexRegion(['Spine2', 'Head', undefined, undefined], [2, 2, 0, 0], base);
    expect(doubled.team).toBeCloseTo(0.5, 6);
    const none = vertexRegion([undefined, ...NONE], [0, 0, 0, 0], base);
    expect(none.team).toBe(0);
    expect(none.color.every((v) => v > 0)).toBe(true);
  });

  it('keeps the clothing darker than the light team base', () => {
    for (const bone of ['Hips', 'LeftArm', 'LeftFoot', 'Head', 'LeftUpLeg']) {
      const r = vertexRegion([bone, ...NONE], [1, 0, 0, 0], base);
      expect(lumaOf(...r.color)).toBeLessThan(lumaOf(base, base, base));
    }
  });
});

describe('clothing palettes per body asset', () => {
  const RAIDER = resolveBodyPalette({
    jacket: '#5e3d28',
    patchTop: '#8f3a2c',
    boots: '#1b1715',
  });
  const SLAVE = resolveBodyPalette({ jacket: '#b6aa8f', teamZone: 'band', farTeam: 0 });

  it('is the Dweller clothing without a manifest palette, and a patch follows the jacket and trousers', () => {
    expect(resolveBodyPalette()).toEqual(DWELLER_PALETTE);
    expect(resolveBodyPalette(null)).toEqual(DWELLER_PALETTE);
    expect(DWELLER_PALETTE.teamZone).toBe('chest');
    expect(DWELLER_PALETTE.farTeam).toBe(1);
    expect(DWELLER_PALETTE.linear.patchTop).toEqual(DWELLER_PALETTE.linear.jacket);
    expect(DWELLER_PALETTE.linear.patchLeg).toEqual(DWELLER_PALETTE.linear.trousers);
    // the Dweller look is what the mannequin was painted with before palettes: arms are jacket, legs trousers
    for (const bone of ['LeftArm', 'RightForeArm'])
      expect(vertexRegion([bone, ...NONE], [1, 0, 0, 0], base).color).toEqual(
        vertexRegion(['Spine1', ...NONE], [1, 0, 0, 0], base).color,
      );
    for (const bone of ['RightUpLeg', 'RightLeg', 'LeftUpLeg'])
      expect(vertexRegion([bone, ...NONE], [1, 0, 0, 0], base).color).toEqual(
        vertexRegion(['LeftLeg', ...NONE], [1, 0, 0, 0], base).color,
      );
  });

  it('paints only the regions the palette names; the rest keeps the Dweller colors', () => {
    const jacket = vertexRegion(['Spine1', ...NONE], [1, 0, 0, 0], base, undefined, RAIDER).color;
    expect(jacket).not.toEqual(DWELLER_PALETTE.linear.jacket);
    expect(jacket).toEqual([...RAIDER.linear.jacket]);
    const belt = vertexRegion(['Hips', ...NONE], [1, 0, 0, 0], base, undefined, RAIDER).color;
    expect(belt).toEqual([...DWELLER_PALETTE.linear.belt]);
    // patchwork: the left arm takes the patch, the right arm the jacket
    expect(vertexRegion(['LeftArm', ...NONE], [1, 0, 0, 0], base, undefined, RAIDER).color).toEqual(
      [...RAIDER.linear.patchTop],
    );
    expect(
      vertexRegion(['RightArm', ...NONE], [1, 0, 0, 0], base, undefined, RAIDER).color,
    ).toEqual([...RAIDER.linear.jacket]);
  });

  it('keeps the team accent on the chest unless the palette moves it to a band', () => {
    expect(vertexRegion(['Spine2', ...NONE], [1, 0, 0, 0], base, undefined, RAIDER).team).toBe(1);
    expect(RAIDER.farTeam).toBe(1);
    expect(SLAVE.teamZone).toBe('band');
    expect(SLAVE.farTeam).toBe(0);
    expect(TEAM_BONES.band).toEqual([]);
    expect(vertexRegion(['Spine2', ...NONE], [1, 0, 0, 0], base, undefined, SLAVE).team).toBe(0);
    expect(regionOfBone('Spine2', 'band')).toBe('jacket');
    expect(regionOfBone('Spine2', 'chest')).toBe('team');
  });

  it('shapes the team band as a window along the upper arm', () => {
    expect(teamBandMask(0)).toBe(0);
    expect(teamBandMask(1)).toBe(0);
    expect(teamBandMask(0.5)).toBe(1);
    expect(teamBandMask(0.35)).toBeGreaterThan(0);
    expect(teamBandMask(0.35)).toBeLessThan(1);
    // symmetric enough to read as a band: both edges soft, the middle third solid
    for (const t of [0.4, 0.5, 0.6]) expect(teamBandMask(t)).toBeGreaterThan(0.95);
  });
});

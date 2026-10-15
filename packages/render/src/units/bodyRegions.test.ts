import { describe, expect, it } from 'vitest';
import { lumaOf } from '../look/surfaces.js';
import { hasBodyRegions, regionOfBone, vertexRegion } from './bodyRegions.js';
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

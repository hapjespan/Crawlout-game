// Normen uit docs/spelfundament-v0.1.md sectie 9 (technische brief). Eén plek, zodat validatie en LOD-bouw gelijk blijven.
export const BUDGETS = {
  /** Maximum aantal driehoeken per LOD voor karakters (brief: 3000-4000, 1200-1500, 400-600). */
  characterMaxTris: [4000, 1500, 600] as const,
  /** Props: LOD0 hetzelfde plafond; LOD1/2 als aandeel van LOD0. */
  propMaxTris0: 4000,
  propLodRatios: [1, 0.4, 0.15] as const,
  maxBones: 28,
  maxTextureSize: 2048,
  characterHeight: 1.8,
  /** Tolerantie op hoogte (relatief) en op voeten rond y=0 (meter). */
  heightTolerance: 0.15,
  feetTolerance: 0.05,
  requiredClips: ['idle', 'walk', 'run', 'attack1', 'attack2', 'gather', 'build', 'death'] as const,
  /** Bones die een Mixamo-skelet minimaal moet hebben (zonder prefix). */
  mixamoCoreBones: ['Hips', 'Spine', 'Head', 'LeftArm', 'RightArm', 'LeftUpLeg', 'RightUpLeg', 'LeftFoot', 'RightFoot'] as const,
} as const;

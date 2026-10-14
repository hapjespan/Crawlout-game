// Normen uit docs/spelfundament-v0.1.md sectie 9 (technische brief). Eén plek, zodat validatie en LOD-bouw gelijk blijven.
export const BUDGETS = {
  /** Maximum aantal driehoeken per LOD voor karakters (brief: 3000-4000, 1200-1500, 400-600). */
  characterMaxTris: [4000, 1500, 600] as const,
  /** Ondergrens per LOD voor karakters (brief). Alleen afgedwongen als de buis zelf heeft gereduceerd: een bron mag lichter zijn dan de band. */
  characterMinTris: [3000, 1200, 400] as const,
  /** Doel voor LOD1 en LOD2 van karakters: het midden van de band, zodat simplify aan beide kanten marge heeft. */
  characterLodTargets: [3600, 1350, 500] as const,
  /**
   * Props mogen lagere budgetten hebben dan karakters: de brief stelt alleen eisen aan karakters, en de Gobkit-props
   * zijn 3 tot 52 driehoeken. Absolute plafonds per LOD (geen aandeel van LOD0); een prop onder het plafond blijft
   * ongewijzigd, dus LOD1 en LOD2 zijn dan dezelfde geometrie als LOD0.
   */
  propMaxTris: [2000, 800, 300] as const,
  maxBones: 28,
  maxTextureSize: 2048,
  characterHeight: 1.8,
  /** Tolerantie op hoogte (relatief) en op voeten rond y=0 (meter). */
  heightTolerance: 0.15,
  feetTolerance: 0.05,
  requiredClips: ['idle', 'walk', 'run', 'attack1', 'attack2', 'gather', 'build', 'death'] as const,
  /** Bones die een Mixamo-skelet minimaal moet hebben (zonder prefix). */
  mixamoCoreBones: [
    'Hips',
    'Spine',
    'Head',
    'LeftArm',
    'RightArm',
    'LeftUpLeg',
    'RightUpLeg',
    'LeftFoot',
    'RightFoot',
  ] as const,
} as const;

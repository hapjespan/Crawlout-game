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
  /**
   * Gebouwen (kind 'building', de varianten van assets/src/buildings/variants.json): absolute plafonds per LOD. De brief
   * noemt alleen karakters; gebouwen staan stil en worden per type geinstanced, dus LOD0 mag ongeveer 1500 tot 2500
   * driehoeken hebben bij de grote gebouwen (hoofdgebouw), de kleine blijven er ruim onder via `lod0Triangles` in de
   * config. LOD1 is het werkpaard op middenafstand, LOD2 een silhouet voor de verte.
   */
  buildingMaxTris: [2500, 1000, 300] as const,
  /** Verhouding van LOD1 en LOD2 tot het LOD0-doel van een gebouw (`lod0Triangles` in de config), begrensd door het plafond. */
  buildingLodRatios: [1, 0.4, 0.12] as const,
  /**
   * Textuurmaat per LOD (maximale zijde, JPEG). De bron-textures (512 tot 1024) worden hier naartoe verkleind (nooit
   * vergroot) zodat de LOD-GLB's klein blijven; LOD0 mag tot `buildingMaxTextureSize`. Render houdt de gebouwen in een
   * texture-array met 1024 px per laag.
   */
  buildingTextureSizes: [1024, 512, 256] as const,
  buildingMaxTextureSize: 1024,
  /**
   * Vereenvoudiging van de bronmeshes van gebouwen (meshopt). `Prune` laat losse kleine onderdelen (de planken en
   * spijlen van het huisje) vallen zodra het budget krap is; de gewichten houden uv-eilanden en vlakken bijeen.
   */
  buildingSimplify: { flags: ['Prune', 'Permissive'], uvWeight: 4, normalWeight: 0.5 } as {
    flags: readonly ('Prune' | 'Permissive' | 'LockBorder' | 'Sparse')[];
    uvWeight: number;
    normalWeight: number;
  },
  /**
   * Verdeling van het driehoekbudget over de materiaalmeshes van een huisonderdeel: aandeel ~ driehoeken^exponent.
   * Onder 1 houden kleine meshes (het dak, 250 driehoeken) verhoudingsgewijs meer dan de grote (planken en spijlen).
   */
  buildingBudgetExponent: 0.5,
  /** Afstand (in eenheden van het bronmodel) waarbinnen hoekpunten als hetzelfde punt tellen bij `select.components`. */
  buildingWeldDistance: 0.1,
  /**
   * Per LOD: samenhangende delen van een bronmesh die samen minder dan dit deel van het oppervlak hebben (planken,
   * spijlen, ramen) vallen weg. Op de verre LODs blijven zo de dakvlakken en wanden over in plaats van een brij.
   */
  buildingMinComponentArea: [0, 0.01, 0.05] as const,
  /**
   * Het gebouw staat binnen de footprint van w x h cellen van 1 m (hooguit 5 procent erbuiten). Er ligt geen grondplaat
   * meer onder de gebouwen: de footprint is wat de sim reserveert, de bounds van het model vullen hem niet exact.
   */
  buildingFootprintTolerance: 0.05,
  /** Per LOD: het model vult minstens dit deel van w en van h (een stuk van de footprint is veranda, erf en marge). */
  buildingFootprintMinFill: [0.85, 0.85, 0.75] as const,
  /** Het midden van de bounds ligt binnen dit deel van w en h van de oorsprong (LOD2 laat de veranda weg). */
  buildingCentreTolerance: 0.08,
  /** De grond staat op y = 0, tolerantie in meter. */
  buildingGroundTolerance: 0.01,
  /**
   * Rigide units (kind 'rigid-unit'): absolute plafonds per LOD. Stond op [2000, 800, 300] toen dit alleen de robots
   * uit assets/src/robots.json waren: geinstanced per type, dus lager dan karakters. Sinds 22 oktober staan er ook
   * geleverde mensfiguren in (krachtpantser, de Klerk, de held van de Raiders). Die vullen hetzelfde beeld als een
   * geskind karakter en verdienen dus dezelfde band als `characterMaxTris`. Het oude plafond dwong twee slechte
   * keuzes af: LOD0 werd op 2000 afgekapt terwijl de bronmodellen tienduizenden driehoeken hebben, en LOD2 van 300
   * paste niet naast meer dan dertien materiaalgroepen, zodat texturen moesten worden opgeofferd om er onder te
   * komen. Het plafond is een vangnet; wat elk model echt kost, staat in zijn eigen `lod0Triangles`.
   */
  rigidUnitMaxTris: [4000, 1500, 600] as const,
  /** Tolerantie (m) op de zweefhoogte: `hover` tegen de onderkant van de bounds. */
  hoverTolerance: 0.01,
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

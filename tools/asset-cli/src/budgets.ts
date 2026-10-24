// Normen uit docs/spelfundament-v0.1.md sectie 9 (technische brief). Eén plek, zodat validatie en LOD-bouw gelijk blijven.
export const BUDGETS = {
  /**
   * Maximum aantal driehoeken per LOD voor karakters. De brief noemde 3000-4000; dat was een plafond uit de tijd dat
   * de framerate het knelpunt heette. Gemeten op de Klerk (`fallout_brotherhood_of_steel_squire.glb`, 93.878
   * driehoeken, 39 primitives, 29 materialen) valt dat plafond zichtbaar te laag uit, want simplify deelt één ratio
   * uit over álle primitives: bij een doel van 4000 houdt de jas 1084 van 30.924 driehoeken over en het **hoofd 28 van
   * 1150** — een gezicht van 28 driehoeken is een bol. Dezelfde reductie op 12.000 geeft het hoofd 125, op 20.000 geeft
   * hij jas 6064, helm 1955 en hoofd 222; daarboven (28.000: hoofd 317) is het verschil in de vooraanzichten niet meer
   * te zien. 24.000 is dus het plafond met marge boven het werkpunt van 20.000; wat een model echt kost staat in zijn
   * eigen `lod0Triangles`.
   */
  characterMaxTris: [24000, 9000, 3000] as const,
  /**
   * Ondergrens per LOD voor karakters. Alleen afgedwongen als de buis zelf heeft gereduceerd: een bron mag lichter
   * zijn dan de band. LOD0 blijft op 3000 zodat een licht bronmodel (`dweller_body_human`, 1281 driehoeken) zijn eigen
   * `lod0Triangles` van 3600 mag houden; LOD1 en LOD2 gaan omhoog omdat ze nu echte middenafstand-LOD's zijn.
   */
  characterMinTris: [3000, 2500, 800] as const,
  /** Doel voor LOD1 en LOD2 van karakters: ongeveer een derde en een negende van het LOD0-werkpunt van 20.000. */
  characterLodTargets: [20000, 7000, 2200] as const,
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
   *
   * Het LOD0-plafond staat op 6000 (was 2500). Aanleiding: `dweller_building_storage` is een photogrammetry-scan van
   * 2,75 miljoen driehoeken. Bij 2500 krijgt elk van de zes materiaalgroepen gemiddeld 417 driehoeken; de simplifier
   * reduceert de grote panelen zo ver dat de gebouwvorm in silhouet instort. 6000 geeft ~1000 per groep, genoeg om de
   * golfplaatwanden en het dak herkenbaar te houden. Alle bestaande gebouwen in assets/src en assets/dist hebben hun
   * eigen `lod0Triangles` ≤ 2500 en blijven daardoor ongewijzigd: het plafond is een vangnet, niet een doel.
   *
   * 22 oktober stond het plafond op 6000. Dat is op 23 oktober mee omhoog gegaan met de karakters: een gebouw vult
   * meer beeld dan een unit en staat stil, dus het mag niet onder de band van een karakter liggen. De bronnen geven
   * de ruimte: `old_industrial_storage_building.glb` is 2.750.173 driehoeken, de utility-hal 13.548.
   */
  buildingMaxTris: [20000, 8000, 2500] as const,
  /** Verhouding van LOD1 en LOD2 tot het LOD0-doel van een gebouw (`lod0Triangles` in de config), begrensd door het plafond. */
  buildingLodRatios: [1, 0.4, 0.12] as const,
  /**
   * Textuurmaat per LOD (maximale zijde, JPEG). De bron-textures (512 tot 1024) worden hier naartoe verkleind (nooit
   * vergroot) zodat de LOD-GLB's klein blijven; LOD0 mag tot `buildingMaxTextureSize`. Render houdt de gebouwen in een
   * texture-array met 1024 px per laag.
   *
   * LOD1 stond op 512 en LOD2 op 256. Gemeten: élke textuur in `assets/local/delivered/` is ten hoogste 1024 (de
   * meeste precies 1024x1024), dus LOD1 gooide driekwart van de texels weg van materiaal dat op middenafstand nog
   * het grootste deel van het beeld vult. LOD1 krijgt de volle 1024, LOD2 512.
   */
  buildingTextureSizes: [1024, 1024, 512] as const,
  buildingMaxTextureSize: 1024,
  /**
   * Textuurmaat per LOD voor karakters en props uit `buildLods` (maximale zijde; nooit vergroot). Gebouwen hadden dit
   * al (`buildingTextureSizes`), karakters niet: LOD2 van de Klerk droeg dezelfde 22 kaarten van 1024 als LOD0, goed
   * voor 48 MB aan beeld bij 2157 driehoeken.
   *
   * De drie LOD-GLB's van een karakter worden alle drie geladen en delen één texture-array: `TextureLayerTable` houdt
   * per materiaalnaam de **grootste** afbeelding, dus LOD0 bepaalt wat er op de GPU staat en de kaarten van LOD1 en
   * LOD2 worden niet bemonsterd. Kleiner maken kost dus geen zichtbare kwaliteit, alleen downloadbytes. LOD1 houdt de
   * helft en LOD2 een kwart als marge voor een pad dat ooit één losse LOD laadt.
   *
   * Dit zijn plafonds, geen doelen: elke LOD halveert bovendien de eigen zijde van de bron (`edge >> level`), dus een
   * bron van 1024 wordt 1024 / 512 / 256 en een atlas van 2048 wordt 2048 / 1024 / 512. Het plafond van LOD0 staat op
   * `maxTextureSize` zodat een samengevoegde atlas zijn maat houdt: die draagt 23 materialen in één beeld en zou bij
   * 1024 per cel nog maar 128 tot 256 px overhouden.
   */
  characterTextureSizes: [2048, 1024, 512] as const,
  /**
   * WebP-kwaliteit per kaartsoort in de LOD-GLB's (sharp). Basiskleur mag lossy; de alfa draagt het teammasker en gaat
   * met `alphaQuality: 100` lossless mee. Normalen zijn het gevoeligst (chroma draagt X en Y) en krijgen daarom de
   * hoogste kwaliteit: gemeten op de Klerk is 95 een RMSE van 2,0 op 255 bij een vijfde van de PNG-bytes, waar ETC1S
   * op een normal map zichtbare banding geeft. MetallicRoughness is data en volgt de normalen.
   */
  characterTextureQuality: { base: 92, normal: 95, mr: 95 } as const,
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
   *
   * 23 oktober mee omhoog met `characterMaxTris`: het krachtpantserframe en de held van de Raiders vullen hetzelfde
   * beeld als een geskind karakter, dus ze horen in dezelfde band.
   */
  rigidUnitMaxTris: [24000, 9000, 3000] as const,
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

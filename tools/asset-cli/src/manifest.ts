// Manifest-formaat van de asset-cli. Dit bestand is het contract met packages/render:
//   import { manifestSchema, type AssetManifest } from '@crawlout/asset-cli/manifest';
// Alleen zod als runtime-afhankelijkheid; geen Node-imports, dus bruikbaar in de browser.
import { ANIM_NAMES } from '@crawlout/protocol';
import { z } from 'zod';

export const MANIFEST_VERSION = 1 as const;

const vec3 = z.tuple([z.number(), z.number(), z.number()]);

/** Categorieen van props uit de DJMaesen-packs (assets/src/packs.json); map en render kiezen props hierop. */
export const PROP_CATEGORIES = [
  'tree-leafy',
  'tree-bare',
  'grass',
  'plant',
  'rock',
  'crate',
  'chest',
  'barrel',
  'structure',
  'debris',
] as const;
export const propCategorySchema = z.enum(PROP_CATEGORIES);

/**
 * De oppervlaktesoorten van de gegenereerde tegels. Dit is de contractlijst: asset-cli (`surfaceTex.ts`,
 * `surfaceKindOfName`) en render (`look/surfaces.ts`, `surfaceKindOfMaterial`) moeten dezelfde lijst en dezelfde
 * ladder houden. Staat hier omdat het manifest het contract is en dit bestand geen Node-imports heeft.
 */
export const SURFACE_KINDS = [
  'wood',
  'paintedMetal',
  'rustMetal',
  'cloth',
  'leather',
  'skin',
  'rock',
  'foliage',
  'concrete',
  'roofing',
  'lens',
] as const;
export const surfaceKindSchema = z.enum(SURFACE_KINDS);

/**
 * Een gedeelde oppervlaktetegel: de drie kaarten van een oppervlaktesoort, als losse bestanden naast manifest.json.
 * Alle drie tilen, zijn vierkant en hebben dezelfde maat (`SurfaceTiles.size`), zodat render ze op een laagindex kan
 * adresseren precies zoals bij een ingebedde kaart.
 */
export const surfaceTileSchema = z
  .object({
    kind: surfaceKindSchema,
    /** Grijswaarde-verweringskaart op de basiskleur (sRGB); pad relatief aan de map van manifest.json. */
    base: z.string().min(1),
    /** Tangent-space normalkaart (lineair, glTF +Y omhoog). */
    normal: z.string().min(1),
    /** glTF metallicRoughness: G = roughness, B = metalness (lineair). */
    mr: z.string().min(1),
  })
  .strict();

/**
 * De gedeelde oppervlaktetegels van deze build (fase-0 sectie 28). Een materiaal in een LOD-GLB dat zo'n tegel
 * gebruikt draagt de kaarten niet zelf: het heeft `extras.surface` met de naam van zijn oppervlaktesoort en geen
 * enkele textuur. Render zoekt de soort hier op, laadt het tegelbestand een keer en hangt het op het materiaal
 * voordat het de textuurlaagtabel in gaat.
 *
 * Ontbreekt dit veld, dan gebruikt geen enkel asset gedeelde tegels en draagt elk materiaal zijn eigen kaarten; dat
 * is het gedrag van voor deze wijziging en blijft geldig.
 */
export const surfaceTilesSchema = z
  .object({
    /** Zijde van elke tegel in texels; elke soort en elke kaart heeft dezelfde maat. */
    size: z.number().int().positive(),
    /** Hoeveel meter een hele tegel beslaat in de UV van de assets (asset-cli `UV_METERS_PER_TILE`). */
    metersPerTile: z.number().positive(),
    /** Hoogstens een regel per soort, gesorteerd op `kind`. */
    tiles: z.array(surfaceTileSchema).min(1),
  })
  .strict()
  .superRefine((surfaces, ctx) => {
    const kinds = surfaces.tiles.map((t) => t.kind);
    if (new Set(kinds).size !== kinds.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'elke oppervlaktesoort hoort een keer',
      });
    if ([...kinds].sort().join(',') !== kinds.join(','))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'tiles staan gesorteerd op kind' });
  });

/** Allowed `albedoGain` values; render clamps its explicit override to the same range. */
export const ALBEDO_GAIN_RANGE = [0.5, 2] as const;

export const albedoGainSchema = z.number().min(ALBEDO_GAIN_RANGE[0]).max(ALBEDO_GAIN_RANGE[1]);

/**
 * Kledingkleuren van een poppetje (alleen karakters, render: `units/bodyRegions.ts`). Elke regio is een `#rrggbb` (sRGB);
 * een ontbrekende regio houdt de standaardkleur van render (de Dweller-kleding), `patchTop` en `patchLeg` volgen
 * `jacket` en `trousers` als ze ontbreken. `patchTop` is de linkerarm (een lap op de mouw), `patchLeg` de rechterbovenbeen.
 * `teamZone`: waar de spelerskleur zit: 'chest' (borst en schouders, standaard) of 'band' (alleen een band om de linkerbovenarm).
 * `farTeam` (0 tot 1, standaard 1): hoeveel van het hele bovenlijf op grote afstand de spelerskleur krijgt (leesbaarheid van het team).
 */
export const BODY_PALETTE_REGIONS = [
  'jacket',
  'patchTop',
  'patchLeg',
  'belt',
  'trousers',
  'boots',
  'skin',
] as const;
const paletteColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'verwacht een kleur als #rrggbb');
export const bodyPaletteSchema = z
  .object({
    jacket: paletteColor.optional(),
    patchTop: paletteColor.optional(),
    patchLeg: paletteColor.optional(),
    belt: paletteColor.optional(),
    trousers: paletteColor.optional(),
    boots: paletteColor.optional(),
    skin: paletteColor.optional(),
    teamZone: z.enum(['chest', 'band']).optional(),
    farTeam: z.number().min(0).max(1).optional(),
  })
  .strict();

export const boundsSchema = z.object({ min: vec3, max: vec3 });

export const lodSchema = z.object({
  /** 0 is de zwaarste, 2 de lichtste. */
  level: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  /** Pad relatief aan de map van manifest.json, met forward slashes. */
  path: z.string().min(1),
  triangles: z.number().int().nonnegative(),
});

export const animationSchema = z.object({
  name: z.string().min(1),
  /** Duur in seconden. */
  durationSeconds: z.number().nonnegative(),
});

/** Socketposities in meters, in de rustpose van het model (modelruimte). */
export const socketsSchema = z.object({
  hand: vec3.optional(),
  back: vec3.optional(),
  head: vec3.optional(),
});

export const bakedClipSchema = z.object({
  /** Canonieke naam uit ANIM_NAMES. */
  name: z.string().min(1),
  /** Eerste rij van het blok in de texture. */
  startRow: z.number().int().nonnegative(),
  /** Aantal rijen (frames) van de clip. */
  frames: z.number().int().min(2),
  /** Loop-clips bemonsteren [0, 1); one-shot clips (death) sluiten de laatste pose op 1 in. */
  loop: z.boolean(),
  durationSeconds: z.number().positive(),
});

/**
 * Animaties gebakken naar een bone-matrix-texture (fase-0 sectie 12): RGBA float32 little-endian, rij na rij,
 * `width` = boneCount * 4 texels, `height` = som van alle frames. Clips staan in de volgorde van ANIM_NAMES,
 * elk een aaneengesloten blok rijen.
 */
export const bakedAnimationSchema = z
  .object({
    /** Pad relatief aan de map van manifest.json. */
    path: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive(),
    clips: z.array(bakedClipSchema),
  })
  .superRefine((baked, ctx) => {
    const issue = (message: string): void => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (baked.width % 4 !== 0) issue(`width ${baked.width} is geen veelvoud van 4`);
    const names = baked.clips.map((c) => c.name);
    if (names.join(',') !== ANIM_NAMES.join(','))
      issue(
        `clips moeten ${ANIM_NAMES.join(', ')} zijn, in die volgorde; gevonden: ${names.join(', ') || 'geen'}`,
      );
    let row = 0;
    for (const clip of baked.clips) {
      if (clip.startRow !== row)
        issue(
          `clip "${clip.name}" begint op rij ${clip.startRow}, verwacht ${row} (aaneengesloten blokken)`,
        );
      row += clip.frames;
    }
    if (row !== baked.height) issue(`som van de frames is ${row}, maar height is ${baked.height}`);
  });

export const assetEntrySchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['character', 'prop', 'building', 'rigid-unit']),
    bounds: boundsSchema,
    /** Altijd precies LOD 0, 1 en 2, in die volgorde. */
    lods: z.tuple([lodSchema, lodSchema, lodSchema]),
    sockets: socketsSchema,
    animations: z.array(animationSchema),
    /** Aantal bones van het skelet; 0 voor props. */
    boneCount: z.number().int().nonnegative(),
    /**
     * Alleen gebouwen: footprint in cellen van 1 m (zoals data/buildings/*.json). Het model staat met het midden van de
     * footprint op de oorsprong in x en z, de grond op y = 0, en de bounds vullen w x h binnen 5 procent.
     */
    footprint: z
      .object({ w: z.number().int().positive(), h: z.number().int().positive() })
      .optional(),
    /** Gebouwen en rigide units: namen van de materialen die de spelerskleur krijgen (naam bevat "team"); minstens een, behalve bij een ruine zonder eigenaar (`site_*_ruin`): dan een lege lijst. */
    teamMaterials: z.array(z.string().min(1)).optional(),
    /**
     * Waar het teammasker (de delen die de spelerskleur krijgen) vandaan komt, zoals render's `TeamMaskSource`:
     * 'materialName' (materialen met "team" in de naam), 'diffuseAlpha' (de alfa van de diffuse, per texel) of 'none'.
     * Aanwezig bij karakters en props; ontbreekt het, dan geldt 'materialName'. Gebouwen gebruiken `teamMaterials`.
     */
    teamMask: z.enum(['materialName', 'diffuseAlpha', 'none']).optional(),
    /**
     * Welke PBR-kaarten naast de diffuse in de LOD-GLB's staan. Elke kaart ligt op het materiaal naast de
     * `baseColorTexture`, met dezelfde UV-set en dezelfde maat, zodat render per kaartsoort een array-texture kan
     * bouwen waarin een primitive overal dezelfde laagindex heeft. Een materiaal zonder zo'n kaart krijgt geen laag
     * (render leest dat als vlak). Ontbreekt het veld of is het leeg, dan is er alleen diffuse.
     */
    maps: z.array(z.enum(['normal', 'metallicRoughness', 'occlusion', 'emissive'])).optional(),
    /** Aanwezig voor karakters met animaties; props en karakters zonder clips hebben geen baked. */
    baked: bakedAnimationSchema.optional(),
    /** Alleen props (de pack-props): soort, voor map (plaatsing) en render (schaduw, wind, beweegbaarheid). */
    category: propCategorySchema.optional(),
    /**
     * Alleen props met transparante delen (bladkaarten, gras): 'mask' = het materiaal heeft alphaMode MASK met een
     * alphaCutoff en de diffuse textuur (PNG of WebP) heeft een alfakanaal; render tekent het met alpha-test, niet
     * met blending. Ontbreekt het veld, dan is het materiaal ondoorzichtig.
     */
    alpha: z.enum(['mask']).optional(),
    /**
     * Helderheidsfactor op de albedo van dit asset (0,5 tot 2), voor kunst die onder de toon-ramp te donker of te licht
     * naast de rest staat. Ontbreekt het, dan is het 1. Render leest het; de renderer-optie `albedoGain` blijft een
     * expliciete override per asset-id. Bron: `albedoGain` bij het prop in packs.json of bij de variant in variants.json.
     */
    albedoGain: albedoGainSchema.optional(),
    /**
     * Alleen kind 'rigid-unit' (robots: een star model zonder skelet, geen animaties, geen bake; beweging is een
     * transform van het hele model): altijd `true`. Render tekent zo'n unit als een instanced mesh in plaats van een
     * geskind karakter. Velden die render leest: `rigid`, `bounds`, `teamMaterials` en `hover`.
     */
    rigid: z.literal(true).optional(),
    /**
     * Alleen kind 'rigid-unit' die zweeft (reparatiedrone): de hoogte in meters van de onderkant van het model boven
     * de grond. De zweefhoogte zit al in het model gebakken (`bounds.min[1]` is gelijk aan `hover`): render zet het model
     * op de grond-y van de unit en telt `hover` er NIET nog eens bij op. Het veld dient voor wat op de grond hoort
     * (schaduwvlek, selectiering, healthbar-afstand). Ontbreekt het, dan staat het model op de grond (min y = 0).
     */
    hover: z.number().positive().optional(),
    /** Alleen karakters: de kledingkleuren die render op het skelet schildert (zie `bodyPaletteSchema`). */
    palette: bodyPaletteSchema.optional(),
  })
  .superRefine((entry, ctx) => {
    if (entry.palette && entry.kind !== 'character')
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'palette is alleen voor karakters' });
    if (entry.kind === 'rigid-unit') {
      if (entry.rigid !== true)
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'een rigid-unit heeft rigid: true' });
      if (entry.teamMask !== 'none' && (!entry.teamMaterials || entry.teamMaterials.length === 0))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'een rigid-unit heeft een team-materiaal (teamMaterials)',
        });
      if (entry.footprint || entry.boneCount !== 0 || entry.baked || entry.animations.length > 0)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'een rigid-unit heeft geen footprint, bones, animaties of bake',
        });
      if (entry.hover !== undefined && Math.abs(entry.bounds.min[1] - entry.hover) > 0.01)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `hover ${entry.hover} komt niet overeen met bounds.min.y ${entry.bounds.min[1]}`,
        });
      return;
    }
    if (entry.rigid || entry.hover !== undefined)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'rigid en hover zijn alleen voor rigid-units',
      });
    if ((entry.category || entry.alpha) && entry.kind !== 'prop')
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'category en alpha zijn alleen voor props',
      });
    if (entry.kind === 'building') {
      if (!entry.footprint)
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'een gebouw heeft een footprint' });
      // An empty list is allowed: a ruin or wreck without an owner (the site ruins) has no team colour.
      if (!entry.teamMaterials)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'een gebouw heeft teamMaterials (leeg voor een ruine zonder teamkleur)',
        });
    } else if (entry.footprint || entry.teamMaterials) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'footprint en teamMaterials zijn alleen voor gebouwen',
      });
    }
    if (entry.baked && entry.baked.width !== entry.boneCount * 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `baked.width ${entry.baked.width} komt niet overeen met boneCount ${entry.boneCount} * 4`,
      });
    }
  });

export const manifestSchema = z.object({
  version: z.literal(MANIFEST_VERSION),
  assets: z.array(assetEntrySchema),
  /** De gedeelde oppervlaktetegels, als deze build ze schrijft; zie `surfaceTilesSchema`. */
  surfaces: surfaceTilesSchema.optional(),
});

/**
 * Naam van de glTF-material-extra die zegt dat een materiaal een gedeelde tegel gebruikt. De waarde is een
 * `SurfaceKind`. Drie's GLTFLoader zet material extras op `material.userData`, dus render leest
 * `material.userData[SURFACE_EXTRA]`. Een materiaal met deze extra heeft zelf geen enkele textuur.
 */
export const SURFACE_EXTRA = 'surface' as const;

export type Vec3 = z.infer<typeof vec3>;
export type SurfaceKind = z.infer<typeof surfaceKindSchema>;
export type SurfaceTile = z.infer<typeof surfaceTileSchema>;
export type SurfaceTiles = z.infer<typeof surfaceTilesSchema>;
export type PropCategory = z.infer<typeof propCategorySchema>;
export type AssetBounds = z.infer<typeof boundsSchema>;
export type AssetLod = z.infer<typeof lodSchema>;
export type AssetAnimation = z.infer<typeof animationSchema>;
export type AssetSockets = z.infer<typeof socketsSchema>;
export type BodyPalette = z.infer<typeof bodyPaletteSchema>;
export type BakedClip = z.infer<typeof bakedClipSchema>;
export type BakedAnimation = z.infer<typeof bakedAnimationSchema>;
export type AssetEntry = z.infer<typeof assetEntrySchema>;
export type AssetManifest = z.infer<typeof manifestSchema>;

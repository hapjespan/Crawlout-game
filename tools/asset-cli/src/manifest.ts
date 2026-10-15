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
     * Alleen gebouwen: footprint in cellen van 1 m (zoals data/buildings.json). Het model staat met het midden van de
     * footprint op de oorsprong in x en z, de grond op y = 0, en de bounds vullen w x h binnen 5 procent.
     */
    footprint: z
      .object({ w: z.number().int().positive(), h: z.number().int().positive() })
      .optional(),
    /** Gebouwen en rigide units: namen van de materialen die de spelerskleur krijgen (naam bevat "team"); altijd minstens een. */
    teamMaterials: z.array(z.string().min(1)).optional(),
    /**
     * Waar het teammasker (de delen die de spelerskleur krijgen) vandaan komt, zoals render's `TeamMaskSource`:
     * 'materialName' (materialen met "team" in de naam), 'diffuseAlpha' (de alfa van de diffuse, per texel) of 'none'.
     * Aanwezig bij karakters en props; ontbreekt het, dan geldt 'materialName'. Gebouwen gebruiken `teamMaterials`.
     */
    teamMask: z.enum(['materialName', 'diffuseAlpha', 'none']).optional(),
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
  })
  .superRefine((entry, ctx) => {
    if (entry.kind === 'rigid-unit') {
      if (entry.rigid !== true)
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'een rigid-unit heeft rigid: true' });
      if (!entry.teamMaterials || entry.teamMaterials.length === 0)
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
      if (!entry.teamMaterials || entry.teamMaterials.length === 0)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'een gebouw heeft een team-materiaal',
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
});

export type Vec3 = z.infer<typeof vec3>;
export type PropCategory = z.infer<typeof propCategorySchema>;
export type AssetBounds = z.infer<typeof boundsSchema>;
export type AssetLod = z.infer<typeof lodSchema>;
export type AssetAnimation = z.infer<typeof animationSchema>;
export type AssetSockets = z.infer<typeof socketsSchema>;
export type BakedClip = z.infer<typeof bakedClipSchema>;
export type BakedAnimation = z.infer<typeof bakedAnimationSchema>;
export type AssetEntry = z.infer<typeof assetEntrySchema>;
export type AssetManifest = z.infer<typeof manifestSchema>;

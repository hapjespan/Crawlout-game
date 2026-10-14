// Manifest-formaat van de asset-cli. Dit bestand is het contract met packages/render:
//   import { manifestSchema, type AssetManifest } from '@crawlout/asset-cli/manifest';
// Alleen zod als runtime-afhankelijkheid; geen Node-imports, dus bruikbaar in de browser.
import { ANIM_NAMES } from '@crawlout/protocol';
import { z } from 'zod';

export const MANIFEST_VERSION = 1 as const;

const vec3 = z.tuple([z.number(), z.number(), z.number()]);

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
    kind: z.enum(['character', 'prop']),
    bounds: boundsSchema,
    /** Altijd precies LOD 0, 1 en 2, in die volgorde. */
    lods: z.tuple([lodSchema, lodSchema, lodSchema]),
    sockets: socketsSchema,
    animations: z.array(animationSchema),
    /** Aantal bones van het skelet; 0 voor props. */
    boneCount: z.number().int().nonnegative(),
    /** Aanwezig voor karakters met animaties; props en karakters zonder clips hebben geen baked. */
    baked: bakedAnimationSchema.optional(),
  })
  .superRefine((entry, ctx) => {
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
export type AssetBounds = z.infer<typeof boundsSchema>;
export type AssetLod = z.infer<typeof lodSchema>;
export type AssetAnimation = z.infer<typeof animationSchema>;
export type AssetSockets = z.infer<typeof socketsSchema>;
export type BakedClip = z.infer<typeof bakedClipSchema>;
export type BakedAnimation = z.infer<typeof bakedAnimationSchema>;
export type AssetEntry = z.infer<typeof assetEntrySchema>;
export type AssetManifest = z.infer<typeof manifestSchema>;

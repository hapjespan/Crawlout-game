// Manifest-formaat van de asset-cli. Dit bestand is het contract met packages/render:
//   import { manifestSchema, type AssetManifest } from '@crawlout/asset-cli/manifest';
// Alleen zod als runtime-afhankelijkheid; geen Node-imports, dus bruikbaar in de browser.
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

/** Stub voor sprint 2: animaties gebakken naar bone-matrix textures. Nog nooit gevuld. */
export const bakedAnimationSchema = z.object({
  texturePath: z.string().min(1),
  fps: z.number().positive(),
  boneCount: z.number().int().positive(),
  clips: z.array(z.object({ name: z.string().min(1), firstFrame: z.number().int().nonnegative(), frameCount: z.number().int().positive() })),
});

export const assetEntrySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['character', 'prop']),
  bounds: boundsSchema,
  /** Altijd precies LOD 0, 1 en 2, in die volgorde. */
  lods: z.tuple([lodSchema, lodSchema, lodSchema]),
  sockets: socketsSchema,
  animations: z.array(animationSchema),
  /** Aantal bones van het skelet; 0 voor props. */
  boneCount: z.number().int().nonnegative(),
  /** Sprint 2; ontbreekt zolang het bakken niet bestaat. */
  baked: bakedAnimationSchema.optional(),
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
export type BakedAnimation = z.infer<typeof bakedAnimationSchema>;
export type AssetEntry = z.infer<typeof assetEntrySchema>;
export type AssetManifest = z.infer<typeof manifestSchema>;

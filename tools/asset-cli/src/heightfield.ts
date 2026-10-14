// Formaat van het afgeleide terrein (hoogteveld en terrein-manifest). Contract met de map-werkstroom:
//   import { heightfieldSchema, heightAt } from '@crawlout/asset-cli/heightfield';
// Alleen zod als runtime-afhankelijkheid; geen Node-imports, dus bruikbaar in browser en in packages/map.
import { z } from 'zod';

export const HEIGHTFIELD_FORMAT = 'crawlout-heightfield/1' as const;
export const TERRAIN_MANIFEST_FORMAT = 'crawlout-terrain/1' as const;

/**
 * Hoogteveld in meters. `heights[j * w + i]` is de hoogte (y omhoog, in meters, minimaal `minM`) van cel (i, j);
 * i loopt met +x, j met +z (rij 0 is de kleinste z, zoals de rijen van data/maps). Het midden van cel (i, j) ligt op
 * ((i + 0.5) * metersPerCell, (j + 0.5) * metersPerCell) vanaf de linker-achterhoek van het veld. Waarden hebben
 * twee decimalen; `minM` en `maxM` zijn de werkelijke extremen van `heights`.
 */
export const heightfieldSchema = z
  .object({
    format: z.literal(HEIGHTFIELD_FORMAT),
    w: z.number().int().positive(),
    h: z.number().int().positive(),
    metersPerCell: z.number().positive(),
    minM: z.number(),
    maxM: z.number(),
    heights: z.array(z.number()),
  })
  .superRefine((field, ctx) => {
    if (field.heights.length !== field.w * field.h) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['heights'],
        message: `${field.heights.length} waarden, verwacht w*h = ${field.w * field.h}`,
      });
      return;
    }
    let min = Infinity;
    let max = -Infinity;
    for (const value of field.heights) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (min !== field.minM || max !== field.maxM) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `minM/maxM (${field.minM}/${field.maxM}) komen niet overeen met de heights (${min}/${max})`,
      });
    }
    if (field.minM > field.maxM) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'minM is groter dan maxM' });
    }
  });

export type Heightfield = z.infer<typeof heightfieldSchema>;

/** Hoogte (m) op positie (xM, zM) in meters vanaf de linker-achterhoek van het veld, bilineair tussen celmiddens. */
export function heightAt(field: Heightfield, xM: number, zM: number): number {
  const fx = Math.min(Math.max(xM / field.metersPerCell - 0.5, 0), field.w - 1);
  const fz = Math.min(Math.max(zM / field.metersPerCell - 0.5, 0), field.h - 1);
  const i0 = Math.min(Math.floor(fx), field.w - 2 < 0 ? 0 : field.w - 2);
  const j0 = Math.min(Math.floor(fz), field.h - 2 < 0 ? 0 : field.h - 2);
  const tx = field.w > 1 ? fx - i0 : 0;
  const tz = field.h > 1 ? fz - j0 : 0;
  const at = (i: number, j: number): number => field.heights[Math.min(j, field.h - 1) * field.w + Math.min(i, field.w - 1)] as number;
  const top = at(i0, j0) * (1 - tx) + at(i0 + 1, j0) * tx;
  const bottom = at(i0, j0 + 1) * (1 - tx) + at(i0 + 1, j0 + 1) * tx;
  return top * (1 - tz) + bottom * tz;
}

const hexColour = z.string().regex(/^#[0-9a-f]{6}$/);

/** Verwijzing naar een afbeelding naast terrain.json; `path` is relatief aan die map, met forward slashes. */
const terrainImageSchema = z.object({
  path: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  mime: z.enum(['image/jpeg', 'image/png']),
});

/**
 * `assets/dist/terrain/terrain.json`: het terrein-manifest, los van het asset-manifest (kind 'terrain').
 * Alle paden zijn relatief aan de map van dit bestand.
 */
export const terrainManifestSchema = z.object({
  format: z.literal(TERRAIN_MANIFEST_FORMAT),
  id: z.string().min(1),
  /** Naamsvermelding (CC-BY-4.0) van de bron; het bronbestand zelf zit niet in git. */
  attribution: z.string().min(1),
  heightfield: z.object({
    path: z.string().min(1),
    w: z.number().int().positive(),
    h: z.number().int().positive(),
    metersPerCell: z.number().positive(),
    minM: z.number(),
    maxM: z.number(),
  }),
  /**
   * Bovenaanzicht van de kleur, uitgelijnd met het hoogteveld: pixel (px, py) hoort bij x = px / width * w *
   * metersPerCell en z = py / height * h * metersPerCell. In kleurruimte sRGB; leg dit als map (uv = x / veldbreedte,
   * z / veldbreedte) over het terrein, zonder PBR.
   */
  albedo: terrainImageSchema,
  /** Gemiddelde kleur van de albedo (sRGB), als effen terugval of ondergrond voor de ruimte buiten het veld. */
  rockTint: hexColour,
  /** Kleur van het Base-materiaal van de bron (de donkere voet van het terrein), sRGB. */
  groundTint: hexColour,
  /** Hoe de uitsnede uit de bron is gehaald; alleen informatief. */
  crop: z.object({
    /**
     * Uitsnede in bronmeters, in de wereldruimte van de bron na de Z-up-naar-Y-up-omzetting en na een draaiing
     * om de y-as van `rotationDeg` graden (x' = cos * x - sin * z, z' = sin * x + cos * z).
     */
    rotationDeg: z.number(),
    minX: z.number(),
    minZ: z.number(),
    sizeM: z.number().positive(),
    /** Vergroting van bron naar veld (horizontaal en verticaal, uniform). */
    scale: z.number().positive(),
    /** Bronhoogte (m, na de omzetting) die van alle hoogtes is afgetrokken, zodat het laagste punt op 0 ligt. */
    heightOffsetM: z.number(),
  }),
});

export type TerrainManifest = z.infer<typeof terrainManifestSchema>;

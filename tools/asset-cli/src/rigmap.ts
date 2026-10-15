// Conform-config voor bronassets die niet aan de brief voldoen (assets/src/rigmap.json, optioneel).
// Een asset zonder entry gaat ongewijzigd naar de validatie.
import { z } from 'zod';
import { BUDGETS } from './budgets.js';

const boneTable = z.record(z.string().min(1));

export const rigmapSchema = z.object({
  /**
   * Per rig: bronbone (hoofdletterongevoelig) naar Mixamo-naam. Bones die niet in de tabel staan worden gesnoeid.
   * `merge` (optioneel): gesnoeide bronbone naar een Mixamo-naam uit `bones` die zijn gewicht krijgt, in plaats van de
   * dichtstbijzijnde behouden voorouder (bijvoorbeeld een twist-bone onder de schouder die bij de bovenarm hoort).
   */
  rigs: z.record(z.object({ bones: boneTable, merge: boneTable.optional() })).default({}),
  assets: z
    .record(
      z.object({
        /** Naam uit `rigs`; snoeit en hernoemt de bones van de skin. */
        rig: z.string().optional(),
        /** Reduceer een te zware bron tot dit aantal driehoeken (karakters: binnen de LOD0-band van de brief). */
        lod0Triangles: z.number().int().positive().optional(),
        /** Uniforme schaal die in de vertices wordt gebakken (bijvoorbeeld 0.01 voor bronnen in centimeters). */
        scale: z.number().positive().optional(),
        /** Publiceer onder deze id in plaats van de bestandsnaam (een lokale versie die een repo-asset vervangt). */
        id: z
          .string()
          .regex(/^[a-z0-9_]+$/)
          .optional(),
        /** Alleen deze meshes (exacte namen) blijven over; de rest van de scène vervalt. */
        meshes: z.array(z.string().min(1)).min(1).optional(),
        /** Karakter opnieuw binden in de node-pose, draaien om +Y, schalen naar `height` m, voeten op y = 0. */
        fit: z
          .object({ height: z.number().positive(), yawDegrees: z.number().optional() })
          .optional(),
        /** Clips van een ander karakter overzetten (src/retarget.ts); paden relatief aan dit bestand. */
        retarget: z
          .object({
            /** Bron-GLB met de clips. */
            from: z.string().min(1),
            /** Rigmap en clipmap waarmee de bron eerst geconformeerd wordt (Mixamo-namen, canonieke clips). */
            rigmap: z.string().min(1),
            clipmap: z.string().min(1),
            /** Doelbone naar bronbone (Mixamo-namen) waar de namen verschillen. */
            bones: boneTable.optional(),
            alignRest: z.boolean().optional(),
          })
          .optional(),
        /** Een emissive-only kleurtextuur (Sketchfab-unlit) als diffuse gebruiken. */
        emissiveAsBaseColor: z.boolean().optional(),
        /** Alle diffuse textures samenvoegen tot één atlas van maximaal deze maat. */
        atlas: z.number().int().positive().optional(),
        /** Teammasker per texel in de alfa van de diffuse (src/textures.ts applyTeamMaskAlpha); manifest `teamMask` wordt 'diffuseAlpha'. */
        teamMask: z
          .object({
            hue: z.tuple([z.number().min(0).max(360), z.number().min(0).max(360)]),
            minSaturation: z.number().min(0).max(1).optional(),
            minValue: z.number().min(0).max(1).optional(),
            softness: z.number().min(0).max(20).optional(),
          })
          .optional(),
      }),
    )
    .default({}),
});
export type Rigmap = z.infer<typeof rigmapSchema>;
export type AssetConform = Rigmap['assets'][string];
export const EMPTY_RIGMAP: Rigmap = { rigs: {}, assets: {} };

export function parseRigmap(json: unknown): Rigmap {
  const map = rigmapSchema.parse(json);
  for (const [id, entry] of Object.entries(map.assets)) {
    if (entry.rig && !map.rigs[entry.rig])
      throw new Error(`asset "${id}" verwijst naar onbekende rig "${entry.rig}"`);
    const [min, max] = [BUDGETS.characterMinTris[0], BUDGETS.characterMaxTris[0]];
    if (
      entry.rig &&
      entry.lod0Triangles !== undefined &&
      (entry.lod0Triangles < min || entry.lod0Triangles > max)
    ) {
      throw new Error(
        `asset "${id}": lod0Triangles ${entry.lod0Triangles} valt buiten de LOD0-band van de brief (${min} tot ${max})`,
      );
    }
  }
  return map;
}

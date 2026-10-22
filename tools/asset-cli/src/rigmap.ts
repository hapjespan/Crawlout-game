// Conform-config voor bronassets die niet aan de brief voldoen (assets/src/rigmap.json, optioneel).
// Een asset zonder entry gaat ongewijzigd naar de validatie.
import { resolve } from 'node:path';
import { z } from 'zod';
import { BUDGETS } from './budgets.js';
import { bodyPaletteSchema } from './manifest.js';
import { hexColor } from './variants.js';

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
        /**
         * Pad naar de bron-GLB, relatief aan dit bestand, voor een bron die de buis zelf niet oppakt (de geleverde
         * modellen onder `delivered/`). De sleutel is dan een naam van zichzelf. Een geleverd model dat al een skelet
         * heeft, gaat zo door rig en retarget in plaats van door de starre delivered-buis. Niet samen met `autoRig`,
         * dat zijn eigen `from` heeft.
         */
        source: z.string().min(1).optional(),
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
        /**
         * Auto-rig a static mesh (src/autorig.ts): `from` (a GLB without skeleton, T- or A-pose) gets the skin, bind pose
         * and clips of `skeleton` (conformed with its own `rigmap` and `clipmap`); paths relative to this file. The entry
         * key is a name of its own, the source does not need to be a GLB in this folder. Not combined with `meshes`,
         * `fit`, `rig` or `retarget`.
         */
        autoRig: z
          .object({
            from: z.string().min(1),
            skeleton: z.string().min(1),
            rigmap: z.string().min(1),
            clipmap: z.string().min(1),
            /** Body height after scaling (m, without small loose parts); default 1.8. */
            height: z.number().positive().optional(),
            yawDegrees: z.number().optional(),
            /** Bone-heat constant (larger: stiffer joints); default 1. */
            heat: z.number().positive().optional(),
            /** Small loose parts within this distance (m) take the weights of the body under them; default 0.05. */
            attachRadius: z.number().nonnegative().optional(),
          })
          .optional(),
        /** Een emissive-only kleurtextuur (Sketchfab-unlit) als diffuse gebruiken. */
        emissiveAsBaseColor: z.boolean().optional(),
        /**
         * Extra uitvoer onder een andere id van dezelfde bron (een factie-variant van het poppetje): dezelfde mesh, skin
         * en gebakken animaties, alleen de basiskleur van de genoemde materialen (naam in de bron, `#rrggbb` sRGB)
         * verschilt. De animatietexture wordt gedeeld (het manifest wijst naar de texture van de bron), dus de variant
         * kost alleen de drie LOD-GLB's.
         */
        derive: z
          .array(
            z.object({
              id: z.string().regex(/^[a-z0-9_]+$/),
              colors: z
                .record(hexColor)
                .refine((c) => Object.keys(c).length > 0, 'minstens één kleur'),
              /** Kledingpalet voor render (manifest `palette`); de basiskleuren hierboven blijven de GLB-kleuren. */
              palette: bodyPaletteSchema.optional(),
              /**
               * Uniform scale of the whole body (a mutant of 2,3 m: 1.25; the source stands at 1,8 m). The scaled variant
               * gets its own baked animation texture instead of sharing the one of the source.
               */
              scale: z.number().min(0.5).max(2).optional(),
            }),
          )
          .optional(),
        /** Alle diffuse textures samenvoegen tot één atlas van maximaal deze maat. */
        atlas: z.number().int().positive().optional(),
        /** Teammasker per texel in de alfa van de diffuse (src/textures.ts applyTeamMaskAlpha); manifest `teamMask` wordt 'diffuseAlpha'. */
        teamMask: z
          .object({
            hue: z.tuple([z.number().min(0).max(360), z.number().min(0).max(360)]),
            minSaturation: z.number().min(0).max(1).optional(),
            minValue: z.number().min(0).max(1).optional(),
            softness: z.number().min(0).max(20).optional(),
            /** Only on the skin of these bones (Mixamo names): texels of triangles with at least `minWeight` on them. */
            bones: z.array(z.string().min(1)).min(1).optional(),
            minWeight: z.number().min(0).max(1).optional(),
          })
          .optional(),
      }),
    )
    .default({}),
});
export type Rigmap = z.infer<typeof rigmapSchema>;
export type AssetConform = Rigmap['assets'][string];
export const EMPTY_RIGMAP: Rigmap = { rigs: {}, assets: {} };

/**
 * Entries die hun eigen bron aanwijzen (`autoRig.from` of `source`, paden relatief aan `configDir`). De gewone sweep
 * slaat `delivered/` over, dus zo komt een geleverd model toch de buis in; de sleutel van de entry is de bron-id.
 */
export function namedSources(map: Rigmap, configDir: string): { file: string; sourceId: string }[] {
  return Object.entries(map.assets).flatMap(([sourceId, entry]) => {
    const from = entry.autoRig?.from ?? entry.source;
    return from ? [{ file: resolve(configDir, from), sourceId }] : [];
  });
}

export function parseRigmap(json: unknown): Rigmap {
  const map = rigmapSchema.parse(json);
  for (const [id, entry] of Object.entries(map.assets)) {
    if (entry.autoRig && (entry.meshes || entry.fit || entry.rig || entry.retarget))
      throw new Error(`asset "${id}": autoRig gaat niet samen met meshes, fit, rig of retarget`);
    if (entry.autoRig && entry.source)
      throw new Error(`asset "${id}": autoRig heeft zijn eigen "from"; laat "source" weg`);
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

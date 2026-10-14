// Conform-config voor bronassets die niet aan de brief voldoen (assets/src/rigmap.json, optioneel).
// Een asset zonder entry gaat ongewijzigd naar de validatie.
import { z } from 'zod';
import { BUDGETS } from './budgets.js';

const boneTable = z.record(z.string().min(1));

export const rigmapSchema = z.object({
  /** Per rig: bronbone (hoofdletterongevoelig) naar Mixamo-naam. Bones die niet in de tabel staan worden gesnoeid. */
  rigs: z.record(z.object({ bones: boneTable })).default({}),
  assets: z
    .record(
      z.object({
        /** Naam uit `rigs`; snoeit en hernoemt de bones van de skin. */
        rig: z.string().optional(),
        /** Reduceer een te zware bron tot dit aantal driehoeken (karakters: binnen de LOD0-band van de brief). */
        lod0Triangles: z.number().int().positive().optional(),
        /** Uniforme schaal die in de vertices wordt gebakken (bijvoorbeeld 0.01 voor bronnen in centimeters). */
        scale: z.number().positive().optional(),
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
    if (entry.rig && !map.rigs[entry.rig]) throw new Error(`asset "${id}" verwijst naar onbekende rig "${entry.rig}"`);
    const [min, max] = [BUDGETS.characterMinTris[0], BUDGETS.characterMaxTris[0]];
    if (entry.rig && entry.lod0Triangles !== undefined && (entry.lod0Triangles < min || entry.lod0Triangles > max)) {
      throw new Error(`asset "${id}": lod0Triangles ${entry.lod0Triangles} valt buiten de LOD0-band van de brief (${min} tot ${max})`);
    }
  }
  return map;
}

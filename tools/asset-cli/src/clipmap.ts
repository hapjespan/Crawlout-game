// Koppelt clipnamen uit bron-GLB's (bijvoorbeeld Quaternius "Walk_Loop") aan de canonieke namen uit ANIM_NAMES.
// Configuratie: assets/src/clipmap.json (optioneel). Zonder bestand moeten de clips al de canonieke namen hebben.
import { ANIM_NAMES, type AnimName } from '@crawlout/protocol';
import { z } from 'zod';

const animName = z.string().refine((n): n is AnimName => (ANIM_NAMES as readonly string[]).includes(n), {
  message: `doelnaam moet een van ${ANIM_NAMES.join(', ')} zijn`,
});
const clipTable = z.record(animName);

export const clipmapSchema = z.object({
  /** Bronnaam (hoofdletterongevoelig) naar canonieke clipnaam, voor alle assets. */
  clips: clipTable.default({}),
  /** Per asset-id extra of afwijkende koppelingen; gaan voor op `clips`. */
  assets: z.record(clipTable).default({}),
});
export type Clipmap = z.infer<typeof clipmapSchema>;
export const EMPTY_CLIPMAP: Clipmap = { clips: {}, assets: {} };

export function parseClipmap(json: unknown): Clipmap {
  return clipmapSchema.parse(json);
}

export interface ResolvedClips {
  /** Canonieke clipnaam naar index in de animatielijst van de GLB; alleen gevonden clips. */
  found: Map<AnimName, number>;
  errors: string[];
}

/** Vindt per canonieke clip precies een bronclip, via directe naam of via de clipmap. */
export function resolveClips(sourceNames: string[], clipmap: Clipmap, assetId?: string): ResolvedClips {
  const map = new Map<string, AnimName>();
  for (const table of [clipmap.clips, (assetId && clipmap.assets[assetId]) || {}]) {
    for (const [source, target] of Object.entries(table)) map.set(source.toLowerCase(), target);
  }
  const found = new Map<AnimName, number>();
  const errors: string[] = [];
  for (const target of ANIM_NAMES) {
    const hits = sourceNames.flatMap((name, index) => {
      const key = name.toLowerCase();
      return (map.get(key) ?? (key === target ? target : undefined)) === target ? [index] : [];
    });
    if (hits.length === 0) {
      errors.push(`animatieclip "${target}" ontbreekt; voeg de clip toe of koppel een bestaande in assets/src/clipmap.json (aanwezig: ${sourceNames.join(', ') || 'geen'}).`);
    } else if (hits.length > 1) {
      errors.push(`animatieclip "${target}" is dubbelzinnig: ${hits.map((i) => `"${sourceNames[i]}"`).join(' en ')} koppelen er allebei aan.`);
    } else found.set(target, hits[0]!);
  }
  return { found, errors };
}

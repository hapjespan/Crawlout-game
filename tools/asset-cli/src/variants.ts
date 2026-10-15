// Schema van assets/src/buildings/variants.json: per gebouw-id uit data/buildings.json (visuals.mesh) hoe het uit het
// bron-huisje (en eenvoudige vormen) gebouwd wordt. Alle vormgetallen staan in dat bestand, niet in code. Alleen zod
// als afhankelijkheid, dus ook los te valideren.
import { z } from 'zod';

export const VARIANTS_VERSION = 1 as const;

const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const positive = z.number().positive();
/** sRGB-kleur als `#rrggbb`; de generator rekent om naar lineair voor glTF. */
export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'verwacht een kleur als #rrggbb');

const sourceSchema = z.object({
  /** Pad van het bron-GLB, relatief aan assets/src. Het bestand wordt zelf geen asset. */
  file: z.string().min(1),
  /** Naamsvermelding (CC-BY); alleen documentatie, de licentietekst staat in assets/src/licenses. */
  attribution: z.string().optional(),
});

/** Een bronmateriaal (spec-gloss) wordt een effen basiskleur plus diffuse textuur onder deze uitvoernaam. */
const sourceMaterialSchema = z.object({
  /** Effen basiskleur die de diffuse factor van het bronmateriaal vervangt (standaard: die factor). */
  color: hexColor.optional(),
  /** Uitvoernaam. Twee bronmaterialen met dezelfde naam moeten dezelfde textuur en kleur hebben en worden samengevoegd. */
  name: z.string().min(1),
});

const flatMaterialSchema = z.object({
  color: hexColor,
  /** Een team-materiaal (naam bevat "team") krijgt in render de spelerskleur; basiskleur is dan het neutrale masker. */
  note: z.string().optional(),
});

const place = {
  /** Voet (midden onder) van het onderdeel in meters; het midden van de footprint is (0, 0), de grond is y = 0. */
  position: vec3,
  /** Rotatie in graden om de voet, volgorde Y, X, Z. */
  rotation: vec3.optional(),
  /** Hoogste LOD waarop dit onderdeel er nog is (0, 1 of 2); standaard alle LODs. Fijn detail valt zo weg in de verte. */
  maxLod: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  /** Laagste LOD waarop dit onderdeel er is; standaard 0. Een vereenvoudigd vervangend onderdeel voor de verte begint hier. */
  minLod: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
};

const houseSelectSchema = z.object({
  /** Alleen driehoeken van deze bronmaterialen (bronnamen). Standaard alle. */
  materials: z.array(z.string()).optional(),
  /** Alleen driehoeken waarvan het zwaartepunt in dit hoogtebereik ligt, als deel (0 tot 1) van de huishoogte. */
  yFrom: z.number().min(0).max(1).optional(),
  yTo: z.number().min(0).max(1).optional(),
  /** Houd per bronmateriaal alleen de N grootste samenhangende delen (bijvoorbeeld de dakvlakken zonder dakkapel en ramen). */
  components: z.number().int().positive().optional(),
});

const houseSchema = z.object({
  type: z.literal('house'),
  source: z.string().min(1),
  /**
   * Breedte (x) en diepte (z) in meters waarin het onderdeel past (na `rotation`). Bij `fit` 'contain' en 'house' is de
   * schaal uniform: het onderdeel past in dit vak en vult de ene as precies, de andere hooguit. Bij 'stretch' vult het
   * vak exact (niet-uniform).
   */
  size: z.tuple([positive, positive]),
  /**
   * Hoe het onderdeel in `size` komt. 'contain' (standaard): uniforme schaal op de bounds van het geselecteerde deel,
   * gecentreerd. 'house': uniforme schaal en plaatsing op de bounds van het hele bronhuis, ook voor een geselecteerd
   * deel; zo staan de dakvlakken op LOD2 precies op het huis van LOD0 en 1, en verschuiven de LODs niet. 'stretch':
   * niet-uniform op de bounds van het geselecteerde deel (vervormt ramen en dak; alleen voor een bewuste rek).
   */
  fit: z.enum(['contain', 'house', 'stretch']).optional(),
  /**
   * Extra schaal op de hoogte, boven op de uniforme schaal ('contain', 'house') of op het gemiddelde van x en z
   * ('stretch'). 1 = onvervormd; een andere waarde rekt het onderdeel in de hoogte.
   */
  heightFactor: positive,
  select: houseSelectSchema.optional(),
  /** Aandeel in het driehoekbudget; standaard breedte keer diepte. */
  weight: positive.optional(),
  ...place,
});

const boxSchema = z.object({
  type: z.literal('box'),
  size: z.tuple([positive, positive, positive]),
  material: z.string().min(1),
  ...place,
});

const cylinderSchema = z.object({
  type: z.literal('cylinder'),
  radius: positive,
  /** Straal bovenaan; standaard gelijk aan `radius`. */
  radiusTop: z.number().nonnegative().optional(),
  height: positive,
  segments: z.number().int().min(3).max(32),
  material: z.string().min(1),
  ...place,
});

const coneSchema = z.object({
  type: z.literal('cone'),
  radius: positive,
  height: positive,
  segments: z.number().int().min(3).max(32),
  material: z.string().min(1),
  ...place,
});

export const partSchema = z.discriminatedUnion('type', [
  houseSchema,
  boxSchema,
  cylinderSchema,
  coneSchema,
]);

export const variantSchema = z.object({
  /**
   * Footprint in cellen van 1 m; de bounds van het model vullen w x h in x en z (5 procent tolerantie). Een uniform
   * geschaald huis vult de footprint zelden helemaal: vul de rest met een grondplaat (box) of aanbouw.
   */
  footprint: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  /** Tint per uitvoermateriaal (bronmaterialen op uitvoernaam), vermenigvuldigd met de basiskleur. */
  tints: z.record(hexColor).optional(),
  /** Kleur per effen materiaal voor dit gebouw; overschrijft `flatMaterials`. */
  colors: z.record(hexColor).optional(),
  /** Doel-aantal driehoeken van LOD0 (hooguit het budget van `budgets.ts`); LOD1 en LOD2 volgen de verhoudingen. */
  lod0Triangles: z.number().int().positive(),
  parts: z.array(partSchema).min(1),
  note: z.string().optional(),
});

export const variantsSchema = z
  .object({
    version: z.literal(VARIANTS_VERSION),
    sources: z.record(sourceSchema),
    /** Bronmateriaalnaam naar uitvoernaam. Een bronmateriaal dat hier niet staat is een fout. */
    sourceMaterials: z.record(sourceMaterialSchema),
    /** Effen materialen voor toevoegingen, op naam. Minstens een naam met "team". */
    flatMaterials: z.record(flatMaterialSchema),
    variants: z.record(variantSchema),
  })
  .superRefine((config, ctx) => {
    const issue = (message: string, path: (string | number)[]): void =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
    const outputNames = new Set(Object.values(config.sourceMaterials).map((m) => m.name));
    for (const name of Object.keys(config.flatMaterials))
      if (outputNames.has(name))
        issue(`materiaalnaam "${name}" is zowel bron- als effen materiaal`, [
          'flatMaterials',
          name,
        ]);
    for (const [id, variant] of Object.entries(config.variants)) {
      variant.parts.forEach((part, index) => {
        const where = ['variants', id, 'parts', index];
        if (part.type === 'house' && !(part.source in config.sources))
          issue(`onbekende bron "${part.source}"`, [...where, 'source']);
        if ('material' in part && !(part.material in config.flatMaterials))
          issue(`onbekend effen materiaal "${part.material}"`, [...where, 'material']);
        if (part.type === 'house' && part.select?.materials)
          for (const name of part.select.materials)
            if (!(name in config.sourceMaterials))
              issue(`onbekend bronmateriaal "${name}"`, [...where, 'select', 'materials']);
      });
      for (const name of Object.keys(variant.tints ?? {}))
        if (!outputNames.has(name))
          issue(`tint voor onbekend uitvoermateriaal "${name}"`, ['variants', id, 'tints', name]);
      for (const name of Object.keys(variant.colors ?? {}))
        if (!(name in config.flatMaterials))
          issue(`kleur voor onbekend effen materiaal "${name}"`, ['variants', id, 'colors', name]);
      const used = variant.parts.some((part) => 'material' in part && /team/i.test(part.material));
      if (!used)
        issue('geen team-materiaal in de onderdelen (naam bevat "team")', [
          'variants',
          id,
          'parts',
        ]);
    }
  });

export type VariantsConfig = z.infer<typeof variantsSchema>;
export type VariantDef = z.infer<typeof variantSchema>;
export type VariantPart = z.infer<typeof partSchema>;
export type HousePart = z.infer<typeof houseSchema>;

/** Parseert en valideert de config; gooit een leesbare fout met het pad naar het veld. */
export function parseVariants(json: unknown): VariantsConfig {
  const parsed = variantsSchema.safeParse(json);
  if (parsed.success) return parsed.data;
  const reasons = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  throw new Error(reasons.join('; '));
}

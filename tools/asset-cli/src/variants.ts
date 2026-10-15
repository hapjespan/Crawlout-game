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
  /**
   * De wereldschaal: meters per bron-eenheid. Elk huisonderdeel van elke variant krijgt precies deze uniforme schaal
   * (1 unit = 1 meter, poppetje 1,8 m; Spelfundament sectie 9), dus geen gebouw krimpt om in een footprint te passen.
   */
  metersPerUnit: positive,
  /**
   * De deuropening in bron-eenheden (na de node-transformaties, y omhoog): de vloer onder de deur en de onderkant van de
   * bovendorpel. Hiermee is `metersPerUnit` gekozen; een test eist een deur van minstens 2,1 m en controleert de getallen
   * tegen de geometrie.
   */
  door: z
    .object({
      floorY: z.number(),
      lintelY: z.number(),
      /** Een punt in de deuropening (x, z) in bron-eenheden, voor de controle tegen het kozijn. */
      at: z.tuple([z.number(), z.number()]),
    })
    .optional(),
  /**
   * Alleen samenhangende delen die helemaal in dit blok liggen (bron-eenheden, na de node-transformaties) horen bij het
   * huis; los rommel ernaast (een plank op de grond, een touw dat buiten het dak hangt) valt weg en telt niet mee in de
   * bounds.
   */
  keep: z.object({ min: vec3, max: vec3 }).optional(),
  /** Uitleg bij de schaal en de deurmaat; alleen documentatie. */
  note: z.string().optional(),
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

/**
 * Een kopie (of een deel) van het bronhuis op de wereldschaal van de bron (`metersPerUnit`): geen eigen maat, geen
 * vervorming. `position` is de voet van het hele bronhuis (midden van zijn bounds in x en z, onderkant op y), ook voor een
 * geselecteerd deel; zo staan de dakvlakken op LOD2 precies op het huis van LOD0 en 1, en verschuiven de LODs niet.
 */
const houseSchema = z
  .object({
    type: z.literal('house'),
    source: z.string().min(1),
    select: houseSelectSchema.optional(),
    /** Aandeel in het driehoekbudget; standaard 1 per huisonderdeel. */
    weight: positive.optional(),
    ...place,
  })
  .strict();

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
   * Footprint in cellen van 1 m (wat de sim reserveert); het model staat erbinnen (hooguit 5 procent erbuiten) en
   * vult minstens 85 procent van w en van h (LOD2 75). Een uniform geschaald huis vult de footprint zelden helemaal;
   * de rest blijft grond: er is bewust geen grondplaat (die stak af tegen het terrein), zie README, Gebouwen.
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

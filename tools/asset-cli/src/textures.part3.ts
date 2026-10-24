// Split from textures.part1.ts to stay under the 5,000-token file limit; textures.ts re-exports the public surface.
// Holds: buildAtlas, the one routine that merges every diffuse (and normal and metallic-roughness) texture of a
// document into a single square atlas. The packing, the tiling and the UV remap live in textures.part1.ts.
import {
  type Document,
  type Texture,
  type Primitive,
  type Material,
  type Accessor,
  Root,
} from '@gltf-transform/core';
import {
  linearToSrgbByte,
  loadSharp,
  packSquares,
  remapPrimitiveToAtlas,
  requiredRepeat,
  surfaceArea,
} from './textures.part1.js';

interface Placement {
  texture: Texture;
  x: number;
  y: number;
  size: number;
}

const pow2 = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

export interface AtlasInfo {
  size: number;
  /** Per bron-textuur (naam of index) de celmaat in de atlas en hoe vaak de textuur in de cel herhaald is (tegelende UV's). */
  cells: { texture: string; source: number; size: number; repeat: number }[];
}

/** Meer herhalingen van een textuur in één cel geeft te weinig texels per tegel. */
const MAX_UV_REPEAT = 8;

const WRAP_CLAMP_TO_EDGE = 33071;

/**
 * Voegt alle diffuse textures samen tot één vierkante PNG-atlas van maximaal `size`. Elke textuur krijgt een vierkante
 * cel (macht van 2); past het niet, dan halveert de textuur met het kleinste oppervlak per texel eerst.
 *
 * UV's buiten 0 tot 1 gaan zoals de bron ze bedoelde (wrap REPEAT): elke driehoek schuift naar zijn eigen tegel van
 * 0 tot 1, een overschrijding van hooguit 3 procent wordt afgeklemd. Een driehoek die een tegelgrens echt overspant
 * (een tegelende textuur, bijvoorbeeld UV's van 0 tot 3) vraagt dat de textuur in de cel herhaald wordt; de cel bevat
 * dan N x N kopieën en de UV's worden door N gedeeld. Wrap CLAMP_TO_EDGE klemt per hoekpunt. Alle primitives krijgen
 * daarna één materiaal ("atlas").
 */
export async function buildAtlas(
  document: Document,
  size: number,
  options: { keepAlpha?: boolean } = {},
): Promise<AtlasInfo> {
  const sharp = await loadSharp();
  const root = document.getRoot();
  const prims = root.listMeshes().flatMap((m) => m.listPrimitives());
  const usedBy = new Map<Texture, Primitive[]>();
  const wrap = new Map<Texture, [boolean, boolean]>();
  // Een materiaal zonder diffuse textuur (alleen een baseColorFactor, bijvoorbeeld de huid van de Klerk) krijgt een
  // effen celtje van zijn eigen kleur, zodat het gewoon meegaat in de atlas in plaats van hem te blokkeren.
  const solid = new Map<Material, Texture>();
  for (const prim of prims) {
    const material = prim.getMaterial();
    if (!material) throw new Error('primitive zonder materiaal bij het maken van de atlas');
    let tex = material.getBaseColorTexture();
    if (!tex) {
      tex = solid.get(material) ?? null;
      if (!tex) {
        const [r, g, b, a] = material.getBaseColorFactor();
        const png = await sharp({
          create: {
            width: 4,
            height: 4,
            channels: 4,
            background: {
              r: linearToSrgbByte(r!),
              g: linearToSrgbByte(g!),
              b: linearToSrgbByte(b!),
              alpha: a!,
            },
          },
        })
          .png()
          .toBuffer();
        tex = document
          .createTexture(`${material.getName() || 'material'}_solid`)
          .setMimeType('image/png')
          .setImage(new Uint8Array(png));
        solid.set(material, tex);
        material.setBaseColorTexture(tex).setBaseColorFactor([1, 1, 1, a!]);
      }
    }
    if (!prim.getAttribute('TEXCOORD_0'))
      throw new Error('primitive zonder TEXCOORD_0 bij het maken van de atlas');
    usedBy.set(tex, [...(usedBy.get(tex) ?? []), prim]);
    const info = material.getBaseColorTextureInfo();
    wrap.set(tex, [
      info?.getWrapS() === WRAP_CLAMP_TO_EDGE,
      info?.getWrapT() === WRAP_CLAMP_TO_EDGE,
    ]);
  }
  const textures = [...usedBy.keys()];
  const repeats = textures.map((t) => requiredRepeat(usedBy.get(t)!, wrap.get(t)!));
  textures.forEach((t, i) => {
    if (repeats[i]! > MAX_UV_REPEAT)
      throw new Error(
        `textuur "${t.getName() || t.getURI() || '(naamloos)'}" tegelt ${repeats[i]} keer; meer dan ${MAX_UV_REPEAT} past niet in een atlascel`,
      );
  });
  const meta = await Promise.all(textures.map((t) => sharp(Buffer.from(t.getImage()!)).metadata()));
  // Een herhaalde textuur krijgt een grotere cel, zodat een tegel zijn eigen resolutie houdt (tot de atlasmaat).
  const cells = meta.map((m, i) =>
    Math.min(size, pow2(Math.max(m.width ?? 1, m.height ?? 1) * repeats[i]!)),
  );
  const density = textures.map(
    (t, i) => cells[i]! ** 2 / Math.max(1e-9, surfaceArea(usedBy.get(t)!)),
  );
  let placed = packSquares(cells, size);
  while (!placed) {
    // Halveer de textuur met de hoogste texeldichtheid (meeste pixels per oppervlak), grootste cellen eerst.
    let pick = -1;
    for (let i = 0; i < cells.length; i++)
      if (
        cells[i]! > 1 &&
        (pick < 0 ||
          cells[i]! > cells[pick]! ||
          (cells[i] === cells[pick] && density[i]! > density[pick]!))
      )
        pick = i;
    if (pick < 0) throw new Error('textures passen niet in de atlas');
    cells[pick] = cells[pick]! / 2;
    density[pick] = density[pick]! / 4;
    placed = packSquares(cells, size);
  }
  const placements: Placement[] = textures.map((texture, i) => ({
    texture,
    ...placed![i]!,
    size: cells[i]!,
  }));
  /**
   * Eén cel: de bronafbeelding op celmaat, met de tegeling van die cel. Zonder bron krijgt de cel `fill` (de neutrale
   * waarde van die kaart of de eigen factoren van het materiaal); zonder bron én zonder `fill` blijft de cel leeg.
   * `scale` vermenigvuldigt de kanalen (metallicRoughness: de factoren van het bronmateriaal in de texels bakken,
   * want het samengevoegde materiaal heeft er nog maar één paar).
   */
  const cellOf = async (
    p: Placement,
    i: number,
    source: Uint8Array | null,
    extra: {
      fill?: { r: number; g: number; b: number; alpha: number };
      scale?: readonly [number, number, number];
    } = {},
  ) => {
    const scale = extra.scale;
    const tinted = async (png: Buffer): Promise<Buffer> => {
      if (!scale || (scale[0] === 1 && scale[1] === 1 && scale[2] === 1)) return png;
      // Per kanaal vermenigvuldigen op de rauwe texels: sharp's `linear` weigert een array dat niet bij het aantal
      // banden van de bron past, en een cel kan RGB of RGBA zijn.
      const { data, info } = await sharp(png)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (let i = 0; i < data.length; i += 4)
        for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c]! * scale[c]!);
      return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
        .png()
        .toBuffer();
    };
    if (!source) {
      if (!extra.fill) return null;
      return {
        input: await sharp({
          create: { width: p.size, height: p.size, channels: 4, background: extra.fill },
        })
          .png()
          .toBuffer(),
        left: p.x,
        top: p.y,
      };
    }
    const repeat = repeats[i]!;
    const buffer = Buffer.from(source);
    if (repeat === 1)
      return {
        input: await tinted(
          await sharp(buffer)
            .resize(p.size, p.size, { fit: 'fill' })
            .ensureAlpha()
            .png()
            .toBuffer(),
        ),
        left: p.x,
        top: p.y,
      };
    // N x N kopieën van de textuur naast elkaar, dan naar de celmaat.
    const tile = Math.ceil(p.size / repeat);
    const one = await sharp(buffer)
      .resize(tile, tile, { fit: 'fill' })
      .ensureAlpha()
      .png()
      .toBuffer();
    const grid = await sharp({
      create: {
        width: tile * repeat,
        height: tile * repeat,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    })
      .composite(
        Array.from({ length: repeat * repeat }, (_, k) => ({
          input: one,
          left: (k % repeat) * tile,
          top: Math.floor(k / repeat) * tile,
        })),
      )
      .png()
      .toBuffer();
    return {
      input: await tinted(
        await sharp(grid).resize(p.size, p.size, { fit: 'fill' }).png().toBuffer(),
      ),
      left: p.x,
      top: p.y,
    };
  };
  const layers = (
    await Promise.all(placements.map((p, i) => cellOf(p, i, p.texture.getImage()!)))
  ).filter((l) => l !== null);
  // Atlas zo klein mogelijk: de omhullende macht van 2 van wat gebruikt is.
  const used = pow2(Math.max(...placements.map((p) => Math.max(p.x, p.y) + p.size)));
  let png: Buffer;
  if (options.keepAlpha) {
    // Bladkaarten en gras: de alfa moet in de atlas blijven, dus de cellen worden pixel voor pixel gekopieerd
    // (composite 'over' op een effen achtergrond zou de transparantie wegwerken).
    const pixels = Buffer.alloc(used * used * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set([128, 128, 128, 0], i);
    for (const layer of layers) {
      const raw = await sharp(layer.input)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (let row = 0; row < raw.info.height; row++)
        raw.data.copy(
          pixels,
          ((layer.top + row) * used + layer.left) * 4,
          row * raw.info.width * 4,
          (row + 1) * raw.info.width * 4,
        );
    }
    png = await sharp(pixels, { raw: { width: used, height: used, channels: 4 } })
      .png()
      .toBuffer();
  } else {
    png = await sharp({
      create: {
        width: used,
        height: used,
        channels: 4,
        background: { r: 128, g: 128, b: 128, alpha: 1 },
      },
    })
      .composite(layers)
      .png()
      .toBuffer();
  }
  const atlas = document
    .createTexture('atlas')
    .setMimeType('image/png')
    .setImage(new Uint8Array(png));
  const material = document
    .createMaterial('atlas')
    .setBaseColorTexture(atlas)
    .setBaseColorFactor([1, 1, 1, 1]);

  // Dezelfde cellen voor de PBR-set: de normal- en metallic-roughnessatlas liggen pixel voor pixel op de diffuse-atlas,
  // zodat de UV's van één remap alle drie bedienen (render legt ze op dezelfde laagindex). Een cel waarvan het
  // bronmateriaal die kaart niet heeft, krijgt de neutrale waarde van die kaart, niet een gok: vlakke normaal, en
  // metaal 0 met ruwheid 1. Heeft geen enkele cel de kaart, dan komt er geen atlas.
  const materialOf = (texture: Texture): Material | null =>
    usedBy
      .get(texture)
      ?.find((prim) => prim.getMaterial())
      ?.getMaterial() ?? null;
  const extraMaps = [
    {
      name: 'atlas_normal',
      /** Tangent-space (0.5, 0.5, 1): geen reliëf. */
      fill: { r: 128, g: 128, b: 255, alpha: 1 },
      image: (m: Material) => m.getNormalTexture()?.getImage() ?? null,
      /** Een normal map heeft geen factor die in de texels te bakken valt. */
      cell: () => ({}) as Parameters<typeof cellOf>[3],
      set: (t: Texture) => material.setNormalTexture(t),
    },
    {
      name: 'atlas_mr',
      /** glTF-kanalen: G ruwheid 1, B metaal 0. */
      fill: { r: 255, g: 255, b: 0, alpha: 1 },
      image: (m: Material) => m.getMetallicRoughnessTexture()?.getImage() ?? null,
      /**
       * glTF vermenigvuldigt de kaart met roughnessFactor en metallicFactor, en het samengevoegde materiaal heeft er
       * nog maar één paar. Zonder dit leest de jas van de Klerk (metallicFactor 0 over een kaart met B = 1) na de
       * atlas als een geleider. Een cel zonder kaart krijgt de factoren van zijn eigen materiaal als effen waarde.
       */
      cell: (m: Material | null) => {
        const roughness = clamp01(m?.getRoughnessFactor() ?? 1);
        const metal = clamp01(m?.getMetallicFactor() ?? 1);
        return {
          fill: {
            r: 255,
            g: Math.round(roughness * 255),
            // Zelfde afspraak als render's fallbackTexel: glTF's standaard metallicFactor is 1 en een exporteur die
            // niets zei is niet te onderscheiden van kaal metaal. Zonder kaart telt 1 dus als 0.
            b: metal >= 1 ? 0 : Math.round(metal * 255),
            alpha: 1,
          },
          scale: [1, roughness, metal] as const,
        };
      },
      set: (t: Texture) => {
        material.setMetallicRoughnessTexture(t).setMetallicFactor(1).setRoughnessFactor(1);
      },
    },
  ] as const;
  const mapTextures: Texture[] = [];
  for (const map of extraMaps) {
    const owners = placements.map((p) => materialOf(p.texture));
    const sources = owners.map((owner) => (owner ? map.image(owner) : null));
    // Geen enkele cel met kaart: overslaan, tenzij de materialen zelf uiteenlopende PBR-factoren hebben die anders
    // verloren gaan in het ene samengevoegde materiaal (glTF's metallicFactor 1 betekent hier "niets gezegd").
    const factorsMatter =
      map.name === 'atlas_mr' &&
      owners.some((m) => (m?.getRoughnessFactor() ?? 1) !== 1 || (m?.getMetallicFactor() ?? 1) < 1);
    if (sources.every((s) => s === null) && !factorsMatter) continue;
    const cells = (
      await Promise.all(placements.map((p, i) => cellOf(p, i, sources[i]!, map.cell(owners[i]!))))
    ).filter((l) => l !== null);
    const buffer = await sharp({
      create: { width: used, height: used, channels: 4, background: map.fill },
    })
      .composite(cells)
      .png()
      .toBuffer();
    const texture = document
      .createTexture(map.name)
      .setMimeType('image/png')
      .setImage(new Uint8Array(buffer));
    map.set(texture);
    mapTextures.push(texture);
  }

  const oldAccessors = new Set<Accessor>();
  for (const prim of prims) {
    for (const semantic of prim.listSemantics()) oldAccessors.add(prim.getAttribute(semantic)!);
    const idx = prim.getIndices();
    if (idx) oldAccessors.add(idx);
  }
  placements.forEach((p, i) => {
    for (const prim of usedBy.get(p.texture)!) {
      remapPrimitiveToAtlas(document, prim, p, used, repeats[i]!, wrap.get(p.texture)!);
      prim.setMaterial(material);
    }
  });
  for (const accessor of oldAccessors)
    if (accessor.listParents().every((parent) => parent instanceof Root)) accessor.dispose();
  for (const m of root.listMaterials()) if (m !== material) m.dispose();
  const keep = new Set<Texture>([atlas, ...mapTextures]);
  for (const t of root.listTextures()) if (!keep.has(t)) t.dispose();
  return {
    size: used,
    cells: placements.map((p, i) => ({
      texture: p.texture.getName() || p.texture.getURI() || '(naamloos)',
      source: textures.indexOf(p.texture),
      size: p.size,
      repeat: repeats[i]!,
    })),
  };
}

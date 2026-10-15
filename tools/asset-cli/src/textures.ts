// Texture-stappen voor karakterbronnen die niet volgens de brief geleverd zijn: een emissive-only kleurtextuur als
// diffuse gebruiken, alle diffuse textures samenvoegen tot één atlas (render tekent één atlas per draw), en het
// teammasker als apart materiaal (naam met "team", wat render als masker leest) afsplitsen op textuurkleur.
// Beeldbewerking via sharp, alleen geladen als een van deze stappen in de config staat.
import {
  Root,
  type Accessor,
  type Document,
  type Primitive,
  type Texture,
} from '@gltf-transform/core';

type Sharp = (typeof import('sharp'))['default'];
let sharpModule: Promise<Sharp> | null = null;
const loadSharp = (): Promise<Sharp> => (sharpModule ??= import('sharp').then((m) => m.default));

/** Materialen zonder diffuse maar met een emissive textuur (Sketchfab-unlit): de emissive wordt de diffuse. */
export function emissiveAsBaseColor(document: Document): number {
  let changed = 0;
  for (const material of document.getRoot().listMaterials()) {
    const emissive = material.getEmissiveTexture();
    if (material.getBaseColorTexture() || !emissive) continue;
    material
      .setBaseColorTexture(emissive)
      .setBaseColorFactor([1, 1, 1, 1])
      .setEmissiveTexture(null)
      .setEmissiveFactor([0, 0, 0]);
    changed++;
  }
  return changed;
}

interface Placement {
  texture: Texture;
  x: number;
  y: number;
  size: number;
}

/** Pakt vierkante cellen (macht van 2) in een vierkant van `size`; quadtree, grootste eerst. Null als het niet past. */
export function packSquares(
  cells: readonly number[],
  size: number,
): { x: number; y: number }[] | null {
  const order = cells.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const free: { x: number; y: number; size: number }[] = [{ x: 0, y: 0, size }];
  const out: { x: number; y: number }[] = new Array(cells.length);
  for (const [cell, index] of order) {
    // Kleinste vrije vak dat past, dan opsplitsen tot de celmaat.
    free.sort((a, b) => a.size - b.size || a.y - b.y || a.x - b.x);
    const slot = free.findIndex((f) => f.size >= cell);
    if (slot < 0) return null;
    let box = free.splice(slot, 1)[0]!;
    while (box.size > cell) {
      const half = box.size / 2;
      free.push(
        { x: box.x + half, y: box.y, size: half },
        { x: box.x, y: box.y + half, size: half },
        { x: box.x + half, y: box.y + half, size: half },
      );
      box = { x: box.x, y: box.y, size: half };
    }
    out[index] = { x: box.x, y: box.y };
  }
  return out;
}

const pow2 = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

/** Oppervlak in modelruimte van de primitives die een textuur gebruiken (bepaalt wie eerst kleiner moet). */
function surfaceArea(prims: readonly Primitive[]): number {
  let area = 0;
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  const c = [0, 0, 0];
  for (const prim of prims) {
    const pos = prim.getAttribute('POSITION');
    const idx = prim.getIndices();
    if (!pos) continue;
    const n = idx ? idx.getCount() : pos.getCount();
    for (let i = 0; i + 2 < n; i += 3) {
      pos.getElement(idx ? idx.getScalar(i) : i, a);
      pos.getElement(idx ? idx.getScalar(i + 1) : i + 1, b);
      pos.getElement(idx ? idx.getScalar(i + 2) : i + 2, c);
      const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
      const v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
      area +=
        Math.hypot(
          u[1]! * v[2]! - u[2]! * v[1]!,
          u[2]! * v[0]! - u[0]! * v[2]!,
          u[0]! * v[1]! - u[1]! * v[0]!,
        ) / 2;
    }
  }
  return area;
}

export interface AtlasInfo {
  size: number;
  /** Per bron-textuur (naam of index) de celmaat in de atlas en hoe vaak de textuur in de cel herhaald is (tegelende UV's). */
  cells: { texture: string; source: number; size: number; repeat: number }[];
}

/** Een UV-overschrijding tot deze afstand buiten een tegel van 0 tot 1 telt niet als tegelen maar wordt afgeklemd. */
const UV_TILE_TOLERANCE = 0.03;
/** Meer herhalingen van een textuur in één cel geeft te weinig texels per tegel. */
const MAX_UV_REPEAT = 8;
const WRAP_CLAMP_TO_EDGE = 33071;

interface TriangleTile {
  /** Tegel (gehele UV-verschuiving) per as. */
  base: [number, number];
  /** Aantal tegels dat de driehoek per as raakt (1 = binnen één tegel). */
  touched: [number, number];
}

/**
 * De tegel van een driehoek, uit zijn UV-omhullende. Een driehoek die binnen een tegel past (met `tolerance` marge
 * naar buiten) hoort bij die tegel; een driehoek die een tegelgrens echt overspant raakt meerdere tegels en vraagt
 * dat de textuur in de atlascel herhaald wordt.
 */
export function triangleTile(
  uvs: readonly [number, number][],
  tolerance = UV_TILE_TOLERANCE,
): TriangleTile {
  const base: [number, number] = [0, 0];
  const touched: [number, number] = [1, 1];
  for (const axis of [0, 1] as const) {
    let min = Infinity;
    let max = -Infinity;
    for (const uv of uvs) {
      const value = Number.isFinite(uv[axis]) ? uv[axis] : 0;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    base[axis] = Math.floor(min + tolerance);
    touched[axis] = Math.max(1, Math.floor(max - tolerance) - base[axis] + 1);
  }
  return { base, touched };
}

/** Bron-UV's van een primitive als paren (Float32 uit elke opslagvorm). */
function readUvs(uv: Accessor): [number, number][] {
  const out: [number, number][] = [];
  const e = [0, 0];
  for (let i = 0; i < uv.getCount(); i++) {
    uv.getElement(i, e);
    out.push([e[0]!, e[1]!]);
  }
  return out;
}

function triangleIndices(prim: Primitive): number[] {
  const idx = prim.getIndices();
  const count = idx ? idx.getCount() : (prim.getAttribute('POSITION')?.getCount() ?? 0);
  const out: number[] = [];
  for (let i = 0; i + 2 < count; i += 3)
    out.push(
      idx ? idx.getScalar(i) : i,
      idx ? idx.getScalar(i + 1) : i + 1,
      idx ? idx.getScalar(i + 2) : i + 2,
    );
  return out;
}

/** Aantal herhalingen dat een textuur in zijn cel nodig heeft, uit de driehoeken die tegelgrenzen overspannen. */
function requiredRepeat(
  prims: readonly Primitive[],
  clampedAxes: readonly [boolean, boolean],
): number {
  let repeat = 1;
  for (const prim of prims) {
    const uv = prim.getAttribute('TEXCOORD_0');
    if (!uv) continue;
    const uvs = readUvs(uv);
    const tri = triangleIndices(prim);
    for (let i = 0; i < tri.length; i += 3) {
      const { touched } = triangleTile([uvs[tri[i]!]!, uvs[tri[i + 1]!]!, uvs[tri[i + 2]!]!]);
      for (const axis of [0, 1] as const)
        if (!clampedAxes[axis]) repeat = Math.max(repeat, touched[axis]);
    }
  }
  return repeat;
}

/**
 * Zet de primitive om naar de atlas: elke driehoek schuift naar zijn eigen tegel (hoekpunten die in driehoeken met
 * verschillende tegels zitten worden gedupliceerd), daarna naar de cel `(x, y, size)` van de atlas (`used` px breed).
 * `repeat` is het aantal herhalingen van de textuur in de cel; assen met wrap CLAMP_TO_EDGE klemmen per hoekpunt.
 * Alle attributen krijgen nieuwe accessors (de bron kan door andere primitives gedeeld worden).
 */
function remapPrimitiveToAtlas(
  document: Document,
  prim: Primitive,
  cell: { x: number; y: number; size: number },
  used: number,
  repeat: number,
  clampedAxes: readonly [boolean, boolean],
): void {
  const uvAccessor = prim.getAttribute('TEXCOORD_0')!;
  const uvs = readUvs(uvAccessor);
  const tri = triangleIndices(prim);
  const keyToNew = new Map<string, number>();
  const sourceOf: number[] = [];
  const tileOf: [number, number][] = [];
  const indices: number[] = [];
  for (let i = 0; i < tri.length; i += 3) {
    const corners = [tri[i]!, tri[i + 1]!, tri[i + 2]!];
    const { base } = triangleTile(corners.map((c) => uvs[c]!));
    const tile: [number, number] = [clampedAxes[0] ? 0 : base[0], clampedAxes[1] ? 0 : base[1]];
    for (const corner of corners) {
      const key = `${corner}:${tile[0]}:${tile[1]}`;
      let index = keyToNew.get(key);
      if (index === undefined) {
        index = sourceOf.length;
        keyToNew.set(key, index);
        sourceOf.push(corner);
        tileOf.push(tile);
      }
      indices.push(index);
    }
  }
  const count = sourceOf.length;
  const buffer =
    prim.getAttribute('POSITION')!.getBuffer() ??
    document.getRoot().listBuffers()[0] ??
    document.createBuffer();

  // UV: tegel eraf, delen door het aantal herhalingen, naar het midden van de texels van de cel (geen bloeden).
  const out = new Float32Array(count * 2);
  const scale = (cell.size - 1) / used;
  for (let v = 0; v < count; v++) {
    const src = uvs[sourceOf[v]!]!;
    for (const axis of [0, 1] as const) {
      const local = Number.isFinite(src[axis]) ? src[axis] - tileOf[v]![axis] : 0;
      const t = Math.min(1, Math.max(0, local)) / (clampedAxes[axis] ? 1 : repeat);
      out[v * 2 + axis] = ((axis === 0 ? cell.x : cell.y) + 0.5) / used + t * scale;
    }
  }

  for (const semantic of prim.listSemantics()) {
    const old = prim.getAttribute(semantic)!;
    if (semantic === 'TEXCOORD_0') {
      prim.setAttribute(
        semantic,
        document.createAccessor().setType('VEC2').setArray(out).setBuffer(buffer),
      );
      continue;
    }
    const array = old.getArray()!;
    const size = old.getElementSize();
    const next = new (array.constructor as new (n: number) => typeof array)(count * size);
    for (let v = 0; v < count; v++)
      next.set(array.subarray(sourceOf[v]! * size, (sourceOf[v]! + 1) * size), v * size);
    prim.setAttribute(semantic, old.clone().setArray(next));
  }
  prim.setIndices(
    document
      .createAccessor()
      .setType('SCALAR')
      .setArray(count > 65535 ? new Uint32Array(indices) : new Uint16Array(indices))
      .setBuffer(buffer),
  );
}

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
  for (const prim of prims) {
    const material = prim.getMaterial();
    const tex = material?.getBaseColorTexture();
    if (!tex)
      throw new Error(
        `primitive met materiaal "${material?.getName() ?? '-'}" heeft geen diffuse textuur`,
      );
    if (!prim.getAttribute('TEXCOORD_0'))
      throw new Error('primitive zonder TEXCOORD_0 bij het maken van de atlas');
    usedBy.set(tex, [...(usedBy.get(tex) ?? []), prim]);
    const info = material!.getBaseColorTextureInfo();
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
  const layers = await Promise.all(
    placements.map(async (p, i) => {
      const repeat = repeats[i]!;
      const source = Buffer.from(p.texture.getImage()!);
      let input: Buffer;
      if (repeat === 1) {
        input = await sharp(source)
          .resize(p.size, p.size, { fit: 'fill' })
          .ensureAlpha()
          .png()
          .toBuffer();
      } else {
        // N x N kopieën van de textuur naast elkaar, dan naar de celmaat.
        const tile = Math.ceil(p.size / repeat);
        const one = await sharp(source)
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
        input = await sharp(grid).resize(p.size, p.size, { fit: 'fill' }).png().toBuffer();
      }
      return { input, left: p.x, top: p.y };
    }),
  );
  // Atlas zo klein mogelijk: de omhullende macht van 2 van wat gebruikt is.
  const used = pow2(Math.max(...placements.map((p) => Math.max(p.x, p.y) + p.size)));
  let png: Buffer;
  if (options.keepAlpha) {
    // Bladkaarten en gras: de alfa moet in de atlas blijven, dus de cellen worden pixel voor pixel gekopieerd
    // (composite 'over' op een effen achtergrond zou de transparantie wegwerken).
    const pixels = Buffer.alloc(used * used * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set([128, 128, 128, 0], i);
    for (const layer of layers) {
      const raw = await sharp(layer.input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
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
  for (const t of root.listTextures()) if (t !== atlas) t.dispose();
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

export interface TeamMaskRule {
  /** Tint in graden [van, tot] (0 tot 360); van groter dan tot loopt over 0 heen. */
  hue: readonly [number, number];
  /** Minimale verzadiging (0 tot 1). */
  minSaturation?: number | undefined;
  /** Minimale helderheid (0 tot 1). */
  minValue?: number | undefined;
  /** Zachtheid van de rand: sigma van een gauss-vervaging van het masker in texels (standaard 1, 0 = hard). */
  softness?: number | undefined;
}

export interface TeamMaskInfo {
  /** Texels met masker (alfa boven de helft) en texels in totaal, over alle diffuse textures. */
  masked: number;
  total: number;
  /** Aantal textures waarvan de alfa het masker werd. */
  textures: number;
}

function hsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return [(h * 60 + 360) % 360, max > 0 ? d / max : 0, max];
}

/** Of een texel (rgb 0 tot 255) in het kleurbereik van de regel valt. */
export function inTeamRange(rule: TeamMaskRule, r: number, g: number, b: number): boolean {
  const [h0, h1] = rule.hue;
  const [h, s, v] = hsv(r / 255, g / 255, b / 255);
  const inHue = h0 <= h1 ? h >= h0 && h <= h1 : h >= h0 || h <= h1;
  return inHue && s >= (rule.minSaturation ?? 0) && v >= (rule.minValue ?? 0);
}

/**
 * Maakt het teammasker per texel in de alfa van de diffuse (render: modus 'diffuseAlpha', manifest `teamMask`):
 * texels in het kleurbereik van `rule` krijgen alfa 1, de rest 0, met een zachte rand (gauss-vervaging van het
 * masker, daarna een smoothstep rond de helft). De kleur van de texels blijft ongemoeid, ook waar de alfa 0 is. Een eventuele bestaande alfa vervalt; het
 * materiaal blijft OPAQUE, de alfa is dus geen doorzichtigheid. Textures worden PNG.
 */
export async function applyTeamMaskAlpha(
  document: Document,
  rule: TeamMaskRule,
): Promise<TeamMaskInfo> {
  const sharp = await loadSharp();
  const sigma = rule.softness ?? 1;
  const done = new Set<Texture>();
  const info: TeamMaskInfo = { masked: 0, total: 0, textures: 0 };
  for (const material of document.getRoot().listMaterials()) {
    const texture = material.getBaseColorTexture();
    if (!texture || done.has(texture)) continue;
    done.add(texture);
    const { data, info: raw } = await sharp(Buffer.from(texture.getImage()!))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const texels = raw.width * raw.height;
    const mask = Buffer.alloc(texels);
    for (let i = 0; i < texels; i++)
      if (inTeamRange(rule, data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!)) mask[i] = 255;
    let soft: Buffer = mask;
    let stride = 1;
    if (sigma > 0) {
      // sharp geeft na blur van een grijsbeeld drie kanalen terug; de stride houdt daar rekening mee.
      const blurred = await sharp(mask, {
        raw: { width: raw.width, height: raw.height, channels: 1 },
      })
        .blur(sigma)
        .raw()
        .toBuffer({ resolveWithObject: true });
      soft = blurred.data;
      stride = blurred.info.channels;
    }
    for (let i = 0; i < texels; i++) {
      // Smoothstep rond de helft: een rand loopt over ongeveer twee texels, en losse speldeprikken (ruis in de
      // textuur die net buiten het kleurbereik valt) verdwijnen in plaats van een gespikkeld masker te geven.
      const blurred = soft[i * stride]! / 255;
      const t = sigma > 0 ? Math.min(1, Math.max(0, (blurred - 0.25) / 0.5)) : blurred;
      data[i * 4 + 3] = Math.round((sigma > 0 ? t * t * (3 - 2 * t) : t) * 255);
      if (mask[i]) info.masked++;
    }
    info.total += texels;
    info.textures++;
    const png = await sharp(data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
      .png()
      .toBuffer();
    texture.setMimeType('image/png').setImage(new Uint8Array(png));
  }
  for (const material of document.getRoot().listMaterials())
    if (material.getBaseColorTexture()) material.setAlphaMode('OPAQUE');
  return info;
}

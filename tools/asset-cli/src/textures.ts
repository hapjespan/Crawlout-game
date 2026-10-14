// Texture-stappen voor karakterbronnen die niet volgens de brief geleverd zijn: een emissive-only kleurtextuur als
// diffuse gebruiken, alle diffuse textures samenvoegen tot één atlas (render tekent één atlas per draw), en het
// teammasker als apart materiaal (naam met "team", wat render als masker leest) afsplitsen op textuurkleur.
// Beeldbewerking via sharp, alleen geladen als een van deze stappen in de config staat.
import type { Document, Material, Primitive, Texture } from '@gltf-transform/core';

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
  /** Per bron-textuur (naam of index) de celmaat in de atlas. */
  cells: { texture: string; source: number; size: number }[];
}

/**
 * Voegt alle diffuse textures samen tot één vierkante PNG-atlas van maximaal `size`. Elke textuur krijgt een vierkante
 * cel (macht van 2); past het niet, dan halveert de textuur met het kleinste oppervlak per texel eerst. UV's worden
 * per primitive naar hun cel verschoven; een primitive waarvan de UV's als geheel een geheel getal buiten [0, 1]
 * liggen wordt eerst teruggeschoven. Alle primitives krijgen daarna één materiaal ("atlas").
 */
export async function buildAtlas(document: Document, size: number): Promise<AtlasInfo> {
  const sharp = await loadSharp();
  const root = document.getRoot();
  const prims = root.listMeshes().flatMap((m) => m.listPrimitives());
  const usedBy = new Map<Texture, Primitive[]>();
  for (const prim of prims) {
    const tex = prim.getMaterial()?.getBaseColorTexture();
    if (!tex)
      throw new Error(
        `primitive met materiaal "${prim.getMaterial()?.getName() ?? '-'}" heeft geen diffuse textuur`,
      );
    usedBy.set(tex, [...(usedBy.get(tex) ?? []), prim]);
  }
  const textures = [...usedBy.keys()];
  const meta = await Promise.all(textures.map((t) => sharp(Buffer.from(t.getImage()!)).metadata()));
  const cells = meta.map((m) => Math.min(size, pow2(Math.max(m.width ?? 1, m.height ?? 1))));
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
    placements.map(async (p) => ({
      input: await sharp(Buffer.from(p.texture.getImage()!))
        .resize(p.size, p.size, { fit: 'fill' })
        .ensureAlpha()
        .png()
        .toBuffer(),
      left: p.x,
      top: p.y,
    })),
  );
  // Atlas zo klein mogelijk: de omhullende macht van 2 van wat gebruikt is.
  const used = pow2(Math.max(...placements.map((p) => Math.max(p.x, p.y) + p.size)));
  const png = await sharp({
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
  const atlas = document
    .createTexture('atlas')
    .setMimeType('image/png')
    .setImage(new Uint8Array(png));
  const material = document
    .createMaterial('atlas')
    .setBaseColorTexture(atlas)
    .setBaseColorFactor([1, 1, 1, 1]);

  // Een UV-accessor die door primitives met verschillende textures gedeeld wordt, krijgt per textuur een kopie
  // (vóór het verschuiven, zodat elke kopie de bron-UV's heeft).
  const owner = new Map<unknown, Texture>();
  for (const p of placements)
    for (const prim of usedBy.get(p.texture)!) {
      const uv = prim.getAttribute('TEXCOORD_0');
      if (!uv) throw new Error('primitive zonder TEXCOORD_0 bij het maken van de atlas');
      const first = owner.get(uv);
      if (!first) owner.set(uv, p.texture);
      else if (first !== p.texture) {
        const copy = uv.clone();
        owner.set(copy, p.texture);
        prim.setAttribute('TEXCOORD_0', copy);
      }
    }
  const done = new Set<unknown>();
  for (const p of placements) {
    for (const prim of usedBy.get(p.texture)!) {
      const uv = prim.getAttribute('TEXCOORD_0')!;
      if (done.has(uv)) {
        prim.setMaterial(material);
        continue;
      }
      done.add(uv);
      const e = [0, 0];
      let minU = Infinity;
      let minV = Infinity;
      for (let i = 0; i < uv.getCount(); i++) {
        uv.getElement(i, e);
        minU = Math.min(minU, e[0]!);
        minV = Math.min(minV, e[1]!);
      }
      const shiftU = Math.floor(minU + 1e-4);
      const shiftV = Math.floor(minV + 1e-4);
      const out = new Float32Array(uv.getCount() * 2);
      const scale = p.size / used;
      for (let i = 0; i < uv.getCount(); i++) {
        uv.getElement(i, e);
        const u = Math.min(1, Math.max(0, e[0]! - shiftU));
        const v = Math.min(1, Math.max(0, e[1]! - shiftV));
        out[i * 2] = p.x / used + u * scale;
        out[i * 2 + 1] = p.y / used + v * scale;
      }
      uv.setNormalized(false).setArray(out);
      prim.setMaterial(material);
    }
  }
  for (const m of root.listMaterials()) if (m !== material) m.dispose();
  for (const t of root.listTextures()) if (t !== atlas) t.dispose();
  return {
    size: used,
    cells: placements.map((p) => ({
      texture: p.texture.getName() || p.texture.getURI() || '(naamloos)',
      source: textures.indexOf(p.texture),
      size: p.size,
    })),
  };
}

export interface TeamMaskRule {
  /** Tint in graden [van, tot] (0 tot 360). */
  hue: readonly [number, number];
  /** Minimale verzadiging (0 tot 1). */
  minSaturation?: number | undefined;
  /** Minimale helderheid (0 tot 1). */
  minValue?: number | undefined;
  /** Deel van de monsters per driehoek dat moet passen (standaard 0.5). */
  threshold?: number | undefined;
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

/**
 * Splitst de driehoeken waarvan de textuur (monsters op hoeken, randmiddens en zwaartepunt) overwegend aan `rule`
 * voldoet af naar een kopie van het materiaal met "_team" in de naam; render kleurt die in de teamkleur. Geeft het
 * aantal driehoeken in het masker en in totaal.
 */
export async function splitTeamMask(
  document: Document,
  rule: TeamMaskRule,
): Promise<{ masked: number; total: number }> {
  const sharp = await loadSharp();
  const decoded = new Map<Texture, { data: Buffer; width: number; height: number }>();
  const pixels = async (t: Texture) => {
    let d = decoded.get(t);
    if (!d) {
      const { data, info } = await sharp(Buffer.from(t.getImage()!))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      d = { data, width: info.width, height: info.height };
      decoded.set(t, d);
    }
    return d;
  };
  const threshold = rule.threshold ?? 0.5;
  const [h0, h1] = rule.hue;
  const matches = (
    img: { data: Buffer; width: number; height: number },
    u: number,
    v: number,
  ): boolean => {
    const x = Math.min(img.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * img.width)));
    const y = Math.min(img.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * img.height)));
    const o = (y * img.width + x) * 4;
    const [h, s, val] = hsv(img.data[o]! / 255, img.data[o + 1]! / 255, img.data[o + 2]! / 255);
    const inHue = h0 <= h1 ? h >= h0 && h <= h1 : h >= h0 || h <= h1;
    return inHue && s >= (rule.minSaturation ?? 0) && val >= (rule.minValue ?? 0);
  };

  let masked = 0;
  let total = 0;
  const teamMaterials = new Map<Material, Material>();
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of [...mesh.listPrimitives()]) {
      const material = prim.getMaterial();
      const tex = material?.getBaseColorTexture();
      const uv = prim.getAttribute('TEXCOORD_0');
      const idx = prim.getIndices();
      if (!material || !tex || !uv || !idx || /team/i.test(material.getName())) continue;
      const img = await pixels(tex);
      const keep: number[] = [];
      const team: number[] = [];
      const a = [0, 0];
      const b = [0, 0];
      const c = [0, 0];
      for (let i = 0; i + 2 < idx.getCount(); i += 3) {
        const tri = [idx.getScalar(i), idx.getScalar(i + 1), idx.getScalar(i + 2)];
        uv.getElement(tri[0]!, a);
        uv.getElement(tri[1]!, b);
        uv.getElement(tri[2]!, c);
        const samples: [number, number][] = [
          [a[0]!, a[1]!],
          [b[0]!, b[1]!],
          [c[0]!, c[1]!],
          [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2],
          [(b[0]! + c[0]!) / 2, (b[1]! + c[1]!) / 2],
          [(a[0]! + c[0]!) / 2, (a[1]! + c[1]!) / 2],
          [(a[0]! + b[0]! + c[0]!) / 3, (a[1]! + b[1]! + c[1]!) / 3],
        ];
        // Iets naar het zwaartepunt toe, zodat randtexels van een andere UV-eiland niet meetellen.
        const cu = samples[6]![0];
        const cv = samples[6]![1];
        const hits = samples.filter(([u, v]) =>
          matches(img, u + (cu - u) * 0.15, v + (cv - v) * 0.15),
        ).length;
        (hits / samples.length > threshold ? team : keep).push(...tri);
        total++;
      }
      if (team.length === 0) continue;
      masked += team.length / 3;
      let teamMaterial = teamMaterials.get(material);
      if (!teamMaterial) {
        // extras houdt het materiaal apart bij dedup() in de LOD-bouw (die negeert namen).
        teamMaterial = material
          .clone()
          .setName(`${material.getName() || 'material'}_team`)
          .setExtras({ ...material.getExtras(), teamMask: true });
        teamMaterials.set(material, teamMaterial);
      }
      const accessor = (list: number[]) =>
        document
          .createAccessor()
          .setType('SCALAR')
          .setArray(uv.getCount() > 65535 ? new Uint32Array(list) : new Uint16Array(list))
          .setBuffer(idx.getBuffer());
      const teamPrim = prim.clone().setIndices(accessor(team)).setMaterial(teamMaterial);
      mesh.addPrimitive(teamPrim);
      if (keep.length > 0) prim.setIndices(accessor(keep));
      else {
        mesh.removePrimitive(prim);
        prim.dispose();
      }
    }
  }
  return { masked, total };
}

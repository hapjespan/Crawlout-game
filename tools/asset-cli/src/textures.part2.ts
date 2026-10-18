// Split from textures.ts to stay under the 5,000-token file limit; textures.ts re-exports the public surface.
// Holds: TeamMaskRule, TeamMaskInfo, hsv, inTeamRange, boneRegion, distanceToTriangle, +1 more.
import type { Document, Texture } from '@gltf-transform/core';
import { loadSharp } from './textures.part1.js';

export interface TeamMaskRule {
  /** Tint in graden [van, tot] (0 tot 360); van groter dan tot loopt over 0 heen. */
  hue: readonly [number, number];
  /** Minimale verzadiging (0 tot 1). */
  minSaturation?: number | undefined;
  /** Minimale helderheid (0 tot 1). */
  minValue?: number | undefined;
  /** Zachtheid van de rand: sigma van een gauss-vervaging van het masker in texels (standaard 1, 0 = hard). */
  softness?: number | undefined;
  /**
   * Only on the skin of these bones (Mixamo names, for example the upper arms for an arm band): texels covered by a
   * triangle whose mean weight on these bones is at least `minWeight` (default 0.5). Needs a skinned mesh.
   */
  bones?: readonly string[] | undefined;
  minWeight?: number | undefined;
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
 * Texels (width x height, 1 = inside) covered by the triangles of `texture`'s primitives whose mean skin weight on
 * `bones` is at least `minWeight`, grown by two texels so the band does not stop short at a UV seam.
 */
export function boneRegion(
  document: Document,
  texture: Texture,
  bones: readonly string[],
  minWeight: number,
  width: number,
  height: number,
): Uint8Array {
  const wanted = new Set(bones);
  const region = new Uint8Array(width * height);
  let skinned = false;
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    const skin = node.getSkin();
    if (!mesh || !skin) continue;
    const names = skin.listJoints().map((j) => j.getName().replace(/^mixamorig[:_]?/i, ''));
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMaterial()?.getBaseColorTexture() !== texture) continue;
      const uv = prim.getAttribute('TEXCOORD_0');
      const joints = prim.getAttribute('JOINTS_0');
      const weights = prim.getAttribute('WEIGHTS_0');
      if (!uv || !joints || !weights) continue;
      skinned = true;
      const count = uv.getCount();
      const share = new Float64Array(count);
      const j = [0, 0, 0, 0];
      const w = [0, 0, 0, 0];
      for (let i = 0; i < count; i++) {
        joints.getElement(i, j);
        weights.getElement(i, w);
        const sum = w.reduce((a, b) => a + b, 0) || 1;
        for (let k = 0; k < 4; k++) if (wanted.has(names[j[k]!] ?? '')) share[i]! += w[k]! / sum;
      }
      const idx = prim.getIndices();
      const triCount = idx ? idx.getCount() / 3 : count / 3;
      const at = (k: number): number => (idx ? idx.getScalar(k) : k);
      const t = [0, 0];
      for (let tri = 0; tri < triCount; tri++) {
        const ids = [at(tri * 3), at(tri * 3 + 1), at(tri * 3 + 2)];
        if ((share[ids[0]!]! + share[ids[1]!]! + share[ids[2]!]!) / 3 < minWeight) continue;
        const pts = ids.map((i) => {
          uv.getElement(i, t);
          return [t[0]! * width, t[1]! * height] as const;
        });
        const x0 = Math.max(0, Math.floor(Math.min(...pts.map((q) => q[0]))) - 2);
        const x1 = Math.min(width - 1, Math.ceil(Math.max(...pts.map((q) => q[0]))) + 2);
        const y0 = Math.max(0, Math.floor(Math.min(...pts.map((q) => q[1]))) - 2);
        const y1 = Math.min(height - 1, Math.ceil(Math.max(...pts.map((q) => q[1]))) + 2);
        for (let y = y0; y <= y1; y++)
          for (let x = x0; x <= x1; x++)
            if (distanceToTriangle(x + 0.5, y + 0.5, pts) <= 2) region[y * width + x] = 1;
      }
    }
  }
  if (!skinned) throw new Error('teamMask.bones needs a skinned mesh with TEXCOORD_0');
  return region;
}

/** Distance (texels) from a point to a 2D triangle; 0 inside. */
function distanceToTriangle(
  x: number,
  y: number,
  p: readonly (readonly [number, number])[],
): number {
  const [a, b, c] = p as [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ];
  const side = (u: readonly [number, number], v: readonly [number, number]): number =>
    (v[0] - u[0]) * (y - u[1]) - (v[1] - u[1]) * (x - u[0]);
  const s0 = side(a, b);
  const s1 = side(b, c);
  const s2 = side(c, a);
  if ((s0 >= 0 && s1 >= 0 && s2 >= 0) || (s0 <= 0 && s1 <= 0 && s2 <= 0)) return 0;
  const seg = (u: readonly [number, number], v: readonly [number, number]): number => {
    const dx = v[0] - u[0];
    const dy = v[1] - u[1];
    const len2 = dx * dx + dy * dy;
    const f = len2 > 0 ? Math.min(1, Math.max(0, ((x - u[0]) * dx + (y - u[1]) * dy) / len2)) : 0;
    return Math.hypot(x - u[0] - f * dx, y - u[1] - f * dy);
  };
  return Math.min(seg(a, b), seg(b, c), seg(c, a));
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
    const region = rule.bones
      ? boneRegion(document, texture, rule.bones, rule.minWeight ?? 0.5, raw.width, raw.height)
      : null;
    for (let i = 0; i < texels; i++)
      if (
        (!region || region[i]) &&
        inTeamRange(rule, data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!)
      )
        mask[i] = 255;
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

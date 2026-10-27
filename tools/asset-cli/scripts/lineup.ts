// Line-up sheets: every unit (as its loadout dresses it), hero, prop and building at true scale next to the 1,8 m Klerk,
// posed by the same baked bone texture the game samples, with attachments placed by the game's own socket matrices
// (packages/render attachmentSockets.ts). Views: front, right side, and the RTS camera at game pixel size.
//
//   npx -y pnpm@9 --filter @crawlout/asset-cli exec tsx scripts/lineup.ts [outDir] [clip] [phase]
//
// Reads assets/dist and assets/dist-local merged the way the dev client merges them (local ids win). Also prints a
// TSV of every asset's bounding box in metres.
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Document, Material, Node } from '@gltf-transform/core';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { createIO } from '../src/lods.js';
import type { AssetManifest } from '../src/manifest.js';
import {
  attachmentMatrix,
  attachmentsOfLoadout,
  SLOT_SPECS,
  slotBoneIndex,
} from '../../../packages/render/src/units/attachmentSockets.js';

type V3 = [number, number, number];
/** A manifest entry plus the dist directory it came from ('dist' or 'dist-local'). */
type Entry = AssetManifest['assets'][number] & { dir?: string };
interface Surface {
  px: Uint8Array | null;
  w: number;
  h: number;
  color: V3;
}
interface Tri {
  p: V3[];
  uv: [number, number][];
  s: number;
}
interface Model {
  tris: Tri[];
  surfaces: Surface[];
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = process.argv[2] ?? '/tmp/asset-lineup';
const CLIP = process.argv[3] ?? 'idle';
const PHASE = Number(process.argv[4] ?? '0');
mkdirSync(OUT, { recursive: true });
const io = createIO();

function readManifest(dir: string): (Entry & { dir: string })[] {
  const file = join(ROOT, 'assets', dir, 'manifest.json');
  if (!existsSync(file)) return [];
  return (JSON.parse(readFileSync(file, 'utf8')) as AssetManifest).assets.map((a) => ({
    ...a,
    dir,
  }));
}
const local = readManifest('dist-local');
const assets = new Map([...readManifest('dist'), ...local].map((a) => [a.id, a]));
const localIds = new Set(local.map((a) => a.id));

const toSrgb = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
async function surfaceOf(m: Material | null): Promise<Surface> {
  const f = m?.getBaseColorFactor() ?? [1, 1, 1, 1];
  const color: V3 = [toSrgb(f[0]!), toSrgb(f[1]!), toSrgb(f[2]!)];
  const image = m?.getBaseColorTexture()?.getImage();
  if (!image) return { px: null, w: 0, h: 0, color };
  try {
    const { data, info } = await sharp(Buffer.from(image))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { px: new Uint8Array(data), w: info.width, h: info.height, color };
  } catch {
    return { px: null, w: 0, h: 0, color };
  }
}

const mat4 = (a: ArrayLike<number>, b: ArrayLike<number>): number[] => {
  const r = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let row = 0; row < 4; row++)
      for (let k = 0; k < 4; k++) r[c * 4 + row]! += a[k * 4 + row]! * b[c * 4 + k]!;
  return r;
};
const xform = (m: ArrayLike<number>, p: ArrayLike<number>): V3 => [
  m[0]! * p[0]! + m[4]! * p[1]! + m[8]! * p[2]! + m[12]!,
  m[1]! * p[0]! + m[5]! * p[1]! + m[9]! * p[2]! + m[13]!,
  m[2]! * p[0]! + m[6]! * p[1]! + m[10]! * p[2]! + m[14]!,
];

/** Skin matrices (column-major, model space) of one baked frame, or null for a model without a bake. */
function frameMatrices(e: Entry, clip: string, phase: number): number[][] | null {
  if (!e.baked || clip === 'bind') return null;
  const c = e.baked.clips.find((k) => k.name === clip) ?? e.baked.clips[0]!;
  const row = c.startRow + Math.min(c.frames - 1, Math.floor(phase * c.frames));
  const buf = readFileSync(join(ROOT, 'assets', e.dir ?? 'dist', e.baked.path));
  const f = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const out: number[][] = [];
  for (let b = 0; b < (e.boneCount ?? 0); b++)
    out.push(
      Array.from(
        f.subarray((row * e.baked.width + b * 4) * 4, (row * e.baked.width + b * 4) * 4 + 16),
      ),
    );
  return out;
}

async function loadDoc(e: Entry & { dir?: string }): Promise<Document> {
  await MeshoptDecoder.ready;
  const path = e.lods[0]!.path;
  return io.readBinary(
    readFileSync(path.startsWith('/') ? path : join(ROOT, 'assets', e.dir ?? 'dist', path)),
  );
}

/** Triangles of an asset in model space, skinned by `skin` when given; `pre` moves static vertices first. */
async function modelOf(
  e: Entry,
  skin: number[][] | null,
  pre?: number[],
  bone?: number,
): Promise<Model & { joints: string[] }> {
  const doc = await loadDoc(e);
  const surfaces: Surface[] = [];
  const index = new Map<Material | null, number>();
  const tris: Tri[] = [];
  const joints =
    doc
      .getRoot()
      .listSkins()[0]
      ?.listJoints()
      .map((j) => j.getName()) ?? [];
  const walk = async (node: Node, parent: number[]): Promise<void> => {
    const world = mat4(parent, node.getMatrix());
    const mesh = node.getMesh();
    const nodeSkin = node.getSkin();
    const map = nodeSkin?.listJoints().map((j) => joints.indexOf(j.getName())) ?? [];
    for (const prim of mesh?.listPrimitives() ?? []) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const J = prim.getAttribute('JOINTS_0');
      const W = prim.getAttribute('WEIGHTS_0');
      const uvA = prim.getAttribute('TEXCOORD_0');
      const m = prim.getMaterial();
      let si = index.get(m);
      if (si === undefined) {
        si = surfaces.length;
        surfaces.push(await surfaceOf(m));
        index.set(m, si);
      }
      const vert = (vi: number): V3 => {
        const p = pos.getElement(vi, [0, 0, 0]);
        if (skin && nodeSkin && J && W) {
          const j = J.getElement(vi, [0, 0, 0, 0]);
          const w = W.getElement(vi, [0, 0, 0, 0]);
          const acc: V3 = [0, 0, 0];
          for (let k = 0; k < 4; k++) {
            if (!w[k]) continue;
            const q = xform(skin[map[j[k]!]!]!, p);
            for (let d = 0; d < 3; d++) acc[d]! += w[k]! * q[d]!;
          }
          return acc;
        }
        let q = xform(world, p);
        if (pre) q = xform(pre, q);
        if (skin && bone !== undefined) q = xform(skin[bone]!, q);
        return q;
      };
      const idx = prim.getIndices();
      const n = idx ? idx.getCount() : pos.getCount();
      for (let i = 0; i + 2 < n; i += 3) {
        const ids = [0, 1, 2].map((k) => (idx ? idx.getScalar(i + k) : i + k));
        tris.push({
          p: ids.map(vert),
          uv: ids.map((vi) => (uvA ? (uvA.getElement(vi, [0, 0]) as [number, number]) : [0, 0])),
          s: si,
        });
      }
    }
    for (const c of node.listChildren()) await walk(c, world);
  };
  for (const scene of doc.getRoot().listScenes())
    for (const c of scene.listChildren())
      await walk(c, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return { tris, surfaces, joints };
}

export interface Subject {
  label: string;
  body: string;
  slots?: Record<string, string>;
  clip?: string;
  phase?: number;
  /** Stand the model on the ground line (props have their grip at the origin). */
  lift?: boolean;
}

/** A manifest entry, or for an absolute .glb path (a raw source) a stand-in without bake or sockets. */
function entryOf(id: string): Entry & { dir?: string } {
  const e = assets.get(id);
  if (e) return e;
  if (!id.startsWith('/')) throw new Error(`no asset ${id}`);
  return {
    id,
    kind: 'prop',
    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
    lods: [{ level: 0, path: id, triangles: 0 }],
    sockets: {},
    animations: [],
    boneCount: 0,
  } as unknown as Entry;
}

/** A subject's triangles: the body (posed if it has a bake) plus its attachments on the game's sockets. */
async function build(s: Subject): Promise<{ model: Model; note: string }> {
  const e = entryOf(s.body);
  const skin = frameMatrices(e, s.clip ?? CLIP, s.phase ?? PHASE);
  const body = await modelOf(e, skin);
  const model: Model = { tris: [...body.tris], surfaces: [...body.surfaces] };
  const notes: string[] = [];
  for (const { slot, assetId } of attachmentsOfLoadout(s.slots ?? {})) {
    const prop = assets.get(assetId);
    const spec = SLOT_SPECS[slot];
    const m = attachmentMatrix(slot, e.sockets ?? {});
    const bone = slotBoneIndex(body.joints, slot);
    if (!prop) {
      notes.push(`${slot}: ${assetId} MISSING`);
      continue;
    }
    if (!m || bone < 0) {
      notes.push(`${slot}: no ${spec.socket} socket/bone, skipped`);
      continue;
    }
    const pm = await modelOf(prop, skin, m.elements, bone);
    const off = model.surfaces.length;
    model.surfaces.push(...pm.surfaces);
    for (const t of pm.tris) model.tris.push({ ...t, s: t.s + off });
    notes.push(`${slot}: ${assetId} ${dims(prop)}`);
  }
  if (s.lift) {
    let dy = Infinity;
    for (const t of model.tris) for (const p of t.p) dy = Math.min(dy, p[1]);
    dy = -dy;
    for (const t of model.tris) t.p = t.p.map(([x, y, z]) => [x, y + dy, z] as V3);
  }
  return { model, note: notes.join(' | ') };
}

export const dims = (e: Entry): string =>
  [0, 1, 2].map((i) => (e.bounds.max[i]! - e.bounds.min[i]!).toFixed(2)).join('x');

type View = { name: string; yaw: number; pitch: number };
const LIGHT: V3 = [0.35, 0.8, 0.48];

/** Rasterises one model into `img` with yaw (about Y) and pitch (camera elevation), ground at gy, centred at cx. */
function draw(
  img: { d: Uint8Array; z: Float32Array; W: number; H: number },
  m: Model,
  v: View,
  scale: number,
  cx: number,
  gy: number,
): void {
  const cy = Math.cos(v.yaw),
    sy = Math.sin(v.yaw),
    cp = Math.cos(v.pitch),
    sp = Math.sin(v.pitch);
  for (const t of m.tris) {
    const r = t.p.map(([x, y, z]) => [x * cy + z * sy, y, -x * sy + z * cy] as V3);
    const e1 = [0, 1, 2].map((k) => t.p[1]![k]! - t.p[0]![k]!);
    const e2 = [0, 1, 2].map((k) => t.p[2]![k]! - t.p[0]![k]!);
    const nx = e1[1]! * e2[2]! - e1[2]! * e2[1]!,
      ny = e1[2]! * e2[0]! - e1[0]! * e2[2]!,
      nz = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
    const shade =
      0.4 +
      0.6 *
        Math.abs((LIGHT[0] * nx + LIGHT[1] * ny + LIGHT[2] * nz) / (Math.hypot(nx, ny, nz) || 1));
    const sx = r.map((p) => cx + p[0] * scale);
    const syv = r.map((p) => gy - (p[1] * cp - p[2] * sp) * scale);
    const dz = r.map((p) => p[1] * sp + p[2] * cp);
    const den = (syv[1]! - syv[2]!) * (sx[0]! - sx[2]!) + (sx[2]! - sx[1]!) * (syv[0]! - syv[2]!);
    if (Math.abs(den) < 1e-9) continue;
    const surf = m.surfaces[t.s]!;
    const x0 = Math.max(0, Math.floor(Math.min(...sx))),
      x1 = Math.min(img.W - 1, Math.ceil(Math.max(...sx)));
    const y0 = Math.max(0, Math.floor(Math.min(...syv))),
      y1 = Math.min(img.H - 1, Math.ceil(Math.max(...syv)));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const w0 =
          ((syv[1]! - syv[2]!) * (x + 0.5 - sx[2]!) + (sx[2]! - sx[1]!) * (y + 0.5 - syv[2]!)) /
          den;
        const w1 =
          ((syv[2]! - syv[0]!) * (x + 0.5 - sx[2]!) + (sx[0]! - sx[2]!) * (y + 0.5 - syv[2]!)) /
          den;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * dz[0]! + w1 * dz[1]! + w2 * dz[2]!;
        const di = y * img.W + x;
        if (z <= img.z[di]!) continue;
        img.z[di] = z;
        let [cr, cg, cb] = surf.color;
        if (surf.px) {
          const u = w0 * t.uv[0]![0] + w1 * t.uv[1]![0] + w2 * t.uv[2]![0];
          const vv = w0 * t.uv[0]![1] + w1 * t.uv[1]![1] + w2 * t.uv[2]![1];
          const tx = Math.min(surf.w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * surf.w)));
          const ty = Math.min(surf.h - 1, Math.max(0, Math.floor((vv - Math.floor(vv)) * surf.h)));
          const ti = (ty * surf.w + tx) * 4;
          cr *= surf.px[ti]! / 255;
          cg *= surf.px[ti + 1]! / 255;
          cb *= surf.px[ti + 2]! / 255;
        }
        img.d.set(
          [
            255 * Math.min(1, cr * shade),
            255 * Math.min(1, cg * shade),
            255 * Math.min(1, cb * shade),
          ],
          di * 4,
        );
      }
  }
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/**
 * One sheet: a row per view, a column per subject, one metre scale for the whole sheet (`pxPerM`), metre lines.
 * `pixel` > 1 renders at pxPerM / pixel and enlarges with nearest neighbour, to show the game's pixel size.
 */
export async function sheet(
  name: string,
  subjects: Subject[],
  views: View[],
  pxPerM: number,
  opts: { pixel?: number; bg?: V3 } = {},
): Promise<void> {
  const built: { s: Subject; model: Model; note: string }[] = [];
  for (const s of subjects) built.push({ s, ...(await build(s)) });
  const spans = built.map(({ model }) => {
    let lo = Infinity,
      hi = -Infinity,
      top = 0;
    for (const t of model.tris)
      for (const p of t.p) {
        const r = Math.hypot(p[0], p[2]);
        lo = Math.min(lo, -r);
        hi = Math.max(hi, r);
        top = Math.max(top, p[1]);
      }
    return { w: Math.max(1, hi - lo), top };
  });
  const k = opts.pixel ?? 1;
  const scale = pxPerM / k;
  const cellW = spans.map((sp) => Math.max(150 / k, Math.ceil(sp.w * scale) + 10));
  const rowH =
    Math.ceil(
      Math.max(...spans.map((sp) => sp.top)) * scale * 1.05 +
        Math.max(...spans.map((sp) => sp.w)) * scale * 0.5,
    ) + Math.ceil(70 / k);
  const W = cellW.reduce((a, b) => a + b, 0),
    H = rowH * views.length;
  const img = { d: new Uint8Array(W * H * 4), z: new Float32Array(W * H).fill(-Infinity), W, H };
  const bg = opts.bg ?? [20, 22, 20];
  for (let i = 0; i < W * H; i++) img.d.set([...bg, 255], i * 4);
  const svg: string[] = [];
  views.forEach((v, row) => {
    const gy =
      row * rowH +
      rowH -
      Math.ceil(26 / k) -
      Math.ceil(Math.max(...spans.map((sp) => sp.w)) * scale * 0.25 * Math.sin(v.pitch));
    if (!opts.bg)
      for (let mtr = 0; mtr * scale < rowH - 40 / k; mtr++) {
        const y = Math.round(gy - mtr * scale * Math.cos(v.pitch));
        const c = mtr === 0 ? 110 : mtr % 5 === 0 ? 70 : 42;
        if (mtr * scale >= 4) for (let x = 0; x < W; x++) img.d.set([c, c + 6, c], (y * W + x) * 4);
      }
    let x0 = 0;
    built.forEach(({ model }, i) => {
      draw(img, model, v, scale, x0 + cellW[i]! / 2, gy);
      x0 += cellW[i]!;
    });
    svg.push(
      `<text x="4" y="${(row * rowH + 14) * k}" fill="#e0c060" font-size="13">${v.name}</text>`,
    );
  });
  let x0 = 0;
  built.forEach(({ s, note }, i) => {
    const e = entryOf(s.body);
    const lines = [
      `${s.label}${localIds.has(s.body) ? '' : ' [dist]'}`,
      `${s.body} ${dims(e)}`,
      ...note.split(' | ').filter(Boolean),
    ];
    lines.forEach((l, j) =>
      svg.push(
        `<text x="${x0 * k + 4}" y="${H * k - 4 - (lines.length - 1 - j) * 12}" fill="#d8d8d8" font-size="10">${esc(l)}</text>`,
      ),
    );
    x0 += cellW[i]!;
  });
  const file = join(OUT, `${name}.png`);
  await sharp(Buffer.from(img.d), { raw: { width: W, height: H, channels: 4 } })
    .resize(W * k, H * k, { kernel: 'nearest' })
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${W * k}" height="${H * k}" font-family="Helvetica">${svg.join('')}</svg>`,
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toFile(file);
  console.log(file);
}

export const FRONT: View = { name: 'front', yaw: 0, pitch: 0 };
export const SIDE: View = { name: 'right side', yaw: Math.PI / 2, pitch: 0 };
export const BACK: View = { name: 'back 3/4', yaw: Math.PI * 0.8, pitch: 0 };
export const RTS_A: View = {
  name: 'RTS 55deg, 3/4 front',
  yaw: Math.PI / 4,
  pitch: (55 * Math.PI) / 180,
};
export const RTS_B: View = {
  name: 'RTS 55deg, 3/4 back',
  yaw: Math.PI * 0.8,
  pitch: (55 * Math.PI) / 180,
};

/** Every loadout with a body in the manifest, from data/loadouts and data/creeps.json. */
export function loadouts(): {
  id: string;
  faction: string;
  role: string;
  slots: Record<string, string>;
}[] {
  const dir = join(ROOT, 'data/loadouts');
  const out = [];
  for (const f of readdirSync(dir).sort())
    for (const l of JSON.parse(readFileSync(join(dir, f), 'utf8')) as {
      id: string;
      faction: string;
      role: string;
      visuals: { meshSlots: Record<string, string> };
    }[])
      out.push({ id: l.id, faction: l.faction, role: l.role, slots: l.visuals.meshSlots });
  return out;
}

export { assets };

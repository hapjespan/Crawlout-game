// Textured orthographic previews of built assets, side by side on one metre scale.
//
// silhouette.ts answers "is this the right size": flat shading, no texture, because shape is what you judge there. This
// module answers "does it look right": it samples the base colour texture per pixel, so the art shows up. Same
// projection and the same metre grid, plus a z-buffer, because once triangles carry different colours a painter's sort
// on average depth starts showing through surfaces.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { getBounds } from '@gltf-transform/functions';
import type { Document, Material } from '@gltf-transform/core';
import { MeshoptDecoder } from 'meshoptimizer';
import { createIO } from './lods.js';

const sharp = createRequire(import.meta.url)('sharp') as typeof import('sharp');
const io = createIO();

export interface PreviewSubject {
  label: string;
  /** Path to a .glb. */
  file: string;
}

interface Surface {
  /** Raw RGBA of the base colour texture, or null for a flat material. */
  pixels: Uint8Array | null;
  width: number;
  height: number;
  /** Base colour factor, used flat or multiplied over the texture. */
  color: [number, number, number];
}

interface Face {
  /** World position per corner. */
  p: [number, number, number][];
  /** Texture coordinate per corner. */
  uv: [number, number][];
  surface: number;
  shade: number;
}

const identity = (): number[] => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mul4(a: number[], b: number[]): number[] {
  const r = new Array<number>(16).fill(0);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      for (let k = 0; k < 4; k++) r[i * 4 + j]! += a[i * 4 + k]! * b[k * 4 + j]!;
  return r;
}

function apply(m: number[], p: [number, number, number]): [number, number, number] {
  const [x, y, z] = p;
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ];
}

/** sRGB base colour factors are linear in glTF; bring them back for display. */
const toSrgb = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

async function surfaceOf(material: Material | null): Promise<Surface> {
  const factor = material?.getBaseColorFactor() ?? [1, 1, 1, 1];
  const color: [number, number, number] = [
    toSrgb(factor[0]!),
    toSrgb(factor[1]!),
    toSrgb(factor[2]!),
  ];
  const image = material?.getBaseColorTexture()?.getImage();
  if (!image) return { pixels: null, width: 0, height: 0, color };
  const { data, info } = await sharp(Buffer.from(image))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { pixels: new Uint8Array(data), width: info.width, height: info.height, color };
}

async function facesOf(doc: Document): Promise<{ faces: Face[]; surfaces: Surface[] }> {
  const surfaces: Surface[] = [];
  const index = new Map<Material | null, number>();
  const faces: Face[] = [];
  for (const scene of doc.getRoot().listScenes()) {
    const walk = async (
      node: ReturnType<typeof scene.listChildren>[number],
      m: number[],
    ): Promise<void> => {
      const world = mul4(m, Array.from(node.getMatrix()));
      const mesh = node.getMesh();
      if (mesh)
        for (const prim of mesh.listPrimitives()) {
          const pos = prim.getAttribute('POSITION');
          if (!pos) continue;
          const uvs = prim.getAttribute('TEXCOORD_0');
          const material = prim.getMaterial();
          let si = index.get(material);
          if (si === undefined) {
            si = surfaces.length;
            surfaces.push(await surfaceOf(material));
            index.set(material, si);
          }
          const idx = prim.getIndices();
          const n = idx ? idx.getCount() : pos.getCount();
          for (let i = 0; i + 2 < n; i += 3) {
            const p: [number, number, number][] = [];
            const uv: [number, number][] = [];
            for (let k = 0; k < 3; k++) {
              const vi = idx ? idx.getScalar(i + k) : i + k;
              p.push(apply(world, pos.getElement(vi, [0, 0, 0]) as [number, number, number]));
              uv.push(
                uvs ? (uvs.getElement(vi, [0, 0]) as [number, number]) : ([0, 0] as [number, number]),
              );
            }
            const e1 = [p[1]![0] - p[0]![0], p[1]![1] - p[0]![1], p[1]![2] - p[0]![2]];
            const e2 = [p[2]![0] - p[0]![0], p[2]![1] - p[0]![1], p[2]![2] - p[0]![2]];
            const nx = e1[1]! * e2[2]! - e1[2]! * e2[1]!;
            const ny = e1[2]! * e2[0]! - e1[0]! * e2[2]!;
            const nz = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
            const len = Math.hypot(nx, ny, nz) || 1;
            // Light from the front, a little left and above, with a floor so nothing goes pure black.
            const lambert = Math.max(0, (-0.35 * nx + 0.45 * ny + 0.82 * nz) / len);
            faces.push({ p, uv, surface: si, shade: 0.35 + 0.65 * lambert });
          }
        }
      for (const child of node.listChildren()) await walk(child, world);
    };
    for (const child of scene.listChildren()) await walk(child, identity());
  }
  return { faces, surfaces };
}

/** Draws every subject on one shared scale with a metre grid, sampling each triangle's texture. Returns raw RGBA. */
export async function previewSheet(
  subjects: readonly PreviewSubject[],
  opt: { width: number; height: number } = { width: 1400, height: 900 },
): Promise<{ data: Uint8Array; width: number; height: number }> {
  await MeshoptDecoder.ready;
  const loaded = [];
  for (const s of subjects) {
    const doc = await io.readBinary(readFileSync(s.file));
    const b = getBounds(doc.getRoot().listScenes()[0]!);
    loaded.push({ ...s, ...(await facesOf(doc)), min: b.min, max: b.max });
  }
  const tallest = Math.max(...loaded.map((l) => l.max[1]! - l.min[1]!));
  const widest = Math.max(...loaded.map((l) => l.max[0]! - l.min[0]!));
  const { width: W, height: H } = opt;
  const cellW = W / loaded.length;
  const scale = Math.min((H - 110) / (tallest * 1.08), (cellW - 30) / (widest * 1.12));
  const groundY = H - 60;

  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = 14;
    data[i * 4 + 1] = 15;
    data[i * 4 + 2] = 14;
    data[i * 4 + 3] = 255;
  }
  const depth = new Float32Array(W * H).fill(-Infinity); // +Z is towards the viewer, so the largest z wins
  for (let mtr = 0; mtr * scale < H - 60; mtr++) {
    const y = Math.floor(groundY - mtr * scale);
    const v = mtr % 5 === 0 ? 58 : 32;
    if (y >= 0 && y < H)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        data[i] = v;
        data[i + 1] = v + 5;
        data[i + 2] = v;
      }
  }

  loaded.forEach((l, cell) => {
    const cx = cell * cellW + cellW / 2;
    const midX = (l.min[0]! + l.max[0]!) / 2;
    for (const f of l.faces) {
      const sx = f.p.map((v) => cx + (v[0] - midX) * scale);
      const sy = f.p.map((v) => groundY - (v[1] - l.min[1]!) * scale);
      const x0 = Math.max(0, Math.floor(Math.min(...sx)));
      const x1 = Math.min(W - 1, Math.ceil(Math.max(...sx)));
      const y0 = Math.max(0, Math.floor(Math.min(...sy)));
      const y1 = Math.min(H - 1, Math.ceil(Math.max(...sy)));
      const den = (sy[1]! - sy[2]!) * (sx[0]! - sx[2]!) + (sx[2]! - sx[1]!) * (sy[0]! - sy[2]!);
      if (Math.abs(den) < 1e-9) continue;
      const surf = l.surfaces[f.surface]!;
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const w0 = ((sy[1]! - sy[2]!) * (x - sx[2]!) + (sx[2]! - sx[1]!) * (y - sy[2]!)) / den;
          const w1 = ((sy[2]! - sy[0]!) * (x - sx[2]!) + (sx[0]! - sx[2]!) * (y - sy[2]!)) / den;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * f.p[0]![2] + w1 * f.p[1]![2] + w2 * f.p[2]![2];
          const di = y * W + x;
          if (z <= depth[di]!) continue; // +Z is towards the viewer, so keep the nearest
          let r = surf.color[0];
          let g = surf.color[1];
          let b = surf.color[2];
          if (surf.pixels) {
            const u = w0 * f.uv[0]![0] + w1 * f.uv[1]![0] + w2 * f.uv[2]![0];
            const v = w0 * f.uv[0]![1] + w1 * f.uv[1]![1] + w2 * f.uv[2]![1];
            const tx = Math.min(surf.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * surf.width)));
            const ty = Math.min(surf.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * surf.height)));
            const ti = (ty * surf.width + tx) * 4;
            r *= surf.pixels[ti]! / 255;
            g *= surf.pixels[ti + 1]! / 255;
            b *= surf.pixels[ti + 2]! / 255;
          }
          depth[di] = z;
          const o = di * 4;
          data[o] = Math.round(255 * Math.min(1, r * f.shade));
          data[o + 1] = Math.round(255 * Math.min(1, g * f.shade));
          data[o + 2] = Math.round(255 * Math.min(1, b * f.shade));
        }
    }
    for (let x = Math.floor(cell * cellW + 6); x < (cell + 1) * cellW - 6; x++) {
      const i = (groundY * W + x) * 4;
      data[i] = 96;
      data[i + 1] = 110;
      data[i + 2] = 96;
    }
  });
  return { data, width: W, height: H };
}

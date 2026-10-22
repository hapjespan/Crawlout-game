// Flat-shaded orthographic previews of built assets, side by side on one metre scale, for a size review.
//
// A screenshot of the render demo shows the game's lighting but not the proportions: the camera is wherever it is and
// the units stand wherever the fake snapshot puts them. For "is this the right size next to a 1,8 m Dweller" a plain
// orthographic projection on a shared scale answers the question directly, and it needs no browser or GPU.
import { readFileSync } from 'node:fs';
import { getBounds } from '@gltf-transform/functions';
import type { Document } from '@gltf-transform/core';
import { MeshoptDecoder } from 'meshoptimizer';
import { createIO } from './lods.js';

export interface Subject {
  label: string;
  /** Path to a .glb. */
  file: string;
}

interface Tri {
  /** Screen x, y per corner plus the depth and the shade. */
  p: [number, number][];
  depth: number;
  shade: number;
}

const io = createIO();

/** World-space triangles of every primitive, with the node transforms applied. */
function trianglesOf(doc: Document): { v: [number, number, number][][] } {
  const out: [number, number, number][][] = [];
  for (const scene of doc.getRoot().listScenes()) {
    const walk = (node: ReturnType<typeof scene.listChildren>[number], m: number[]): void => {
      const t = node.getMatrix();
      const w = mul4(m, Array.from(t));
      const mesh = node.getMesh();
      if (mesh)
        for (const prim of mesh.listPrimitives()) {
          const pos = prim.getAttribute('POSITION');
          if (!pos) continue;
          const idx = prim.getIndices();
          const n = idx ? idx.getCount() : pos.getCount();
          for (let i = 0; i + 2 < n; i += 3) {
            const tri: [number, number, number][] = [];
            for (let k = 0; k < 3; k++) {
              const vi = idx ? idx.getScalar(i + k) : i + k;
              const p = pos.getElement(vi, [0, 0, 0]) as number[];
              tri.push(apply(w, p as [number, number, number]));
            }
            out.push(tri);
          }
        }
      for (const child of node.listChildren()) walk(child, w);
    };
    for (const child of scene.listChildren()) walk(child, identity());
  }
  return { v: out };
}

const identity = (): number[] => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mul4(a: number[], b: number[]): number[] {
  const r = new Array<number>(16).fill(0);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      for (let k = 0; k < 4; k++) r[i * 4 + j]! += a[i * 4 + k]! * b[k * 4 + j]!;
  return r;
}

/** Column-major glTF matrix times a point. */
function apply(m: number[], p: [number, number, number]): [number, number, number] {
  const [x, y, z] = p;
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ];
}

/**
 * Draws every subject on one shared scale (pixels per metre) with a ground line and a 1 m grid, and returns raw RGBA.
 */
export async function silhouetteSheet(
  subjects: readonly Subject[],
  opt: { width: number; height: number; marginM?: number } = { width: 1800, height: 820 },
): Promise<{ data: Uint8Array; width: number; height: number }> {
  // The built LODs are meshopt-compressed, so the decoder has to be up before the first read.
  await MeshoptDecoder.ready;
  const loaded = [];
  for (const s of subjects) {
    const doc = await io.readBinary(readFileSync(s.file));
    const b = getBounds(doc.getRoot().listScenes()[0]!);
    loaded.push({ ...s, tris: trianglesOf(doc).v, min: b.min, max: b.max });
  }
  const tallest = Math.max(...loaded.map((l) => l.max[1]! - l.min[1]!));
  const widest = Math.max(...loaded.map((l) => l.max[0]! - l.min[0]!));
  const { width: W, height: H } = opt;
  const cellW = W / loaded.length;
  // One scale for everyone, so the sizes can be compared straight off the picture.
  const scale = Math.min((H - 120) / (tallest * 1.1), (cellW - 40) / (widest * 1.15));
  const groundY = H - 70;

  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = 16;
    data[i * 4 + 1] = 18;
    data[i * 4 + 2] = 16;
    data[i * 4 + 3] = 255;
  }
  const px = (x: number, y: number, r: number, g: number, b: number): void => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (Math.floor(y) * W + Math.floor(x)) * 4;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  };
  // Metre grid: a faint line every metre, brighter every five.
  for (let mtr = 0; mtr * scale < H - 70; mtr++) {
    const y = groundY - mtr * scale;
    const v = mtr % 5 === 0 ? 70 : 38;
    for (let x = 0; x < W; x++) px(x, y, v, v + 6, v);
  }

  loaded.forEach((l, i) => {
    const cx = i * cellW + cellW / 2;
    const midX = (l.min[0]! + l.max[0]!) / 2;
    const tris: Tri[] = l.tris.map((t) => {
      const p = t.map(
        (v) => [cx + (v[0] - midX) * scale, groundY - (v[1] - l.min[1]!) * scale] as [number, number],
      );
      // Flat shade from the facet normal against a light from the front-left-above, plus depth for a little relief.
      const e1 = [t[1]![0] - t[0]![0], t[1]![1] - t[0]![1], t[1]![2] - t[0]![2]];
      const e2 = [t[2]![0] - t[0]![0], t[2]![1] - t[0]![1], t[2]![2] - t[0]![2]];
      const n = [
        e1[1]! * e2[2]! - e1[2]! * e2[1]!,
        e1[2]! * e2[0]! - e1[0]! * e2[2]!,
        e1[0]! * e2[1]! - e1[1]! * e2[0]!,
      ];
      const len = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
      const lambert = Math.max(0, (-0.4 * n[0]! + 0.5 * n[1]! + 0.76 * n[2]!) / len);
      return { p, depth: (t[0]![2] + t[1]![2] + t[2]![2]) / 3, shade: 0.25 + 0.75 * lambert };
    });
    tris.sort((a, b) => a.depth - b.depth); // painter's order: far first
    for (const t of tris) {
      const xs = t.p.map((q) => q[0]);
      const ys = t.p.map((q) => q[1]);
      const x0 = Math.max(0, Math.floor(Math.min(...xs)));
      const x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
      const y0 = Math.max(0, Math.floor(Math.min(...ys)));
      const y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
      const [ax, ay] = t.p[0]!;
      const [bx, by] = t.p[1]!;
      const [cxx, cy] = t.p[2]!;
      const den = (by - cy) * (ax - cxx) + (cxx - bx) * (ay - cy);
      if (Math.abs(den) < 1e-9) continue;
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const w0 = ((by - cy) * (x - cxx) + (cxx - bx) * (y - cy)) / den;
          const w1 = ((cy - ay) * (x - cxx) + (ax - cxx) * (y - cy)) / den;
          if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;
          const g = Math.round(210 * t.shade);
          px(x, y, Math.round(g * 0.72), g, Math.round(g * 0.62));
        }
    }
    // Ground line under each subject.
    for (let x = i * cellW + 8; x < (i + 1) * cellW - 8; x++) px(x, groundY, 120, 140, 120);
  });
  return { data, width: W, height: H };
}

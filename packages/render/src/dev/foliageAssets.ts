// Synthetic foliage for the render demo (?foliage), so the alpha-test, wind, variation and thinning of the prop layer
// can be seen and measured before the real packs are in assets/dist: leafy and bare trees, grass, plants, crates,
// chests, barrels and a watchtower, built from alpha-tested leaf cards (a canvas texture with transparent gaps) and
// exported as GLB with three's GLTFExporter, so they go through the renderer's real GLB path (alphaMode MASK, a
// separate bark texture next to the leaf texture, which takes the layered texture layout). Render-demo code only:
// floats are fine, nothing here reaches the sim. Browser only (canvas textures); lives in the dev entry.
import type { PropCategory } from '../props/propCategory.js';
import type { PropSourceOptions } from '../props/propAssets.js';
import type { RenderProp } from '../props/propLayer.js';
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  type Texture,
} from 'three/webgpu';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** What foliageProps needs of the demo world (apps/client xlWorld.ts XlWorld fits). */
export interface FoliageWorld {
  size: number;
  water: { data: Uint8Array };
  props: readonly RenderProp[];
  trees: number;
}

/** Deterministic hash to 0..1. */
function rand(n: number): number {
  let h = Math.imul(n ^ 0x2c1b3c6d, 0x297a2d39);
  h ^= h >>> 15;
  h = Math.imul(h, 0x6c8e9cf5);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function canvasTexture(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, size);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.flipY = false;
  return t;
}

/** Leaves: a cluster of green blobs on a transparent background (hard edges, so alpha is 0 or 1). */
function leafTexture(): Texture {
  return canvasTexture(128, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    for (let k = 0; k < 14; k++) {
      const a = rand(k * 7 + 1) * Math.PI * 2;
      const r = rand(k * 7 + 2) * s * 0.3;
      const x = s / 2 + Math.cos(a) * r;
      const y = s / 2 + Math.sin(a) * r;
      ctx.fillStyle = `hsl(${78 + rand(k * 7 + 3) * 30} ${40 + rand(k * 7 + 4) * 20}% ${28 + rand(k * 7 + 5) * 20}%)`;
      ctx.beginPath();
      ctx.ellipse(
        x,
        y,
        s * (0.1 + 0.08 * rand(k * 7 + 6)),
        s * 0.07,
        rand(k * 7 + 7) * 3,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  });
}

/** Blades: a fan of thin triangles from the bottom edge, green to straw. */
function bladeTexture(): Texture {
  return canvasTexture(128, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    for (let k = 0; k < 9; k++) {
      const x = s * (0.1 + 0.8 * (k / 8));
      const lean = (rand(k + 40) - 0.5) * s * 0.25;
      const h = s * (0.55 + rand(k + 50) * 0.4);
      ctx.fillStyle = `hsl(${60 + rand(k + 60) * 30} ${35 + rand(k + 70) * 20}% ${34 + rand(k + 80) * 16}%)`;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.035, s);
      ctx.lineTo(x + lean, s - h);
      ctx.lineTo(x + s * 0.035, s);
      ctx.closePath();
      ctx.fill();
    }
  });
}

/** Opaque planks / bark in brown. */
function woodTexture(): Texture {
  return canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#6b5236';
    ctx.fillRect(0, 0, s, s);
    for (let k = 0; k < 24; k++) {
      ctx.fillStyle = `hsl(28 ${25 + rand(k) * 15}% ${22 + rand(k + 9) * 16}%)`;
      ctx.fillRect(rand(k + 3) * s, 0, 3 + rand(k + 5) * 6, s);
    }
  });
}

/** Crossed cards: `n` planes of w x h around the y axis, optionally spread over an ellipsoid. */
function cards(
  n: number,
  w: number,
  h: number,
  place: (k: number) => { x: number; y: number; z: number; yaw: number; tilt: number },
): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let k = 0; k < n; k++) {
    const p = place(k);
    const g = new PlaneGeometry(w, h);
    g.rotateX(p.tilt);
    g.rotateY(p.yaw);
    g.translate(p.x, p.y, p.z);
    parts.push(g);
  }
  return mergeGeometries(parts)!;
}

interface Sources {
  urls: Map<string, string>;
  categories: Record<string, PropCategory>;
}

function crownCards(
  n: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed: number,
): BufferGeometry {
  return cards(n, 1.7, 1.5, (k) => {
    const a = rand(seed + k * 5) * Math.PI * 2;
    const u = Math.cbrt(rand(seed + k * 5 + 1));
    const v = rand(seed + k * 5 + 2) * 2 - 1;
    const rr = Math.sqrt(1 - v * v) * u;
    return {
      x: cx + Math.cos(a) * rr * rx,
      y: cy + v * u * ry,
      z: Math.sin(a) * rr * rx,
      yaw: rand(seed + k * 5 + 3) * Math.PI,
      tilt: (rand(seed + k * 5 + 4) - 0.5) * 1.2,
    };
  });
}

async function glb(scene: Scene): Promise<Blob> {
  const bytes = (await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer;
  return new Blob([bytes], { type: 'model/gltf-binary' });
}

/** Builds the synthetic assets and gives each a blob URL. */
export async function foliageSources(): Promise<Sources> {
  const leaf = leafTexture();
  const blade = bladeTexture();
  const wood = woodTexture();
  const leafMat = new MeshStandardMaterial({
    name: 'leaf',
    map: leaf,
    alphaTest: 0.5,
    side: DoubleSide,
  });
  const bladeMat = new MeshStandardMaterial({
    name: 'blade',
    map: blade,
    alphaTest: 0.5,
    side: DoubleSide,
  });
  const woodMat = new MeshStandardMaterial({ name: 'wood', map: wood });
  const entries: { id: string; category: PropCategory; build: () => Mesh[] }[] = [
    {
      id: 'foltree_a',
      category: 'tree-leafy',
      build: () => [
        new Mesh(new CylinderGeometry(0.16, 0.26, 3.4, 7).translate(0, 1.7, 0), woodMat),
        new Mesh(crownCards(70, 0, 4.2, 1.9, 1.5, 100), leafMat),
      ],
    },
    {
      id: 'foltree_b',
      category: 'tree-leafy',
      build: () => [
        new Mesh(new CylinderGeometry(0.12, 0.2, 2.4, 7).translate(0, 1.2, 0), woodMat),
        new Mesh(crownCards(46, 0, 3.2, 1.5, 1.2, 300), leafMat),
      ],
    },
    {
      id: 'folbare_tree',
      category: 'tree-bare',
      build: () => {
        const parts = [new CylinderGeometry(0.1, 0.22, 3.6, 6).translate(0, 1.8, 0)];
        for (let k = 0; k < 6; k++) {
          const g = new CylinderGeometry(0.03, 0.07, 1.6, 4).translate(0, 0.8, 0);
          g.rotateZ(0.6 + rand(k) * 0.4);
          g.rotateY((k / 6) * Math.PI * 2);
          g.translate(0, 2.6 + rand(k + 9) * 1.2, 0);
          parts.push(g);
        }
        return [new Mesh(mergeGeometries(parts)!, woodMat)];
      },
    },
    {
      id: 'folgrass_tuft',
      category: 'grass',
      build: () => [
        new Mesh(
          cards(5, 0.5, 0.45, (k) => ({ x: 0, y: 0.225, z: 0, yaw: (k / 5) * Math.PI, tilt: 0 })),
          bladeMat,
        ),
      ],
    },
    {
      id: 'folplant_fern',
      category: 'plant',
      build: () => [
        new Mesh(
          cards(5, 0.8, 0.7, (k) => ({
            x: 0,
            y: 0.35,
            z: 0,
            yaw: (k / 5) * Math.PI * 2,
            tilt: 0.3,
          })),
          leafMat,
        ),
      ],
    },
    {
      id: 'folcrate',
      category: 'crate',
      build: () => [new Mesh(new BoxGeometry(0.9, 0.8, 0.9).translate(0, 0.4, 0), woodMat)],
    },
    {
      id: 'folchest',
      category: 'chest',
      build: () => [
        new Mesh(
          mergeGeometries([
            new BoxGeometry(1, 0.5, 0.6).translate(0, 0.25, 0),
            new CylinderGeometry(0.3, 0.3, 1, 8).rotateZ(Math.PI / 2).translate(0, 0.5, 0),
          ])!,
          woodMat,
        ),
      ],
    },
    {
      id: 'folbarrel',
      category: 'barrel',
      build: () => [
        new Mesh(new CylinderGeometry(0.34, 0.34, 0.9, 10).translate(0, 0.45, 0), woodMat),
      ],
    },
    {
      id: 'folwatchtower',
      category: 'structure',
      build: () => [
        new Mesh(
          mergeGeometries([
            new BoxGeometry(0.4, 7, 0.4).translate(1.2, 3.5, 1.2),
            new BoxGeometry(0.4, 7, 0.4).translate(-1.2, 3.5, 1.2),
            new BoxGeometry(0.4, 7, 0.4).translate(1.2, 3.5, -1.2),
            new BoxGeometry(0.4, 7, 0.4).translate(-1.2, 3.5, -1.2),
            new BoxGeometry(3.4, 0.3, 3.4).translate(0, 7, 0),
            new BoxGeometry(3, 1.2, 3).translate(0, 7.75, 0),
          ])!,
          woodMat,
        ),
      ],
    },
  ];
  const urls = new Map<string, string>();
  const categories: Record<string, PropCategory> = {};
  for (const e of entries) {
    const scene = new Scene();
    for (const m of e.build()) scene.add(m);
    urls.set(e.id, URL.createObjectURL(await glb(scene)));
    categories[e.id] = e.category;
  }
  return { urls, categories };
}

/** Prop source for renderer.setProps that serves the synthetic assets. */
export async function foliagePropSource(): Promise<PropSourceOptions> {
  const { urls, categories } = await foliageSources();
  return { manifestUrl: null, sourceUrl: (id) => urls.get(id), categories, placeholders: true };
}

export interface FoliageCounts {
  trees: number;
  grass: number;
  plants: number;
  containers: number;
  towers: number;
}

/**
 * The XL demo props with the trees swapped for the synthetic ones (two leafy variants, a bare one) plus ground cover,
 * crates, chests, barrels and watchtowers over the land. Rocks stay.
 */
export function foliageProps(
  world: FoliageWorld,
  opts: { grass?: number } = {},
): { props: RenderProp[]; counts: FoliageCounts } {
  const size = world.size;
  const land = (x: number, z: number): boolean =>
    x > 2 &&
    z > 2 &&
    x < size - 2 &&
    z < size - 2 &&
    world.water.data[Math.floor(z) * size + Math.floor(x)] === 0;
  const props: RenderProp[] = [];
  const counts: FoliageCounts = { trees: 0, grass: 0, plants: 0, containers: 0, towers: 0 };
  for (const p of world.props) {
    if (p.asset.startsWith('tree')) {
      const id =
        p.asset === 'treelow001'
          ? 'folbare_tree'
          : p.asset === 'treemed001'
            ? 'foltree_b'
            : 'foltree_a';
      props.push({ ...p, asset: id });
      counts.trees++;
    } else if (p.asset.startsWith('bush')) {
      props.push({ ...p, asset: 'folplant_fern', scale: 0.8 + (p.scale - 0.8) });
      counts.plants++;
    } else props.push(p);
  }
  let seed = 9000;
  const scatter = (
    id: string,
    n: number,
    around: boolean,
    scale: [number, number],
    key: keyof FoliageCounts,
  ): void => {
    let made = 0;
    for (let tries = 0; made < n && tries < n * 6; tries++) {
      let x: number;
      let z: number;
      if (around) {
        const t = world.props[Math.floor(rand(seed++) * world.trees) % world.props.length]!;
        const a = rand(seed++) * Math.PI * 2;
        const r = 1 + rand(seed++) * 6;
        x = t.x + Math.cos(a) * r;
        z = t.y + Math.sin(a) * r;
      } else {
        x = 6 + rand(seed++) * (size - 12);
        z = 6 + rand(seed++) * (size - 12);
      }
      if (!land(x, z)) continue;
      props.push({
        asset: id,
        x,
        y: z,
        yaw: Math.floor(rand(seed++) * 65536),
        scale: scale[0] + rand(seed++) * (scale[1] - scale[0]),
      });
      counts[key]++;
      made++;
    }
  };
  const grass = opts.grass ?? 12000;
  scatter('folgrass_tuft', Math.floor(grass / 2), true, [0.8, 1.4], 'grass');
  scatter('folgrass_tuft', Math.ceil(grass / 2), false, [0.8, 1.4], 'grass');
  scatter('folplant_fern', 1500, false, [0.7, 1.3], 'plants');
  scatter('folcrate', 60, false, [0.9, 1.1], 'containers');
  scatter('folchest', 20, false, [0.9, 1.1], 'containers');
  scatter('folbarrel', 60, false, [0.9, 1.1], 'containers');
  scatter('folwatchtower', 6, false, [1, 1], 'towers');
  return { props, counts };
}

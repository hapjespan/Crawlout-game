// Rivers and ponds from the water mask (waterMask.ts) in one draw call: a surface on the water level over the water
// cells and the land ring around them (so the shoreline is where the terrain rises through it), with a toon water
// material. No PBR, no screen-space tricks:
//   color   murky teal in deep water, a lighter muddy green in the shallows and over fords;
//   ripples four small directional waves (analytic slope) moved along the flow with two phases half a cycle apart
//           (flow mapping), so the river visibly runs downstream without stretching;
//   light   two toon bands from the ripple normal, hard-edged sun glints, a little sky at grazing angles;
//   foam    a broken band where the water gets shallow at the shore, and white streaks over the fords;
//   alpha   the bed shows through near the shore, deep water is nearly opaque.
// Per vertex: position on the level, attribute wInfo = (depth in meters, ford share 0..1, flow x, flow z in m/s).
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  type Scene,
  type Vector3,
  type Node,
} from 'three/webgpu';
import {
  abs,
  attribute,
  cameraPosition,
  cos,
  dot,
  float,
  fract,
  length,
  max,
  mix,
  normalize,
  positionWorld,
  pow,
  reflect,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { CORNER_CELLS, WATER_CELL, type WaterSurface } from './waterMask.js';

export interface WaterLayerOptions {
  lightDir: Vector3;
  /** Seconds, advanced by the renderer. */
  time: Node<'float'>;
  /** Shadow factor node, 1 lit and 0 shadowed (shadows/sunShadow.ts). */
  shadow?: Node<'float'> | undefined;
}

/** Flow-map cycle, seconds: each ripple layer slides for one cycle, then fades out while the other takes over. */
const CYCLE = 2.2;
/** Linear colors. */
const DEEP = [0.035, 0.085, 0.085] as const;
const SHALLOW = [0.2, 0.25, 0.17] as const;
const SKY = [0.45, 0.53, 0.55] as const;
const FOAM = [0.78, 0.8, 0.74] as const;
/** Ripples: direction (normalized below), spatial frequency rad/m, slope amplitude, angular speed rad/s. */
const WAVES: readonly (readonly [number, number, number, number, number])[] = [
  [1, 0.3, 1.25, 0.16, 1.1],
  [-0.4, 1, 1.9, 0.12, 1.6],
  [0.7, -0.8, 2.9, 0.09, 2.3],
  [-0.9, -0.2, 4.1, 0.06, 3.1],
];

export interface WaterGeometryInfo {
  geometry: BufferGeometry;
  quads: number;
}

/**
 * The water surface mesh: one quad per cell that has a level (water and its land ring), vertices shared on the cell
 * corners at the mean level of their cells. `groundAt` is the drawn terrain (bed included), for the depth.
 */
export function buildWaterGeometry(
  surface: WaterSurface,
  groundAt: (x: number, z: number) => number,
): WaterGeometryInfo | null {
  const { w, h, level, mask, flow, placement } = surface;
  const cw = w + 1;
  const vertexOf = new Int32Array(cw * (h + 1)).fill(-1);
  const has = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && !Number.isNaN(level[y * w + x]!);
  let quads = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (has(x, y)) quads++;
  if (quads === 0) return null;
  // Corners in use.
  let count = 0;
  for (let y = 0; y <= h; y++)
    for (let x = 0; x <= w; x++)
      if (has(x - 1, y - 1) || has(x, y - 1) || has(x - 1, y) || has(x, y))
        vertexOf[y * cw + x] = count++;
  const positions = new Float32Array(count * 3);
  const info = new Float32Array(count * 4);
  for (let y = 0; y <= h; y++)
    for (let x = 0; x <= w; x++) {
      const v = vertexOf[y * cw + x]!;
      if (v < 0) continue;
      let lv = 0;
      let k = 0;
      let ford = 0;
      let wet = 0;
      let fx = 0;
      let fz = 0;
      for (const [dx, dy] of CORNER_CELLS) {
        if (!has(x + dx, y + dy)) continue;
        const i = (y + dy) * w + x + dx;
        lv += level[i]!;
        fx += flow[i * 2]!;
        fz += flow[i * 2 + 1]!;
        k++;
        if (mask[i] !== WATER_CELL.land) wet++;
        if (mask[i] === WATER_CELL.shallow) ford++;
      }
      const px = placement.minX + x * placement.cell;
      const pz = placement.minZ + y * placement.cell;
      const py = lv / k;
      positions.set([px, py, pz], v * 3);
      info[v * 4] = Math.max(0, py - groundAt(px, pz));
      info[v * 4 + 1] = wet > 0 ? ford / wet : 0;
      info[v * 4 + 2] = fx / k;
      info[v * 4 + 3] = fz / k;
    }
  const indices = count < 65536 ? new Uint16Array(quads * 6) : new Uint32Array(quads * 6);
  let q = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!has(x, y)) continue;
      const a = vertexOf[y * cw + x]!;
      const b = vertexOf[y * cw + x + 1]!;
      const c = vertexOf[(y + 1) * cw + x]!;
      const d = vertexOf[(y + 1) * cw + x + 1]!;
      indices.set([a, c, b, b, c, d], q); // counter-clockwise seen from above
      q += 6;
    }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('wInfo', new BufferAttribute(info, 4));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return { geometry, quads };
}

export function createWaterMaterial(opts: WaterLayerOptions): MeshBasicNodeMaterial {
  const info = attribute('wInfo', 'vec4');
  const depth = info.x;
  const ford = info.y;
  const flowV = info.zw;
  const t = opts.time;
  const light = uniform(opts.lightDir.clone().normalize());
  const p = positionWorld.xz;

  // Slope (d height / dx, d height / dz) of the ripple pattern at q, plus the pattern itself for foam break-up.
  const ripples = (
    q: Node<'vec2'>,
    seed: number,
  ): { slope: Node<'vec2'>; height: Node<'float'> } => {
    let slope: Node<'vec2'> = vec2(0, 0);
    let height: Node<'float'> = float(0);
    for (const [dx, dz, k, a, speed] of WAVES) {
      const len = Math.hypot(dx, dz);
      const d = vec2(dx / len, dz / len);
      const phase = dot(q, d).mul(k).add(t.mul(speed)).add(seed);
      slope = slope.add(d.mul(cos(phase).mul(a)));
      height = height.add(sin(phase).mul(a / k));
    }
    return { slope, height };
  };
  const cycle = t.div(CYCLE);
  const ph0 = fract(cycle);
  const ph1 = fract(cycle.add(0.5));
  const w0 = float(1).sub(abs(ph0.mul(2).sub(1)));
  const r0 = ripples(p.sub(flowV.mul(ph0.mul(CYCLE))), 0);
  const r1 = ripples(p.sub(flowV.mul(ph1.mul(CYCLE))).add(vec2(3.7, 1.3)), 1.9);
  const slope = mix(r1.slope, r0.slope, w0);
  const rippleH = mix(r1.height, r0.height, w0);
  // Calmer right at the shore, livelier over fords, and flatter far away (no glitter where a ripple is a pixel).
  const toEye = cameraPosition.sub(positionWorld);
  const far = smoothstep(70, 260, length(toEye));
  const strength = smoothstep(0.0, 0.25, depth)
    .mul(0.7)
    .add(0.3)
    .mul(ford.mul(0.6).add(1))
    .mul(float(1).sub(far.mul(0.75)));
  const N = normalize(vec3(slope.x.mul(strength).negate(), 1, slope.y.mul(strength).negate()));

  const V = normalize(toEye);
  const hl = dot(N, light).mul(0.5).add(0.5);
  let shade: Node<'float'> = float(0.8).add(smoothstep(0.6, 0.64, hl).mul(0.2));
  if (opts.shadow) shade = shade.mul(mix(float(0.62), float(1), opts.shadow));
  const R = reflect(light.negate(), N);
  // Small hard sun glints, fading out with distance.
  const glint = smoothstep(0.993, 0.997, dot(R, V))
    .mul(0.5)
    .mul(float(1).sub(smoothstep(40, 110, length(toEye))));
  const fresnel = pow(float(1).sub(max(dot(N, V), 0)), 4).mul(0.45);

  const deepness = smoothstep(0.06, 0.95, depth);
  let base: Node<'vec3'> = mix(vec3(...SHALLOW), vec3(...DEEP), deepness);
  base = mix(base, vec3(...SHALLOW).mul(1.3), ford.mul(0.55));
  base = mix(base.mul(shade), vec3(...SKY), fresnel);
  // Foam: a broken band at the shoreline and streaks over the fords, both moving with the ripples.
  const breakup = smoothstep(-0.02, 0.05, rippleH);
  const shoreFoam = smoothstep(0.16, 0.03, depth).mul(breakup.mul(0.7).add(0.3));
  const fordFoam = ford.mul(smoothstep(0.125, 0.15, rippleH)).mul(0.55);
  const foam = max(shoreFoam, fordFoam).mul(smoothstep(0.0, 0.02, depth));
  const color = mix(base.add(vec3(glint, glint, glint.mul(0.95))), vec3(...FOAM), foam);
  const alpha = max(mix(float(0.5), float(0.92), smoothstep(0.0, 0.75, depth)), foam);

  const m = new MeshBasicNodeMaterial();
  m.transparent = true;
  m.depthWrite = false;
  const out = vec4(color, alpha);
  if (opts.shadow) m.fragmentNode = out;
  else m.colorNode = out;
  m.name = 'crawlout-water-toon';
  return m;
}

export class WaterLayer {
  private mesh: Mesh | null = null;
  private readonly material: MeshBasicNodeMaterial;

  constructor(
    private readonly scene: Scene,
    opts: WaterLayerOptions,
  ) {
    this.material = createWaterMaterial(opts);
  }

  /** Replaces the water surface; null removes it. */
  set(surface: WaterSurface | null, groundAt: (x: number, z: number) => number): void {
    this.clear();
    if (!surface) return;
    const built = buildWaterGeometry(surface, groundAt);
    if (!built) return;
    this.mesh = new Mesh(built.geometry, this.material);
    this.mesh.name = 'water';
    this.mesh.raycast = () => {}; // picking goes to the ground under the water
    this.mesh.renderOrder = 1; // after the other transparent ground layers (decals)
    this.scene.add(this.mesh);
  }

  get object(): Mesh | null {
    return this.mesh;
  }

  get triangles(): number {
    return (this.mesh?.geometry.index?.count ?? 0) / 3;
  }

  clear(): void {
    if (!this.mesh) return;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh = null;
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
  }
}

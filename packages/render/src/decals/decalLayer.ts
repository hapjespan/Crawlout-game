// Ground decals in one instanced draw call: blob shadows under units and scrap heaps, selection rings, claim rings
// in the owner's color, ability zones and the placement preview. The quad is a small grid that follows the terrain in the vertex
// shader (terrain height texture), so large decals hug slopes.
import { MAX_PLAYERS } from '@crawlout/protocol';
import {
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Vector3,
  type Scene,
} from 'three/webgpu';
import {
  abs,
  attribute,
  float,
  fract,
  int,
  length,
  max,
  min,
  mix,
  select,
  smoothstep,
  uniformArray,
  vec2,
  vec3,
  vec4,
  vertexStage,
} from 'three/tsl';
import { teamPalette } from '../palette.js';
import { terrainHeightNode, type HeightTexture } from '../terrain/heightTexture.js';

/** Decal color slots after the team palette (team slots 0..MAX_PLAYERS-1, neutral MAX_PLAYERS). */
export const DECAL_COLOR = {
  selection: MAX_PLAYERS + 1,
  valid: MAX_PLAYERS + 2,
  invalid: MAX_PLAYERS + 3,
} as const;

export const DECAL_SHAPE = { circle: 0, rect: 1 } as const;

export interface DecalStyle {
  shape: number;
  /** Dark blob in the middle, 0..1 (blob shadow). */
  shadow: number;
  /** Colored ring at the edge, 0..1. */
  ring: number;
  /** Ring width in meters. */
  ringWidth: number;
  /** Colored fill inside, 0..1. */
  fill: number;
  /** 1 m cell grid lines inside, 0..1 (placement preview). */
  grid: number;
  /** Palette slot: teamIndex(owner) or a DECAL_COLOR. */
  color: number;
  /** 0..1: the fill fades towards the center of a circle (ability zones), 0 keeps it flat. Default 0. */
  fillEdge?: number;
}

const LIFT = 0.05; // meters above the terrain

function decalPalette(): Vector3[] {
  const c = new Color();
  const extra = [0x73ff73, 0x4fe36a, 0xff3b30].map((hex) => {
    c.setHex(hex);
    return new Vector3(c.r, c.g, c.b);
  });
  return [...teamPalette(), ...extra];
}

function dynamic(capacity: number): InstancedBufferAttribute {
  const a = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  a.setUsage(DynamicDrawUsage);
  return a;
}

function createDecalMaterial(heights: HeightTexture | null): MeshBasicNodeMaterial {
  const iA = attribute('iDecalA', 'vec4'); // center x, center z, half x, half z (meters)
  const iB = attribute('iDecalB', 'vec4'); // shadow, ring, ring width (m), fill
  const iC = attribute('iDecalC', 'vec4'); // grid, color slot, shape, fill edge
  const local = attribute('position', 'vec3').xz; // -1..1 over the quad (not positionLocal: positionNode overwrites it)
  const world = vec2(iA.x, iA.y).add(local.mul(iA.zw));
  const ground = heights ? terrainHeightNode(heights, world) : float(0);

  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  m.positionNode = vec3(world.x, ground.add(LIFT), world.y);

  // Fragment, in meters from the decal center.
  const p = vertexStage(local.mul(iA.zw));
  const half = vertexStage(iA.zw);
  const rect = vertexStage(iC.z).greaterThan(0.5);
  const radial = length(p).div(half.x); // 0 at the center, 1 at the edge (circles)
  const edgeCircle = half.x.sub(length(p));
  const edgeRect = min(half.x.sub(abs(p.x)), half.y.sub(abs(p.y)));
  const edge = select(rect, edgeRect, edgeCircle); // meters inside the edge, negative outside
  const inside = smoothstep(-0.02, 0.02, edge);
  const width = vertexStage(iB.z);
  const ring = smoothstep(-0.02, 0.03, edge)
    .mul(float(1).sub(smoothstep(width.sub(0.03), width.add(0.02), edge)))
    .mul(vertexStage(iB.y));
  const shadow = float(1)
    .sub(smoothstep(0.2, 0.65, radial))
    .mul(vertexStage(iB.x))
    .mul(0.42);
  // Soft fill: with fill edge 1 it is 30 % at the center and full at the rim of a circle.
  const edgeWeight = mix(float(1), radial.mul(radial).mul(0.7).add(0.3), vertexStage(iC.w));
  const fill = inside.mul(vertexStage(iB.w)).mul(min(edgeWeight, 1));
  const cell = abs(fract(p.add(half)).sub(0.5)); // 0.5 on a cell line
  const gridLine = smoothstep(0.44, 0.48, max(cell.x, cell.y)).mul(inside).mul(vertexStage(iC.x));
  const colored = max(max(ring, fill), gridLine);
  const alpha = max(shadow, colored);
  const palette = uniformArray<'vec3'>(decalPalette(), 'vec3');
  const tint = palette.element(int(vertexStage(iC.y)));
  m.colorNode = vec4(mix(vec3(0, 0, 0), tint, colored.div(max(alpha, 0.001))), alpha);
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.name = 'crawlout-ground-decal';
  return m;
}

export class DecalLayer {
  private readonly mesh: Mesh;
  private readonly a: InstancedBufferAttribute;
  private readonly b: InstancedBufferAttribute;
  private readonly c: InstancedBufferAttribute;
  private material: MeshBasicNodeMaterial;
  private n = 0;
  readonly capacity: number;

  constructor(scene: Scene, capacity: number) {
    this.capacity = capacity;
    const geo = new PlaneGeometry(2, 2, 6, 6).rotateX(-Math.PI / 2);
    geo.deleteAttribute('normal');
    geo.deleteAttribute('uv');
    this.a = dynamic(capacity);
    this.b = dynamic(capacity);
    this.c = dynamic(capacity);
    geo.setAttribute('iDecalA', this.a);
    geo.setAttribute('iDecalB', this.b);
    geo.setAttribute('iDecalC', this.c);
    this.material = createDecalMaterial(null);
    this.mesh = new Mesh(geo, this.material);
    this.mesh.name = 'ground-decals';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.count = 0;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** New terrain: the material bakes the height texture in. */
  setHeights(heights: HeightTexture | null): void {
    const old = this.material;
    this.material = createDecalMaterial(heights);
    this.mesh.material = this.material;
    old.dispose();
  }

  begin(): void {
    this.n = 0;
  }

  /** Adds one decal. x, z, halfX, halfZ in meters. Silently drops decals beyond capacity. */
  push(x: number, z: number, halfX: number, halfZ: number, s: DecalStyle): void {
    const k = this.n;
    if (k >= this.capacity) return;
    this.n = k + 1;
    const o = k * 4;
    const a = this.a.array as Float32Array;
    const b = this.b.array as Float32Array;
    const c = this.c.array as Float32Array;
    a[o] = x;
    a[o + 1] = z;
    a[o + 2] = halfX;
    a[o + 3] = halfZ;
    b[o] = s.shadow;
    b[o + 1] = s.ring;
    b[o + 2] = s.ringWidth;
    b[o + 3] = s.fill;
    c[o] = s.grid;
    c[o + 1] = s.color;
    c[o + 2] = s.shape;
    c[o + 3] = s.fillEdge ?? 0;
  }

  end(): void {
    const n = this.n;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n === 0) return;
    for (const attr of [this.a, this.b, this.c]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * 4);
      attr.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

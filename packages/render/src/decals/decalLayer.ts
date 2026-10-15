// Ground decals in one instanced draw call: blob shadows under units and scrap heaps, selection rings, claim rings
// in the owner's color, ability zones, the placement preview and the contact decals of buildings and large props
// (decals/contact.ts: a dark soft edge hugging the footprint plus a dusty, trodden ring, so they sit in the ground). The quad is a small grid that follows the terrain in the vertex
// shader (terrain height texture), so large decals hug slopes.
import { MAX_PLAYERS } from '@crawlout/protocol';
import {
  ClampToEdgeWrapping,
  Color,
  DataArrayTexture,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  RedFormat,
  UnsignedByteType,
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
  sin,
  smoothstep,
  texture,
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
  /** Trodden, dusty earth around a footprint (contact decals). */
  dirt: MAX_PLAYERS + 4,
} as const;

/** contact: the object's footprint (rounded box, half sizes = quad half sizes minus the margin in ringWidth) with a soft dark edge (shadow) and a dusty ring (fill) around it. */
export const DECAL_SHAPE = { circle: 0, rect: 1, contact: 2 } as const;

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
/** Contact distance fields (contactMask.ts): texels per side and how many fit (one layer per building type). */
export const CONTACT_MASK_SIZE = 128;
export const CONTACT_MASK_LAYERS = 16;
/** Colour of the trodden dust ring around a footprint (sRGB): warm and a little darker than the ground. */
const DIRT_COLOR = 0x5b4a37;
/** Where the dark contact edge ends, as a share of the margin; the dust ring runs over the whole margin. */
const CONTACT_AO_SHARE = 0.4;
/** Wobble of the contact edge (share of the distance from the footprint, zero at the wall), so the ring is not a clean offset. */
const CONTACT_WOBBLE = 0.45;

function decalPalette(): Vector3[] {
  const c = new Color();
  const extra = [0x73ff73, 0x4fe36a, 0xff3b30, DIRT_COLOR].map((hex) => {
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

function createDecalMaterial(
  heights: HeightTexture | null,
  contactMasks: DataArrayTexture,
): MeshBasicNodeMaterial {
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
  const shapeId = vertexStage(iC.z);
  const rect = shapeId.greaterThan(0.5).and(shapeId.lessThan(1.5));
  const contact = shapeId.greaterThan(1.5);
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
  const palette = uniformArray<'vec3'>(decalPalette(), 'vec3');
  const tint = palette.element(int(vertexStage(iC.y)));
  // Contact: distance from the footprint (rounded box) or, with a mask layer (iC.w - 1), from the mesh's own ground
  // contact (contactMask.ts: a distance field over the decal quad, bytes over 0..margin), wobbled by a cheap noise.
  const margin = max(vertexStage(iB.z), 0.01);
  const inner = max(half.sub(margin), vec2(0, 0));
  const boxDistance = length(max(abs(p).sub(inner), vec2(0, 0)));
  const maskSlot = vertexStage(iC.w);
  const maskDistance = texture(contactMasks, p.div(half.mul(2)).add(0.5))
    .depth(int(max(maskSlot.sub(1), 0).add(0.5)))
    .x.mul(margin);
  const outside = select(maskSlot.greaterThan(0.5), maskDistance, boxDistance);
  const seed = vertexStage(iA.x.mul(0.37).add(iA.y.mul(0.61)));
  const wobble = sin(p.x.mul(1.9).add(seed))
    .mul(sin(p.y.mul(2.3).sub(seed)))
    .mul(0.6)
    .add(sin(p.x.mul(4.3).add(p.y.mul(3.1)).add(seed.mul(2))).mul(0.4));
  const reach = outside.mul(wobble.mul(CONTACT_WOBBLE).add(1));
  const dust = float(1)
    .sub(smoothstep(margin.mul(0.12), margin, reach))
    .mul(vertexStage(iB.w));
  const edgeAo = float(1).sub(smoothstep(0, margin.mul(CONTACT_AO_SHARE), reach));
  const occlusion = edgeAo.mul(edgeAo).mul(vertexStage(iB.x));
  const contactAlpha = float(1).sub(float(1).sub(dust).mul(float(1).sub(occlusion)));
  const contactColored = dust.mul(float(1).sub(occlusion)); // dust shows where the dark edge does not cover it
  const alpha = select(contact, contactAlpha, max(shadow, colored));
  const coloredOut = select(contact, contactColored, colored);
  m.colorNode = vec4(mix(vec3(0, 0, 0), tint, coloredOut.div(max(alpha, 0.001))), alpha);
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
  private readonly contactMasks: DataArrayTexture;
  private contactUsed = 0;
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
    const masks = new DataArrayTexture(
      new Uint8Array(CONTACT_MASK_SIZE * CONTACT_MASK_SIZE * CONTACT_MASK_LAYERS).fill(255),
      CONTACT_MASK_SIZE,
      CONTACT_MASK_SIZE,
      CONTACT_MASK_LAYERS,
    );
    masks.format = RedFormat;
    masks.type = UnsignedByteType;
    masks.magFilter = masks.minFilter = LinearFilter;
    masks.wrapS = masks.wrapT = ClampToEdgeWrapping;
    masks.generateMipmaps = false;
    masks.flipY = false;
    masks.name = 'crawlout-contact-masks';
    masks.needsUpdate = true;
    this.contactMasks = masks;
    this.material = createDecalMaterial(null, masks);
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
    this.material = createDecalMaterial(heights, this.contactMasks);
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

  /**
   * A contact decal around an object: `halfX`/`halfZ` are the object's footprint (meters, centered on x, z); the decal
   * reaches `margin` beyond it. `style` supplies shadow (dark edge) and fill (dust ring) strengths, see decals/contact.ts.
   * With a `maskLayer` (addContactMask) the edge follows the mesh's own ground contact instead of the footprint box.
   */
  pushContact(
    x: number,
    z: number,
    halfX: number,
    halfZ: number,
    margin: number,
    style: DecalStyle,
    maskLayer = -1,
  ): void {
    this.push(x, z, halfX + margin, halfZ + margin, {
      ...style,
      ringWidth: margin,
      fillEdge: maskLayer + 1,
    });
  }

  /**
   * Stores a contact distance field (contactMask.ts, CONTACT_MASK_SIZE squared bytes) and returns its layer for
   * pushContact, or -1 when all layers are taken.
   */
  addContactMask(bytes: Uint8Array): number {
    const layerBytes = CONTACT_MASK_SIZE * CONTACT_MASK_SIZE;
    if (bytes.length !== layerBytes || this.contactUsed >= CONTACT_MASK_LAYERS) return -1;
    const layer = this.contactUsed++;
    (this.contactMasks.image.data as Uint8Array).set(bytes, layer * layerBytes);
    this.contactMasks.needsUpdate = true;
    return layer;
  }

  /** Forgets all contact masks (new assets): the layers are reused. */
  clearContactMasks(): void {
    this.contactUsed = 0;
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
    this.contactMasks.dispose();
  }
}

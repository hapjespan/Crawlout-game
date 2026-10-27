// Occlusion fade: a tree, a tall shrub or a tall prop that stands between the camera and a unit (own or enemy) or a
// claim flag turns to a screen-space dither, so the unit stays in view. Works the same on WebGPU and WebGL2: no extra
// pass, no transparency sorting, one texture sample per vertex.
//
// The CPU stamps, per frame, the ground in front of every focus (towards the camera) into a small field over the map
// (FIELD_TEXELS square, two channels): channel 0 where a tall occluder (a tree, about TALL_M high) would hide the
// focus, channel 1 where a low one would (a tall shrub, LOW_M). How far that reaches follows the camera's pitch: the
// line of sight from the focus rises with it, so a steep camera fades less. Each texel eases towards its stamp (in
// over FADE_IN_S, out over FADE_OUT_S), so nothing pops. An occluder's material samples the field at its instance
// origin in the vertex stage (occlusionFade) and discards that share of its pixels in a fixed screen-space pattern
// (occlusionDiscard), up to MAX_FADE: the tree stays as a lacy ghost and still casts its shadow (the shadow pass does
// not run the fragment node). Cost: about 50 texels per focus per channel, so 200 units are a few thousand writes.
// The frame is the viewer's (fog of war filtered by the sim's view): an enemy in the fog fades nothing.
import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  RGFormat,
  UnsignedByteType,
  Vector4,
  type Vector3,
} from 'three/webgpu';
import {
  Discard,
  float,
  fract,
  screenCoordinate,
  texture,
  uniform,
  vec2,
  vertexStage,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { ENTITY_FLAG } from '@crawlout/protocol';
import { classifyTypeId, ENTITY_KIND } from '../entities/typeIds.js';
import type { InterpolatedFrame } from '../snapshot/interpolate.js';

/** Field edge in texels (1.5 m on a 384 m map). */
export const FIELD_TEXELS = 256;
/** Height (m) of the occluders per channel: a tree crown's mass, a tall shrub. */
export const TALL_M = 10;
export const LOW_M = 2.2;
/** Half-width (m) of the faded strip per channel: a crown's radius, a shrub's. */
const HALF_WIDTH = [3.2, 1.4] as const;
/** How far behind the focus (m) an occluder still counts: a crown overhangs its trunk. */
const BEHIND = [2, 0.8] as const;
/** Where the line of sight starts above the ground (m): a unit's chest, a claim flag's cloth. */
const LIFT_UNIT = 1.1;
const LIFT_CLAIM = 2;
/** A claim flag fades a wider strip (its ring and pole read as one). */
const CLAIM_WIDEN_M = 1.5;
/** Longest reach (m) in front of a focus: a near-horizontal camera never fades half the forest. */
const MAX_REACH_M = 16;
export const FADE_IN_S = 0.2;
export const FADE_OUT_S = 0.45;
/** Most of an occluder's pixels the dither takes away. */
export const MAX_FADE = 0.65;

export type OcclusionChannel = 0 | 1;
/** Fade of an occluder (0..1) from its world origin xz, for a material. */
export type OcclusionSampler = (origin: Node<'vec2'>) => Node<'float'>;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface FieldRect {
  minX: number;
  minZ: number;
  sizeX: number;
  sizeZ: number;
}

/**
 * Stamps one focus into `target` (2 floats per texel, n texels square over `rect`): max of what is there and the
 * strip in front of it. Returns the touched texel box [i0, j0, i1, j1] (inclusive), or null when nothing was touched.
 */
export function stampFocus(
  target: Float32Array,
  n: number,
  rect: FieldRect,
  focus: { x: number; y: number; z: number; lift: number; widen: number },
  cam: { x: number; y: number; z: number },
): [number, number, number, number] | null {
  let hx = cam.x - focus.x;
  let hz = cam.z - focus.z;
  const hd = Math.hypot(hx, hz);
  if (hd < 1e-3) return null; // straight above: nothing stands in between
  hx /= hd;
  hz /= hd;
  const rise = Math.max(0.2, (cam.y - focus.y - focus.lift) / hd);
  const cx = rect.sizeX / n;
  const cz = rect.sizeZ / n;
  let box: [number, number, number, number] | null = null;
  for (let ch = 0; ch < 2; ch++) {
    const reach = Math.min(
      MAX_REACH_M,
      Math.max(0, ((ch === 0 ? TALL_M : LOW_M) - focus.lift) / rise),
    );
    const back = BEHIND[ch]!;
    const half = HALF_WIDTH[ch]! + focus.widen;
    const ext = half + 1.5;
    const x0 = Math.min(focus.x - hx * back, focus.x + hx * (reach + 1.5)) - ext;
    const x1 = Math.max(focus.x - hx * back, focus.x + hx * (reach + 1.5)) + ext;
    const z0 = Math.min(focus.z - hz * back, focus.z + hz * (reach + 1.5)) - ext;
    const z1 = Math.max(focus.z - hz * back, focus.z + hz * (reach + 1.5)) + ext;
    const i0 = Math.max(0, Math.floor((x0 - rect.minX) / cx));
    const i1 = Math.min(n - 1, Math.floor((x1 - rect.minX) / cx));
    const j0 = Math.max(0, Math.floor((z0 - rect.minZ) / cz));
    const j1 = Math.min(n - 1, Math.floor((z1 - rect.minZ) / cz));
    if (i0 > i1 || j0 > j1) continue;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const px = rect.minX + (i + 0.5) * cx - focus.x;
        const pz = rect.minZ + (j + 0.5) * cz - focus.z;
        const t = px * hx + pz * hz;
        const lat = Math.abs(px * hz - pz * hx);
        const v =
          smooth(-back - 1, -back, t) *
          (1 - smooth(reach, reach + 1.5, t)) *
          (1 - smooth(half * 0.6, half, lat));
        const o = (j * n + i) * 2 + ch;
        if (v > target[o]!) target[o] = v;
      }
    box = box
      ? [Math.min(box[0], i0), Math.min(box[1], j0), Math.max(box[2], i1), Math.max(box[3], j1)]
      : [i0, j0, i1, j1];
  }
  return box;
}

export class OcclusionField {
  readonly texture: DataTexture;
  /** minX, minZ, 1 / sizeX, 1 / sizeZ of the field (m). */
  private readonly rectUniform = uniform(new Vector4(0, 0, 1 / 384, 1 / 384));
  private rect: FieldRect = { minX: 0, minZ: 0, sizeX: 384, sizeZ: 384 };
  private readonly value = new Float32Array(FIELD_TEXELS * FIELD_TEXELS * 2);
  private readonly target = new Float32Array(FIELD_TEXELS * FIELD_TEXELS * 2);
  private readonly bytes: Uint8Array;
  /** Texel box that still holds a fade (i0, j0, i1, j1), or null. */
  private active: [number, number, number, number] | null = null;
  private readonly focus = { x: 0, y: 0, z: 0, lift: 0, widen: 0 };

  constructor() {
    this.bytes = new Uint8Array(FIELD_TEXELS * FIELD_TEXELS * 2);
    this.texture = new DataTexture(
      this.bytes,
      FIELD_TEXELS,
      FIELD_TEXELS,
      RGFormat,
      UnsignedByteType,
    );
    this.texture.magFilter = this.texture.minFilter = LinearFilter;
    this.texture.wrapS = this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
  }

  /** The map's extent (m); the field lies over it. */
  setBounds(b: { minX: number; maxX: number; minZ: number; maxZ: number } | null): void {
    if (!b) return;
    this.rect = { minX: b.minX, minZ: b.minZ, sizeX: b.maxX - b.minX, sizeZ: b.maxZ - b.minZ };
    this.rectUniform.value.set(b.minX, b.minZ, 1 / this.rect.sizeX, 1 / this.rect.sizeZ);
    this.value.fill(0);
    this.bytes.fill(0);
    this.active = null;
    this.texture.needsUpdate = true;
  }

  /** Stamps the frame's units and claim flags and eases the field towards it. Call once per frame. */
  update(frame: InterpolatedFrame, cam: Vector3, dt: number): void {
    const n = FIELD_TEXELS;
    let box = this.active;
    const f = this.focus;
    for (let i = 0; i < frame.count; i++) {
      if ((frame.flags[i]! & ENTITY_FLAG.dead) !== 0) continue;
      const kind = classifyTypeId(frame.typeId[i]!);
      const claim = kind === ENTITY_KIND.claim;
      if (!claim && kind !== ENTITY_KIND.unit && kind !== ENTITY_KIND.unknown) continue;
      f.x = frame.x[i]!;
      f.y = frame.y[i]!;
      f.z = frame.z[i]!;
      f.lift = claim ? LIFT_CLAIM : LIFT_UNIT;
      f.widen = claim ? CLAIM_WIDEN_M : 0;
      const b = stampFocus(this.target, n, this.rect, f, cam);
      if (b)
        box = box
          ? [
              Math.min(box[0], b[0]),
              Math.min(box[1], b[1]),
              Math.max(box[2], b[2]),
              Math.max(box[3], b[3]),
            ]
          : b;
    }
    if (!box) return;
    const up = dt / FADE_IN_S;
    const down = dt / FADE_OUT_S;
    let next: [number, number, number, number] | null = null;
    let changed = false;
    for (let j = box[1]; j <= box[3]; j++)
      for (let i = box[0]; i <= box[2]; i++) {
        let live = false;
        for (let ch = 0; ch < 2; ch++) {
          const o = (j * n + i) * 2 + ch;
          const t = this.target[o]!;
          const v = this.value[o]!;
          const e = t > v ? Math.min(t, v + up) : Math.max(t, v - down);
          this.target[o] = 0;
          if (e !== v) {
            this.value[o] = e;
            const byte = Math.round(e * 255);
            if (byte !== this.bytes[o]) {
              this.bytes[o] = byte;
              changed = true;
            }
          }
          if (e > 0) live = true;
        }
        if (live)
          next = next
            ? [
                Math.min(next[0], i),
                Math.min(next[1], j),
                Math.max(next[2], i),
                Math.max(next[3], j),
              ]
            : [i, j, i, j];
      }
    this.active = next;
    if (changed) this.texture.needsUpdate = true;
  }

  /** A material's fade from the field's channel at an origin (world xz), sampled in the vertex stage. */
  sampler(channel: OcclusionChannel): OcclusionSampler {
    return (origin) => {
      const r = this.rectUniform;
      const uv = vec2(origin.x.sub(r.x).mul(r.z), origin.y.sub(r.y).mul(r.w));
      const s = texture(this.texture, uv).level(float(0));
      return vertexStage(channel === 0 ? s.x : s.y);
    };
  }

  dispose(): void {
    this.texture.dispose();
  }
}

/**
 * Discards a `fade` share (up to MAX_FADE) of a fragment's pixels in interleaved gradient noise over the screen: a
 * fine, even dither. Call inside an Fn of the fragment node.
 */
export function occlusionDiscard(fade: Node<'float'>): void {
  const p = screenCoordinate.xy;
  const noise = fract(
    float(52.9829189).mul(fract(p.x.mul(float(0.06711056)).add(p.y.mul(float(0.00583715))))),
  );
  Discard(noise.lessThan(fade.mul(MAX_FADE)));
}

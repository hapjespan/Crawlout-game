// GPU particles as instanced camera-facing quads: one draw call per pool (additive and alpha-blended).
// The CPU only writes a particle once, when it spawns (ring buffer); the vertex shader moves, grows and fades it
// from its spawn state and the current time. Expired particles collapse to zero size.
//
// Per instance: pA (x0, y0, z0 meters, t0 seconds), pB (velocity m/s, life s), pC (size at birth, size at death,
// gravity m/s², shape 0 = soft disc | 1 = streak along the velocity), pD (linear rgb, alpha).
import {
  AdditiveBlending,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
  NormalBlending,
  PlaneGeometry,
  type Scene,
  type Node,
} from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  clamp,
  cross,
  float,
  length,
  max,
  mix,
  normalize,
  select,
  vec3,
  vec4,
  vertexStage,
} from 'three/tsl';

export const PARTICLE_SHAPE = { disc: 0, streak: 1 } as const;

/** One particle at spawn. Reuse a scratch object; the pool copies the fields. */
export interface ParticleSpec {
  x: number;
  y: number;
  z: number;
  /** Spawn time, seconds on the renderer clock; may lie in the future (delayed effects). */
  t0: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size0: number;
  size1: number;
  gravity: number;
  shape: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

export function createParticleSpec(): ParticleSpec {
  return {
    x: 0,
    y: 0,
    z: 0,
    t0: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 1,
    size0: 1,
    size1: 1,
    gravity: 0,
    shape: 0,
    r: 1,
    g: 1,
    b: 1,
    a: 1,
  };
}

export interface ParticleSink {
  emit(p: ParticleSpec): void;
}

function createParticleMaterial(time: Node<'float'>, additive: boolean): MeshBasicNodeMaterial {
  const pA = attribute('pA', 'vec4');
  const pB = attribute('pB', 'vec4');
  const pC = attribute('pC', 'vec4');
  const pD = attribute('pD', 'vec4');
  const age = time.sub(pA.w);
  const life = max(pB.w, 0.001);
  const t = clamp(age.div(life), 0, 1);
  const alive = age.greaterThanEqual(0).and(age.lessThan(life));
  const center = pA.xyz.add(pB.xyz.mul(age)).sub(vec3(0, pC.z.mul(0.5).mul(age).mul(age), 0));
  const size = select(alive, mix(pC.x, pC.y, t), float(0));
  const corner = attribute('position', 'vec3').xy; // -0.5..0.5 (not positionLocal: positionNode overwrites it)

  const view = normalize(center.sub(cameraPosition));
  const right = normalize(cross(view, vec3(0, 1, 0)));
  const up = cross(right, view);
  // Streaks stretch along the current velocity, seen from the camera.
  const vel = pB.xyz.sub(vec3(0, pC.z.mul(age), 0));
  const along = normalize(vel.add(vec3(0, 0.0001, 0)));
  const side = normalize(cross(along, view));
  const streak = pC.w.greaterThan(0.5);
  const disc = center.add(right.mul(corner.x.mul(size))).add(up.mul(corner.y.mul(size)));
  const stretched = center
    .add(side.mul(corner.x.mul(size)))
    .add(along.mul(corner.y.mul(size).mul(6)));

  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  m.positionNode = select(streak, stretched, disc);
  const r = length(vertexStage(corner).mul(2));
  const edge = clamp(float(1).sub(r), 0, 1);
  const soft = edge.mul(edge); // quadratic falloff: puffs blend instead of reading as discs
  const vt = vertexStage(t);
  const fade = float(1).sub(vt.mul(vt));
  const alpha = soft.mul(fade).mul(vertexStage(pD.w));
  m.colorNode = vec4(vertexStage(pD.xyz), alpha);
  m.blending = additive ? AdditiveBlending : NormalBlending;
  m.name = additive ? 'crawlout-vfx-additive' : 'crawlout-vfx-alpha';
  return m;
}

export class ParticlePool implements ParticleSink {
  readonly mesh: Mesh;
  readonly capacity: number;
  private readonly attrs: InstancedBufferAttribute[];
  private readonly arrays: [Float32Array, Float32Array, Float32Array, Float32Array];
  private next = 0;
  private used = 0;
  private dirtyFrom = Infinity;
  private dirtyTo = -1;
  private readonly material: MeshBasicNodeMaterial;

  constructor(scene: Scene, capacity: number, time: Node<'float'>, additive: boolean) {
    this.capacity = capacity;
    const geo = new PlaneGeometry(1, 1);
    geo.deleteAttribute('normal');
    geo.deleteAttribute('uv');
    this.attrs = ['pA', 'pB', 'pC', 'pD'].map((name) => {
      const a = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
      a.setUsage(DynamicDrawUsage);
      geo.setAttribute(name, a);
      return a;
    });
    this.arrays = this.attrs.map((x) => x.array as Float32Array) as [
      Float32Array,
      Float32Array,
      Float32Array,
      Float32Array,
    ];
    // Born dead: t0 far in the future keeps unused slots invisible.
    for (let k = 0; k < capacity; k++) this.arrays[0][k * 4 + 3] = 1e9;
    this.material = createParticleMaterial(time, additive);
    this.mesh = new Mesh(geo, this.material);
    this.mesh.name = additive ? 'vfx-additive' : 'vfx-alpha';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.count = 0;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  emit(p: ParticleSpec): void {
    const k = this.next;
    this.next = (k + 1) % this.capacity;
    this.used = Math.max(this.used, k + 1);
    const o = k * 4;
    const [a, b, c, d] = this.arrays;
    a[o] = p.x;
    a[o + 1] = p.y;
    a[o + 2] = p.z;
    a[o + 3] = p.t0;
    b[o] = p.vx;
    b[o + 1] = p.vy;
    b[o + 2] = p.vz;
    b[o + 3] = p.life;
    c[o] = p.size0;
    c[o + 1] = p.size1;
    c[o + 2] = p.gravity;
    c[o + 3] = p.shape;
    d[o] = p.r;
    d[o + 1] = p.g;
    d[o + 2] = p.b;
    d[o + 3] = p.a;
    if (k < this.dirtyFrom) this.dirtyFrom = k;
    if (k > this.dirtyTo) this.dirtyTo = k;
  }

  /** Uploads what was emitted since the last commit. */
  commit(): void {
    this.mesh.count = this.used;
    this.mesh.visible = this.used > 0;
    if (this.dirtyTo < 0) return;
    // One range from the lowest to the highest slot written; a wrap inside one frame simply covers more.
    const from = this.dirtyFrom;
    const to = this.dirtyTo;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(from * 4, (to - from + 1) * 4);
      a.needsUpdate = true;
    }
    this.dirtyFrom = Infinity;
    this.dirtyTo = -1;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

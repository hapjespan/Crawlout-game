// One instanced draw of a static mesh with the prop material's per-instance attributes (propMaterial.ts): iPos
// (x, y, z meters, yaw radians), iScale (x, y, z, team palette slot) and iTint (rgb multiplier). Shared by the
// structure layer (buildings, scrap heaps, claims) and the prop layer (trees, rocks, bushes).
import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  Mesh,
  type BufferGeometry,
  type MeshBasicNodeMaterial,
  type Scene,
} from 'three/webgpu';

export class InstanceBatch {
  readonly mesh: Mesh;
  private readonly pos: InstancedBufferAttribute;
  private readonly scale: InstancedBufferAttribute;
  private readonly tint: InstancedBufferAttribute;
  count = 0;

  constructor(
    scene: Scene,
    geometry: BufferGeometry,
    material: MeshBasicNodeMaterial,
    capacity: number,
    name: string,
  ) {
    const attr = (): InstancedBufferAttribute => {
      const a = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    this.pos = attr();
    this.scale = attr();
    this.tint = attr();
    geometry.setAttribute('iPos', this.pos);
    geometry.setAttribute('iScale', this.scale);
    geometry.setAttribute('iTint', this.tint);
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  get capacity(): number {
    return this.pos.count;
  }

  push(
    x: number,
    y: number,
    z: number,
    yaw: number,
    sx: number,
    sy: number,
    sz: number,
    team: number,
    tint: readonly [number, number, number],
  ): void {
    const k = this.count;
    if (k >= this.capacity) return;
    this.count = k + 1;
    const o = k * 4;
    const p = this.pos.array as Float32Array;
    const s = this.scale.array as Float32Array;
    const t = this.tint.array as Float32Array;
    p[o] = x;
    p[o + 1] = y;
    p[o + 2] = z;
    p[o + 3] = yaw;
    s[o] = sx;
    s[o + 1] = sy;
    s[o + 2] = sz;
    s[o + 3] = team;
    t[o] = tint[0];
    t[o + 1] = tint[1];
    t[o + 2] = tint[2];
    t[o + 3] = 1;
  }

  commit(): void {
    const n = this.count;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n === 0) return;
    for (const a of [this.pos, this.scale, this.tint]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * 4);
      a.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }
}

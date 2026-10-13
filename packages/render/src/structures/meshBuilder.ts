// Merges primitive geometries into one indexed geometry with position, normal and color
// (linear rgb plus team mask in alpha), the vertex layout of the prop material.
import { BufferAttribute, BufferGeometry, Color, Euler, Matrix4, Quaternion, Vector3 } from 'three/webgpu';

export interface PartOptions {
  /** sRGB hex. */
  color: number;
  /** Team mask 0..1: how much of the owner's color shows through. */
  team?: number;
  position?: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  scale?: readonly [number, number, number];
}

export class MeshBuilder {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly col: number[] = [];
  private readonly idx: number[] = [];
  private readonly m = new Matrix4();
  private readonly nm = new Matrix4();
  private readonly c = new Color();
  private readonly v = new Vector3();

  /** Adds a primitive (consumed and disposed) with a transform, color and team mask. */
  add(g: BufferGeometry, opts: PartOptions): this {
    const [px, py, pz] = opts.position ?? [0, 0, 0];
    const [rx, ry, rz] = opts.rotation ?? [0, 0, 0];
    const [sx, sy, sz] = opts.scale ?? [1, 1, 1];
    this.m.compose(new Vector3(px, py, pz), new Quaternion().setFromEuler(new Euler(rx, ry, rz)), new Vector3(sx, sy, sz));
    this.nm.copy(this.m).invert().transpose();
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const base = this.pos.length / 3;
    this.c.setHex(opts.color);
    for (let i = 0; i < p.count; i++) {
      this.v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(this.m);
      this.pos.push(this.v.x, this.v.y, this.v.z);
      this.v.set(n.getX(i), n.getY(i), n.getZ(i)).transformDirection(this.nm);
      this.nrm.push(this.v.x, this.v.y, this.v.z);
      this.col.push(this.c.r, this.c.g, this.c.b, opts.team ?? 0);
    }
    const gi = g.getIndex();
    if (gi) for (let i = 0; i < gi.count; i++) this.idx.push(base + gi.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    g.dispose();
    return this;
  }

  build(): BufferGeometry {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    geo.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3));
    geo.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 4));
    const vertexCount = this.pos.length / 3;
    geo.setIndex(new BufferAttribute(vertexCount > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }
}

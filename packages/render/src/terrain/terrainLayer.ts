// Terrain mesh from flat typed arrays (the map agent's greybox export), toon-shaded with vertex colors.
// Receives building shadows when a shadow factor is given, and keeps a height texture for terrain-hugging decals.
import { BufferAttribute, BufferGeometry, Color, Mesh, MeshBasicNodeMaterial, type Scene, type Vector3, type Node } from 'three/webgpu';
import { attribute, dot, float, mix, normalWorld, uniform, vec4 } from 'three/tsl';
import type { DataTexturePrecision } from '../gpu/dataTextures.js';
import { toonRamp } from '../units/unitMaterial.js';
import { TerrainHeightField, type TerrainGeometry } from './heightField.js';
import { createHeightTexture, type HeightTexture } from './heightTexture.js';

export interface TerrainLayerOptions {
  /** Shadow factor node, 1 lit and 0 shadowed (shadows/sunShadow.ts). */
  shadow?: Node<'float'> | undefined;
  precision?: DataTexturePrecision;
}

function linearColors(src: Float32Array | Uint8Array | undefined, vertexCount: number): Float32Array {
  const out = new Float32Array(vertexCount * 3);
  const c = new Color();
  const scale = src instanceof Uint8Array ? 1 / 255 : 1;
  for (let i = 0; i < vertexCount; i++) {
    if (src) c.setRGB(src[i * 3]! * scale, src[i * 3 + 1]! * scale, src[i * 3 + 2]! * scale, 'srgb');
    else c.setRGB(0.55, 0.5, 0.42, 'srgb');
    out[i * 3] = c.r;
    out[i * 3 + 1] = c.g;
    out[i * 3 + 2] = c.b;
  }
  return out;
}

export class TerrainLayer {
  private mesh: Mesh | null = null;
  private readonly material: MeshBasicNodeMaterial;
  heightField: TerrainHeightField | null = null;
  heightTexture: HeightTexture | null = null;
  private readonly precision: DataTexturePrecision;

  constructor(
    private readonly scene: Scene,
    lightDir: Vector3,
    opts: TerrainLayerOptions = {},
  ) {
    this.precision = opts.precision ?? 'float';
    const light = uniform(lightDir.clone().normalize());
    const m = new MeshBasicNodeMaterial();
    let shade = toonRamp(dot(normalWorld, light));
    if (opts.shadow) shade = mix(float(0.52), shade, opts.shadow);
    m.colorNode = vec4(attribute('color', 'vec3').mul(shade), 1);
    m.name = 'crawlout-terrain-toon';
    this.material = m;
  }

  set(geometry: TerrainGeometry): void {
    const { positions, indices } = geometry;
    if (positions.length % 3 !== 0) throw new Error('terrain positions must hold xyz triples');
    if (indices.length % 3 !== 0) throw new Error('terrain indices must hold triangles');
    const vertexCount = positions.length / 3;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    geo.setAttribute('color', new BufferAttribute(linearColors(geometry.colors, vertexCount), 3));
    geo.setIndex(new BufferAttribute(indices, 1));
    if (geometry.normals) geo.setAttribute('normal', new BufferAttribute(geometry.normals, 3));
    else geo.computeVertexNormals();
    geo.computeBoundingSphere();
    geo.computeBoundingBox();

    this.clear();
    this.mesh = new Mesh(geo, this.material);
    this.mesh.name = 'terrain';
    this.scene.add(this.mesh);
    this.heightField = new TerrainHeightField(positions, indices);
    this.heightTexture = createHeightTexture(this.heightField, this.precision);
  }

  get object(): Mesh | null {
    return this.mesh;
  }

  heightAt(x: number, z: number): number {
    return this.heightField ? this.heightField.heightAt(x, z, 0) : 0;
  }

  clear(): void {
    if (!this.mesh) return;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh = null;
    this.heightField = null;
    this.heightTexture?.texture.dispose();
    this.heightTexture = null;
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
  }
}

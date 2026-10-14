// Terrain mesh from flat typed arrays (the map agent's greybox export). The greybox is resampled into a smooth grid
// (terrainRefine.ts, render only) and drawn with the terrain material (terrainMaterial.ts: rock on slopes, dust on the
// flat, a world-space detail texture, toon ramp). Receives building shadows when a shadow factor is given, and keeps
// a height texture for terrain-hugging decals. Height lookups use the refined surface, which is what is drawn.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  type Scene,
  type Texture,
  type Vector3,
  type Node,
} from 'three/webgpu';
import type { DataTexturePrecision } from '../gpu/dataTextures.js';
import { TerrainHeightField, type TerrainGeometry } from './heightField.js';
import { createHeightTexture, type HeightTexture } from './heightTexture.js';
import { createTerrainMaterial, type TerrainMaterialBundle } from './terrainMaterial.js';
import { refineTerrain, type TerrainDetailOptions } from './terrainRefine.js';

export interface TerrainLayerOptions {
  /** Shadow factor node, 1 lit and 0 shadowed (shadows/sunShadow.ts). */
  shadow?: Node<'float'> | undefined;
  precision?: DataTexturePrecision;
  /** Render-only refinement of the given mesh. */
  detail?: TerrainDetailOptions;
}

function linearColors(
  src: Float32Array | Uint8Array | undefined,
  vertexCount: number,
): Float32Array {
  const out = new Float32Array(vertexCount * 3);
  const c = new Color();
  const scale = src instanceof Uint8Array ? 1 / 255 : 1;
  for (let i = 0; i < vertexCount; i++) {
    if (src)
      c.setRGB(src[i * 3]! * scale, src[i * 3 + 1]! * scale, src[i * 3 + 2]! * scale, 'srgb');
    else c.setRGB(150 / 255, 128 / 255, 94 / 255, 'srgb');
    out[i * 3] = c.r;
    out[i * 3 + 1] = c.g;
    out[i * 3 + 2] = c.b;
  }
  return out;
}

export class TerrainLayer {
  private mesh: Mesh | null = null;
  private readonly look: TerrainMaterialBundle;
  heightField: TerrainHeightField | null = null;
  heightTexture: HeightTexture | null = null;
  private readonly precision: DataTexturePrecision;
  private readonly detail: TerrainDetailOptions;

  constructor(
    private readonly scene: Scene,
    lightDir: Vector3,
    opts: TerrainLayerOptions = {},
  ) {
    this.precision = opts.precision ?? 'float';
    this.detail = opts.detail ?? {};
    this.look = createTerrainMaterial({ lightDir, shadow: opts.shadow });
  }

  set(geometry: TerrainGeometry): void {
    const { positions, indices } = geometry;
    if (positions.length % 3 !== 0) throw new Error('terrain positions must hold xyz triples');
    if (indices.length % 3 !== 0) throw new Error('terrain indices must hold triangles');
    const source = new TerrainHeightField(positions, indices);
    const drawn = refineTerrain(geometry, source, this.detail);
    const vertexCount = drawn.positions.length / 3;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(drawn.positions, 3));
    geo.setAttribute('color', new BufferAttribute(linearColors(drawn.colors, vertexCount), 3));
    geo.setIndex(new BufferAttribute(drawn.indices, 1));
    const occlusion = drawn.occlusion ?? new Float32Array(vertexCount).fill(1);
    geo.setAttribute('occlusion', new BufferAttribute(occlusion, 1));
    if (drawn.normals) geo.setAttribute('normal', new BufferAttribute(drawn.normals, 3));
    else geo.computeVertexNormals();
    geo.computeBoundingSphere();
    geo.computeBoundingBox();

    this.clear();
    this.mesh = new Mesh(geo, this.look.material);
    this.mesh.name = 'terrain';
    this.scene.add(this.mesh);
    // A refined grid has small even cells: a finer bin keeps a height query at a handful of triangles.
    this.heightField =
      drawn === geometry ? source : new TerrainHeightField(drawn.positions, drawn.indices, 1);
    this.heightTexture = createHeightTexture(this.heightField, this.precision);
    const [lo, hi] = this.heightField.heightRange();
    this.look.setHeightRange(lo, hi);
  }

  /** Detail texture (the albedo of terrain.json); null for the tints alone. The caller keeps ownership. */
  setAlbedo(map: Texture | null): void {
    this.look.setAlbedo(map);
  }

  /** Rock and ground tints, sRGB hex (#rrggbb). */
  setTints(rockTint: string, groundTint: string): void {
    this.look.setTints(rockTint, groundTint);
  }

  get object(): Mesh | null {
    return this.mesh;
  }

  /** Triangles drawn. */
  get triangles(): number {
    return (this.mesh?.geometry.getIndex()?.count ?? 0) / 3;
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
    this.look.dispose();
  }
}

// The ground vegetation in the scene: grass, weeds, shrubs and reeds (vegetationScatter.ts) as instanced procedural
// meshes (vegetationMeshes.ts), one draw per species per chunk of CHUNK_M. A chunk is frustum-culled by its bounding
// sphere and hidden beyond the species' fade distance, so the far zoom pays nothing for grass it could not see.
// Buildings clear the ground under them: setClearings() rebuilds the chunks a footprint touches, which also puts the
// plants back on the levelled ground (terrainPlatforms.ts) around it.
import {
  BufferGeometry,
  InstancedBufferAttribute,
  Mesh,
  Sphere,
  Vector3,
  type Camera,
  type MeshBasicNodeMaterial,
  type Node,
  type Scene,
} from 'three/webgpu';
import type { SunShadowTerm } from '../shadows/sunShadow.js';
import { createVegetationMaterial } from './vegetationMaterial.js';
import { grassTuft, reedClump, shrub, weed } from './vegetationMeshes.js';
import { INSTANCE_STRIDE, SPECIES, type ScatterResult, type Species } from './vegetationScatter.js';

/** Chunk edge, meters. */
export const CHUNK_M = 24;
/** How far a plant's base sits below the ground (m), so a slope never shows a gap under it. */
const SINK = 0.03;
/** Space kept clear around a building footprint (m). */
export const CLEARING_MARGIN_M = 0.8;

interface SpeciesSpec {
  geometry: () => BufferGeometry;
  palette: { dry: [number, number, number]; lush: [number, number, number] };
  wind: { amplitude: number; speed: number };
  fade: [number, number];
  castShadow: boolean;
}

/** The look of each species: the palettes sit in the ground's (terrain/groundSplat.ts GROUND_PALETTE). */
export const SPECIES_SPEC: Record<Species, SpeciesSpec> = {
  grass: {
    geometry: () => grassTuft(1),
    palette: { dry: [0.32, 0.27, 0.125], lush: [0.15, 0.19, 0.065] },
    wind: { amplitude: 0.07, speed: 2.3 },
    fade: [70, 115],
    castShadow: false,
  },
  weedYellow: {
    geometry: () => weed(3, [0.62, 0.45, 0.07]),
    palette: { dry: [0.17, 0.155, 0.075], lush: [0.085, 0.12, 0.045] },
    wind: { amplitude: 0.05, speed: 2 },
    fade: [60, 100],
    castShadow: false,
  },
  weedPale: {
    geometry: () => weed(5, [0.55, 0.52, 0.45]),
    palette: { dry: [0.17, 0.155, 0.075], lush: [0.085, 0.12, 0.045] },
    wind: { amplitude: 0.05, speed: 2 },
    fade: [60, 100],
    castShadow: false,
  },
  shrubRound: {
    geometry: () => shrub(7, 1, 1),
    palette: { dry: [0.2, 0.19, 0.09], lush: [0.09, 0.135, 0.05] },
    wind: { amplitude: 0.03, speed: 1.4 },
    fade: [260, 340],
    castShadow: true,
  },
  shrubLow: {
    geometry: () => shrub(9, 1.35, 0.65),
    palette: { dry: [0.25, 0.19, 0.09], lush: [0.11, 0.14, 0.055] },
    wind: { amplitude: 0.025, speed: 1.4 },
    fade: [260, 340],
    castShadow: true,
  },
  shrubTall: {
    geometry: () => shrub(13, 0.85, 1.45),
    palette: { dry: [0.16, 0.17, 0.08], lush: [0.075, 0.12, 0.05] },
    wind: { amplitude: 0.04, speed: 1.3 },
    fade: [260, 340],
    castShadow: true,
  },
  reed: {
    geometry: () => reedClump(17),
    palette: { dry: [0.28, 0.23, 0.11], lush: [0.13, 0.17, 0.06] },
    wind: { amplitude: 0.1, speed: 1.7 },
    fade: [200, 280],
    castShadow: true,
  },
};

export interface ClearingRect {
  x: number;
  z: number;
  hx: number;
  hz: number;
}

interface Chunk {
  species: Species;
  /** Indices (instance numbers) into the species' scatter array. */
  members: number[];
  center: Vector3;
  mesh: Mesh | null;
  pos: InstancedBufferAttribute | null;
  vars: InstancedBufferAttribute | null;
}

export interface VegetationLayerOptions {
  lightDir: Vector3;
  shadow?: SunShadowTerm | null;
  time: Node<'float'>;
  windStrength: Node<'float'>;
  heightAt: (x: number, z: number) => number;
  /** Whether shrubs and reeds cast the sun's shadow. */
  castShadows?: boolean;
}

export class VegetationLayer {
  private readonly geometries = new Map<Species, BufferGeometry>();
  private readonly materials = new Map<Species, MeshBasicNodeMaterial>();
  private chunks: Chunk[] = [];
  private data: ScatterResult['instances'] | null = null;
  private clearings: readonly ClearingRect[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly opts: VegetationLayerOptions,
  ) {}

  /** Replaces the vegetation with a new scatter (null clears it). */
  set(result: ScatterResult | null): void {
    this.clear();
    if (!result) return;
    this.data = result.instances;
    const byKey = new Map<string, Chunk>();
    for (const species of SPECIES) {
      const d = result.instances[species];
      for (let k = 0; k * INSTANCE_STRIDE < d.length; k++) {
        const cx = Math.floor(d[k * INSTANCE_STRIDE]! / CHUNK_M);
        const cz = Math.floor(d[k * INSTANCE_STRIDE + 1]! / CHUNK_M);
        const key = `${species}:${cx}:${cz}`;
        let c = byKey.get(key);
        if (!c) {
          c = {
            species,
            members: [],
            center: new Vector3((cx + 0.5) * CHUNK_M, 0, (cz + 0.5) * CHUNK_M),
            mesh: null,
            pos: null,
            vars: null,
          };
          byKey.set(key, c);
        }
        c.members.push(k);
      }
    }
    this.chunks = [...byKey.values()];
    for (const c of this.chunks) this.build(c);
  }

  /** Building footprints: plants inside one (plus CLEARING_MARGIN_M) are hidden, the chunks they touch re-placed. */
  setClearings(rects: readonly ClearingRect[]): void {
    this.clearings = rects.map((r) => ({ ...r }));
    const reach = CHUNK_M / 2 + CLEARING_MARGIN_M + 4; // the levelled border reaches past the footprint
    for (const c of this.chunks)
      if (
        rects.some(
          (r) =>
            Math.abs(r.x - c.center.x) < r.hx + reach && Math.abs(r.z - c.center.z) < r.hz + reach,
        )
      )
        this.build(c);
  }

  /** Re-reads the ground height under every plant (the terrain changed under them). */
  relayout(): void {
    for (const c of this.chunks) this.build(c);
  }

  /** Hides chunks beyond their species' fade distance. Call once per frame. */
  update(camera: Camera): void {
    const cam = camera.position;
    const half = CHUNK_M * 0.75;
    for (const c of this.chunks)
      if (c.mesh)
        c.mesh.visible =
          c.mesh.count > 0 && cam.distanceTo(c.center) < SPECIES_SPEC[c.species].fade[1] + half;
  }

  /** Instances drawn now (visible chunks), by species: for the stats. */
  counts(): Record<Species, number> {
    const out = Object.fromEntries(SPECIES.map((s) => [s, 0])) as Record<Species, number>;
    for (const c of this.chunks) if (c.mesh?.visible) out[c.species] += c.mesh.count;
    return out;
  }

  private geometryOf(species: Species): BufferGeometry {
    let g = this.geometries.get(species);
    if (!g) {
      g = SPECIES_SPEC[species].geometry();
      this.geometries.set(species, g);
    }
    return g;
  }

  private materialOf(species: Species): MeshBasicNodeMaterial {
    let m = this.materials.get(species);
    if (!m) {
      const spec = SPECIES_SPEC[species];
      m = createVegetationMaterial({
        name: `crawlout-vegetation-${species}`,
        lightDir: this.opts.lightDir,
        shadow: this.opts.shadow ?? null,
        palette: spec.palette,
        wind: spec.wind,
        time: this.opts.time,
        windStrength: this.opts.windStrength,
        fade: spec.fade,
      });
      this.materials.set(species, m);
    }
    return m;
  }

  private cleared(x: number, z: number): boolean {
    for (const r of this.clearings)
      if (
        Math.abs(x - r.x) < r.hx + CLEARING_MARGIN_M &&
        Math.abs(z - r.z) < r.hz + CLEARING_MARGIN_M
      )
        return true;
    return false;
  }

  /** Fills (or refills) a chunk's instance buffers from the scatter, the ground heights and the clearings. */
  private build(c: Chunk): void {
    const d = this.data![c.species];
    const n = c.members.length;
    if (!c.mesh) {
      const base = this.geometryOf(c.species);
      const g = new BufferGeometry();
      for (const name of Object.keys(base.attributes))
        g.setAttribute(name, base.getAttribute(name));
      g.setIndex(base.getIndex());
      c.pos = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
      c.vars = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
      g.setAttribute('vPos', c.pos);
      g.setAttribute('vVar', c.vars);
      c.mesh = new Mesh(g, this.materialOf(c.species));
      c.mesh.name = `vegetation-${c.species}`;
      c.mesh.castShadow = SPECIES_SPEC[c.species].castShadow && this.opts.castShadows !== false;
      c.mesh.receiveShadow = true;
      this.scene.add(c.mesh);
    }
    const pos = c.pos!.array as Float32Array;
    const vars = c.vars!.array as Float32Array;
    let count = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const k of c.members) {
      const o = k * INSTANCE_STRIDE;
      const x = d[o]!;
      const z = d[o + 1]!;
      if (this.cleared(x, z)) continue;
      const y = this.opts.heightAt(x, z) - SINK;
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
      pos.set([x, y, z, d[o + 2]!], count * 4);
      vars.set([d[o + 3]!, d[o + 4]!, d[o + 5]!, d[o + 6]!], count * 4);
      count++;
    }
    c.pos!.needsUpdate = true;
    c.vars!.needsUpdate = true;
    c.mesh.count = count;
    c.mesh.visible = count > 0;
    c.center.y = count > 0 ? (lo + hi) / 2 : 0;
    const g = c.mesh.geometry;
    g.boundingSphere = new Sphere(
      c.center.clone(),
      CHUNK_M * 0.75 + (count > 0 ? (hi - lo) / 2 : 0) + 2,
    );
  }

  private clear(): void {
    for (const c of this.chunks)
      if (c.mesh) {
        this.scene.remove(c.mesh);
        // Releases the chunk's instance buffers; the species' shared mesh buffers are uploaded again by the chunks
        // that still draw them (three drops every attribute of a disposed geometry), which is a few kilobytes.
        c.mesh.geometry.dispose();
      }
    this.chunks = [];
    this.data = null;
  }

  dispose(): void {
    this.clear();
    for (const g of this.geometries.values()) g.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.geometries.clear();
    this.materials.clear();
  }
}

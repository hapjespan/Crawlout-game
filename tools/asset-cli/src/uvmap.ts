// UV sets for the procedural primitives of shapes.ts. The generator built boxes, prisms, cylinders and spheres with
// `uvs: null`, so every procedural building, rigid unit and attachment came out of the pipe as flat vertex colour: no
// texture could be attached and the normal and metallic-roughness maps the render look now layers on top of the toon
// ramp (docs/spelfundament-v0.1/01-1-visie-en-kaders.md, sections 8 and 9) had nothing to sample.
//
// The unwrap is world-space tiling, not an atlas: the building contract of render (structures/buildingGeometry.ts)
// says the uv "may lie outside 0..1" and rescales a material's uv so its texel density lands in DENSITY_BAND
// (100..180 texels/m). So one square metre of surface maps to UV_METERS_PER_TILE of the tile, every part of every
// asset gets the same grain, and a 256 px tile over 2 m is 128 texels/m: inside the band, no rescale needed.
import type { Mesh, Vec3 } from './geometry.js';

/** Metres of surface per repeat of the generated tile; see the density note above. */
export const UV_METERS_PER_TILE = 2;

/**
 * Steps per tile a generated uv is rounded to (7.8 mm of surface at a 2 m tile, far under one texel of a 128 px
 * map). The LOD GLBs store TEXCOORD_0 as float32 and meshopt codes it byte plane by byte plane, so zeroing the low
 * mantissa of every uv is most of the attribute's compressed size for detail no one can see.
 */
const UV_STEPS_PER_TILE = 256;

const quantize = (v: number): number => Math.round(v * UV_STEPS_PER_TILE) / UV_STEPS_PER_TILE;

/** The axis (0, 1, 2) the normal points along most. */
function dominantAxis(nx: number, ny: number, nz: number): 0 | 1 | 2 {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  if (ay >= ax && ay >= az) return 1;
  return az >= ax ? 2 : 0;
}

/**
 * Box projection per vertex from its own normal: the two position axes across the dominant axis become u and v, in
 * metres over `metersPerTile`. Exact for the flat-shaded shapes (Builder.face gives every face its own vertices, so a
 * vertex normal is its face normal); the round shapes supply their own uv and are left alone by `withUv`.
 */
export function boxProjectUv(mesh: Mesh, metersPerTile = UV_METERS_PER_TILE): Mesh {
  const count = mesh.positions.length / 3;
  const uvs = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const p = i * 3;
    const axis = dominantAxis(mesh.normals[p]!, mesh.normals[p + 1]!, mesh.normals[p + 2]!);
    const [u, v] =
      axis === 1
        ? [mesh.positions[p]!, mesh.positions[p + 2]!]
        : axis === 2
          ? [mesh.positions[p]!, mesh.positions[p + 1]!]
          : [mesh.positions[p + 2]!, mesh.positions[p + 1]!];
    uvs[i * 2] = quantize(u / metersPerTile);
    uvs[i * 2 + 1] = quantize(v / metersPerTile);
  }
  return { ...mesh, uvs };
}

/** The mesh with a uv set: its own when it has one, box projection otherwise. */
export function withUv(mesh: Mesh, metersPerTile = UV_METERS_PER_TILE): Mesh {
  return mesh.uvs ? mesh : boxProjectUv(mesh, metersPerTile);
}

/**
 * Fills the vertices whose uv is NaN (Builder vertices that got no explicit uv) by box projection, so a shape may mix
 * a cylindrical side with flat caps in one mesh.
 */
export function fillMissingUv(mesh: Mesh, metersPerTile = UV_METERS_PER_TILE): Mesh {
  if (!mesh.uvs) return boxProjectUv(mesh, metersPerTile);
  const projected = boxProjectUv(mesh, metersPerTile).uvs!;
  const uvs = Float32Array.from(mesh.uvs);
  for (let i = 0; i < uvs.length; i += 2)
    if (Number.isNaN(uvs[i]!) || Number.isNaN(uvs[i + 1]!)) {
      uvs[i] = projected[i]!;
      uvs[i + 1] = projected[i + 1]!;
    }
  return { ...mesh, uvs };
}

/** Arc length along a ring of radius `r` at angle fraction `t`, in tiles. */
export function ringU(t: number, r: number, metersPerTile = UV_METERS_PER_TILE): number {
  return quantize((t * 2 * Math.PI * Math.max(r, 1e-4)) / metersPerTile);
}

/** Distance in tiles (a height, a path length). */
export function metresV(y: number, metersPerTile = UV_METERS_PER_TILE): number {
  return quantize(y / metersPerTile);
}

/** Point-to-point distance of two positions, in metres. */
export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

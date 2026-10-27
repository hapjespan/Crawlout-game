// Outward-facing triangles for every generated building and robot mesh: the shape parts of variants.json, robots.json, raiders.json,
// dwellers-gear.json and sites.json
// (signed volume > 0 per closed part, geometric normal agrees with the vertex normal per triangle) and the committed
// LOD GLBs in assets/dist (back-face culling must show the outside, not the inside).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { placeShape } from '../src/buildings.js';
import type { Mesh } from '../src/geometry.js';
import { manifestSchema } from '../src/manifest.js';
import { expandParts } from '../src/partExpand.js';
import { loadRobotsConfig } from '../src/robots.js';
import { readSplitJson } from '../src/splitJson.js';
import { parseVariants, type HousePart, type VariantPart } from '../src/variants.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const variants = parseVariants(readSplitJson(join(repo, 'assets/src/buildings/variants.json')));
const robots = loadRobotsConfig(join(repo, 'assets/src/robots.json'));
const raiders = loadRobotsConfig(join(repo, 'assets/src/raiders.json'));
const dwellerGear = loadRobotsConfig(join(repo, 'assets/src/dwellers-gear.json'));
const sites = loadRobotsConfig(join(repo, 'assets/src/sites.json'));
const survival = loadRobotsConfig(join(repo, 'assets/src/survival.json'));
const garde = loadRobotsConfig(join(repo, 'assets/src/garde.json'));

type Shape = Exclude<VariantPart, HousePart>;
const allVariants = [
  ...Object.entries(variants.variants),
  ...Object.entries(robots.units),
  ...Object.entries(robots.buildings),
  ...Object.entries(raiders.units),
  ...Object.entries(raiders.buildings),
  ...Object.entries(raiders.attachments),
  ...Object.entries(dwellerGear.attachments),
  ...Object.entries(sites.buildings),
  ...Object.entries(survival.units),
  ...Object.entries(garde.units),
  ...Object.entries(garde.buildings),
  ...Object.entries(garde.attachments),
];

/** Triangles whose geometric normal opposes the normals stored on their vertices. */
function windingErrors(mesh: Mesh): number {
  let wrong = 0;
  const p = mesh.positions;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [ia, ib, ic] = [mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!];
    const u = [0, 1, 2].map((k) => p[ib * 3 + k]! - p[ia * 3 + k]!);
    const v = [0, 1, 2].map((k) => p[ic * 3 + k]! - p[ia * 3 + k]!);
    const n = [
      u[1]! * v[2]! - u[2]! * v[1]!,
      u[2]! * v[0]! - u[0]! * v[2]!,
      u[0]! * v[1]! - u[1]! * v[0]!,
    ];
    if (Math.hypot(n[0]!, n[1]!, n[2]!) < 1e-12) continue; // a degenerate sliver
    let dot = 0;
    for (const i of [ia, ib, ic])
      for (let k = 0; k < 3; k++) dot += n[k]! * mesh.normals[i * 3 + k]!;
    if (dot <= 0) wrong++;
  }
  return wrong;
}

function signedVolume(mesh: Mesh): number {
  let sum = 0;
  const p = mesh.positions;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t]! * 3;
    const b = mesh.indices[t + 1]! * 3;
    const c = mesh.indices[t + 2]! * 3;
    sum +=
      (p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) -
        p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) +
        p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!)) /
      6;
  }
  return sum;
}

describe('outward winding of the shape parts', () => {
  for (const [id, variant] of allVariants)
    it(`${id}: every shape part faces outward`, () => {
      const shapes = expandParts(variant.parts).filter((q): q is Shape => q.type !== 'house');
      for (const part of shapes) {
        const mesh = placeShape(part);
        expect(windingErrors(mesh), `${id} ${part.type} ${part.material}`).toBe(0);
        // Closed solids only: open parts (no bottom), domes (half a sphere) and thin sheets have no meaningful volume.
        const closed =
          !('open' in part && part.open) &&
          !('half' in part && part.half === 'top') &&
          ['box', 'cylinder', 'cone', 'sphere'].includes(part.type);
        if (closed) expect(signedVolume(mesh), `${id} ${part.type}`).toBeGreaterThan(0);
      }
    });
});

describe('outward winding in assets/dist', () => {
  it('every triangle of every building, robot and Raider LOD faces the way its vertex normals point', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions([EXTMeshoptCompression])
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const manifest = manifestSchema.parse(
      JSON.parse(readFileSync(join(repo, 'assets/dist/manifest.json'), 'utf8')),
    );
    // Primitives of the simplified source house keep their source winding and normals; only shapes are checked here.
    const houseMaterials = new Set(Object.values(variants.sourceMaterials).map((m) => m.name));
    const ids = new Set(allVariants.map(([id]) => id));
    let checked = 0;
    for (const entry of manifest.assets.filter((a) => ids.has(a.id)))
      for (const lod of entry.lods) {
        const doc = await io.readBinary(
          new Uint8Array(readFileSync(join(repo, 'assets/dist', lod.path))),
        );
        for (const mesh of doc.getRoot().listMeshes())
          for (const prim of mesh.listPrimitives()) {
            const pos = prim.getAttribute('POSITION');
            const nor = prim.getAttribute('NORMAL');
            const idx = prim.getIndices();
            if (!pos || !nor || !idx || houseMaterials.has(prim.getMaterial()?.getName() ?? ''))
              continue;
            const m: Mesh = {
              positions: Float32Array.from(pos.getArray()!),
              normals: Float32Array.from(nor.getArray()!),
              uvs: null,
              indices: Uint32Array.from(idx.getArray()!),
            };
            expect(
              windingErrors(m),
              `${entry.id} LOD${lod.level} ${prim.getMaterial()?.getName()}`,
            ).toBe(0);
            checked++;
          }
      }
    expect(checked).toBeGreaterThan(0);
  }, 120_000);
});

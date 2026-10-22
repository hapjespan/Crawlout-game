// Split from delivered.ts to stay under the 5,000-token file limit; delivered.ts re-exports the public surface.
// Holds: placeModel, deliveredLodTargets, flipped, OutGroup, assembleDocument, SIMPLIFY_DEFAULT, +7 more.
import {
  makeTransform,
  transformMesh,
  MeshAccumulator,
  type Mesh,
  compact,
  triangleCount,
  simplifyMesh,
} from './geometry.js';
import { hexToLinear } from './buildings.js';
import { BUDGETS } from './budgets.js';
import { Document, Logger, type Texture } from '@gltf-transform/core';
import { buildAtlas } from './textures.js';
import { MeshoptSimplifier } from 'meshoptimizer';
import { boundsOf, resolveAxis, slug } from './delivered.part1.js';
import type { DeliveredAsset, Extracted, Group, PlacedModel, V3 } from './delivered.part1.js';

/** Groups the extracted meshes per output material and puts them in model space: rotate, real size, origin. */
export function placeModel(
  parts: readonly Extracted[],
  asset: DeliveredAsset,
  sourceTriangles: number,
  assetId: string,
): PlacedModel {
  const warnings: string[] = [];
  const steps: V3[] =
    asset.rotate === undefined
      ? []
      : typeof asset.rotate[0] === 'number'
        ? [asset.rotate as V3]
        : (asset.rotate as V3[]);
  // Per-part turns first, in the source's own space: about the hub, before the whole model is squared up.
  const partTurns = (asset.partRotate ?? []).map((r) => {
    const p = r.pivot ?? ([0, 0, 0] as V3);
    return {
      names: new Set(r.nodes),
      steps: [
        makeTransform({ translation: [-p[0], -p[1], -p[2]] }),
        makeTransform({ rotation: r.rotate }),
        makeTransform({ translation: p }),
      ],
    };
  });
  const prepared =
    partTurns.length === 0
      ? parts
      : parts.map((part) => {
          const rule = partTurns.find((t) => part.nodes.some((n) => t.names.has(n)));
          return rule
            ? { ...part, mesh: rule.steps.reduce((mesh, s) => transformMesh(mesh, s), part.mesh) }
            : part;
        });

  const turns = steps.map((rotation) => makeTransform({ rotation }));
  const turned = prepared.map((p) => ({
    ...p,
    mesh: turns.reduce((mesh, turn) => transformMesh(mesh, turn), p.mesh),
  }));
  const first = boundsOf(turned.map((p) => p.mesh));
  const axisIndex = { x: 0, y: 1, z: 2 } as const;
  const scale =
    asset.scale ??
    (() => {
      const fit = asset.fit!;
      const size = first.max[axisIndex[fit.axis]]! - first.min[axisIndex[fit.axis]]!;
      if (size <= 0) throw new Error(`fit: de ${fit.axis}-afmeting van het model is 0`);
      return fit.meters / size;
    })();
  const min: V3 = [first.min[0] * scale, first.min[1] * scale, first.min[2] * scale];
  const max: V3 = [first.max[0] * scale, first.max[1] * scale, first.max[2] * scale];
  const lift = asset.hover ?? 0;
  const offset: V3 = [
    -resolveAxis(asset.align.x, 'centre', min[0], max[0]),
    -resolveAxis(asset.align.y, 'min', min[1], max[1]) + lift,
    -resolveAxis(asset.align.z, 'centre', min[2], max[2]),
  ];
  const place = makeTransform({ scale: [scale, scale, scale], translation: offset });

  const byName = new Map<
    string,
    { acc: MeshAccumulator; textured: boolean } & Omit<Group, 'mesh'>
  >();
  for (const part of turned) {
    const nodeKey = part.nodes.find((n) => `node:${n}` in asset.materials);
    const rule = asset.materials[nodeKey ? `node:${nodeKey}` : part.sourceName] ?? {};
    if (rule.drop) continue;
    const textured = part.texture !== null && !rule.flat;
    // The surface keyword in the name picks the render look; a textured name also carries the asset id because render
    // keys its texture layer on the material name.
    const name =
      rule.name ??
      `${slug(asset.surface)}_${slug(nodeKey ?? part.sourceName)}${textured ? `_${slug(assetId)}` : ''}`;
    const color: V3 = rule.color ? hexToLinear(rule.color) : part.color;
    let entry = byName.get(name);
    if (!entry) {
      entry = {
        acc: new MeshAccumulator(),
        textured,
        name,
        color,
        texture: textured ? part.texture : null,
        twoSided: rule.twoSided ?? false,
        solo: rule.solo ?? 0,
      };
      byName.set(name, entry);
    } else if (
      entry.textured !== textured ||
      (textured && entry.texture?.key !== part.texture?.key)
    )
      throw new Error(
        `materiaal "${name}": bronmaterialen met dezelfde uitvoernaam moeten dezelfde textuur hebben (geef ze een eigen naam)`,
      );
    entry.acc.add(textured ? part.mesh : { ...part.mesh, uvs: null });
  }
  if (byName.size === 0) throw new Error('alle materialen zijn weggelaten (drop)');
  const groups: Group[] = [...byName.values()]
    .map((e) => ({
      name: e.name,
      color: e.color,
      texture: e.texture,
      twoSided: e.twoSided,
      solo: e.solo,
      mesh: transformMesh(e.acc.build(), place),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { groups, scale, sourceTriangles, warnings };
}

/** Triangle targets per LOD: the budgets of the kind, LOD1 and LOD2 as a share of LOD0 (buildings use the ratios of the config). */
export function deliveredLodTargets(
  kind: DeliveredAsset['kind'],
  lod0: number,
): [number, number, number] {
  const max = kind === 'building' ? BUDGETS.buildingMaxTris : BUDGETS.rigidUnitMaxTris;
  const ratios = kind === 'building' ? BUDGETS.buildingLodRatios : ([1, 0.4, 0.15] as const);
  return [0, 1, 2].map((level) => Math.min(max[level]!, Math.round(lod0 * ratios[level]!))) as [
    number,
    number,
    number,
  ];
}

function flipped(mesh: Mesh): Mesh {
  const n = mesh.positions.length / 3;
  const positions = new Float32Array(mesh.positions.length * 2);
  positions.set(mesh.positions);
  positions.set(mesh.positions, mesh.positions.length);
  const normals = new Float32Array(mesh.normals.length * 2);
  normals.set(mesh.normals);
  for (let i = 0; i < mesh.normals.length; i++)
    normals[mesh.normals.length + i] = -mesh.normals[i]!;
  let uvs: Float32Array | null = null;
  if (mesh.uvs) {
    uvs = new Float32Array(mesh.uvs.length * 2);
    uvs.set(mesh.uvs);
    uvs.set(mesh.uvs, mesh.uvs.length);
  }
  const indices = new Uint32Array(mesh.indices.length * 2);
  indices.set(mesh.indices);
  for (let i = 0; i < mesh.indices.length; i += 3) {
    indices[mesh.indices.length + i] = mesh.indices[i]! + n;
    indices[mesh.indices.length + i + 1] = mesh.indices[i + 2]! + n;
    indices[mesh.indices.length + i + 2] = mesh.indices[i + 1]! + n;
  }
  return { positions, normals, uvs, indices };
}

export interface OutGroup {
  name: string;
  mesh: Mesh;
  color: V3;
  texture: Group['texture'];
}

/** The GLB document of one LOD: textured groups (atlas when there are several textures), then the flat groups. */
export async function assembleDocument(
  id: string,
  allGroups: readonly OutGroup[],
  atlasSize: number,
  atlasName: string,
): Promise<Document> {
  const document = new Document().setLogger(new Logger(Logger.Verbosity.WARN));
  const buffer = document.createBuffer();
  const mesh = document.createMesh(id);
  const add = (geometry: Mesh, material: ReturnType<Document['createMaterial']>): void => {
    const compacted = compact(geometry, geometry.indices);
    const small = compacted.positions.length / 3 < 65536;
    const primitive = document
      .createPrimitive()
      .setMaterial(material)
      .setAttribute(
        'POSITION',
        document.createAccessor().setType('VEC3').setArray(compacted.positions).setBuffer(buffer),
      )
      .setAttribute(
        'NORMAL',
        document.createAccessor().setType('VEC3').setArray(compacted.normals).setBuffer(buffer),
      )
      .setIndices(
        document
          .createAccessor()
          .setType('SCALAR')
          .setArray(small ? Uint16Array.from(compacted.indices) : compacted.indices)
          .setBuffer(buffer),
      );
    if (compacted.uvs)
      primitive.setAttribute(
        'TEXCOORD_0',
        document.createAccessor().setType('VEC2').setArray(compacted.uvs).setBuffer(buffer),
      );
    mesh.addPrimitive(primitive);
  };
  const solid = (name: string, color: V3): ReturnType<Document['createMaterial']> =>
    document
      .createMaterial(name)
      .setBaseColorFactor([color[0], color[1], color[2], 1])
      .setMetallicFactor(0)
      .setRoughnessFactor(1);

  const groups = allGroups.filter((g) => g.mesh.indices.length > 0);
  const textured = groups.filter((g) => g.texture && g.mesh.uvs);
  const textures = new Map<string, Texture>();
  for (const group of textured) {
    let texture = textures.get(group.texture!.key);
    if (!texture) {
      texture = document
        .createTexture(`${group.name}_diffuse`)
        .setImage(group.texture!.image)
        .setMimeType(group.texture!.mimeType);
      textures.set(group.texture!.key, texture);
    }
    const material = solid(group.name, [1, 1, 1]).setBaseColorTexture(texture);
    add(group.mesh, material);
  }
  if (textures.size >= 2) {
    await buildAtlas(document, atlasSize);
    for (const material of document.getRoot().listMaterials()) material.setName(atlasName);
  }
  for (const group of groups.filter((g) => !(g.texture && g.mesh.uvs)))
    add(group.mesh, solid(group.name, group.color));
  document.createScene(id).addChild(document.createNode(id).setMesh(mesh));
  return document;
}

const SIMPLIFY_DEFAULT = BUDGETS.buildingSimplify;

const JOINT_FLAGS: readonly ('Prune' | 'Permissive' | 'LockBorder' | 'Sparse')[] = ['Permissive'];

/**
 * One simplification over all groups together (meshopt, the material of a vertex is a heavily weighted attribute): the
 * seams between materials stay closed and the budget goes where the shape needs it, instead of every material getting its
 * own share and cracks along the borders. The triangles are split over the groups again afterwards.
 */
function simplifyJoint(
  groups: readonly Group[],
  target: number,
  options: DeliveredAsset['simplify'],
): Mesh[] {
  const counts = groups.map((g) => g.mesh.positions.length / 3);
  const total = counts.reduce((a, b) => a + b, 0);
  const positions = new Float32Array(total * 3);
  const stride = 6; // normal (3), uv (2), group id (1)
  const attributes = new Float32Array(total * stride);
  const owner = new Uint16Array(total);
  const indices: number[] = [];
  let base = 0;
  groups.forEach((g, gi) => {
    positions.set(g.mesh.positions, base * 3);
    for (let v = 0; v < counts[gi]!; v++) {
      attributes.set(g.mesh.normals.subarray(v * 3, v * 3 + 3), (base + v) * stride);
      if (g.mesh.uvs)
        attributes.set(g.mesh.uvs.subarray(v * 2, v * 2 + 2), (base + v) * stride + 3);
      attributes[(base + v) * stride + 5] = gi;
      owner[base + v] = gi;
    }
    for (const i of g.mesh.indices) indices.push(i + base);
    base += counts[gi]!;
  });
  const nw = options?.normalWeight ?? SIMPLIFY_DEFAULT.normalWeight;
  const uw = options?.uvWeight ?? SIMPLIFY_DEFAULT.uvWeight;
  // Permissive (a texture atlas or hard normals have seams everywhere) but no Prune: with the error limit at 1 it drops
  // every thin or small part (cage bars, a team saucer). The group id attribute is weighted so a collapse rarely crosses materials.
  const flags = [...(options?.flags ?? JOINT_FLAGS)];
  const run = (goal: number): Uint32Array => {
    let current: Uint32Array<ArrayBufferLike> = Uint32Array.from(indices);
    let want = goal;
    for (let pass = 0; pass < 6; pass++) {
      [current] = MeshoptSimplifier.simplifyWithAttributes(
        current,
        positions,
        3,
        attributes,
        stride,
        [nw, nw, nw, uw, uw, 50],
        null,
        Math.min(indices.length / 3, Math.max(1, Math.floor(want))) * 3,
        1,
        flags,
      );
      if (current.length / 3 <= goal) break;
      want = Math.max(1, want * 0.85);
    }
    return current;
  };
  let reduced = run(target);
  // Two-sided groups get a flipped copy, so they count double against the target.
  const twoSided = (r: Uint32Array): number => {
    let n = 0;
    for (let i = 0; i < r.length; i += 3) if (groups[owner[r[i]!]!]!.twoSided) n++;
    return n;
  };
  const flippedTris = twoSided(reduced);
  const keptTris = reduced.length / 3;
  if (flippedTris > 0 && keptTris + flippedTris > target)
    reduced = run(Math.max(12, Math.floor((target * keptTris) / (keptTris + flippedTris))));
  const perGroup: number[][] = groups.map(() => []);
  for (let i = 0; i < reduced.length; i += 3) {
    const gi = owner[reduced[i]!]!;
    perGroup[gi]!.push(reduced[i]!, reduced[i + 1]!, reduced[i + 2]!);
  }
  const normals = new Float32Array(total * 3);
  for (let v = 0; v < total; v++)
    normals.set(attributes.subarray(v * stride, v * stride + 3), v * 3);
  const uvs = new Float32Array(total * 2);
  for (let v = 0; v < total; v++)
    uvs.set(attributes.subarray(v * stride + 3, v * stride + 5), v * 2);
  return groups.map((g, gi) =>
    compact(
      {
        positions,
        normals,
        uvs: g.mesh.uvs ? uvs : null,
        indices: Uint32Array.from(perGroup[gi]!),
      },
      Uint32Array.from(perGroup[gi]!),
    ),
  );
}

/** Meshes of all groups reduced to the target, plus the extra shapes untouched. `scale`: this LOD's target over LOD0's. */
export function reduceGroups(
  groups: readonly Group[],
  extra: readonly { material: string; mesh: Mesh }[],
  target: number,
  scale: number,
  options: DeliveredAsset['simplify'],
): OutGroup[] {
  const extraTris = extra.reduce((sum, e) => sum + triangleCount(e.mesh), 0);
  const solo = groups.filter((g) => g.solo > 0);
  const joint = groups.filter((g) => g.solo === 0);
  const flags = options?.flags ?? SIMPLIFY_DEFAULT.flags;
  const soloMeshes = solo.map((g) =>
    simplifyMesh(g.mesh, Math.max(4, Math.round(g.solo * scale)), {
      flags,
      uvWeight: options?.uvWeight ?? SIMPLIFY_DEFAULT.uvWeight,
      normalWeight: options?.normalWeight ?? SIMPLIFY_DEFAULT.normalWeight,
    }),
  );
  const soloTris = soloMeshes.reduce((sum, m) => sum + triangleCount(m), 0);
  const jointMeshes =
    joint.length > 0
      ? simplifyJoint(joint, Math.max(joint.length * 12, target - extraTris - soloTris), options)
      : [];
  return groups.map((group) => {
    const mesh =
      group.solo > 0 ? soloMeshes[solo.indexOf(group)]! : jointMeshes[joint.indexOf(group)]!;
    return {
      name: group.name,
      mesh: group.twoSided ? flipped(mesh) : mesh,
      color: group.color,
      texture: group.texture,
    };
  });
}

/** Moves every mesh in y so the lowest vertex of the set is at `y` (simplification can lift a foot or tip off the ground). */
export function regroundY(groups: OutGroup[], extra: OutGroup[], y: number): void {
  const all = [...groups, ...extra];
  const lowest = boundsOf(all.map((g) => g.mesh)).min[1];
  if (!Number.isFinite(lowest) || Math.abs(lowest - y) < 1e-9) return;
  for (const g of all) {
    const positions = new Float32Array(g.mesh.positions);
    for (let i = 1; i < positions.length; i += 3) positions[i] = positions[i]! - (lowest - y);
    g.mesh = { ...g.mesh, positions };
  }
}

export const round6 = (v: readonly number[]): V3 =>
  [v[0]!, v[1]!, v[2]!].map((x) => Math.round(x * 1e6) / 1e6) as V3;

export const oddCeil = (meters: number): number => {
  const cells = Math.ceil(meters - 1e-6);
  return cells % 2 === 0 ? cells + 1 : cells;
};

export interface DeliveredDetails {
  kind: 'rigid-unit' | 'prop' | 'building';
  sourceTriangles: number;
  lodTriangles: number[];
  materials: string[];
  /** Real size of LOD0 in meters (w x h x d). */
  sizeM: V3;
  scale: number;
  hover?: number;
  /** Buildings: the footprint (cells of 1 m, odd) that the model needs at its real size. */
  neededFootprint?: { w: number; h: number };
}

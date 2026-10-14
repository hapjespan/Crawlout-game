// Brengt een bronasset binnen de brief voordat de validatie draait: bones snoeien en hernoemen, clips selecteren,
// extra UV-sets weg, schaal bakken en een te zware mesh reduceren. Alles is config-gestuurd (assets/src/rigmap.json en
// clipmap.json); een asset zonder entry blijft ongewijzigd, behalve dat niet-gemapte clips vervallen.
import type { Document } from '@gltf-transform/core';
import { transformMesh } from '@gltf-transform/functions';
import { pruneBones, type PruneResult } from './bones.js';
import { resolveClips, type Clipmap } from './clipmap.js';
import { countTriangles, hasSkin } from './inspect.js';
import { simplifyToTarget } from './lods.js';
import type { Rigmap } from './rigmap.js';

export interface ConformInfo {
  bones?: PruneResult;
  /** Bronnaam van de behouden clip naar canonieke naam. */
  clipsKept: Record<string, string>;
  clipsDropped: string[];
  extraUvSetsRemoved: number;
  scale?: number;
  trianglesBefore: number;
  trianglesAfter: number;
  /** Of de buis zelf gereduceerd heeft (dan geldt de ondergrens van de LOD0-band). */
  reduced: boolean;
}

/** Bakt een uniforme schaal in de vertices van een statische asset; de nodes komen op de identiteit onder de scene. */
export function applyUniformScale(document: Document, scale: number): void {
  if (hasSkin(document)) throw new Error('een schaal in rigmap.json is alleen voor props; een karakter schaal je in de bron of met een root-transform in de bake');
  const root = document.getRoot();
  const owners = new Map<unknown, number>();
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (mesh) owners.set(mesh, (owners.get(mesh) ?? 0) + 1);
  }
  for (const [, count] of owners) if (count > 1) throw new Error('een mesh die door meerdere nodes gedeeld wordt kan niet geschaald worden');
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) return;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    // S * wereldmatrix: de eerste drie rijen van de column-major matrix schalen.
    const matrix = node.getWorldMatrix().map((value, i) => (i % 4 === 3 ? value : value * scale));
    transformMesh(mesh, matrix as unknown as Parameters<typeof transformMesh>[1]);
    node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
    scene.addChild(node);
  }
  for (const node of root.listNodes()) if (!node.getMesh() && node.listChildren().length === 0) node.dispose();
}

/** Verwijdert alle UV-sets behalve TEXCOORD_0 (de brief eist er precies één). */
export function stripExtraUvSets(document: Document): number {
  let removed = 0;
  for (const prim of document.getRoot().listMeshes().flatMap((m) => m.listPrimitives())) {
    for (const semantic of prim.listSemantics()) {
      if (/^TEXCOORD_(\d+)$/.test(semantic) && semantic !== 'TEXCOORD_0') {
        prim.setAttribute(semantic, null);
        removed++;
      }
    }
  }
  return removed;
}

/** Behoudt alleen de gemapte clips en geeft ze de canonieke naam. Bij een mapfout blijft het document intact (de validatie meldt het). */
export function selectClips(document: Document, clipmap: Clipmap, assetId: string): { kept: Record<string, string>; dropped: string[] } {
  const animations = document.getRoot().listAnimations();
  const names = animations.map((a, i) => a.getName() || `animation_${i}`);
  const { found, errors } = resolveClips(names, clipmap, assetId);
  if (errors.length > 0 || animations.length === 0) return { kept: {}, dropped: [] };
  const keepIndex = new Map([...found].map(([canonical, index]) => [index, canonical]));
  const kept: Record<string, string> = {};
  const dropped: string[] = [];
  animations.forEach((animation, index) => {
    const canonical = keepIndex.get(index);
    if (!canonical) {
      dropped.push(names[index]!);
      for (const channel of animation.listChannels()) channel.dispose();
      for (const sampler of animation.listSamplers()) sampler.dispose();
      animation.dispose();
      return;
    }
    kept[names[index]!] = canonical;
    animation.setName(canonical);
  });
  return { kept, dropped };
}

export interface ConformOptions {
  assetId: string;
  rigmap: Rigmap;
  clipmap: Clipmap;
}

export async function conformDocument(document: Document, options: ConformOptions): Promise<ConformInfo> {
  const entry = options.rigmap.assets[options.assetId];
  const trianglesBefore = countTriangles(document);
  const info: ConformInfo = { clipsKept: {}, clipsDropped: [], extraUvSetsRemoved: 0, trianglesBefore, trianglesAfter: trianglesBefore, reduced: false };

  if (entry?.rig) {
    const rig = options.rigmap.rigs[entry.rig];
    if (!rig) throw new Error(`rig "${entry.rig}" staat niet in rigmap.json`);
    info.bones = pruneBones(document, rig.bones);
  }
  if (entry) info.extraUvSetsRemoved = stripExtraUvSets(document);
  if (entry?.scale !== undefined && entry.scale !== 1) {
    applyUniformScale(document, entry.scale);
    info.scale = entry.scale;
  }
  if (hasSkin(document)) {
    const { kept, dropped } = selectClips(document, options.clipmap, options.assetId);
    info.clipsKept = kept;
    info.clipsDropped = dropped;
  }
  if (entry?.lod0Triangles !== undefined && trianglesBefore > entry.lod0Triangles) {
    await simplifyToTarget(document, entry.lod0Triangles);
    info.reduced = true;
  }
  info.trianglesAfter = countTriangles(document);
  return info;
}

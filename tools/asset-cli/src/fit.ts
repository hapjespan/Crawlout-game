// Extractie en fit voor karakterbronnen die niet als los, schoon karakter aangeleverd zijn (bijvoorbeeld een
// Sketchfab-scène): alleen de gekozen meshes blijven over, en het skelet wordt in zijn huidige pose (de node-pose)
// opnieuw gebonden, gedraaid, naar een doelhoogte geschaald en met de voeten op y = 0 gezet. Daarna zijn alle
// transformaties toegepast: de mesh-nodes staan op de identiteit onder de scene, joint-wereldmatrices zijn star (geen
// schaal), inverse-bindmatrices zijn de inverse van de rustpose en rustpose = bindpose (wat render verwacht).
import type { Accessor, Document, Node, Primitive } from '@gltf-transform/core';
import { prune } from '@gltf-transform/functions';
import {
  compose,
  identity,
  invertAffine,
  multiply,
  quatFromAxisAngle,
  quatMultiply,
  rotationOf,
  transformDirection,
  transformPoint,
  type Mat,
  normalize3,
} from './math.js';

/** Houdt alleen de meshes met deze namen (exact); andere mesh-nodes, ongebruikte nodes en materialen vervallen. */
export async function extractMeshes(
  document: Document,
  keep: readonly string[],
): Promise<string[]> {
  const root = document.getRoot();
  const names = new Set(keep);
  const kept = root.listMeshes().filter((m) => names.has(m.getName()));
  const missing = keep.filter((name) => !kept.some((m) => m.getName() === name));
  if (missing.length > 0)
    throw new Error(
      `meshes niet gevonden: ${missing.join(', ')} (aanwezig: ${root
        .listMeshes()
        .map((m) => m.getName())
        .join(', ')})`,
    );
  const removed: string[] = [];
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (mesh && !names.has(mesh.getName())) {
      removed.push(mesh.getName());
      node.setMesh(null);
    }
  }
  for (const mesh of root.listMeshes()) if (!names.has(mesh.getName())) mesh.dispose();
  // Lege takken zonder joints en zonder meshes weg; prune ruimt materialen, textures en accessors op.
  const joints = new Set(root.listSkins().flatMap((s) => s.listJoints()));
  const useful = (node: Node): boolean => {
    let found = false;
    node.traverse((n) => {
      if (n.getMesh() || joints.has(n)) found = true;
    });
    return found;
  };
  for (const node of root.listNodes()) if (!node.isDisposed() && !useful(node)) node.dispose();
  await document.transform(prune({ keepLeaves: false, keepAttributes: true }));
  return [...new Set(removed)];
}

export interface FitOptions {
  /** Doelhoogte in meter (rustpose, voeten tot kruin). */
  height: number;
  /** Draaiing om +Y in graden, toegepast voor het schalen (om het gezicht naar +Z te krijgen). */
  yawDegrees?: number | undefined;
}

export interface FitInfo {
  /** Uniforme schaal die is toegepast. */
  scale: number;
  heightBefore: number;
}

function nearestJointAncestor(node: Node, joints: ReadonlySet<Node>): Node | null {
  for (let n = node.getParentNode(); n; n = n.getParentNode()) if (joints.has(n)) return n;
  return null;
}

/**
 * Bindt de (enige) skin opnieuw in de huidige node-pose, met yaw, schaal en voeten op y = 0 toegepast. Bestaande clips
 * vervallen (ze horen bij het oude assenstelsel); gebruik retargeten voor nieuwe clips.
 */
export function fitCharacter(document: Document, options: FitOptions): FitInfo {
  const root = document.getRoot();
  const skins = root.listSkins();
  if (skins.length !== 1) throw new Error(`fit verwacht precies 1 skin, gevonden: ${skins.length}`);
  const skin = skins[0]!;
  const joints = skin.listJoints();
  const jointSet = new Set(joints);
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) throw new Error('geen scene');
  const meshNodes = root.listNodes().filter((n) => n.getMesh());
  for (const node of meshNodes)
    if (node.getSkin() !== skin)
      throw new Error(
        `mesh "${node.getMesh()!.getName()}" hangt niet aan de skin; starre meshes worden bij fit niet ondersteund`,
      );

  const ibmAccessor = skin.getInverseBindMatrices();
  const world = joints.map((j) => Float64Array.from(j.getWorldMatrix()) as Mat);
  const skinning = joints.map((_, i) => {
    const ibm = identity();
    if (ibmAccessor) ibmAccessor.getElement(i, ibm as unknown as number[]);
    return multiply(world[i]!, ibm);
  });

  // 1. Vertices naar de node-pose (wereldruimte): v' = som w_j * W_j * IBM_j * v.
  const primitives = [...new Set(meshNodes.map((n) => n.getMesh()!))].flatMap((m) =>
    m.listPrimitives(),
  );
  const baked = new Map<Accessor, number[][]>();
  const bakedNormals = new Map<Accessor, number[][]>();
  for (const prim of primitives) {
    const position = prim.getAttribute('POSITION');
    const normal = prim.getAttribute('NORMAL');
    const j = prim.getAttribute('JOINTS_0');
    const w = prim.getAttribute('WEIGHTS_0');
    if (!position || !j || !w)
      throw new Error('skinned primitive zonder POSITION, JOINTS_0 of WEIGHTS_0');
    if (baked.has(position)) continue;
    const out: number[][] = [];
    const outN: number[][] = [];
    const p = [0, 0, 0];
    const n = [0, 0, 0];
    const jj = [0, 0, 0, 0];
    const ww = [0, 0, 0, 0];
    for (let v = 0; v < position.getCount(); v++) {
      position.getElement(v, p);
      if (normal) normal.getElement(v, n);
      j.getElement(v, jj);
      w.getElement(v, ww);
      const sum = ww.reduce((s, x) => s + x, 0) || 1;
      const acc = [0, 0, 0];
      const accN = [0, 0, 0];
      for (let k = 0; k < 4; k++) {
        if (!ww[k]) continue;
        const m = skinning[jj[k]!]!;
        const tp = transformPoint(m, p);
        const tn = transformDirection(m, n);
        for (let c = 0; c < 3; c++) {
          acc[c]! += (ww[k]! / sum) * tp[c]!;
          accN[c]! += (ww[k]! / sum) * tn[c]!;
        }
      }
      out.push(acc);
      outN.push(normalize3(accN));
    }
    baked.set(position, out);
    if (normal) bakedNormals.set(normal, outN);
  }

  // 2. Fit: yaw, dan schaal tot de doelhoogte, voeten op y = 0 en het midden van de voetafdruk op x = z = 0.
  const yaw = quatFromAxisAngle([0, 1, 0], ((options.yawDegrees ?? 0) * Math.PI) / 180);
  const R = compose({ t: [0, 0, 0], r: yaw, s: [1, 1, 1] });
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const list of baked.values())
    for (const v of list) {
      const r = transformPoint(R, v);
      for (let c = 0; c < 3; c++) {
        min[c] = Math.min(min[c]!, r[c]!);
        max[c] = Math.max(max[c]!, r[c]!);
      }
    }
  const heightBefore = max[1]! - min[1]!;
  if (!(heightBefore > 0)) throw new Error('mesh heeft geen hoogte');
  const scale = options.height / heightBefore;
  const F = multiply(
    compose({
      t: [-((min[0]! + max[0]!) / 2) * scale, -min[1]! * scale, -((min[2]! + max[2]!) / 2) * scale],
      r: [0, 0, 0, 1],
      s: [scale, scale, scale],
    }),
    R,
  );

  // Altijd float32 en niet genormaliseerd, ook als de bron gekwantiseerd was.
  const write = (accessor: Accessor, list: number[][], map: (v: number[]) => number[]): void => {
    const array = new Float32Array(list.length * 3);
    list.forEach((v, i) => array.set(map(v), i * 3));
    accessor.setType('VEC3').setNormalized(false).setArray(array);
  };
  for (const [accessor, list] of baked) write(accessor, list, (v) => transformPoint(F, v));
  for (const [accessor, list] of bakedNormals)
    write(accessor, list, (n) => normalize3(transformDirection(R, n)));

  // 3. Nieuwe joint-wereldmatrices: star deel van F * W_j (translatie in meters, rotatie zonder schaal).
  const rigid = world.map((W) => {
    const fw = multiply(F, W);
    const { q } = rotationOf(W);
    return compose({
      t: [fw[12]!, fw[13]!, fw[14]!],
      r: quatMultiply(yaw, q),
      s: [1, 1, 1],
    });
  });

  // 4. Hiërarchie: elke joint onder zijn dichtstbijzijnde joint-voorouder, de bovenste joints direct onder de scene.
  const parentOf = joints.map((j) => nearestJointAncestor(j, jointSet));
  joints.forEach((joint, i) => {
    const parent = parentOf[i];
    const parentWorld = parent ? rigid[joints.indexOf(parent)]! : identity();
    const local = multiply(invertAffine(parentWorld), rigid[i]!);
    const { q } = rotationOf(local);
    joint.setTranslation([local[12]!, local[13]!, local[14]!]).setRotation(q).setScale([1, 1, 1]);
  });
  joints.forEach((joint, i) => {
    const parent = parentOf[i];
    if (parent) parent.addChild(joint);
    else scene.addChild(joint);
  });
  for (const node of meshNodes) {
    node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
    scene.addChild(node);
  }
  for (const node of root.listNodes())
    if (!jointSet.has(node) && !node.getMesh() && !node.isDisposed()) node.dispose();

  // 5. Inverse-bindmatrices = inverse van de nieuwe rustpose.
  const ibm = new Float32Array(joints.length * 16);
  rigid.forEach((m, i) => ibm.set(invertAffine(m), i * 16));
  const accessor = document
    .createAccessor()
    .setType('MAT4')
    .setArray(ibm)
    .setBuffer(ibmAccessor?.getBuffer() ?? root.listBuffers()[0] ?? document.createBuffer());
  skin.setInverseBindMatrices(accessor);
  ibmAccessor?.dispose();
  skin.setSkeleton(null);

  // 6. Oude clips horen bij het oude assenstelsel.
  for (const animation of root.listAnimations()) {
    for (const channel of animation.listChannels()) channel.dispose();
    for (const sampler of animation.listSamplers()) sampler.dispose();
    animation.dispose();
  }
  return { scale, heightBefore };
}

/**
 * Voegt alle skinned primitives met hetzelfde materiaal samen tot één primitive op één mesh-node (na fit staan alle
 * mesh-nodes op de identiteit, dus de vertices kunnen zonder transformatie samen). Simplify werkt dan over het hele
 * karakter in plaats van per los onderdeel.
 */
export function mergeSkinnedPrimitives(document: Document): number {
  const root = document.getRoot();
  const nodes = root.listNodes().filter((n) => n.getMesh() && n.getSkin());
  const skin = nodes[0]?.getSkin();
  if (!skin || nodes.some((n) => n.getSkin() !== skin)) return 0;
  const semantics = ['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'] as const;
  const size = { POSITION: 3, NORMAL: 3, TEXCOORD_0: 2, JOINTS_0: 4, WEIGHTS_0: 4 } as const;
  const groups = new Map<unknown, { prims: Primitive[] }>();
  for (const node of nodes)
    for (const prim of node.getMesh()!.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      const key = prim.getMaterial();
      const group = groups.get(key) ?? { prims: [] };
      group.prims.push(prim);
      groups.set(key, group);
    }
  const buffer = root.listBuffers()[0] ?? document.createBuffer();
  const mesh = document.createMesh('body');
  for (const { prims } of groups.values()) {
    const data = Object.fromEntries(semantics.map((s) => [s, [] as number[]])) as Record<
      (typeof semantics)[number],
      number[]
    >;
    const indices: number[] = [];
    for (const prim of prims) {
      const base = data.POSITION.length / 3;
      const count = prim.getAttribute('POSITION')!.getCount();
      for (const s of semantics) {
        const accessor = prim.getAttribute(s);
        const el = new Array<number>(size[s]).fill(0);
        for (let i = 0; i < count; i++) {
          if (accessor) accessor.getElement(i, el);
          else el.fill(0);
          data[s].push(...el);
        }
      }
      const idx = prim.getIndices();
      const n = idx ? idx.getCount() : count;
      for (let i = 0; i < n; i++) indices.push(base + (idx ? idx.getScalar(i) : i));
    }
    const vertexCount = data.POSITION.length / 3;
    const accessor = (
      array: Float32Array | Uint16Array | Uint32Array,
      type: 'VEC2' | 'VEC3' | 'VEC4' | 'SCALAR',
    ) => document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
    const merged = document
      .createPrimitive()
      .setMaterial(prims[0]!.getMaterial())
      .setAttribute('POSITION', accessor(new Float32Array(data.POSITION), 'VEC3'))
      .setAttribute('NORMAL', accessor(new Float32Array(data.NORMAL), 'VEC3'))
      .setAttribute('TEXCOORD_0', accessor(new Float32Array(data.TEXCOORD_0), 'VEC2'))
      .setAttribute('JOINTS_0', accessor(new Uint16Array(data.JOINTS_0), 'VEC4'))
      .setAttribute('WEIGHTS_0', accessor(new Float32Array(data.WEIGHTS_0), 'VEC4'))
      .setIndices(
        accessor(
          vertexCount > 65535 ? new Uint32Array(indices) : new Uint16Array(indices),
          'SCALAR',
        ),
      );
    mesh.addPrimitive(merged);
  }
  const scene = root.getDefaultScene() ?? root.listScenes()[0]!;
  for (const node of nodes) node.dispose();
  scene.addChild(document.createNode('body').setMesh(mesh).setSkin(skin));
  for (const m of root.listMeshes()) if (m !== mesh) m.dispose();
  return groups.size;
}

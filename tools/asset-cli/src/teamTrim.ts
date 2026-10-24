// Een losse band in de spelerskleur op een geskind karakter (rigmap `teamTrim`). Render kleurt materialen waarvan de
// naam "team" bevat (manifest `teamMask: 'materialName'`), dus de band is een eigen primitive met een eigen materiaal.
//
// De band is geen nieuwe vorm maar een schil over de huid die er al ligt: de driehoeken rond een bone, binnen een
// venster langs die bone, worden gekopieerd en een paar millimeter naar buiten gezet. Zo volgt de band de mouw precies,
// erft hij de skin-gewichten (hij beweegt dus vanzelf mee) en kost hij een paar honderd driehoeken.
import type { Document, Primitive } from '@gltf-transform/core';
import { invertAffine, transformPoint } from './math.js';

export interface TeamTrimRule {
  /** Bone waar de band omheen ligt (Mixamo-naam, bijvoorbeeld "LeftArm"). */
  bone: string;
  /** Bone die de richting van de band bepaalt; standaard het eerste kind van `bone` in de skin. */
  towards?: string | undefined;
  /** Venster langs de bone, van kop (0) naar punt (1). */
  from?: number | undefined;
  to?: number | undefined;
  /** Minimale skin-gewicht op `bone` per hoekpunt. */
  minWeight?: number | undefined;
  /**
   * Maximale loodrechte afstand tot de botas, in meters. Zonder deze grens is het venster een plak dwars door het
   * model: bij een sleutelbeen loopt die plak als een streep over de hele borst. Met de grens wordt het een kap om
   * de bone zelf, en dat is wat een schouderlapje is.
   */
  radius?: number | undefined;
  /**
   * Minimale y van de hoekpuntnormaal in de bindpose: 0.3 houdt alleen wat naar boven kijkt, dus de bovenkant van
   * de schouder in plaats van de hele ring om de bone (een lapje onder de oksel ziet niemand).
   */
  minUp?: number | undefined;
  /** Afstand naar buiten langs de normaal, in meters. */
  offset?: number | undefined;
  /** Naam van het materiaal; moet "team" bevatten, anders ziet render de band niet. */
  name?: string | undefined;
  /** Lineaire basiskleur van de band (render vervangt hem door de spelerskleur). */
  color?: readonly [number, number, number] | undefined;
}

export interface TeamTrimInfo {
  material: string;
  triangles: number;
  bone: string;
}

const strip = (name: string): string => name.replace(/^mixamorig[:_]?/i, '');

/** Hoekpunten met minstens `minWeight` op joint `index`, over JOINTS_0 en WEIGHTS_0. */
function weightOn(prim: Primitive, index: number): Float32Array | null {
  const joints = prim.getAttribute('JOINTS_0');
  const weights = prim.getAttribute('WEIGHTS_0');
  if (!joints || !weights) return null;
  const out = new Float32Array(joints.getCount());
  const j = [0, 0, 0, 0];
  const w = [0, 0, 0, 0];
  for (let i = 0; i < out.length; i++) {
    joints.getElement(i, j);
    weights.getElement(i, w);
    const sum = w[0]! + w[1]! + w[2]! + w[3]! || 1;
    for (let k = 0; k < 4; k++) if (j[k] === index) out[i]! += w[k]! / sum;
  }
  return out;
}

/**
 * Zet de band op het document en geeft terug wat er bij kwam. Gooit als de bone of zijn richting ontbreekt; een band
 * zonder driehoeken (venster te smal, gewicht te hoog) is ook een fout, want dan heeft de speler geen kleur.
 */
export function addTeamTrim(document: Document, rule: TeamTrimRule): TeamTrimInfo {
  const skin = document.getRoot().listSkins()[0];
  const meshNode = document
    .getRoot()
    .listNodes()
    .find((n) => n.getMesh() && n.getSkin());
  if (!skin || !meshNode) throw new Error('teamTrim: geen geskinde mesh in het document');
  const joints = skin.listJoints();
  const names = joints.map((j) => strip(j.getName()));
  const index = names.indexOf(strip(rule.bone));
  if (index < 0) throw new Error(`teamTrim: bone "${rule.bone}" staat niet in de skin`);
  const childName = rule.towards
    ? strip(rule.towards)
    : names.find((_, i) => joints[i]!.getParentNode() === joints[index]);
  const child = childName === undefined ? -1 : names.indexOf(childName);
  if (child < 0)
    throw new Error(`teamTrim: geen vervolgbone voor "${rule.bone}"; geef "towards" op`);

  // Koppen van de twee bones in de ruimte van de mesh (de skin werkt in die ruimte; rest- en bindpose vallen samen).
  const toMesh = invertAffine(meshNode.getWorldMatrix());
  const head = transformPoint(toMesh, joints[index]!.getWorldTranslation());
  const tail = transformPoint(toMesh, joints[child]!.getWorldTranslation());
  const axis = [tail[0] - head[0], tail[1] - head[1], tail[2] - head[2]];
  const length2 = axis[0]! ** 2 + axis[1]! ** 2 + axis[2]! ** 2;
  if (!(length2 > 0)) throw new Error(`teamTrim: bone "${rule.bone}" heeft geen lengte`);

  const from = rule.from ?? 0.3;
  const to = rule.to ?? 0.62;
  const minWeight = rule.minWeight ?? 0.7;
  const offset = rule.offset ?? 0.004;
  const radius = rule.radius;
  const minUp = rule.minUp;

  /** Per primitive the vertices inside the window: enough weight on the bone and the right stretch along it. */
  const window = (prim: Primitive): Uint8Array | null => {
    if (prim.getMode() !== 4) return null;
    const share = weightOn(prim, index);
    const position = prim.getAttribute('POSITION');
    const normal = prim.getAttribute('NORMAL');
    if (!share || !position || !normal) return null;
    const p = [0, 0, 0];
    const up = [0, 0, 0];
    const keep = new Uint8Array(share.length);
    for (let i = 0; i < share.length; i++) {
      if (share[i]! < minWeight) continue;
      if (minUp !== undefined) {
        normal.getElement(i, up);
        const l = Math.hypot(up[0]!, up[1]!, up[2]!) || 1;
        if (up[1]! / l < minUp) continue;
      }
      position.getElement(i, p);
      const rel = [p[0]! - head[0], p[1]! - head[1], p[2]! - head[2]];
      const t = (rel[0]! * axis[0]! + rel[1]! * axis[1]! + rel[2]! * axis[2]!) / length2;
      if (t < from || t > to) continue;
      if (radius !== undefined) {
        const away = Math.hypot(...rel.map((v, k) => v - t * axis[k]!));
        if (away > radius) continue;
      }
      keep[i] = 1;
    }
    return keep;
  };
  const whole = (prim: Primitive, keep: Uint8Array): number[] => {
    const idx = prim.getIndices();
    const count = idx ? idx.getCount() : prim.getAttribute('POSITION')!.getCount();
    const corner = (k: number): number => (idx ? idx.getScalar(k) : k);
    const out: number[] = [];
    for (let k = 0; k + 2 < count; k += 3) {
      const tri = [corner(k), corner(k + 1), corner(k + 2)];
      if (tri.every((v) => keep[v])) out.push(...tri);
    }
    return out;
  };

  // One garment piece carries the band, the one with the most triangles in the window. A band spread over several
  // pieces would need several materials, and render keys the player colour on the material name.
  let donor: Primitive | null = null;
  let donorCorners: number[] = [];
  for (const mesh of document.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const keep = window(prim);
      if (!keep) continue;
      const corners = whole(prim, keep);
      if (corners.length > donorCorners.length) {
        donor = prim;
        donorCorners = corners;
      }
    }
  const positions: number[] = [];
  const normals: number[] = [];
  const uvData: number[] = [];
  const tangentData: number[] = [];
  const jointData: number[] = [];
  const weightData: number[] = [];
  const indices: number[] = [];
  if (donor) {
    const position = donor.getAttribute('POSITION')!;
    const normal = donor.getAttribute('NORMAL')!;
    const jointAttr = donor.getAttribute('JOINTS_0');
    const weightAttr = donor.getAttribute('WEIGHTS_0');
    const uv = donor.getAttribute('TEXCOORD_0');
    const tangent = donor.getAttribute('TANGENT');
    const remap = new Map<number, number>();
    const p = [0, 0, 0];
    const n = [0, 0, 0];
    const q = [0, 0, 0, 0];
    for (const source of donorCorners) {
      let target = remap.get(source);
      if (target === undefined) {
        target = positions.length / 3;
        remap.set(source, target);
        position.getElement(source, p);
        normal.getElement(source, n);
        const l = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
        for (let k = 0; k < 3; k++) {
          normals.push(n[k]! / l);
          positions.push(p[k]! + (n[k]! / l) * offset);
        }
        if (uv) {
          uv.getElement(source, p);
          uvData.push(p[0]!, p[1]!);
        }
        if (tangent) {
          tangent.getElement(source, q);
          tangentData.push(q[0]!, q[1]!, q[2]!, q[3]!);
        }
        jointAttr?.getElement(source, q);
        jointData.push(q[0]!, q[1]!, q[2]!, q[3]!);
        weightAttr?.getElement(source, q);
        weightData.push(q[0]!, q[1]!, q[2]!, q[3]!);
      }
      indices.push(target);
    }
  }
  const triangles = indices.length / 3;
  if (triangles === 0)
    throw new Error(
      `teamTrim: geen driehoeken rond "${rule.bone}" tussen ${from} en ${to} met gewicht ${minWeight}`,
    );

  const buffer = document.getRoot().listBuffers()[0] ?? document.createBuffer();
  const vertices = positions.length / 3;
  const accessor = (
    array: Float32Array | Uint8Array | Uint16Array | Uint32Array,
    type: 'VEC2' | 'VEC3' | 'VEC4' | 'SCALAR',
  ) => document.createAccessor().setArray(array).setType(type).setBuffer(buffer);
  const name = rule.name ?? 'team_trim';
  const color = rule.color ?? [0.8, 0.8, 0.8];
  const material = document
    .createMaterial(name)
    .setBaseColorFactor([color[0], color[1], color[2], 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.7);
  // The band borrows the weave of the garment it lies on: render multiplies the player colour by the albedo's
  // luminance, so a flat patch reads as a sticker while a textured one reads as dyed cloth. Same texture object, so
  // the GLB does not grow; the normal and metallic-roughness maps ride along on the same UV's.
  const donorMaterial = donor?.getMaterial();
  if (uvData.length > 0 && donorMaterial?.getBaseColorTexture()) {
    material.setBaseColorTexture(donorMaterial.getBaseColorTexture());
    const info = donorMaterial.getBaseColorTextureInfo();
    const own = material.getBaseColorTextureInfo();
    if (info && own)
      own.setTexCoord(info.getTexCoord()).setWrapS(info.getWrapS()).setWrapT(info.getWrapT());
    const normalMap = donorMaterial.getNormalTexture();
    if (normalMap)
      material.setNormalTexture(normalMap).setNormalScale(donorMaterial.getNormalScale());
    const pbr = donorMaterial.getMetallicRoughnessTexture();
    if (pbr)
      material
        .setMetallicRoughnessTexture(pbr)
        .setRoughnessFactor(donorMaterial.getRoughnessFactor());
  }
  const prim = document
    .createPrimitive()
    .setAttribute('POSITION', accessor(new Float32Array(positions), 'VEC3'))
    .setAttribute('NORMAL', accessor(new Float32Array(normals), 'VEC3'))
    .setAttribute(
      'JOINTS_0',
      accessor(
        joints.length > 255 ? new Uint16Array(jointData) : new Uint8Array(jointData),
        'VEC4',
      ),
    )
    .setAttribute('WEIGHTS_0', accessor(new Float32Array(weightData), 'VEC4'))
    .setIndices(
      accessor(vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices), 'SCALAR'),
    )
    .setMaterial(material);
  if (uvData.length > 0)
    prim.setAttribute('TEXCOORD_0', accessor(new Float32Array(uvData), 'VEC2'));
  if (tangentData.length > 0)
    prim.setAttribute('TANGENT', accessor(new Float32Array(tangentData), 'VEC4'));
  meshNode.getMesh()!.addPrimitive(prim);
  return { material: name, triangles, bone: rule.bone };
}

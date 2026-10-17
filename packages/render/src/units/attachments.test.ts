import { describe, expect, it, vi } from 'vitest';
import { ANIM, ENTITY_FLAG } from '@crawlout/protocol';
import { unitTypeId } from '@crawlout/data';
import type { AssetManifest } from '@crawlout/asset-cli/manifest';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  type InstancedBufferAttribute,
  type Object3D,
} from 'three/webgpu';
import type { DecalLayer } from '../decals/decalLayer.js';
import { createInterpolatedFrame, type InterpolatedFrame } from '../snapshot/interpolate.js';
import { AttachmentRegistry, type RigAttachInfo } from './attachmentAssets.js';
import { attachmentGeometryFromGltf, mergeAttachmentLods } from './attachmentGeometry.js';
import {
  ATTACHMENT_SLOTS,
  attachmentMatrix,
  attachmentsOfLoadout,
  boneIndexOf,
  GRIP_OFFSET,
  GRIP_ROTATION,
  SLOT_SPECS,
} from './attachmentSockets.js';
import { NO_UV } from './gltfUnitGeometry.js';
import { ATTACHMENT_LOD_STEP } from './unitMaterial.js';
import { ATTACHMENT_LODS, PLACEHOLDER_RIG, UnitLayer } from './unitLayer.js';

const SOCKETS = {
  hand: [-0.74, 1.44, -0.065],
  back: [0, 1.31, -0.005],
  head: [0, 1.57, 0.005],
} as const;
const near = (v: Vector3, x: number, y: number, z: number, digits = 5): void => {
  expect(v.x).toBeCloseTo(x, digits);
  expect(v.y).toBeCloseTo(y, digits);
  expect(v.z).toBeCloseTo(z, digits);
};

describe('slot mapping', () => {
  it('lists the attachment slots of a loadout in table order, without the body and unknown slots', () => {
    expect(
      attachmentsOfLoadout({
        body: 'raider_body_human',
        gear_head: 'raider_gear_warlord_helm',
        weapon: 'raider_weapon_pipe_gun',
        gear_back: 'raider_gear_shackles',
        banner: 'raider_banner',
        armor: '',
      }),
    ).toEqual([
      { slot: 'weapon', assetId: 'raider_weapon_pipe_gun' },
      { slot: 'gear_back', assetId: 'raider_gear_shackles' },
      { slot: 'gear_head', assetId: 'raider_gear_warlord_helm' },
    ]);
    expect(attachmentsOfLoadout({ body: 'dweller_body_human' })).toEqual([]);
  });

  it('follows the README: hand for weapon and tool, back and head sockets, the chest for armor', () => {
    expect(ATTACHMENT_SLOTS).toEqual(['weapon', 'tool', 'gear_back', 'gear_head', 'armor']);
    expect(SLOT_SPECS.weapon).toMatchObject({ anchor: 'grip', bone: 'RightHand', socket: 'hand' });
    expect(SLOT_SPECS.tool).toEqual(SLOT_SPECS.weapon);
    expect(SLOT_SPECS.gear_back).toMatchObject({ anchor: 'back', bone: 'Spine2', socket: 'back' });
    expect(SLOT_SPECS.gear_head).toMatchObject({ anchor: 'head', bone: 'Head', socket: 'head' });
    expect(SLOT_SPECS.armor).toMatchObject({ anchor: 'body', bone: 'Spine2', socket: null });
  });

  it('finds a bone in the baked order', () => {
    expect(boneIndexOf(['Hips', 'Spine', 'RightHand'], 'RightHand')).toBe(2);
    expect(boneIndexOf(['Hips'], 'Head')).toBe(-1);
  });
});

describe('socket transforms', () => {
  it('puts a back or head prop at its socket, unrotated', () => {
    for (const [slot, socket] of [
      ['gear_back', SOCKETS.back],
      ['gear_head', SOCKETS.head],
    ] as const) {
      const m = attachmentMatrix(slot, SOCKETS)!;
      near(new Vector3(0, 0, 0).applyMatrix4(m), socket[0], socket[1], socket[2]);
      // no turn: an axis stays an axis
      near(new Vector3(0, 1, 0).transformDirection(m), 0, 1, 0);
      near(new Vector3(0, 0, 1).transformDirection(m), 0, 0, 1);
    }
  });

  it('leaves armor in the body space', () => {
    expect(attachmentMatrix('armor', {})!.equals(new Matrix4())).toBe(true);
  });

  it('puts a grip a hand width from the wrist toward the fingertips and turns it by GRIP_ROTATION', () => {
    const m = attachmentMatrix('weapon', SOCKETS)!;
    near(
      new Vector3(0, 0, 0).applyMatrix4(m),
      SOCKETS.hand[0] + GRIP_OFFSET[0],
      SOCKETS.hand[1] + GRIP_OFFSET[1],
      SOCKETS.hand[2] + GRIP_OFFSET[2],
    );
    // a pure rotation about the grip: lengths survive, and it is not the identity
    const z = new Vector3(0, 0, 1).transformDirection(m);
    expect(z.length()).toBeCloseTo(1, 6);
    expect(z.distanceTo(new Vector3(0, 0, 1))).toBeGreaterThan(0.3);
    expect(Math.hypot(...GRIP_ROTATION)).toBeCloseTo(1, 2);
    expect(attachmentMatrix('tool', SOCKETS)!.equals(m)).toBe(true);
  });

  it('gives nothing for a body without the socket the slot needs', () => {
    expect(attachmentMatrix('weapon', { back: [0, 1, 0] })).toBeNull();
    expect(attachmentMatrix('gear_back', { hand: [0, 1, 0] })).toBeNull();
    expect(attachmentMatrix('gear_head', {})).toBeNull();
    expect(attachmentMatrix('armor', {})).not.toBeNull();
  });
});

/** A static GLB stand-in: one box mesh at a node offset, with a material color. */
function propScene(
  opts: { at?: [number, number, number]; size?: number; color?: number } = {},
): Object3D {
  const root = new Group();
  const box = new Mesh(
    new BoxGeometry(opts.size ?? 0.2, opts.size ?? 0.2, opts.size ?? 0.2),
    new MeshStandardMaterial({ color: opts.color ?? 0x808080 }),
  );
  box.position.set(...(opts.at ?? [0, 0, 0]));
  root.add(box);
  return root;
}

describe('attachment geometry', () => {
  it('moves the prop into the body space and skins every vertex fully to the slot bone', () => {
    const matrix = new Matrix4().makeTranslation(1, 2, 3);
    const { geometry, triangles, map } = attachmentGeometryFromGltf(
      propScene({ at: [0, 0.5, 0] }),
      {
        bone: 13,
        matrix,
      },
    );
    expect(map).toBeNull();
    expect(triangles).toBe(12);
    const pos = geometry.getAttribute('position');
    let minY = Infinity;
    for (let i = 0; i < pos.count; i++) minY = Math.min(minY, pos.getY(i));
    // box centered at y 0.5 (half size 0.1) -> its underside at 0.4, then up by the socket's 2
    expect(minY).toBeCloseTo(2.4, 5);
    const index = geometry.getAttribute('skinIndex');
    const weight = geometry.getAttribute('skinWeight');
    const color = geometry.getAttribute('color');
    for (let i = 0; i < pos.count; i++) {
      expect([index.getX(i), weight.getX(i), weight.getY(i)]).toEqual([13, 1, 0]);
      expect(color.getW(i)).toBe(0); // never team colored
    }
    expect(geometry.getAttribute('uv')).toBeUndefined();
  });

  it('rotates normals with the slot matrix and keeps them unit length', () => {
    const turn = new Matrix4().makeRotationZ(Math.PI / 2);
    const { geometry } = attachmentGeometryFromGltf(propScene(), { bone: 0, matrix: turn });
    const n = geometry.getAttribute('normal');
    for (let i = 0; i < n.count; i++)
      expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 5);
    // the +Y face now looks along -X
    const p = geometry.getAttribute('position');
    const faceUp = Array.from({ length: n.count }, (_, i) => i).find(
      (i) => Math.abs(n.getX(i) + 1) < 1e-5,
    );
    expect(faceUp).toBeDefined();
    expect(p.getX(faceUp!)).toBeCloseTo(-0.1, 5);
  });

  it('turns the color of a material into a linear vertex color and refuses a skinned or empty GLB', () => {
    const { geometry } = attachmentGeometryFromGltf(propScene({ color: 0xff0000 }), {
      bone: 0,
      matrix: new Matrix4(),
    });
    const c = geometry.getAttribute('color');
    expect(c.getX(0)).toBeCloseTo(1, 5);
    expect(c.getY(0)).toBeCloseTo(0, 5);
    expect(() =>
      attachmentGeometryFromGltf(new Group(), { bone: 0, matrix: new Matrix4() }),
    ).toThrow(/no mesh/);
  });

  it('merges the LODs of a prop into one geometry, each vertex carrying its LOD in the color alpha', () => {
    const a = attachmentGeometryFromGltf(propScene({ size: 0.4 }), {
      bone: 3,
      matrix: new Matrix4(),
    });
    const b = attachmentGeometryFromGltf(propScene({ size: 0.2 }), {
      bone: 3,
      matrix: new Matrix4(),
    });
    const verts = a.geometry.getAttribute('position').count;
    const merged = mergeAttachmentLods([a.geometry, b.geometry]);
    expect(merged.getAttribute('position').count).toBe(verts * 2);
    const color = merged.getAttribute('color');
    expect(color.getW(0)).toBe(0);
    expect(color.getW(verts)).toBe(1);
    const index = merged.getIndex()!;
    expect(index.count).toBe(72);
    // the second LOD's indices point into its own vertices
    for (let i = 36; i < 72; i++) expect(index.getX(i)).toBeGreaterThanOrEqual(verts);
    for (let i = 0; i < 36; i++) expect(index.getX(i)).toBeLessThan(verts);
    expect(merged.getAttribute('skinIndex').getX(verts)).toBe(3);
  });

  it('fills a missing uv with NO_UV when only one LOD has the atlas', () => {
    const plain = attachmentGeometryFromGltf(propScene(), { bone: 0, matrix: new Matrix4() });
    const textured = new BufferGeometry();
    for (const name of ['position', 'normal', 'skinIndex', 'skinWeight'] as const)
      textured.setAttribute(name, plain.geometry.getAttribute(name).clone());
    textured.setAttribute('color', plain.geometry.getAttribute('color').clone());
    const n = plain.geometry.getAttribute('position').count;
    textured.setAttribute('uv', new BufferAttribute(new Float32Array(n * 2).fill(0.25), 2));
    textured.setIndex(plain.geometry.getIndex()!.clone());
    const merged = mergeAttachmentLods([textured, plain.geometry]);
    const uv = merged.getAttribute('uv');
    expect(uv.getX(0)).toBeCloseTo(0.25, 6);
    expect(uv.getX(n)).toBe(NO_UV);
  });
});

describe('AttachmentRegistry', () => {
  const MANIFEST_URL = 'https://assets.test/manifest.json';
  const entry = (id: string, kind: 'prop' | 'building' = 'prop') => ({
    id,
    kind,
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    lods: [0, 1, 2].map((level) => ({
      level,
      path: `${id}/lod${level}.glb`,
      triangles: 12 / (level + 1),
    })),
    sockets: {},
    animations: [],
    boneCount: 0,
  });
  const manifest = (ids: string[], building: string[] = []): AssetManifest =>
    ({
      version: 1,
      assets: [...ids.map((i) => entry(i)), ...building.map((i) => entry(i, 'building'))],
    }) as unknown as AssetManifest;

  function rig(over: Partial<RigAttachInfo> = {}): RigAttachInfo {
    return {
      assetId: 'raider_body_human',
      rig: 1,
      sockets: SOCKETS,
      boneNames: ['Hips', 'Spine', 'Spine2', 'Head', 'RightHand'],
      ...over,
    };
  }

  function setup(
    ids: string[],
    opts: { manifestUrl?: string | undefined; building?: string[] } = {},
  ) {
    const added: { name: string; rig: number; vertices: number }[] = [];
    const assigned = new Map<number, number[]>();
    const fetched: string[] = [];
    const warn = vi.fn();
    const registry = new AttachmentRegistry(
      {
        addAttachment(src) {
          added.push({
            name: src.name,
            rig: src.rig,
            vertices: src.geometry.getAttribute('position').count,
          });
          return added.length - 1;
        },
        assignAttachments(typeIds, handles) {
          for (const t of typeIds) assigned.set(t, [...handles]);
        },
      },
      {
        manifest: async () => manifest(ids, opts.building ?? []),
        fetchBytes: async (url) => {
          fetched.push(url);
          return new ArrayBuffer(0);
        },
        parseGltf: async () => propScene(),
      },
      {
        manifestUrl: 'manifestUrl' in opts ? opts.manifestUrl : MANIFEST_URL,
        resolveUrl: (_m, path) => `https://assets.test/${path}`,
        warn,
      },
    );
    return { registry, added, assigned, fetched, warn };
  }

  const loadouts = [
    {
      id: 0,
      visuals: { meshSlots: { body: 'raider_body_human', weapon: 'raider_weapon_pipe_gun' } },
    },
    {
      id: 1,
      visuals: {
        meshSlots: {
          body: 'raider_body_human',
          weapon: 'raider_weapon_pipe_gun',
          armor: 'raider_armor_steel',
          gear_head: 'raider_gear_warlord_helm',
        },
      },
    },
    { id: 2, visuals: { meshSlots: { body: 'raider_body_human' } } },
    {
      id: 3,
      visuals: { meshSlots: { body: 'dweller_body_human', weapon: 'dweller_weapon_rifle' } },
    },
  ];
  const ALL = ['raider_weapon_pipe_gun', 'raider_armor_steel', 'raider_gear_warlord_helm'];

  it('builds each prop once per body and hands the loadouts their own lists, in slot order', async () => {
    const { registry, added, assigned } = setup(ALL);
    registry.setLoadouts(loadouts);
    registry.rigLoaded(rig());
    await registry.settled();
    expect(added.map((a) => a.name).sort()).toEqual([...ALL].sort());
    expect(added.every((a) => a.rig === 1)).toBe(true);
    // two LODs in one geometry: 24 vertices per box, twice
    expect(added.every((a) => a.vertices === 48)).toBe(true);
    const names = (typeId: number) => assigned.get(typeId)!.map((h) => added[h]!.name);
    expect(names(unitTypeId(0))).toEqual(['raider_weapon_pipe_gun']);
    expect(names(unitTypeId(1))).toEqual([
      'raider_weapon_pipe_gun',
      'raider_gear_warlord_helm',
      'raider_armor_steel',
    ]);
    expect(assigned.get(unitTypeId(2))).toEqual([]);
    expect(assigned.get(unitTypeId(0))![0]).toBe(assigned.get(unitTypeId(1))![0]); // the same prop is one attachment
    const status = registry.statuses().find((s) => s.assetId === 'raider_weapon_pipe_gun')!;
    expect(status).toMatchObject({
      state: 'ready',
      slot: 'weapon',
      bodyAssetId: 'raider_body_human',
    });
    expect(status.typeIds.sort()).toEqual([unitTypeId(0), unitTypeId(1)]);
    expect(status.triangles).toEqual([12, 12]);
  });

  it('does not care whether the body or the loadouts arrive first', async () => {
    const a = setup(ALL);
    a.registry.rigLoaded(rig());
    a.registry.setLoadouts(loadouts);
    await a.registry.settled();
    expect(a.added).toHaveLength(3);
    expect(a.assigned.get(unitTypeId(0))).toHaveLength(1);
  });

  it('waits for the body: nothing is built, nothing fetched, before a rig exists', async () => {
    const { registry, added, fetched } = setup(ALL);
    registry.setLoadouts(loadouts);
    await registry.settled();
    expect(added).toEqual([]);
    expect(fetched).toEqual([]);
    expect(registry.statuses().every((s) => s.state === 'loading')).toBe(true);
  });

  it('skips a prop the manifest lacks, silently, and says so in its status', async () => {
    const { registry, added, warn } = setup([]);
    registry.setLoadouts(loadouts);
    registry.rigLoaded(rig());
    await registry.settled();
    expect(added).toEqual([]);
    const rifle = registry.statuses().find((s) => s.assetId === 'dweller_weapon_rifle')!;
    expect(rifle.state).toBe('loading'); // its body (dweller_body_human) never loaded here
    const pipe = registry.statuses().find((s) => s.assetId === 'raider_weapon_pipe_gun')!;
    expect(pipe).toMatchObject({ state: 'skipped', reason: 'not in the manifest' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('skips with a reason when the body lacks the bone or the socket, and without a manifest', async () => {
    const a = setup(ALL);
    a.registry.setLoadouts(loadouts);
    a.registry.rigLoaded(rig({ sockets: { back: [0, 1, 0] } }));
    await a.registry.settled();
    const pipe = a.registry.statuses().find((s) => s.assetId === 'raider_weapon_pipe_gun')!;
    expect(pipe).toMatchObject({ state: 'skipped', reason: 'body has no hand socket' });
    // armor needs no socket and still shows
    expect(a.added.map((x) => x.name)).toEqual(['raider_armor_steel']);
    const helm = a.registry.statuses().find((s) => s.assetId === 'raider_gear_warlord_helm')!;
    expect(helm.state).toBe('skipped');

    const b = setup(ALL);
    b.registry.setLoadouts(loadouts);
    b.registry.rigLoaded(rig({ boneNames: ['Hips'] }));
    await b.registry.settled();
    expect(b.registry.statuses().find((s) => s.assetId === 'raider_armor_steel')!.reason).toMatch(
      /no bone Spine2/,
    );

    const c = setup(ALL, { manifestUrl: undefined });
    c.registry.setLoadouts(loadouts);
    c.registry.rigLoaded(rig());
    await c.registry.settled();
    expect(c.added).toEqual([]);
    expect(c.registry.statuses().every((s) => s.state !== 'ready')).toBe(true);
  });

  it('warns and reports failed for a prop that is a building, and carries on with the rest', async () => {
    const { registry, added, warn } = setup(['raider_armor_steel', 'raider_gear_warlord_helm'], {
      building: ['raider_weapon_pipe_gun'],
    });
    registry.setLoadouts(loadouts);
    registry.rigLoaded(rig());
    await registry.settled();
    const pipe = registry.statuses().find((s) => s.assetId === 'raider_weapon_pipe_gun')!;
    expect(pipe.state).toBe('failed');
    expect(pipe.reason).toMatch(/not a prop/);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(added.map((a) => a.name).sort()).toEqual([
      'raider_armor_steel',
      'raider_gear_warlord_helm',
    ]);
  });

  it('only fetches the two nearest LODs of a prop', async () => {
    const { registry, fetched } = setup(['raider_weapon_pipe_gun']);
    registry.setLoadouts([loadouts[0]!]);
    registry.rigLoaded(rig());
    await registry.settled();
    expect(fetched.sort()).toEqual([
      'https://assets.test/raider_weapon_pipe_gun/lod0.glb',
      'https://assets.test/raider_weapon_pipe_gun/lod1.glb',
    ]);
  });
});

interface Placed {
  id: number;
  typeId: number;
  x: number;
  z: number;
  owner?: number;
  anim?: number;
  animT?: number;
  flags?: number;
}

function frameOf(units: Placed[]): InterpolatedFrame {
  const frame = createInterpolatedFrame(64);
  frame.count = units.length;
  units.forEach((u, i) => {
    frame.id[i] = u.id;
    frame.typeId[i] = u.typeId;
    frame.x[i] = u.x;
    frame.z[i] = u.z;
    frame.y[i] = 0;
    frame.owner[i] = u.owner ?? 0;
    frame.anim[i] = u.anim ?? ANIM.idle;
    frame.animT[i] = u.animT ?? 0;
    frame.yaw[i] = 0.5;
    frame.flags[i] = u.flags ?? 0;
  });
  return frame;
}

const decals = { push() {} } as unknown as DecalLayer;

function cameraAt(distance: number): PerspectiveCamera {
  const c = new PerspectiveCamera(45, 16 / 9, 0.5, 4000);
  c.position.set(0, distance * 0.8, distance * 0.6);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
}

describe('UnitLayer attachments', () => {
  function layerWith() {
    const scene = new Scene();
    const layer = new UnitLayer(scene, { capacity: 16, lightDir: new Vector3(0, 1, 0) });
    const prop = () =>
      mergeAttachmentLods([
        attachmentGeometryFromGltf(propScene(), { bone: 2, matrix: new Matrix4() }).geometry,
        attachmentGeometryFromGltf(propScene(), { bone: 2, matrix: new Matrix4() }).geometry,
      ]);
    const gun = layer.addAttachment({ name: 'gun', rig: PLACEHOLDER_RIG, geometry: prop() });
    const hat = layer.addAttachment({ name: 'hat', rig: PLACEHOLDER_RIG, geometry: prop() });
    layer.assignAttachments([1], [gun, hat]); // typeId 1 carries both
    layer.assignAttachments([2], [gun]);
    return { scene, layer };
  }
  const mesh = (scene: Scene, name: string) => scene.getObjectByName(name) as Mesh;
  const rows = (m: Mesh, name: string, k: number): number[] => {
    const a = m.geometry.getAttribute(name) as InstancedBufferAttribute;
    return [a.getX(k), a.getY(k), a.getZ(k), a.getW(k)];
  };

  it('draws one instanced mesh per attachment, however many units carry it', () => {
    const { scene, layer } = layerWith();
    expect(layer.attachmentCount).toBe(2);
    const gun = mesh(scene, 'units-placeholder-gun');
    const hat = mesh(scene, 'units-placeholder-hat');
    expect(gun.visible).toBe(false);
    const units: Placed[] = [
      { id: 1, typeId: 1, x: 0, z: 0 },
      { id: 2, typeId: 1, x: 1, z: 0 },
      { id: 3, typeId: 2, x: -1, z: 0 },
      { id: 4, typeId: 3, x: 2, z: 0 }, // carries nothing
    ];
    layer.update(frameOf(units), cameraAt(10), decals, 0);
    expect(gun.visible).toBe(true);
    expect(gun.count).toBe(3);
    expect(hat.count).toBe(2);
    expect(layer.attachmentInstances).toBe(5);
  });

  it('copies the body instance: same pose, clip and phase, with the LOD above the variation seed', () => {
    const { scene, layer } = layerWith();
    const frame = frameOf([
      { id: 1, typeId: 2, x: 3, z: -2, owner: 2, anim: ANIM.walk, animT: 0.25 },
    ]);
    layer.update(frame, cameraAt(10), decals, 0);
    const gun = mesh(scene, 'units-placeholder-gun');
    const body = scene.getObjectByName('units-placeholder-lod0') as Mesh;
    expect(gun.count).toBe(1);
    expect(body.count).toBe(1);
    expect(rows(gun, 'iPose', 0)).toEqual(rows(body, 'iPose', 0));
    const bodyAnim = rows(body, 'iAnim', 0);
    const gunAnim = rows(gun, 'iAnim', 0);
    expect(gunAnim[0]).toBe(bodyAnim[0]); // clip
    expect(gunAnim[1]).toBe(bodyAnim[1]); // progress
    expect(gunAnim[3]).toBe(bodyAnim[3]); // flags
    expect(gunAnim[2]).toBe(bodyAnim[2]! + 0 * ATTACHMENT_LOD_STEP); // LOD 0
  });

  it('names the unit LOD in the instance, and drops the attachments at the far LOD', () => {
    const { scene, layer } = layerWith();
    const frame = frameOf([{ id: 1, typeId: 2, x: 0, z: 0 }]);
    const gun = mesh(scene, 'units-placeholder-gun');
    const lods: number[] = [];
    for (const d of [8, 60, 400]) {
      layer.update(frame, cameraAt(d), decals, 0);
      const lod = layer.lodCounts.findIndex((n) => n > 0);
      lods.push(lod);
      if (lod < ATTACHMENT_LODS) {
        expect(gun.count).toBe(1);
        const body = scene.getObjectByName(`units-placeholder-lod${lod}`) as Mesh;
        expect(rows(gun, 'iAnim', 0)[2]! - rows(body, 'iAnim', 0)[2]!).toBe(
          lod * ATTACHMENT_LOD_STEP,
        );
      } else {
        expect(gun.count).toBe(0);
        expect(gun.visible).toBe(false);
      }
    }
    expect(lods).toEqual([0, 1, 2]);
  });

  it('draws nothing for a unit that is culled, and keeps casting like the body does', () => {
    const { scene, layer } = layerWith();
    layer.update(frameOf([{ id: 1, typeId: 2, x: 5000, z: 5000 }]), cameraAt(10), decals, 0);
    expect(mesh(scene, 'units-placeholder-gun').count).toBe(0);
    expect(mesh(scene, 'units-placeholder-gun').castShadow).toBe(false); // no sun in this layer
  });

  it('follows a dead unit: the instance keeps the death clip of the body', () => {
    const { scene, layer } = layerWith();
    layer.update(
      frameOf([
        { id: 1, typeId: 2, x: 0, z: 0, anim: ANIM.death, animT: 0.9, flags: ENTITY_FLAG.dead },
      ]),
      cameraAt(10),
      decals,
      0,
    );
    const gun = mesh(scene, 'units-placeholder-gun');
    expect(gun.count).toBe(1);
    expect(rows(gun, 'iAnim', 0)[0]).toBe(ANIM.death);
    expect(rows(gun, 'iAnim', 0)[1]).toBeCloseTo(0.9, 6);
  });

  it('only shows an attachment on units drawn with the rig it was built for', () => {
    const scene = new Scene();
    const layer = new UnitLayer(scene, { capacity: 4, lightDir: new Vector3(0, 1, 0) });
    expect(() =>
      layer.addAttachment({
        name: 'x',
        rig: 7,
        geometry: attachmentGeometryFromGltf(propScene(), { bone: 0, matrix: new Matrix4() })
          .geometry,
      }),
    ).toThrow(/no unit rig/);
    expect(() => layer.assignAttachments([1], [3])).toThrow(/no attachment/);
  });

  it('takes the meshes out of the scene on dispose', () => {
    const { scene, layer } = layerWith();
    layer.dispose();
    expect(scene.getObjectByName('units-placeholder-gun')).toBeUndefined();
    expect(layer.attachmentCount).toBe(0);
  });
});

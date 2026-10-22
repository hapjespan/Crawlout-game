import { Vector3, Matrix4, Group, BufferGeometry, BufferAttribute } from 'three/webgpu';
import { expect, describe, it } from 'vitest';
import {
  attachmentsOfLoadout,
  ATTACHMENT_SLOTS,
  SLOT_SPECS,
  boneIndexOf,
  attachmentMatrix,
  GRIP_OFFSET,
  GRIP_ROTATION,
} from './attachmentSockets.js';
import { attachmentGeometryFromGltf, mergeAttachmentLods } from './attachmentGeometry.js';
import { NO_UV } from './gltfUnitGeometry.js';
import { SOCKETS, propScene } from './attachments.helpers.js';

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

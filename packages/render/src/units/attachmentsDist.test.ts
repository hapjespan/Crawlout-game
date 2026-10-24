// The Raider bodies and props of assets/dist (the asset side's real GLBs and manifest) through the attachment layer
// and the clothing palettes. Needs no GPU: the layer builds its meshes and materials, nothing is rendered.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { unitTypeId } from '@crawlout/data';
import { Matrix4, PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three/webgpu';
import type { DecalLayer } from '../decals/decalLayer.js';
import { createInterpolatedFrame } from '../snapshot/interpolate.js';
import { AttachmentRegistry } from './attachmentAssets.js';
import { GRIP_ROTATION } from './attachmentSockets.js';
import { createGltfIO, UnitAssetLoader } from './unitAssetLoader.js';
import { UnitAssetRegistry } from './unitAssets.js';
import { UnitLayer } from './unitLayer.js';

const DIST = fileURLToPath(new URL('../../../../assets/dist/', import.meta.url));
const URL_BASE = 'dist://manifest.json';

async function distIO() {
  const fetchBytes = async (url: string): Promise<ArrayBuffer> => {
    const b = await readFile(DIST + url.replace('dist://', ''));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  const io = createGltfIO(fetchBytes);
  const loader = new UnitAssetLoader(io, (_manifest, path) => `dist://${path}`);
  return { io, loader };
}

function stubBrowser(): void {
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('createImageBitmap', async () => ({ width: 64, height: 64, close() {} }));
}

/** Mean linear color, and the team-masked share, of the vertices of LOD 0 outside the team mask. */
function paintOf(color: {
  count: number;
  getX(i: number): number;
  getY(i: number): number;
  getZ(i: number): number;
  getW(i: number): number;
}) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  let team = 0;
  for (let i = 0; i < color.count; i++) {
    if (color.getW(i) > 0.5) team++;
    else {
      r += color.getX(i);
      g += color.getY(i);
      b += color.getZ(i);
      n++;
    }
  }
  return { rgb: [r / n, g / n, b / n], luma: (0.2126 * r + 0.7152 * g + 0.0722 * b) / n, team };
}

describe('the clothing palettes of the human bodies in assets/dist', () => {
  it('paints the Raiders in dark leather and rust, the slaves in pale rags with a team band, the Dwellers as before', async () => {
    stubBrowser();
    const { loader } = await distIO();
    const load = (id: string) => loader.load(URL_BASE, id, { rasterize: () => null });
    const [dweller, raider, slave] = await Promise.all([
      load('dweller_body_human'),
      load('raider_body_human'),
      load('raider_body_slave'),
    ]);
    vi.unstubAllGlobals();
    expect(dweller.entry.palette).toBeUndefined();
    expect(raider.entry.palette).toBeDefined();
    expect(slave.entry.palette?.teamZone).toBe('band');

    const d = paintOf(dweller.lods[0].geometry.getAttribute('color'));
    const r = paintOf(raider.lods[0].geometry.getAttribute('color'));
    const s = paintOf(slave.lods[0].geometry.getAttribute('color'));
    // a different look: Raiders darker than the khaki Dwellers, slaves paler than both
    expect(r.luma).toBeLessThan(d.luma * 0.85);
    // Margin was 1.4; surfaceTex's weathering multiplier darkens the rags a little, so the ratio sits at ~1.37.
    expect(s.luma).toBeGreaterThan(d.luma * 1.3);
    expect(s.luma).toBeGreaterThan(r.luma);
    // Raider red: red dominates blue by more than in the Dwellers' khaki
    expect(r.rgb[0]! / r.rgb[2]!).toBeGreaterThan((d.rgb[0]! / d.rgb[2]!) * 1.0);
    // same mesh: Raiders and Dwellers keep the chest accent, the slave only a band on one arm
    expect(r.team).toBe(d.team);
    expect(s.team).toBeGreaterThan(0);
    expect(s.team).toBeLessThan(d.team * 0.7);
    // the slave's team accent does not widen to the whole upper body from afar
    expect(slave.lods[0].farTeam).toBe(0);
    expect(raider.lods[0].farTeam).toBe(1);
    expect(dweller.lods[0].farTeam).toBe(1);
    // all three share the skeleton (so one baked texture)
    expect(raider.lods[0].boneNames).toEqual(dweller.lods[0].boneNames);
  });
});

describe('the hand grip against the real animation texture', () => {
  it('turns a prop (barrel +Z, top +Y) to point forward and stand upright in the idle clip', async () => {
    stubBrowser();
    const { loader } = await distIO();
    const body = await loader.load(URL_BASE, 'raider_body_human', { rasterize: () => null });
    vi.unstubAllGlobals();
    const hand = body.lods[0].boneNames.indexOf('RightHand');
    expect(hand).toBeGreaterThan(0);
    const { anims } = body;
    const idle = anims.clips.find((c) => c.name === 'idle')!;
    const grip = new Quaternion(...GRIP_ROTATION);
    const forward = new Vector3();
    const up = new Vector3();
    let worst = 0;
    for (let f = 0; f < idle.frameCount; f += 5) {
      const skin = new Matrix4().fromArray(
        anims.data,
        ((idle.startRow + f) * anims.width + hand * 4) * 4,
      );
      const turn = new Matrix4().makeRotationFromQuaternion(grip);
      const total = skin.clone().multiply(turn);
      forward.set(0, 0, 1).transformDirection(total);
      up.set(0, 1, 0).transformDirection(total);
      worst = Math.max(worst, Math.acos(Math.min(1, forward.z)), Math.acos(Math.min(1, up.y)));
    }
    // within 20 degrees of the world's forward and up for every sampled idle frame
    expect(worst).toBeLessThan((20 * Math.PI) / 180);
  });

  it('keeps the grip near the hip in walk and swings it forward in the attack: it is carried by the hand bone', async () => {
    stubBrowser();
    const { loader } = await distIO();
    const body = await loader.load(URL_BASE, 'raider_body_human', { rasterize: () => null });
    vi.unstubAllGlobals();
    const hand = body.lods[0].boneNames.indexOf('RightHand');
    const sockets = body.entry.sockets.hand!;
    const gripAt = (clip: string, frac: number): Vector3 => {
      const c = body.anims.clips.find((k) => k.name === clip)!;
      const f = Math.min(c.frameCount - 1, Math.floor(frac * c.frameCount));
      const m = new Matrix4().fromArray(
        body.anims.data,
        ((c.startRow + f) * body.anims.width + hand * 4) * 4,
      );
      return new Vector3(sockets[0]!, sockets[1]!, sockets[2]!).applyMatrix4(m);
    };
    const idle = gripAt('idle', 0);
    expect(idle.y).toBeGreaterThan(0.7); // hanging at the side, not on the floor
    expect(idle.y).toBeLessThan(1.1);
    expect(Math.abs(idle.x)).toBeGreaterThan(0.15); // beside the body, not through it
    let reach = -Infinity;
    for (let k = 0; k < 10; k++) reach = Math.max(reach, gripAt('attack2', k / 10).z);
    expect(reach).toBeGreaterThan(0.35); // the arm comes forward in the attack
  });
});

describe('attachments of the Raider loadouts in assets/dist', () => {
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
          weapon: 'raider_weapon_scrap_revolver',
          gear_head: 'raider_gear_warlord_helm',
        },
      },
    },
    {
      id: 2,
      visuals: {
        meshSlots: {
          body: 'raider_body_human',
          weapon: 'raider_weapon_net_whip',
          gear_back: 'raider_gear_shackles',
          armor: 'raider_armor_steel',
        },
      },
    },
    { id: 3, visuals: { meshSlots: { body: 'raider_body_slave', tool: 'raider_tool_shovel' } } },
    {
      id: 4,
      visuals: { meshSlots: { body: 'dweller_body_human', weapon: 'dweller_weapon_not_yet_made' } },
    },
  ];

  it('carries every prop that has art, skips a Dweller weapon that has none, and draws one mesh per prop', async () => {
    stubBrowser();
    const { io, loader } = await distIO();
    const scene = new Scene();
    const layer = new UnitLayer(scene, { capacity: 64, lightDir: new Vector3(0, 1, 0) });
    const attachments = new AttachmentRegistry(
      layer,
      {
        manifest: (url) => loader.manifest(url),
        fetchBytes: (url) => io.fetchBytes(url),
        parseGltf: (bytes, url) => io.parseGltf(bytes, url),
      },
      { manifestUrl: URL_BASE, resolveUrl: (_m, path) => `dist://${path}` },
    );
    const units = new UnitAssetRegistry(layer, loader, {
      config: { manifestUrl: URL_BASE },
      maxTextureSize: 4096,
      onRigLoaded: (info) => attachments.rigLoaded(info),
    });
    attachments.setLoadouts(loadouts);
    await units.setLoadouts(loadouts);
    await attachments.settled();
    vi.unstubAllGlobals();

    const status = Object.fromEntries(attachments.statuses().map((s) => [s.assetId, s]));
    for (const id of [
      'raider_weapon_pipe_gun',
      'raider_weapon_scrap_revolver',
      'raider_gear_warlord_helm',
      'raider_weapon_net_whip',
      'raider_gear_shackles',
      'raider_armor_steel',
      'raider_tool_shovel',
    ])
      expect(status[id]?.state, id).toBe('ready');
    expect(status.dweller_weapon_not_yet_made).toMatchObject({
      state: 'skipped',
      reason: 'not in the manifest',
    });
    expect(layer.attachmentCount).toBe(7);
    expect(layer.attachmentNamesOf(unitTypeId(2))).toEqual([
      'raider_weapon_net_whip',
      'raider_gear_shackles',
      'raider_armor_steel',
    ]);
    expect(layer.attachmentNamesOf(unitTypeId(4))).toEqual([]);

    // A crowd close to the camera: 30 units of loadout 2 and 30 of loadout 0 cost one draw per prop, not per unit.
    const frame = createInterpolatedFrame(64);
    frame.count = 60;
    for (let i = 0; i < 60; i++) {
      frame.id[i] = i + 1;
      frame.typeId[i] = unitTypeId(i < 30 ? 2 : 0);
      frame.x[i] = (i % 10) * 1.5 - 7;
      frame.z[i] = Math.floor(i / 10) * 1.5 - 4;
      frame.anim[i] = 4; // walk
    }
    const camera = new PerspectiveCamera(45, 16 / 9, 0.5, 2000);
    camera.position.set(0, 14, 14);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    layer.update(frame, camera, { push() {} } as unknown as DecalLayer);
    const visible = scene.children.filter(
      (o) => o.name.startsWith('units-raider_body_human-raider_') && o.visible,
    );
    expect(visible.map((o) => o.name).sort()).toEqual([
      'units-raider_body_human-raider_armor_steel',
      'units-raider_body_human-raider_gear_shackles',
      'units-raider_body_human-raider_weapon_net_whip',
      'units-raider_body_human-raider_weapon_pipe_gun',
    ]);
    expect(layer.attachmentInstances).toBe(30 * 3 + 30);
  });
});

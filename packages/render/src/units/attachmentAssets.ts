// Which attachments (weapon, tool, back gear, head gear, armor) a loadout shows is data, never code: the slots of
// `visuals.meshSlots` in data/loadouts/*.json other than `body` name manifest ids of kind 'prop'. This registry loads
// those props once they have a body to sit on: when the body asset of a loadout is loaded as a skinned rig
// (UnitAssetRegistry, onRigLoaded), each of the loadout's props becomes an attachment of that rig (unitLayer.ts
// addAttachment): its vertices moved into the body's bind space by the slot's socket matrix and skinned to the slot's
// bone (attachmentGeometry.ts, attachmentSockets.ts), then handed to the unit typeIds of the loadout.
//
// Nothing here is fatal. A prop the manifest does not have (the Dweller weapons have no art yet) is skipped without a
// word: art arrives gradually, and the unit is drawn without it. The status list says what happened to each one.
import { unitTypeId } from '@crawlout/data';
import type { AssetManifest } from '@crawlout/asset-cli/manifest';
import type { Matrix4, Object3D } from 'three/webgpu';
import { applySurfaceTiles, surfaceTilesFor } from '../look/surfaceTiles.js';
import { attachmentGeometryFromGltf, mergeAttachmentLods } from './attachmentGeometry.js';
import {
  attachmentMatrix,
  attachmentsOfLoadout,
  boneIndexOf,
  SLOT_SPECS,
  type AttachmentSlot,
  type BodySockets,
} from './attachmentSockets.js';
import type { LoadoutVisuals } from './unitAssets.js';
import { ATTACHMENT_LODS, type UnitLayer } from './unitLayer.js';

/** What the registry needs to know about a loaded body rig. */
export interface RigAttachInfo {
  /** Manifest id of the body asset. */
  assetId: string;
  /** Rig index in the unit layer. */
  rig: number;
  sockets: BodySockets;
  /** Bone names in the joint order of the baked texture. */
  boneNames: readonly string[];
}

export interface AttachmentStatus {
  /** Manifest id of the prop. */
  assetId: string;
  slot: AttachmentSlot;
  /** Manifest id of the body it sits on. */
  bodyAssetId: string;
  state: 'loading' | 'ready' | 'skipped' | 'failed';
  /** Why it is skipped or failed; the unit is drawn without it. */
  reason?: string;
  /** Unit typeIds that carry it. */
  typeIds: number[];
  /** Triangles of LOD 0 and 1 when ready. */
  triangles?: [number, number];
}

type AttachmentTarget = Pick<UnitLayer, 'addAttachment' | 'assignAttachments'>;

/** Network and parsing, injectable for tests (the same shape as the prop registry's). */
export interface AttachmentIO {
  manifest(url: string): Promise<AssetManifest>;
  fetchBytes(url: string): Promise<ArrayBuffer>;
  parseGltf(bytes: ArrayBuffer, url: string): Promise<Object3D>;
}

interface Want {
  slot: AttachmentSlot;
  assetId: string;
  typeIds: number[];
}

interface Parsed {
  roots: Object3D[];
  albedoGain: number | undefined;
}

export class AttachmentRegistry {
  /** Wanted attachments per body asset id, keyed by slot and prop id. */
  private readonly wanted = new Map<string, Map<string, Want>>();
  /** Per body asset id and unit typeId: the keys of its attachments, in slot order. */
  private readonly order = new Map<string, Map<number, string[]>>();
  private readonly rigs = new Map<string, RigAttachInfo>();
  private readonly statusByKey = new Map<string, AttachmentStatus>();
  /** One layer attachment per body, slot and prop (null: skipped or failed). */
  private readonly built = new Map<string, Promise<number | null>>();
  private readonly parsed = new Map<string, Promise<Parsed | null>>();
  private readonly pending = new Set<Promise<unknown>>();
  private generation = 0;
  private disposed = false;

  constructor(
    private readonly layer: AttachmentTarget,
    private readonly io: AttachmentIO,
    private readonly opts: {
      /** The manifest the props come from; undefined: nothing to load. */
      manifestUrl: string | undefined;
      resolveUrl: (manifestUrl: string, path: string) => string;
      warn?: (message: string) => void;
    },
  ) {}

  /** Records which loadout carries what. Loads right away for bodies that are already loaded, later for the rest. */
  setLoadouts(loadouts: readonly LoadoutVisuals[]): void {
    this.generation++;
    this.wanted.clear();
    this.order.clear();
    this.statusByKey.clear();
    for (const l of loadouts) {
      const body = l.visuals.meshSlots.body;
      if (!body) continue;
      const typeId = unitTypeId(l.id);
      const keys: string[] = [];
      for (const { slot, assetId } of attachmentsOfLoadout(l.visuals.meshSlots)) {
        const key = `${slot}|${assetId}`;
        const wants = this.wanted.get(body) ?? new Map<string, Want>();
        const want = wants.get(key) ?? { slot, assetId, typeIds: [] };
        want.typeIds.push(typeId);
        wants.set(key, want);
        this.wanted.set(body, wants);
        keys.push(key);
      }
      const types = this.order.get(body) ?? new Map<number, string[]>();
      types.set(typeId, keys);
      this.order.set(body, types);
    }
    for (const [bodyId, wants] of this.wanted)
      for (const w of wants.values())
        this.statusByKey.set(`${bodyId}|${w.slot}|${w.assetId}`, {
          assetId: w.assetId,
          slot: w.slot,
          bodyAssetId: bodyId,
          state: 'loading',
          typeIds: [...w.typeIds],
        });
    for (const info of this.rigs.values()) this.reconcile(info);
  }

  /** A body asset is loaded as a rig: its loadouts' attachments can be built now. */
  rigLoaded(info: RigAttachInfo): void {
    this.rigs.set(info.assetId, info);
    this.reconcile(info);
  }

  statuses(): AttachmentStatus[] {
    return [...this.statusByKey.values()].map((s) => ({
      ...s,
      typeIds: [...s.typeIds],
      ...(s.triangles ? { triangles: [...s.triangles] as [number, number] } : {}),
    }));
  }

  /** Resolves when everything requested so far has settled (tests and loading screens). */
  async settled(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
  }

  private track<T>(p: Promise<T>): Promise<T> {
    this.pending.add(p);
    const done = () => this.pending.delete(p);
    p.then(done, done);
    return p;
  }

  private reconcile(info: RigAttachInfo): void {
    const wants = this.wanted.get(info.assetId);
    if (!wants || this.disposed) return;
    const generation = this.generation;
    void this.track(
      (async () => {
        const handles = new Map<string, number | null>();
        await Promise.all(
          [...wants].map(async ([key, want]) => {
            handles.set(key, await this.build(info, want));
          }),
        );
        if (generation !== this.generation || this.disposed) return;
        for (const [typeId, keys] of this.order.get(info.assetId) ?? []) {
          const list = keys.map((k) => handles.get(k)).filter((h): h is number => h != null);
          this.layer.assignAttachments([typeId], list);
        }
      })(),
    );
  }

  private statusOf(body: string, want: Want): AttachmentStatus | undefined {
    return this.statusByKey.get(`${body}|${want.slot}|${want.assetId}`);
  }

  private build(info: RigAttachInfo, want: Want): Promise<number | null> {
    const key = `${info.assetId}|${want.slot}|${want.assetId}`;
    let p = this.built.get(key);
    if (!p) {
      p = this.buildOnce(info, want).catch((err: unknown) => {
        const reason = err instanceof Error ? err.message : String(err);
        this.settle(info.assetId, want, 'failed', reason);
        this.opts.warn?.(`attachment "${want.assetId}" (${want.slot}) not shown: ${reason}`);
        return null;
      });
      this.built.set(key, p);
    } else
      void p.then((handle) => {
        // A repeat request (setLoadouts again) gets the same answer; its status says so too.
        const s = this.statusOf(info.assetId, want);
        if (s && s.state === 'loading') s.state = handle === null ? 'skipped' : 'ready';
      });
    return p;
  }

  private settle(
    body: string,
    want: Want,
    state: AttachmentStatus['state'],
    reason?: string,
    triangles?: [number, number],
  ): void {
    const s = this.statusOf(body, want);
    if (!s) return;
    s.state = state;
    if (reason) s.reason = reason;
    if (triangles) s.triangles = triangles;
  }

  private skip(info: RigAttachInfo, want: Want, reason: string): null {
    this.settle(info.assetId, want, 'skipped', reason);
    return null;
  }

  /** The prop's LOD 0 and 1 scenes, once per prop id. Null: the manifest does not have it (not an error). */
  private load(manifestUrl: string, assetId: string): Promise<Parsed | null> {
    let p = this.parsed.get(assetId);
    if (!p) {
      p = (async () => {
        const manifest = await this.io.manifest(manifestUrl);
        const entry = manifest.assets.find((a) => a.id === assetId);
        if (!entry) return null;
        if (entry.kind !== 'prop')
          throw new Error(`"${assetId}" is a ${entry.kind} in the manifest, not a prop`);
        const roots: Object3D[] = [];
        for (let i = 0; i < ATTACHMENT_LODS; i++) {
          const lod = entry.lods[i]!;
          const prev = i > 0 ? entry.lods[i - 1]! : null;
          // Identical LODs share one scene (a tiny prop has the same mesh at every level).
          if (prev && (prev.path === lod.path || prev.triangles === lod.triangles))
            roots.push(roots[i - 1]!);
          else {
            const url = this.opts.resolveUrl(manifestUrl, lod.path);
            roots.push(await this.io.parseGltf(await this.io.fetchBytes(url), url));
          }
        }
        // Generated relief is one shared tile set per manifest (look/surfaceTiles.ts); hang it on before the
        // geometry builder reads the material's map.
        const tiles = await surfaceTilesFor(
          manifestUrl,
          manifest,
          (path) => this.opts.resolveUrl(manifestUrl, path),
          this.io,
        ).catch(() => null);
        for (const root of new Set(roots)) applySurfaceTiles(root, tiles);
        return { roots, albedoGain: entry.albedoGain };
      })();
      p.catch(() => this.parsed.delete(assetId));
      this.parsed.set(assetId, p);
    }
    return p;
  }

  private async buildOnce(info: RigAttachInfo, want: Want): Promise<number | null> {
    const manifestUrl = this.opts.manifestUrl;
    if (!manifestUrl) return this.skip(info, want, 'no manifest');
    const spec = SLOT_SPECS[want.slot];
    const bone = boneIndexOf(info.boneNames, spec.bone);
    if (bone < 0) return this.skip(info, want, `body has no bone ${spec.bone}`);
    const matrix: Matrix4 | null = attachmentMatrix(want.slot, info.sockets);
    if (!matrix) return this.skip(info, want, `body has no ${spec.socket} socket`);
    const prop = await this.load(manifestUrl, want.assetId);
    if (this.disposed) return null;
    if (!prop) return this.skip(info, want, 'not in the manifest');
    const lods = prop.roots.map((root) => attachmentGeometryFromGltf(root, { bone, matrix }));
    const first = lods[0]!;
    const handle = this.layer.addAttachment({
      name: want.assetId,
      rig: info.rig,
      geometry: mergeAttachmentLods(lods.map((l) => l.geometry)),
      ...(first.map
        ? { albedo: { map: first.map, ...(prop.albedoGain ? { gain: prop.albedoGain } : {}) } }
        : {}),
    });
    this.settle(info.assetId, want, 'ready', undefined, [first.triangles, lods[1]!.triangles]);
    return handle;
  }
}

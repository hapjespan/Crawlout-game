// Which unit is drawn with which asset. The choice is data, never code: a loadout's `visuals.meshSlots.body` names a
// manifest id (data/loadouts.json), and one config value (`defaultUnit`) can name the asset for every unit without
// one of its own. Anything that fails to load leaves the procedural placeholder rig in place.
import { unitTypeId } from '@crawlout/data';
import type { TeamMaskSource } from './gltfUnitGeometry.js';
import type { UnitAssetLoader } from './unitAssetLoader.js';
import type { UnitLayer } from './unitLayer.js';

/** The mesh slot of a loadout that holds the character body (data/loadouts.json visuals.meshSlots). */
export const BODY_SLOT = 'body';

export interface UnitAssetConfig {
  /** URL of the asset-cli's manifest.json (assets/dist/manifest.json as served). */
  manifestUrl: string;
  /** Maps a manifest path (relative to manifest.json) to a URL; default: next to manifest.json. */
  resolveUrl?: (path: string) => string;
  /** Asset id for every unit whose loadout has no loaded asset of its own. */
  defaultUnit?: string;
  /** Where the team mask comes from (gltfUnitGeometry.ts). Default 'materialName'. */
  teamMask?: TeamMaskSource;
}

export interface UnitAssetOptions {
  /** Also draw every unit without an asset of its own with this one. */
  asDefault?: boolean;
  teamMask?: TeamMaskSource;
}

export interface UnitAssetStatus {
  assetId: string;
  manifestUrl: string;
  state: 'loading' | 'ready' | 'failed';
  /** Why it failed; the placeholder rig stays. */
  reason?: string;
  /** Unit typeIds drawn with it through loadout data (the default rig covers the rest). */
  typeIds: number[];
  /** Triangles per LOD when ready. */
  triangles?: [number, number, number];
}

export interface LoadoutVisuals {
  id: number;
  visuals: { meshSlots: Readonly<Record<string, string>> };
}

type RigTarget = Pick<UnitLayer, 'addRig' | 'assignRig' | 'setDefaultRig'>;

interface Entry {
  status: UnitAssetStatus;
  rig: Promise<number | null>;
}

export class UnitAssetRegistry {
  private readonly entries = new Map<string, Entry>();
  /** typeIds per body asset id, from the loadouts. */
  private readonly typesByAsset = new Map<string, number[]>();
  private disposed = false;

  constructor(
    private readonly layer: RigTarget,
    private readonly loader: UnitAssetLoader,
    private readonly opts: { config?: UnitAssetConfig | undefined; maxTextureSize: number; warn?: (message: string) => void },
  ) {}

  /** Loads the configured default unit, if any. */
  async start(): Promise<void> {
    const c = this.opts.config;
    if (c?.defaultUnit) await this.load(c.manifestUrl, c.defaultUnit, { asDefault: true });
  }

  /**
   * Maps loadouts to their body asset. With a configured manifest, every body id the manifest has as a baked
   * character is loaded; ids it does not have stay on the placeholder without a warning (art arrives gradually).
   */
  async setLoadouts(loadouts: readonly LoadoutVisuals[]): Promise<void> {
    this.typesByAsset.clear();
    for (const l of loadouts) {
      const id = l.visuals.meshSlots[BODY_SLOT];
      if (!id) continue;
      const list = this.typesByAsset.get(id) ?? [];
      list.push(unitTypeId(l.id));
      this.typesByAsset.set(id, list);
    }
    const loads: Promise<unknown>[] = [];
    for (const [assetId, typeIds] of this.typesByAsset) {
      const loaded = [...this.entries.values()].find((e) => e.status.assetId === assetId && e.status.state !== 'failed');
      if (loaded) {
        loads.push(loaded.rig.then((rig) => this.assign(loaded.status, typeIds, rig)));
        continue;
      }
      const c = this.opts.config;
      if (!c) continue;
      loads.push(
        this.loader.has(c.manifestUrl, assetId).then(
          (has) => (has ? this.load(c.manifestUrl, assetId) : null),
          () => null, // no manifest yet: placeholder for everyone
        ),
      );
    }
    await Promise.all(loads);
  }

  private assign(status: UnitAssetStatus, typeIds: readonly number[], rig: number | null): void {
    if (rig === null || this.disposed) return;
    this.layer.assignRig(typeIds, rig);
    for (const t of typeIds) if (!status.typeIds.includes(t)) status.typeIds.push(t);
  }

  /** Loads (once per manifest and id) and puts it to use. Never rejects: a failure is a status, not an exception. */
  load(manifestUrl: string, assetId: string, opts: UnitAssetOptions = {}): Promise<UnitAssetStatus> {
    const key = `${manifestUrl}#${assetId}`;
    let entry = this.entries.get(key);
    if (!entry || entry.status.state === 'failed') {
      const status: UnitAssetStatus = { assetId, manifestUrl, state: 'loading', typeIds: [] };
      const teamMask = opts.teamMask ?? this.opts.config?.teamMask;
      const rig = this.loader.load(manifestUrl, assetId, teamMask ? { teamMask } : {}).then(
        (asset) => {
          if (this.disposed) return null;
          const edge = Math.max(asset.anims.width, asset.anims.height);
          if (edge > this.opts.maxTextureSize) throw new Error(`bone texture ${asset.anims.width} x ${asset.anims.height} exceeds the GPU limit of ${this.opts.maxTextureSize}`);
          const lod0 = asset.lods[0];
          const rigIndex = this.layer.addRig({
            name: assetId,
            anims: asset.anims,
            lods: [lod0.geometry, asset.lods[1].geometry, asset.lods[2].geometry],
            albedo: { map: lod0.map, maskFromMapAlpha: (teamMask ?? 'materialName') === 'diffuseAlpha' },
          });
          status.state = 'ready';
          status.triangles = [lod0.triangles, asset.lods[1].triangles, asset.lods[2].triangles];
          if (lod0.textureCount > 1) this.opts.warn?.(`unit asset "${assetId}": ${lod0.textureCount} diffuse textures, only the first is used (one atlas per draw)`);
          return rigIndex;
        },
      );
      entry = {
        status,
        rig: rig.catch((err: unknown) => {
          status.state = 'failed';
          status.reason = err instanceof Error ? err.message : String(err);
          this.opts.warn?.(`unit asset "${assetId}" not loaded, placeholder stays: ${status.reason}`);
          return null;
        }),
      };
      this.entries.set(key, entry);
    }
    const { status, rig } = entry;
    return rig.then((index) => {
      if (index !== null && !this.disposed) {
        this.assign(status, this.typesByAsset.get(assetId) ?? [], index);
        if (opts.asDefault) this.layer.setDefaultRig(index);
      }
      return status;
    });
  }

  statuses(): UnitAssetStatus[] {
    return [...this.entries.values()].map((e) => ({ ...e.status, typeIds: [...e.status.typeIds] }));
  }

  dispose(): void {
    this.disposed = true;
  }
}

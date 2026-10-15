// Which unit is drawn rigid (a robot) and with which asset. Data, never code: a loadout's `visuals.meshSlots.body`
// names a manifest id, and when the manifest lists that id as a rigid unit (`rigid: true`, rigidUnitManifest.ts) the
// rigid layer takes the loadout's unit typeId; any other body id stays with the skinned registry (unitAssets.ts).
// Extra bindings (UnitAssetConfig.bind) work for rigid assets too. An asset that fails to load, or a body id the
// manifest does not have, is a status with a reason and the unit stays on the humanoid rig.
import { unitTypeId } from '@crawlout/data';
import type { Rasterize } from '../structures/textureArray.js';
import type { LoadoutVisuals, UnitAssetConfig } from './unitAssets.js';
import { BODY_SLOT } from './unitAssets.js';
import type { UnitAssetLoader } from './unitAssetLoader.js';
import type { RigidUnitLayer } from './rigidUnitLayer.js';

/** Pulls rigid art towards the wasteland grey like the props, a little less than the props (their tints matter). */
export const RIGID_GRADE = 0.1;

export interface RigidUnitStatus {
  assetId: string;
  manifestUrl: string;
  state: 'loading' | 'ready' | 'failed';
  /** Why it failed (the humanoid stays), or a note on a ready asset. */
  reason?: string;
  /** Unit typeIds drawn with it. */
  typeIds: number[];
  /** Triangles per LOD when ready. */
  triangles?: [number, number, number];
  /** Model height and hover height in meters when ready. */
  height?: number;
  hover?: number;
}

type Target = Pick<RigidUnitLayer, 'addAsset' | 'assign'>;

interface Entry {
  status: RigidUnitStatus;
  asset: Promise<number | null>;
}

export class RigidUnitRegistry {
  private readonly entries = new Map<string, Entry>();
  /** typeIds per body asset id, from the loadouts. */
  private readonly typesByAsset = new Map<string, number[]>();
  private disposed = false;

  constructor(
    private readonly layer: Target,
    private readonly loader: UnitAssetLoader,
    private readonly opts: {
      config?: UnitAssetConfig | undefined;
      maxTextureSize: number;
      warn?: (message: string) => void;
      /** Brightness factor on an asset's albedo (renderer option albedoGain). */
      albedoGain?: (assetId: string) => number | undefined;
      rasterize?: Rasterize;
    },
  ) {}

  /** Asset ids of the manifest that are rigid units (the skinned registry leaves these alone); empty without a manifest. */
  async rigidIds(manifestUrl: string): Promise<ReadonlySet<string>> {
    try {
      return new Set((await this.loader.rigidEntries(manifestUrl)).keys());
    } catch {
      return new Set();
    }
  }

  /** Loads the configured bindings that are rigid assets. */
  async start(): Promise<void> {
    const c = this.opts.config;
    if (!c?.bind) return;
    const rigid = await this.rigidIds(c.manifestUrl);
    await Promise.all(
      Object.keys(c.bind)
        .filter((id) => rigid.has(id))
        .map((id) => this.load(c.manifestUrl, id)),
    );
  }

  private typesOf(assetId: string): number[] {
    return [
      ...(this.typesByAsset.get(assetId) ?? []),
      ...(this.opts.config?.bind?.[assetId] ?? []),
    ];
  }

  /** Maps loadouts to their body asset and loads the ones the manifest has as rigid units. */
  async setLoadouts(loadouts: readonly LoadoutVisuals[]): Promise<void> {
    this.typesByAsset.clear();
    for (const l of loadouts) {
      const id = l.visuals.meshSlots[BODY_SLOT];
      if (!id) continue;
      const list = this.typesByAsset.get(id) ?? [];
      list.push(unitTypeId(l.id));
      this.typesByAsset.set(id, list);
    }
    const c = this.opts.config;
    if (!c) return;
    const rigid = await this.rigidIds(c.manifestUrl);
    await Promise.all(
      [...this.typesByAsset.keys()]
        .filter((assetId) => rigid.has(assetId))
        .map((assetId) => this.load(c.manifestUrl, assetId)),
    );
  }

  private assign(status: RigidUnitStatus, typeIds: readonly number[], asset: number | null): void {
    if (asset === null || this.disposed) return;
    this.layer.assign(typeIds, asset);
    for (const t of typeIds) if (!status.typeIds.includes(t)) status.typeIds.push(t);
  }

  /** Loads (once per manifest and id) and puts it to use for its loadouts and bindings, plus `extraTypeIds`. Never rejects: a failure is a status, not an exception. */
  load(
    manifestUrl: string,
    assetId: string,
    extraTypeIds: readonly number[] = [],
  ): Promise<RigidUnitStatus> {
    const key = `${manifestUrl}#${assetId}`;
    let entry = this.entries.get(key);
    if (!entry || entry.status.state === 'failed') {
      const status: RigidUnitStatus = { assetId, manifestUrl, state: 'loading', typeIds: [] };
      const asset = this.loader
        .loadRigid(manifestUrl, assetId, {
          ...(this.opts.rasterize ? { rasterize: this.opts.rasterize } : {}),
          maxLayerSize: this.opts.maxTextureSize,
        })
        .then((loaded) => {
          if (this.disposed) {
            loaded.layers?.dispose();
            return null;
          }
          const index = this.layer.addAsset({
            name: assetId,
            lods: loaded.lods,
            height: loaded.height,
            width: loaded.width,
            reach: loaded.reach,
            hover: loaded.entry.hover,
            layers: loaded.layers,
            layerLuma: loaded.layerLuma,
            gain: this.opts.albedoGain?.(assetId) ?? loaded.entry.albedoGain ?? 1,
            grade: RIGID_GRADE,
          });
          status.state = 'ready';
          status.triangles = loaded.triangles;
          status.height = loaded.height;
          status.hover = loaded.entry.hover;
          const notes: string[] = [];
          if (loaded.warning) notes.push(loaded.warning);
          if (loaded.teamVertices === 0) notes.push('no team material: no team color on the model');
          if (notes.length > 0) status.reason = notes.join('; ');
          return index;
        });
      entry = {
        status,
        asset: asset.catch((err: unknown) => {
          status.state = 'failed';
          status.reason = err instanceof Error ? err.message : String(err);
          this.opts.warn?.(
            `rigid unit asset "${assetId}" not loaded, the humanoid stays: ${status.reason}`,
          );
          return null;
        }),
      };
      this.entries.set(key, entry);
    }
    const { status, asset } = entry;
    return asset.then((index) => {
      this.assign(status, [...this.typesOf(assetId), ...extraTypeIds], index);
      return status;
    });
  }

  /** Adds an asset that is already in memory (synthetic robots of the demo and the tests) and assigns its typeIds. */
  addLoaded(
    assetId: string,
    source: Parameters<Target['addAsset']>[0],
    typeIds: readonly number[],
  ): RigidUnitStatus {
    const index = this.layer.addAsset(source);
    const status: RigidUnitStatus = {
      assetId,
      manifestUrl: '',
      state: 'ready',
      typeIds: [],
      height: source.height,
      hover: source.hover ?? 0,
    };
    this.entries.set(`memory#${assetId}`, { status, asset: Promise.resolve(index) });
    this.assign(status, typeIds, index);
    return status;
  }

  statuses(): RigidUnitStatus[] {
    return [...this.entries.values()].map((e) => ({ ...e.status, typeIds: [...e.status.typeIds] }));
  }

  dispose(): void {
    this.disposed = true;
  }
}

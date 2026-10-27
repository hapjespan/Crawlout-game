// createRenderer setup, stage 3: asset loaders and registries, pipeline warm-up, structures, props, VFX and camera.
import { uniform } from 'three/tsl';
import { ALBEDO_GAIN_RANGE } from '@crawlout/asset-cli/manifest';
import { RtsCameraController } from './camera/rtsCamera.js';
import { FootprintTable } from './entities/footprint.js';
import { markMapKnowledge } from './fog/fogOfWar.js';
import { SUN_DIR } from './lighting/lightRig.js';
import { forceDrawable } from './perf/warmDraw.js';
import { PropAssetRegistry } from './props/propAssets.js';
import { PropLayer } from './props/propLayer.js';
import { windOf } from './props/propWind.js';
import { isTree, type PropCategory } from './props/propCategory.js';
import {
  buildingMeshes,
  loadBuildingAssets,
  type BuildingVisual,
} from './structures/buildingAssets.js';
import { surfaceKindOfCategory } from './look/surfaces.js';
import { createPropMaterial } from './structures/propMaterial.js';
import { DEFAULT_LAYER_SIZE } from './structures/textureArray.js';
import { StructureLayer } from './structures/structureLayer.js';
import { resolveManifestPath, UnitAssetLoader, createGltfIO } from './units/unitAssetLoader.js';
import { UnitAssetRegistry } from './units/unitAssets.js';
import { DEFAULT_LIGHT_DIR } from './units/unitLayer.js';
import { VegetationLayer } from './vegetation/vegetationLayer.js';
import { OcclusionField, type OcclusionSampler } from './occlusion/occlusionField.js';
import { AttachmentRegistry } from './units/attachmentAssets.js';
import { RigidUnitRegistry } from './units/rigidUnitAssets.js';
import { AbilityZones } from './vfx/abilityZones.js';
import { EffectSpawner } from './vfx/effects.js';
import { ParticlePool } from './vfx/particles.js';
import type { SceneStage } from './renderer.scene.js';

const PARTICLES_PER_POOL = 4096;

export function setupAssets(c: SceneStage) {
  const { opts, state, gpu, caps, capacity, shadowsOn, scene, camera, time, sun, terrain } = c;
  const { units, rigid, screen, propBlobs, canvas } = c;
  const assetConfig = opts.assets;
  const gltfIO = createGltfIO();
  const resolveAssetPath = (manifestUrl: string, path: string): string =>
    assetConfig?.resolveUrl && manifestUrl === assetConfig.manifestUrl
      ? assetConfig.resolveUrl(path)
      : resolveManifestPath(manifestUrl, path);
  const loader = new UnitAssetLoader(gltfIO, resolveAssetPath);
  const gainOf = (assetId: string): number | undefined => {
    const g = opts.albedoGain?.[assetId];
    return g === undefined || !Number.isFinite(g)
      ? undefined
      : Math.min(ALBEDO_GAIN_RANGE[1], Math.max(ALBEDO_GAIN_RANGE[0], g));
  };
  const attachments = new AttachmentRegistry(
    units,
    {
      manifest: (url) => loader.manifest(url),
      fetchBytes: (url) => gltfIO.fetchBytes(url),
      parseGltf: (bytes, url) => gltfIO.parseGltf(bytes, url),
    },
    {
      manifestUrl: assetConfig?.manifestUrl,
      resolveUrl: resolveAssetPath,
      warn: (message) => console.warn(`[render] ${message}`),
    },
  );
  const unitAssets = new UnitAssetRegistry(units, loader, {
    config: assetConfig,
    maxTextureSize: caps.maxTextureSize,
    warn: (message) => console.warn(`[render] ${message}`),
    albedoGain: gainOf,
    rigidIds: (url) => rigidUnits.rigidIds(url),
    onRigLoaded: (info) => attachments.rigLoaded(info),
  });
  const rigidUnits = new RigidUnitRegistry(rigid, loader, {
    config: assetConfig,
    maxTextureSize: caps.maxTextureSize,
    warn: (message) => console.warn(`[render] ${message}`),
    albedoGain: gainOf,
  });
  // Everything in the scene, also what is hidden or off screen now, is made ready once loading settles; otherwise the
  // first sight of a building type on the far side of a large map, a unit LOD, a hero or a prop variant costs a frame
  // of 50 to 250 ms. Two steps: compileAsync links the programs (it walks the scene synchronously when called, so the
  // flip is undone before the next frame renders), then one warm draw (perf/warmDraw.ts) of everything with an instance
  // each, run inside the next frame just before its real draw, so the driver builds its pipeline states, vertex arrays,
  // texture uploads and the shadow-depth programs now. It is not presented: the real draw follows in the same task.
  const warmUp = async (): Promise<void> => {
    const restore = forceDrawable(scene);
    const done = gpu.compileAsync(scene, camera);
    restore();
    await done;
    state.warmDrawPending = opts.warmDraw !== false;
  };
  const scheduleWarmUp = (): void => {
    clearTimeout(state.warmTimer);
    state.warmTimer = setTimeout(() => {
      warmUp().catch((err: unknown) => console.warn('[render] pipeline warm-up failed', err));
    }, 250);
  };
  void Promise.all([unitAssets.start(), rigidUnits.start()]).then(scheduleWarmUp);
  const footprints = new FootprintTable(opts.buildingFootprint ?? null);
  const structures = new StructureLayer(scene, {
    capacity,
    footprints,
    heightAt: (x, z) => terrain.heightAt(x, z),
    castShadows: shadowsOn,
    screen,
    ...(opts.lodPixels?.buildings ? { lodPixels: opts.lodPixels.buildings } : {}),
    materials: {
      building: createPropMaterial({
        lightDir: DEFAULT_LIGHT_DIR,
        name: 'crawlout-building-toon',
        shadow: sun,
      }),
      // Scrap heaps and claim points are map knowledge: they keep the explored look in the unexplored dark.
      scrap: markMapKnowledge(
        createPropMaterial({
          lightDir: DEFAULT_LIGHT_DIR,
          name: 'crawlout-scrap-toon',
          surface: 'rustMetal',
          shadow: sun,
        }),
      ),
      claim: markMapKnowledge(
        createPropMaterial({
          lightDir: DEFAULT_LIGHT_DIR,
          name: 'crawlout-claim-toon',
          time,
          surface: 'paintedMetal',
          shadow: sun,
        }),
      ),
    },
  });
  const windStrength = uniform(opts.props?.wind === false ? 0 : 1);
  // Trees and tall structures give way to the units behind them, plants as the low occluders.
  const occlusion = new OcclusionField();
  const occlusionOf = (category: PropCategory): OcclusionSampler | undefined =>
    isTree(category) || category === 'structure'
      ? occlusion.sampler(0)
      : category === 'plant'
        ? occlusion.sampler(1)
        : undefined;
  const props = new PropLayer(scene, {
    ...opts.props,
    maxBlobs: propBlobs,
    screen,
    ...(opts.lodPixels?.props ? { lodPixels: opts.lodPixels.props } : {}),
    ...(opts.lodPixels?.trees ? { treeLodPixels: opts.lodPixels.trees } : {}),
    shadow: sun ? { smallProps: sun.settings.smallProps, sunDir: SUN_DIR } : null,
    heightAt: (x, z) => terrain.heightAt(x, z),
    material: ({ map, layers, mask, category, height }) => {
      const wind = windOf(category);
      const fade = occlusionOf(category);
      return createPropMaterial({
        lightDir: DEFAULT_LIGHT_DIR,
        name: mask ? 'crawlout-prop-toon-mask' : 'crawlout-prop-toon',
        shadow: sun,
        map,
        layers,
        surface: surfaceKindOfCategory(category),
        alphaMask: mask,
        ...(mask && category === 'tree-leafy' && height > 1e-4 ? { crown: height } : {}),
        ...(wind && height > 1e-4
          ? { wind: { ...wind, height, time, strength: windStrength } }
          : {}),
        ...(fade ? { occlusion: fade } : {}),
      });
    },
  });
  const vegetation = new VegetationLayer(scene, {
    lightDir: DEFAULT_LIGHT_DIR,
    shadow: sun,
    time,
    windStrength,
    heightAt: (x, z) => terrain.heightAt(x, z),
    castShadows: shadowsOn,
    occlusion: occlusion.sampler(1),
  });
  const propRegistry = new PropAssetRegistry({
    manifest: (url) => loader.manifest(url),
    fetchBytes: (url) => gltfIO.fetchBytes(url),
    parseGltf: (bytes, url) => gltfIO.parseGltf(bytes, url),
  });
  const loadBuildings = async (buildings: Parameters<typeof buildingMeshes>[0]): Promise<void> => {
    const generation = ++state.buildingGeneration;
    const manifestUrl = assetConfig?.manifestUrl;
    if (!manifestUrl || opts.buildingAssets === false) {
      state.buildingStatuses = [];
      structures.setBuildingAssets(new Map(), null);
      return;
    }
    const meshes = buildingMeshes(buildings);
    state.buildingStatuses = [...new Set(meshes.values())].map((assetId) => ({
      assetId,
      buildingIds: [...meshes].filter(([, a]) => a === assetId).map(([id]) => id),
      state: 'loading',
    }));
    const set = await loadBuildingAssets(
      {
        manifest: (url) => loader.manifest(url),
        fetchBytes: (url) => gltfIO.fetchBytes(url),
        parseGltf: (bytes, url) => gltfIO.parseGltf(bytes, url),
      },
      manifestUrl,
      resolveAssetPath,
      meshes,
      { maxLayerSize: Math.min(DEFAULT_LAYER_SIZE, caps.maxTextureSize) },
    );
    const disposeSet = (): void => {
      for (const v of set.visuals.values()) for (const g of new Set(v.lods)) g.dispose();
    };
    if (generation !== state.buildingGeneration) {
      disposeSet();
      set.layers?.dispose();
      return;
    }
    state.buildingStatuses = set.statuses;
    for (const st of set.statuses)
      if (st.state === 'failed' && st.reason !== 'not in the manifest')
        console.warn(`[render] building "${st.assetId}": ${st.reason}`);
    const byBuilding = new Map<number, BuildingVisual>();
    for (const v of set.visuals.values()) {
      const g = gainOf(v.assetId);
      if (g !== undefined) v.gain = g;
    }
    for (const [buildingId, assetId] of meshes) {
      const v = set.visuals.get(assetId);
      if (v) byBuilding.set(buildingId, v);
    }
    state.buildingLayers?.dispose();
    state.buildingLayers = set.layers;
    structures.setBuildingAssets(
      byBuilding,
      byBuilding.size === 0
        ? null
        : createPropMaterial({
            lightDir: DEFAULT_LIGHT_DIR,
            name: 'crawlout-building-asset-toon',
            shadow: sun,
            layers: set.layers,
            layerLuma: set.layerLuma,
            layerKinds: set.layerKinds,
            reveal: true,
          }),
    );
    disposeSet(); // the structure layer drew its own copies
    scheduleWarmUp();
  };
  const additive = new ParticlePool(scene, PARTICLES_PER_POOL, time, true);
  const smoke = new ParticlePool(scene, PARTICLES_PER_POOL, time, false);
  const zones = new AbilityZones();
  const effects = new EffectSpawner(additive, smoke, Math.random, zones);
  const controls = new RtsCameraController(camera, canvas, {
    heightAt: (x, z) => terrain.heightAt(x, z),
    ...opts.camera,
  });
  return {
    ...c,
    assetConfig,
    resolveAssetPath,
    gainOf,
    attachments,
    unitAssets,
    rigidUnits,
    scheduleWarmUp,
    footprints,
    structures,
    windStrength,
    props,
    vegetation,
    occlusion,
    propRegistry,
    loadBuildings,
    additive,
    smoke,
    zones,
    effects,
    controls,
  };
}
export type AssetStage = ReturnType<typeof setupAssets>;

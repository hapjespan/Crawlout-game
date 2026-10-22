// createRenderer setup, first stages: the shared mutable state, the GPU backend and the scene with its base layers.
import { MAX_ENTITIES } from '@crawlout/protocol';
import {
  PCFShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  TextureLoader,
  WebGPURenderer,
  type DataTexture,
  type Texture,
} from 'three/webgpu';
import { uniform } from 'three/tsl';
import { DecalLayer } from './decals/decalLayer.js';
import {
  pickDataTexturePrecision,
  probeWebGL2DataTextureCaps,
  WEBGPU_DATA_TEXTURE_CAPS,
} from './gpu/dataTextures.js';
import { ScreenLod } from './lod/screenLod.js';
import { createFogOfWar } from './fog/fogOfWar.js';
import { createAtmosphere } from './lighting/atmosphere.js';
import { TONE_EXPOSURE, TONE_MAPPING } from './lighting/lightRig.js';
import { defaultShadowQuality, SunShadow, type ShadowQuality } from './shadows/sunShadow.js';
import type { PropAssetStatus } from './props/propAssets.js';
import type { RenderProp } from './props/propLayer.js';
import type { BuildingAssetStatus } from './structures/buildingAssets.js';
import { TerrainLayer } from './terrain/terrainLayer.js';
import { TerrainSkirt } from './terrain/terrainSkirt.js';
import {
  loadTerrainTextures,
  type TerrainTextureOptions,
  type TerrainTextureStatus,
} from './terrain/terrainTextures.js';
import { bakeAnimations } from './units/bake.js';
import { DEFAULT_LIGHT_DIR, UnitLayer } from './units/unitLayer.js';
import { RigidUnitLayer } from './units/rigidUnitLayer.js';
import type { AbilityLookup } from './vfx/abilityZones.js';
import { WaterLayer } from './water/waterLayer.js';
import type { WaterMask } from './water/waterMask.js';
import type {
  CreateRendererOptions,
  PlacementPreview,
  RenderBackend,
  WaterInfo,
} from './renderer.types.js';

/** Height-texture edge the decals may need (terrain/heightTexture.ts caps at 512). */
const HEIGHT_TEXTURE_EDGE = 512;
/** Default most prop blob shadows, on top of the entity decals. */
const PROP_BLOBS = 768;

/** The variables of createRenderer that change after setup; every stage and the renderer object share this one. */
export interface RendererState {
  inspectedIds: ReadonlySet<number>;
  /** The terrain's height range: the slab the shadow camera is fitted over. */
  groundLo: number;
  groundHi: number;
  terrainTexture: Texture | null;
  terrainGeneration: number;
  warmTimer: ReturnType<typeof setTimeout> | undefined;
  warmDrawPending: boolean;
  warmDraws: number;
  buildingStatuses: BuildingAssetStatus[];
  buildingGeneration: number;
  buildingLayers: { dispose(): void } | null;
  propStatuses: Map<string, PropAssetStatus>;
  propGeneration: number;
  abilities: AbilityLookup | null;
  waterMask: WaterMask | null;
  waterInfo: WaterInfo | null;
  grassTexture: DataTexture | null;
  grassProps: readonly RenderProp[];
  preview: PlacementPreview | null;
  last: number;
}

export function newRendererState(): RendererState {
  return {
    inspectedIds: new Set(),
    groundLo: 0,
    groundHi: 0,
    terrainTexture: null,
    terrainGeneration: 0,
    warmTimer: undefined,
    warmDrawPending: false,
    warmDraws: 0,
    buildingStatuses: [],
    buildingGeneration: 0,
    buildingLayers: null,
    propStatuses: new Map<string, PropAssetStatus>(),
    propGeneration: 0,
    abilities: null,
    waterMask: null,
    waterInfo: null,
    grassTexture: null,
    grassProps: [],
    preview: null,
    last: 0,
  };
}

/** Stage 1: the WebGPU renderer (or its WebGL2 fallback), data texture precision and shadow settings. */
export async function setupGpu(opts: CreateRendererOptions, state: RendererState) {
  const { canvas } = opts;
  const capacity = opts.capacity ?? MAX_ENTITIES;
  const gpu = new WebGPURenderer({ canvas, antialias: true, forceWebGL: opts.forceWebGL ?? false });
  await gpu.init();
  const backend: RenderBackend = (gpu.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend
    ? 'webgpu'
    : 'webgl2';

  const anims = bakeAnimations();
  const caps: { float32: boolean; maxTextureSize: number } =
    backend === 'webgpu'
      ? WEBGPU_DATA_TEXTURE_CAPS
      : (probeWebGL2DataTextureCaps() ?? { float32: true, maxTextureSize: 4096 });
  const force = opts.dataTextures && opts.dataTextures !== 'auto' ? opts.dataTextures : undefined;
  const precision = pickDataTexturePrecision(
    caps,
    Math.max(anims.width, anims.height, HEIGHT_TEXTURE_EDGE),
    force,
  );

  const shadowQuality: ShadowQuality | null =
    opts.shadows === false
      ? null
      : opts.shadows === 'low' || opts.shadows === 'high'
        ? opts.shadows
        : defaultShadowQuality(backend);
  const shadowsOn = shadowQuality !== null;
  gpu.shadowMap.enabled = shadowsOn;
  // r186: PCF is the soft one (Vogel disk + noise over hardware compares; PCFSoftShadowMap was folded into it).
  gpu.shadowMap.type = PCFShadowMap;
  // One tone mapping for everything, applied in the output pass (lighting/lightRig.ts).
  gpu.toneMapping = TONE_MAPPING;
  gpu.toneMappingExposure = TONE_EXPOSURE;
  return {
    opts,
    state,
    canvas,
    capacity,
    gpu,
    backend,
    anims,
    caps,
    precision,
    shadowQuality,
    shadowsOn,
  };
}
export type GpuStage = Awaited<ReturnType<typeof setupGpu>>;

/** Stage 2: scene, atmosphere, camera, sun, terrain, water, skirt, decals and the unit layers. */
export function setupScene(g: GpuStage) {
  const { opts, state, capacity, precision, shadowQuality, anims } = g;
  const scene = new Scene();
  // Gradient sky and a fog of its horizon colour (lighting/atmosphere.ts).
  // The fog of war rides in the atmosphere's fog node: every material gets it without a draw call of its own.
  const fogOfWar = createFogOfWar();
  const atmosphere = createAtmosphere(fogOfWar);
  scene.backgroundNode = atmosphere.backgroundNode;
  scene.fogNode = atmosphere.fogNode;
  const camera = new PerspectiveCamera(45, 1, 0.5, 800);
  const time = uniform(0);
  const clockStart = performance.now();
  const clock = (now: number): number => (now - clockStart) / 1000;

  const sun = shadowQuality ? new SunShadow(scene, DEFAULT_LIGHT_DIR, shadowQuality) : null;
  const terrain = new TerrainLayer(scene, DEFAULT_LIGHT_DIR, {
    shadow: sun,
    precision,
    ...(opts.terrainDetail ? { detail: opts.terrainDetail } : {}),
    ...(opts.terrainChunks ? { chunks: opts.terrainChunks } : {}),
  });
  const water = new WaterLayer(scene, { lightDir: DEFAULT_LIGHT_DIR, time, shadow: sun?.factor });
  const skirt = new TerrainSkirt(scene, terrain.material);
  const setTerrainTextures = async (
    textures: TerrainTextureOptions,
  ): Promise<TerrainTextureStatus> => {
    const generation = ++state.terrainGeneration;
    const { texture, status } = await loadTerrainTextures(textures, {
      fetchText: async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      },
      loadTexture: async (url) => {
        const t = await new TextureLoader().loadAsync(url);
        t.colorSpace = SRGBColorSpace;
        t.anisotropy = 8;
        return t;
      },
    });
    if (generation !== state.terrainGeneration) {
      texture?.dispose();
      return status;
    }
    terrain.setTints(status.rockTint, status.groundTint);
    if (status.tileSize) terrain.setAlbedoTileSize(status.tileSize);
    terrain.setAlbedo(texture);
    state.terrainTexture?.dispose();
    state.terrainTexture = texture;
    if (status.state === 'failed') console.warn(`[render] terrain textures: ${status.reason}`);
    return status;
  };
  if (opts.terrainTextures) void setTerrainTextures(opts.terrainTextures);
  const propBlobs = opts.props?.maxBlobs ?? PROP_BLOBS;
  const decals = new DecalLayer(scene, capacity + 64 + propBlobs);
  // Screen-size LOD shared by units, buildings and props: the drawing buffer height and the camera's fov.
  const screen = new ScreenLod();
  const units = new UnitLayer(scene, {
    capacity,
    lightDir: DEFAULT_LIGHT_DIR,
    precision,
    anims,
    screen,
    shadow: sun,
    ...(opts.lodPixels?.units ? { lodPixels: opts.lodPixels.units } : {}),
  });
  const rigid = new RigidUnitLayer(scene, {
    capacity,
    lightDir: DEFAULT_LIGHT_DIR,
    screen,
    shadow: sun,
    ...(opts.lodPixels?.units ? { lodPixels: opts.lodPixels.units } : {}),
  });
  units.setSkip((typeId) => rigid.owns(typeId)); // the robots are the rigid layer's
  return {
    ...g,
    scene,
    fogOfWar,
    atmosphere,
    camera,
    time,
    clock,
    sun,
    terrain,
    water,
    skirt,
    setTerrainTextures,
    propBlobs,
    decals,
    screen,
    units,
    rigid,
  };
}
export type SceneStage = ReturnType<typeof setupScene>;

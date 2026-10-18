// Public entry point: createRenderer({ canvas }). The renderer reads snapshots only, never sim state (contract 1).
// The setup runs in stages (renderer.scene.ts, renderer.assets.ts, renderer.frame.ts) that share one context object
// and one mutable state; renderer.api.ts builds the returned renderer from their closures.
import { ALBEDO_GAIN_RANGE } from '@crawlout/asset-cli/manifest';
import { buildRendererApi } from './renderer.api.js';
import { setupAssets } from './renderer.assets.js';
import { setupFrame, setupTerrain } from './renderer.frame.js';
import { newRendererState, setupGpu, setupScene } from './renderer.scene.js';
import type { CrawloutRenderer, CreateRendererOptions } from './renderer.types.js';

export type {
  CrawloutRenderer,
  CreateRendererOptions,
  LayerStats,
  PickResult,
  PlacementPreview,
  RenderBackend,
  SetTerrainOptions,
  WaterInfo,
} from './renderer.types.js';

/** Allowed albedoGain values (the manifest field has the same range). */
export { ALBEDO_GAIN_RANGE };

export async function createRenderer(opts: CreateRendererOptions): Promise<CrawloutRenderer> {
  const gpuStage = await setupGpu(opts, newRendererState());
  const sceneStage = setupScene(gpuStage);
  const assetStage = setupAssets(sceneStage);
  const terrainStage = setupTerrain(assetStage);
  const frameStage = setupFrame(terrainStage);
  await frameStage.gpu.setAnimationLoop(frameStage.loop);
  return buildRendererApi(frameStage);
}

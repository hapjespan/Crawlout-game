// Public entry point: createRenderer({ canvas }). The renderer reads snapshots only, never sim state (contract 1).
import { MAX_ENTITIES, UNITS_PER_METER } from '@crawlout/protocol';
import { Color, Matrix4, PerspectiveCamera, Plane, Raycaster, Scene, Vector2, Vector3, WebGPURenderer } from 'three/webgpu';
import { RtsCameraController, type RtsCameraOptions } from './camera/rtsCamera.js';
import { PerfMeter, PerfOverlay, type FrameStats } from './perf/perfOverlay.js';
import { pickEntity, selectInRect, type BoxSelectOptions, type ScreenRect } from './picking/selection.js';
import { createInterpolatedFrame, SnapshotInterpolator } from './snapshot/interpolate.js';
import { createGridTerrain, type TerrainGeometry } from './terrain/heightField.js';
import { TerrainLayer } from './terrain/terrainLayer.js';
import { DEFAULT_LIGHT_DIR, UnitLayer } from './units/unitLayer.js';

export type RenderBackend = 'webgpu' | 'webgl2';

export interface CreateRendererOptions {
  canvas: HTMLCanvasElement;
  /** Skip WebGPU and use the WebGL2 backend. WebGL2 is also used automatically when WebGPU is unavailable. */
  forceWebGL?: boolean;
  /** Stats overlay: true mounts it in the canvas' parent, an element mounts it there, false hides it. Default true. */
  stats?: boolean | HTMLElement;
  /** Device pixel ratio cap. Default 2. */
  maxPixelRatio?: number;
  camera?: RtsCameraOptions;
  /** Entity capacity per batch. Default MAX_ENTITIES. */
  capacity?: number;
}

export interface PickResult {
  /** Entity id under the cursor, or null. */
  entityId: number | null;
  /** Ground point under the cursor in sim units (1 m = 256), or null when the ray misses the ground. */
  ground: { x: number; y: number } | null;
}

export interface CrawloutRenderer {
  readonly backend: RenderBackend;
  readonly cameraControls: RtsCameraController;
  /** Hands over one snapshot buffer (contract 1). The renderer keeps a reference: do not reuse the buffer. */
  pushSnapshot(buf: ArrayBuffer): void;
  /** Replaces the terrain. Arrays are kept, not copied. */
  setTerrain(geometry: TerrainGeometry): void;
  /** What lies under canvas-local CSS pixel (x, y). */
  pickAt(x: number, y: number): PickResult;
  /** Entity ids inside a canvas-local CSS pixel rectangle. */
  boxSelect(rect: ScreenRect, opts?: BoxSelectOptions): number[];
  /** Centers the camera on a sim position (sim units). */
  focus(x: number, y: number): void;
  /** Latest measured frame stats. */
  stats(): FrameStats;
  dispose(): void;
}

function createOverlay(stats: boolean | HTMLElement, canvas: HTMLCanvasElement): PerfOverlay | null {
  if (stats === false) return null;
  const parent = stats instanceof HTMLElement ? stats : canvas.parentElement;
  return parent ? new PerfOverlay(parent) : null;
}

export async function createRenderer(opts: CreateRendererOptions): Promise<CrawloutRenderer> {
  const { canvas } = opts;
  const capacity = opts.capacity ?? MAX_ENTITIES;
  const gpu = new WebGPURenderer({ canvas, antialias: true, forceWebGL: opts.forceWebGL ?? false });
  await gpu.init();
  const backend: RenderBackend = (gpu.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';

  const scene = new Scene();
  scene.background = new Color(0x8fa3a8);
  const camera = new PerspectiveCamera(45, 1, 0.5, 800);

  const terrain = new TerrainLayer(scene, DEFAULT_LIGHT_DIR);
  const units = new UnitLayer(scene, { capacity, lightDir: DEFAULT_LIGHT_DIR });
  const controls = new RtsCameraController(camera, canvas, { heightAt: (x, z) => terrain.heightAt(x, z), ...opts.camera });

  const setTerrain = (geometry: TerrainGeometry): void => {
    terrain.set(geometry);
    const hf = terrain.heightField;
    if (hf) {
      controls.bounds = { minX: hf.minX, maxX: hf.maxX, minZ: hf.minZ, maxZ: hf.maxZ };
      controls.focus(controls.target.x, controls.target.z);
    }
  };
  setTerrain(createGridTerrain(128, 128, 4));

  const interp = new SnapshotInterpolator();
  const frame = createInterpolatedFrame(capacity);

  const overlay = createOverlay(opts.stats ?? true, canvas);
  const meter = new PerfMeter(backend === 'webgpu' ? 'WebGPU' : 'WebGL2');

  const maxDpr = opts.maxPixelRatio ?? 2;
  const resize = (): void => {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    gpu.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    gpu.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);

  let last = performance.now();
  const loop = (): void => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    controls.update(dt);
    interp.sample(now, frame);
    for (let i = 0; i < frame.count; i++) frame.y[i] = terrain.heightAt(frame.x[i]!, frame.z[i]!);
    units.update(frame, camera);
    gpu.render(scene, camera);
    const info = gpu.info.render;
    if (meter.frame(now, performance.now() - now, info.drawCalls, info.triangles)) overlay?.show(meter.stats);
  };
  await gpu.setAnimationLoop(loop);

  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const groundPlane = new Plane(new Vector3(0, 1, 0), 0);
  const hitPoint = new Vector3();
  const viewProj = new Matrix4();

  return {
    backend,
    cameraControls: controls,
    pushSnapshot(buf) {
      interp.push(buf, performance.now());
    },
    setTerrain,
    pickAt(x, y) {
      ndc.set((x / Math.max(1, canvas.clientWidth)) * 2 - 1, -(y / Math.max(1, canvas.clientHeight)) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const { origin, direction } = raycaster.ray;
      const hit = pickEntity(frame, origin.x, origin.y, origin.z, direction.x, direction.y, direction.z);
      let ground: PickResult['ground'] = null;
      const mesh = terrain.object;
      const hits = mesh ? raycaster.intersectObject(mesh, false) : [];
      const p = hits[0]?.point ?? raycaster.ray.intersectPlane(groundPlane, hitPoint);
      if (p) ground = { x: Math.round(p.x * UNITS_PER_METER), y: Math.round(p.z * UNITS_PER_METER) };
      return { entityId: hit >= 0 ? frame.id[hit]! : null, ground };
    },
    boxSelect(rect, selectOpts) {
      viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      return selectInRect(frame, viewProj.elements, canvas.clientWidth, canvas.clientHeight, rect, selectOpts);
    },
    focus(x, y) {
      controls.focus(x / UNITS_PER_METER, y / UNITS_PER_METER);
    },
    stats: () => ({ ...meter.stats }),
    dispose() {
      void gpu.setAnimationLoop(null);
      resizeObserver.disconnect();
      controls.dispose();
      overlay?.dispose();
      units.dispose();
      terrain.dispose();
      interp.clear();
      gpu.dispose();
    },
  };
}

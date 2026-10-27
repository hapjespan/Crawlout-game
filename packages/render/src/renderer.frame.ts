// createRenderer setup, stages 4 and 5: terrain, water and grass mask, then the snapshot interpolation and frame loop.
import { UNITS_PER_METER } from '@crawlout/protocol';
import { DataTexture, LinearFilter, RGBAFormat } from 'three/webgpu';
import { DECAL_COLOR, DECAL_SHAPE, type DecalStyle } from './decals/decalLayer.js';
import { stampInspected } from './entities/inspected.js';
import { PerfMeter, PerfOverlay } from './perf/perfOverlay.js';
import { FrameProfiler } from './perf/frameProfile.js';
import { forceDrawable } from './perf/warmDraw.js';
import {
  createInterpolatedFrame,
  simYawToRender,
  SnapshotInterpolator,
} from './snapshot/interpolate.js';
import { propCategoryOf } from './props/propCategory.js';
import { buildGrassMask } from './terrain/grassMask.js';
import { buildGroundMap, createGroundMapTexture } from './terrain/groundMap.js';
import { scatterVegetation } from './vegetation/vegetationScatter.js';
import { createGridTerrain, type TerrainGeometry } from './terrain/heightField.js';
import type { PlatformSpec } from './terrain/terrainPlatforms.js';
import type { EffectContext } from './vfx/effects.js';
import { analyzeWater } from './water/waterMask.js';
import type { AssetStage } from './renderer.assets.js';
import type { SetTerrainOptions } from './renderer.types.js';

const PREVIEW_VALID: DecalStyle = {
  shape: DECAL_SHAPE.rect,
  shadow: 0,
  ring: 1,
  ringWidth: 0.14,
  fill: 0.3,
  grid: 0.55,
  color: DECAL_COLOR.valid,
};
const PREVIEW_INVALID: DecalStyle = { ...PREVIEW_VALID, color: DECAL_COLOR.invalid };

/** How far the ground map reaches past the map edge (m): the skirt beyond it continues the ground. */
const GROUND_MARGIN_M = 128;

/** Most milliseconds of a frame the foundations may take (terrain.setPlatforms); the rest waits for the next frame. */
const PLATFORM_BUDGET_MS = 3;

function createOverlay(
  stats: boolean | HTMLElement,
  canvas: HTMLCanvasElement,
): PerfOverlay | null {
  if (stats === false) return null;
  const parent = stats instanceof HTMLElement ? stats : canvas.parentElement;
  return parent ? new PerfOverlay(parent) : null;
}

/** Stage 4: water, grass mask and setTerrain, which lays down the default flat terrain. */
export function setupTerrain(c: AssetStage) {
  const { opts, state, terrain, water, decals, props, atmosphere, skirt, controls, camera } = c;
  const { scheduleWarmUp } = c;
  /** Lays the water mask over the current terrain: bed, surface, then everything that reads heights. */
  const applyWater = (): void => {
    const hf = terrain.heightField;
    state.waterInfo = null;
    const waterMask = state.waterMask;
    if (!waterMask || !hf) {
      terrain.setBed(null);
      water.set(null, () => 0);
      return;
    }
    const cell = (hf.maxX - hf.minX) / waterMask.w;
    const cellZ = (hf.maxZ - hf.minZ) / waterMask.h;
    if (Math.abs(cell - cellZ) > 0.01 * cell)
      console.warn(
        `[render] water mask ${waterMask.w}x${waterMask.h} does not fit the terrain's aspect; cells of ${cell} m`,
      );
    const surface = analyzeWater(
      waterMask,
      (x, z) => terrain.baseHeightAt(x, z),
      { minX: hf.minX, minZ: hf.minZ, cell },
      opts.water,
    );
    terrain.setBed(surface.cells > 0 ? surface.bed : null);
    water.set(surface, (x, z) => terrain.heightAt(x, z));
    state.waterInfo =
      surface.cells > 0
        ? { cells: surface.cells, shallowCells: surface.shallowCells, triangles: water.triangles }
        : null;
  };
  const afterHeights = (): void => {
    decals.setHeights(terrain.heightTexture);
    props.relayout();
    const hf = terrain.heightField;
    if (hf) [state.groundLo, state.groundHi] = hf.heightRange();
  };
  // Grass density mask over the terrain, from the grass and plant props (terrain/grassMask.ts).
  const applyGrassMask = (): void => {
    const hf = terrain.heightField;
    const mask = hf
      ? buildGrassMask(
          state.grassProps.map((p) => ({ asset: p.asset, x: p.x, y: p.y })),
          (asset) => props.categoryOf(asset) ?? propCategoryOf(asset),
          hf,
        )
      : null;
    state.grassTexture?.dispose();
    state.grassTexture = null;
    state.grassMask = mask;
    if (!mask) {
      terrain.setGrassMask(null);
      return;
    }
    const rgba = new Uint8Array(mask.w * mask.h * 4);
    for (let i = 0; i < mask.data.length; i++) rgba.fill(mask.data[i]!, i * 4, i * 4 + 4);
    const grassTexture = new DataTexture(rgba, mask.w, mask.h, RGBAFormat);
    state.grassTexture = grassTexture;
    grassTexture.minFilter = grassTexture.magFilter = LinearFilter;
    grassTexture.needsUpdate = true;
    terrain.setGrassMask(grassTexture, mask);
  };
  // The ground map (terrain/groundMap.ts): moisture, cover, ridges, from the heights, the water and the grass mask.
  const applyGroundMap = (): void => {
    const hf = terrain.heightField;
    state.groundTexture?.dispose();
    state.groundTexture = null;
    if (!hf) {
      terrain.setGroundMap(null);
      state.groundMap = null;
      state.vegetationDirty = true;
      return;
    }
    const map = buildGroundMap({
      bounds: hf,
      heightAt: (x, z) => terrain.heightAt(x, z),
      water: state.waterMask,
      grass: state.grassMask,
      margin: GROUND_MARGIN_M,
    });
    state.groundTexture = createGroundMapTexture(map);
    state.groundMap = map;
    state.vegetationDirty = true;
    terrain.setGroundMap(state.groundTexture, map);
  };
  const setTerrain = (geometry: TerrainGeometry, terrainOpts: SetTerrainOptions = {}): void => {
    terrain.set(geometry, terrainOpts.albedoLayout ?? null);
    if (state.waterMask) applyWater();
    if (state.grassProps.length > 0) applyGrassMask();
    applyGroundMap();
    afterHeights();
    scheduleWarmUp();
    const hf = terrain.heightField;
    const bounds = hf ? { minX: hf.minX, maxX: hf.maxX, minZ: hf.minZ, maxZ: hf.maxZ } : null;
    atmosphere.setBounds(bounds);
    skirt.set(bounds, (x, z) => terrain.heightAt(x, z));
    if (hf) {
      controls.bounds = { minX: hf.minX, maxX: hf.maxX, minZ: hf.minZ, maxZ: hf.maxZ };
      controls.focus(controls.target.x, controls.target.z);
      // The furthest zoom of a large map looks across it: keep its far corner inside the far plane.
      camera.far = Math.max(800, controls.maxDistance * 2.6);
      camera.updateProjectionMatrix();
    }
  };
  setTerrain(createGridTerrain(128, 128, 4));
  return { ...c, applyWater, afterHeights, applyGrassMask, applyGroundMap, setTerrain };
}
export type TerrainStage = ReturnType<typeof setupTerrain>;

/** Stage 5: interpolation, effect context, stats overlay, resize, and the frame loop (started by the caller). */
export function setupFrame(c: TerrainStage) {
  const { opts, state, canvas, capacity, backend, gpu, scene, camera, time, clock, sun } = c;
  const { terrain, screen, decals, zones, units, rigid, structures, footprints, props } = c;
  const { additive, smoke, atmosphere, fogOfWar, controls, vegetation } = c;
  let vegetationSignature = '';
  /** Scatters the vegetation over the current ground map (once per change, from the frame loop). */
  const applyVegetation = (): void => {
    state.vegetationDirty = false;
    const map = state.groundMap;
    if (!map || opts.vegetation === false) {
      vegetationSignature = '';
      vegetation.set(null);
      return;
    }
    const result = scatterVegetation({
      ground: map,
      heightAt: (x, z) => terrain.heightAt(x, z),
      water: state.waterMask,
      passable: state.passable,
      keepClear: state.keepClear,
      trees: state.mapProps
        .filter((p) => p.asset.startsWith('tree'))
        .map((p) => ({ x: p.x, z: p.y })),
    });
    // The ground map is rebuilt after every props load; an unchanged scatter keeps the meshes it already has.
    const signature = Object.values(result.instances)
      .map((d) => `${d.length}:${d.reduce((sum, v) => sum + v, 0)}`)
      .join('|');
    if (signature !== vegetationSignature) {
      vegetationSignature = signature;
      vegetation.set(result);
    }
    const groves = result.trees.map((t) => ({
      asset: t.asset,
      x: t.x,
      y: t.z,
      yaw: t.yaw,
      scale: t.scale,
    }));
    const same =
      groves.length === state.groveProps.length &&
      groves.every(
        (g, i) => g.asset === state.groveProps[i]!.asset && g.x === state.groveProps[i]!.x,
      );
    if (!same) {
      state.groveProps = groves;
      state.reloadProps?.();
    }
  };
  const platformList: PlatformSpec[] = [];
  const interp = new SnapshotInterpolator();
  const frame = createInterpolatedFrame(capacity);

  // Effects read entities from the latest snapshot (the one carrying the events).
  const effectContext: EffectContext = {
    entity(id, out) {
      const view = interp.latest;
      const i = id === 0 ? -1 : interp.latestIndex(id);
      if (!view || i < 0) return false;
      const e = view.entities;
      out.x = e.x[i]! / UNITS_PER_METER;
      out.z = e.y[i]! / UNITS_PER_METER;
      out.yaw = simYawToRender(e.yaw[i]!);
      out.typeId = e.typeId[i]!;
      out.owner = e.owner[i]!;
      return true;
    },
    heightAt: (x, z) => terrain.heightAt(x, z),
    footprint: (typeId) => footprints.get(typeId),
    buildingTop: (typeId) => structures.buildingTop(typeId),
    ability: (heroId, abilityId) => state.abilities?.(heroId, abilityId) ?? null,
  };

  const overlay = createOverlay(opts.stats ?? true, canvas);
  const meter = new PerfMeter(backend === 'webgpu' ? 'WebGPU' : 'WebGL2');
  const profiler = new FrameProfiler();

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

  state.last = performance.now();
  const loop = (): void => {
    const now = performance.now();
    profiler.begin();
    const dt = (now - state.last) / 1000;
    state.last = now;
    const t = clock(now);
    time.value = t;
    controls.update(dt);
    camera.updateMatrixWorld();
    screen.setViewport(canvas.height);
    screen.update(camera);
    profiler.mark('camera');
    const builds = terrain.leafBuilds;
    terrain.update(camera);
    profiler.count('leafBuilds', terrain.leafBuilds - builds);
    profiler.mark('terrain');
    interp.sample(now, frame);
    stampInspected(frame.id, frame.flags, frame.count, state.inspectedIds);
    // Foundations first: buildings level the ground under them, and everything below reads the levelled ground.
    profiler.mark('interpolate');
    const relayout = terrain.setPlatforms(
      structures.platforms(frame, platformList),
      PLATFORM_BUDGET_MS,
    );
    profiler.count('platformRelayout', relayout ? 1 : 0);
    profiler.count('warmDraws', state.warmDraws);
    if (relayout) {
      props.relayout();
      vegetation.setClearings(platformList);
    }
    if (state.vegetationDirty) applyVegetation();
    vegetation.update(camera);
    profiler.mark('platforms');
    for (let i = 0; i < frame.count; i++) frame.y[i] = terrain.heightAt(frame.x[i]!, frame.z[i]!);
    profiler.mark('heights');
    decals.begin();
    zones.draw(t, decals); // first, so blobs and selection rings draw over the zone
    units.update(frame, camera, decals);
    rigid.update(frame, camera, decals, t);
    structures.update(frame, camera, decals);
    const preview = state.preview;
    if (preview) {
      const f = footprints.get(preview.typeId);
      decals.push(
        preview.x / UNITS_PER_METER,
        preview.y / UNITS_PER_METER,
        f.w / 2,
        f.h / 2,
        preview.valid ? PREVIEW_VALID : PREVIEW_INVALID,
      );
    }
    profiler.mark('entities');
    props.update(camera, decals); // last: when the decal batch is full, prop blobs are what drops
    profiler.mark('props');
    decals.end();
    additive.commit();
    smoke.commit();
    atmosphere.update(controls.distance);
    fogOfWar.update(dt);
    profiler.mark('effects');
    sun?.update(camera, state.groundLo, state.groundHi);
    profiler.mark('shadowFit');
    if (state.warmDrawPending) {
      state.warmDrawPending = false;
      const restore = forceDrawable(scene);
      gpu.render(scene, camera);
      restore();
      gpu.info.reset(); // the stats are the real draw's
      state.warmDraws++;
      profiler.mark('warmDraw');
    }
    gpu.render(scene, camera);
    profiler.mark('submit');
    profiler.end();
    const info = gpu.info.render;
    if (meter.frame(now, performance.now() - now, info.drawCalls, info.triangles))
      overlay?.show(meter.stats);
  };
  return {
    ...c,
    interp,
    frame,
    effectContext,
    overlay,
    meter,
    profiler,
    resizeObserver,
    loop,
  };
}
export type FrameStage = ReturnType<typeof setupFrame>;

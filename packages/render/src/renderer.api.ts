// createRenderer, last stage: the CrawloutRenderer object, built on the closures of the setup stages.
import { TICK_MS, UNITS_PER_METER } from '@crawlout/protocol';
import { Matrix4, Plane, Raycaster, Vector2, Vector3 } from 'three/webgpu';
import { claimRingArcs } from './claims/claimRing.js';
import { footprintsFromGameData } from './entities/footprint.js';
import { triangleBreakdown } from './perf/triangleBreakdown.js';
import {
  pickEntity,
  pickNearestOnScreen,
  selectInRect,
  type PickShape,
} from './picking/selection.js';
import type { ResolvedSource } from './props/propAssets.js';
import { abilitiesFromGameData } from './vfx/abilityZones.js';
import { parseWaterMask } from './water/waterMask.js';
import type { FrameStage } from './renderer.frame.js';
import type { CrawloutRenderer, PickResult } from './renderer.types.js';

export function buildRendererApi(c: FrameStage): CrawloutRenderer {
  const { state, backend, precision, controls, interp, clock, effects, effectContext } = c;
  const { setTerrain, applyWater, afterHeights, scheduleWarmUp, setTerrainTextures } = c;
  const { footprints, attachments, unitAssets, rigidUnits, loadBuildings, props } = c;
  const { assetConfig, resolveAssetPath, propRegistry, gainOf, applyGrassMask, windStrength } = c;
  const { fogOfWar, structures, canvas, camera, frame, rigid, terrain, meter, scene } = c;
  const { profiler, water, units, gpu, resizeObserver, overlay, decals, additive, smoke } = c;
  const { sun, skirt, zones } = c;
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const groundPlane = new Plane(new Vector3(0, 1, 0), 0);
  const hitPoint = new Vector3();
  const viewProj = new Matrix4();
  const rigidShape = (i: number, out: PickShape): PickShape | null =>
    rigid.pickShape(frame.typeId[i]!, out);
  const pickShape = (i: number, out: PickShape): PickShape | null =>
    rigidShape(i, out) ?? structures.pickShape(frame.typeId[i]!, out);

  return {
    backend,
    dataTexturePrecision: precision,
    cameraControls: controls,
    pushSnapshot(buf) {
      const now = performance.now();
      if (!interp.push(buf, now)) return;
      const view = interp.latest;
      if (!view || view.eventCount === 0) return;
      // Events belong to the newest tick, which the interpolation reaches one tick from now.
      const t0 = clock(now) + TICK_MS / 1000;
      const ev = view.events;
      for (let k = 0; k < view.eventCount; k++)
        effects.handle(ev.type[k]!, ev.a[k]!, ev.b[k]!, ev.x[k]!, ev.y[k]!, t0, effectContext);
    },
    setTerrain,
    setWater(mask) {
      state.waterMask = mask ? parseWaterMask(mask) : null;
      applyWater();
      afterHeights();
      scheduleWarmUp();
      return state.waterInfo ? { ...state.waterInfo } : null;
    },
    setTerrainTextures,
    setGameData(data) {
      footprints.setLookup(footprintsFromGameData(data));
      state.abilities = data.heroes ? abilitiesFromGameData({ heroes: data.heroes }) : null;
      if (data.loadouts) {
        attachments.setLoadouts(data.loadouts);
        void Promise.all([
          unitAssets.setLoadouts(data.loadouts),
          rigidUnits.setLoadouts(data.loadouts),
        ])
          .then(() => attachments.settled())
          .then(scheduleWarmUp);
      }
      void loadBuildings(data.buildings);
    },
    loadUnitAsset: (manifestUrl, assetId, assetOpts) =>
      unitAssets.load(manifestUrl, assetId, assetOpts).finally(scheduleWarmUp),
    unitAssets: () => unitAssets.statuses(),
    attachmentAssets: () => attachments.statuses(),
    loadRigidUnit: (manifestUrl, assetId, typeIds) =>
      rigidUnits.load(manifestUrl, assetId, typeIds).finally(scheduleWarmUp),
    addRigidUnit(source, typeIds) {
      const status = rigidUnits.addLoaded(source.name, source, typeIds);
      scheduleWarmUp();
      return status;
    },
    rigidUnitAssets: () => rigidUnits.statuses(),
    buildingAssets: () =>
      state.buildingStatuses.map((st) => ({ ...st, buildingIds: [...st.buildingIds] })),
    async setProps(list, source = {}) {
      const generation = ++state.propGeneration;
      props.setProps(list);
      state.grassProps = list;
      const src: ResolvedSource = {
        manifestUrl:
          source.manifestUrl === null
            ? undefined
            : (source.manifestUrl ?? assetConfig?.manifestUrl),
        resolveUrl: source.resolveUrl
          ? (_manifestUrl, path) => source.resolveUrl!(path)
          : resolveAssetPath,
        sourceUrl: source.sourceUrl,
        placeholders: source.placeholders ?? true,
        heights: source.heights,
        categories: source.categories,
      };
      state.propStatuses = new Map(
        props
          .assetIds()
          .map((assetId) => [
            assetId,
            { assetId, instances: props.instanceCount(assetId), state: 'loading', origin: 'none' },
          ]),
      );
      const current = state.propStatuses;
      await Promise.all(
        props.assetIds().map(async (assetId) => {
          const r = await propRegistry.resolve(assetId, src);
          if (generation !== state.propGeneration) return;
          const g = gainOf(assetId);
          props.setVisual(
            assetId,
            r.visual && g !== undefined ? { ...r.visual, gain: g } : r.visual,
          );
          const status = current.get(assetId)!;
          status.state = 'ready';
          status.origin = r.origin;
          if (r.reasons.length > 0) status.reason = r.reasons.join('; ');
          if (r.triangles) status.triangles = r.triangles;
          if (r.visual?.category) status.category = r.visual.category;
          if (r.visual?.mask) status.mask = true;
          if (r.visual) status.height = Math.round(r.visual.height * r.visual.fit * 100) / 100;
          if (r.origin !== 'manifest' && r.reasons.some((m) => !m.startsWith('not in')))
            console.warn(`[render] prop "${assetId}": ${status.reason}`);
        }),
      );
      if (generation === state.propGeneration) applyGrassMask();
      scheduleWarmUp();
      return [...current.values()].map((st) => ({ ...st }));
    },
    propAssets: () => [...state.propStatuses.values()].map((st) => ({ ...st })),
    setPropWind(enabled) {
      windStrength.value = enabled ? 1 : 0;
    },
    setInspectedIds(ids) {
      state.inspectedIds = new Set(ids);
    },
    setFog(mask) {
      fogOfWar.setMask(mask);
    },
    setClaimStates(states) {
      structures.setClaimArcs(claimRingArcs(states ?? []));
    },
    setPlacementPreview(p) {
      state.preview = p ? { ...p } : null;
    },
    pickAt(x, y) {
      ndc.set(
        (x / Math.max(1, canvas.clientWidth)) * 2 - 1,
        -(y / Math.max(1, canvas.clientHeight)) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const { origin, direction } = raycaster.ray;
      let hit = pickEntity(
        frame,
        origin.x,
        origin.y,
        origin.z,
        direction.x,
        direction.y,
        direction.z,
        pickShape,
      );
      if (hit < 0) {
        viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        hit = pickNearestOnScreen(
          frame,
          viewProj.elements,
          canvas.clientWidth,
          canvas.clientHeight,
          x,
          y,
          undefined,
          rigidShape,
        );
      }
      let ground: PickResult['ground'] = null;
      const p = terrain.raycast(origin, direction, hitPoint)
        ? hitPoint
        : raycaster.ray.intersectPlane(groundPlane, hitPoint);
      if (p)
        ground = { x: Math.round(p.x * UNITS_PER_METER), y: Math.round(p.z * UNITS_PER_METER) };
      return { entityId: hit >= 0 ? frame.id[hit]! : null, ground };
    },
    boxSelect(rect, selectOpts) {
      viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      return selectInRect(frame, viewProj.elements, canvas.clientWidth, canvas.clientHeight, rect, {
        shape: rigidShape,
        ...selectOpts,
      });
    },
    focus(x, y) {
      controls.focus(x / UNITS_PER_METER, y / UNITS_PER_METER);
    },
    stats: () => ({ ...meter.stats }),
    triangleBreakdown: () => triangleBreakdown(scene, (id) => props.categoryOf(id)),
    frameTimings: () => profiler.last,
    takeSlowestFrame: () => profiler.takeSlowest(),
    layerStats: () => ({
      terrainTriangles: terrain.triangles,
      terrainDraws: terrain.drawCount,
      propsVisible: props.visibleCount,
      propsTotal: props.totalCount,
      waterTriangles: water.triangles,
      attachmentInstances: units.attachmentInstances,
      rigidVisible: rigid.visibleCount,
      rigidTotal: rigid.totalCount,
      rigidDraws: rigid.drawCount,
    }),
    dispose() {
      clearTimeout(state.warmTimer);
      void gpu.setAnimationLoop(null);
      resizeObserver.disconnect();
      controls.dispose();
      unitAssets.dispose();
      attachments.dispose();
      overlay?.dispose();
      units.dispose();
      rigidUnits.dispose();
      rigid.dispose();
      state.buildingGeneration++;
      structures.dispose();
      state.buildingLayers?.dispose();
      props.dispose();
      propRegistry.dispose();
      decals.dispose();
      additive.dispose();
      smoke.dispose();
      sun?.dispose();
      fogOfWar.dispose();
      skirt.dispose();
      state.terrainGeneration++;
      terrain.dispose();
      water.dispose();
      state.terrainTexture?.dispose();
      state.grassTexture?.dispose();
      interp.clear();
      zones.clear();
      gpu.dispose();
    },
  };
}

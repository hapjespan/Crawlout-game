/// <reference types="vite/client" />
// Render demo without a sim: fake snapshots at 20 Hz into the renderer, plus selection, move orders and building
// placement that the fake source mirrors the way the sim would. Open /render-demo.html on the vite dev server.
// Defaults: 200 units, 40 buildings, 8 scrap nodes, 3 claim points, combat events for the VFX. The first unit of
// every player is the hero from data/heroes.json (cap, collar and pauldrons in the team color) and casts its ability
// zone now and then; the buildings that provide 'turret' shoot from their roof.
// Character assets come from assets/dist (the asset-cli's output, bundled by Vite): the fake units are loadout 0, so
// the body asset of that loadout in data/loadouts.json is used when the manifest has it; ?unit=<id> picks any other.
// Decorative props come from Rustbelt's props file (200 trees, rocks, bushes, grass) on the demo terrain: manifest
// first, then the source GLBs in assets/src/props, then a placeholder per kind. ?props=0 hides them, ?props=src skips
// the manifest, ?props=ph shows the placeholders only.
import { PROVIDES } from '@crawlout/data';
import { MAX_ENTITIES, TICK_MS, UNITS_PER_METER } from '@crawlout/protocol';
import {
  buildingTypeId,
  createRenderer,
  snapFootprintCenter,
  type PlacementPreview,
} from '@crawlout/render';
import { createGridTerrain, FakeSnapshotSource } from '@crawlout/render/dev';
import { assetConfig } from '../game/assets.js';
import { loadClientGameData } from '../game/content.js';
import { loadMapProps, propSource } from './props.js';

const WORLD = 128;
const PLAYER = 0;

function wastelandHeight(x: number, z: number): number {
  return (
    1.4 * Math.sin(x * 0.05) * Math.cos(z * 0.043) +
    0.6 * Math.sin(x * 0.13 + 1.7) * Math.sin(z * 0.11 + 0.4) +
    0.25 * Math.sin((x + z) * 0.31)
  );
}

function wastelandColor(x: number, z: number, y: number): readonly [number, number, number] {
  const n =
    0.5 + 0.5 * Math.sin(x * 0.21 + Math.sin(z * 0.17) * 2.1) * Math.cos(z * 0.19 - x * 0.07);
  const low = Math.max(0, Math.min(1, (y + 2) / 4));
  const r = 0.46 + 0.16 * n + 0.08 * low;
  const g = 0.4 + 0.12 * n + 0.06 * low;
  const b = 0.3 + 0.06 * n;
  return [r, g, b];
}

function showError(message: string): void {
  const el = document.getElementById('error');
  if (!el) return;
  el.textContent = message;
  el.style.display = 'grid';
}

function intParam(params: URLSearchParams, name: string, fallback: number, max: number): number {
  const raw = params.get(name);
  const v = raw === null ? fallback : Number(raw);
  return Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : fallback;
}

async function main(): Promise<void> {
  const canvas = document.getElementById('view') as HTMLCanvasElement | null;
  const marquee = document.getElementById('marquee') as HTMLDivElement | null;
  if (!canvas || !marquee) return;
  const params = new URLSearchParams(location.search);
  const count = Math.max(1, intParam(params, 'n', 200, MAX_ENTITIES));
  const data = loadClientGameData();
  const footprint = (typeId: number) =>
    data.buildings[typeId - buildingTypeId(0)]?.footprint ?? null;
  const assets = assetConfig(params);

  const renderer = await createRenderer({
    canvas,
    forceWebGL: params.has('webgl'),
    shadows: !params.has('noshadow'),
    dataTextures: params.has('half') ? 'half' : 'auto',
    ...(assets ? { assets } : {}),
  });
  renderer.setGameData(data);
  const backendEl = document.getElementById('backend');
  if (backendEl) {
    const precision = renderer.dataTexturePrecision === 'half' ? ', half-float' : '';
    backendEl.textContent =
      (renderer.backend === 'webgpu' ? 'WebGPU' : 'WebGL2-fallback') + precision;
  }
  renderer.setTerrain(createGridTerrain(WORLD, WORLD, 1, wastelandHeight, wastelandColor));

  // Unit assets load in the background; show what the units are drawn with once they settle.
  const unitsEl = document.getElementById('units');
  const showUnits = (): void => {
    if (!unitsEl) return;
    const list = renderer.unitAssets();
    unitsEl.textContent =
      list.length === 0
        ? assets
          ? 'placeholder-rig (geen asset in het manifest)'
          : 'placeholder-rig (geen manifest)'
        : list
            .map((a) => `${a.assetId}: ${a.state}${a.reason ? ` (${a.reason})` : ''}`)
            .join(' · ');
  };
  for (const delay of [500, 2000, 6000]) window.setTimeout(showUnits, delay);

  const propsMode = params.get('props');
  const propsEl = document.getElementById('props');
  if (propsMode !== '0') {
    const source =
      propsMode === 'src'
        ? propSource({ manifest: false })
        : propsMode === 'ph'
          ? { manifestUrl: null }
          : propSource();
    void renderer.setProps(loadMapProps('rustbelt'), source).then((list) => {
      if (!propsEl) return;
      const by = new Map<string, number>();
      for (const p of list) by.set(p.origin, (by.get(p.origin) ?? 0) + p.instances);
      propsEl.textContent = [...by].map(([origin, n]) => `${n} uit ${origin}`).join(', ');
    });
  } else if (propsEl) propsEl.textContent = 'uit';

  const source = new FakeSnapshotSource({
    count,
    players: 4,
    worldSize: WORLD,
    buildings: intParam(params, 'b', 40, 400),
    buildingTypes: data.buildings.length,
    footprint,
    scrapNodes: intParam(params, 'nodes', 8, 64),
    claims: intParam(params, 'claims', 3, 32),
    combat: params.get('combat') !== '0',
    ...(data.heroes.length > 0 && !params.has('nohero') ? { heroId: 0 } : {}),
    turrets: data.buildings
      .filter((b) => b.provides.includes(PROVIDES.indexOf('turret')))
      .map((b) => buildingTypeId(b.id)),
  });
  renderer.pushSnapshot(source.next());
  const pump = window.setInterval(() => renderer.pushSnapshot(source.next()), TICK_MS);

  // Build mode (B): a ghost footprint follows the cursor, digits pick the building, a left click places it.
  let buildId: number | null = null;
  let cursor: { x: number; y: number } | null = null;
  const buildEl = document.getElementById('build');
  const updatePreview = (): PlacementPreview | null => {
    if (buildId === null || !cursor) {
      renderer.setPlacementPreview(null);
      return null;
    }
    const typeId = buildingTypeId(buildId);
    const f = footprint(typeId) ?? { w: 2, h: 2 };
    const ground = renderer.pickAt(cursor.x, cursor.y).ground;
    if (!ground) {
      renderer.setPlacementPreview(null);
      return null;
    }
    const at = snapFootprintCenter(ground.x, ground.y, f, UNITS_PER_METER);
    const preview = { typeId, x: at.x, y: at.y, valid: source.fits(at.x, at.y, f) };
    renderer.setPlacementPreview(preview);
    return preview;
  };
  const setBuild = (id: number | null): void => {
    buildId = id;
    if (buildEl)
      buildEl.textContent = id === null ? 'uit' : `${data.buildings[id]?.key ?? id} (${id + 1})`;
    updatePreview();
  };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyB') setBuild(buildId === null ? 0 : null);
    else if (e.code === 'Escape') setBuild(null);
    else if (buildId !== null && /^Digit[1-9]$/.test(e.code)) {
      const id = Number(e.code.slice(5)) - 1;
      if (id < data.buildings.length) setBuild(id);
    }
  });

  // Selection: click picks one entity, drag draws a marquee (units only). Shift adds to the selection.
  let selection = new Set<number>();
  let drag: { x: number; y: number; moved: boolean } | null = null;
  const local = (e: PointerEvent | MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (buildId !== null) {
      cursor = local(e);
      const p = updatePreview();
      if (p?.valid) {
        const f = footprint(p.typeId) ?? { w: 2, h: 2 };
        source.placeBuilding(p.typeId, PLAYER, p.x, p.y, f);
        if (!e.shiftKey) setBuild(null);
      }
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    drag = { ...local(e), moved: false };
  });
  canvas.addEventListener('pointermove', (e) => {
    cursor = local(e);
    if (buildId !== null) updatePreview();
    if (!drag) return;
    const p = cursor;
    if (!drag.moved && Math.hypot(p.x - drag.x, p.y - drag.y) < 4) return;
    drag.moved = true;
    marquee.style.display = 'block';
    marquee.style.left = `${Math.min(p.x, drag.x)}px`;
    marquee.style.top = `${Math.min(p.y, drag.y)}px`;
    marquee.style.width = `${Math.abs(p.x - drag.x)}px`;
    marquee.style.height = `${Math.abs(p.y - drag.y)}px`;
  });
  canvas.addEventListener('pointerup', (e) => {
    if (e.button !== 0 || !drag) return;
    const p = local(e);
    let ids: number[];
    if (drag.moved) {
      ids = renderer.boxSelect({ x0: drag.x, y0: drag.y, x1: p.x, y1: p.y });
    } else {
      const hit = renderer.pickAt(p.x, p.y).entityId;
      ids = hit === null ? [] : [hit];
    }
    selection = e.shiftKey ? new Set([...selection, ...ids]) : new Set(ids);
    source.setSelected(selection);
    marquee.style.display = 'none';
    drag = null;
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (buildId !== null) {
      setBuild(null);
      return;
    }
    const ground = renderer.pickAt(local(e).x, local(e).y).ground;
    if (ground && selection.size > 0) source.moveTo(selection, ground.x, ground.y);
  });

  window.addEventListener('beforeunload', () => {
    window.clearInterval(pump);
    renderer.dispose();
  });
  // Handy in the console: window.crawloutRender.stats(), window.crawloutSource.structures
  Object.assign(window as object, { crawloutRender: renderer, crawloutSource: source });
}

main().catch((err: unknown) => {
  console.error(err);
  showError(`Renderer kon niet starten: ${err instanceof Error ? err.message : String(err)}`);
});

// Client entry, stage 1 (see main.ts): page elements, options, the menu with its splash, then the heavy loading (game
// data, map, renderer, terrain, props, water) while the splash shows the progress.
import { createRenderer, type CrawloutRenderer } from '@crawlout/render';
import { UNITS_PER_METER } from '@crawlout/protocol';
import {
  defaultRelayUrl,
  effectiveParams,
  hudScaleFromParams,
  loadSettings,
  mountMenu,
  saveSettings,
  setSkinAttribute,
  skinComplete,
  type MenuMount,
  type PvpForm,
} from '@crawlout/ui';
import { assetConfig } from './game/assets.js';
import { lodPixelsParam } from './render/lodParams.js';
import { propSource } from './render/props.js';
import { terrainTextures } from './render/terrain.js';
import { shadowOption } from './render/shadows.js';
import { albedoLayoutForMap } from './render/terrainLayout.js';
import { loadClientMapWater } from './render/water.js';
import { loadClientGameData, loadClientMap } from './game/content.js';
import { EMPTY_MENU_CONTENT, menuContent } from './game/menuContent.js';
import { startMode } from './game/menuParams.js';
import { startAmbientCamera, type AmbientCamera } from './ui/ambientCamera.js';
import { minimapLayers } from './game/minimapLayers.js';
import type { ClientContext } from './main.context.js';

const SLICE_MAP = 'rustbelt';

/** The splash waits at most this long for the props to load; the menu does not need them to be usable. */
const PROPS_WAIT_MS = 15000;

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** HUD size from the settings or `?hudscale=`: `--hud-scale` on the page (units.ts reads it, 0.64 without). */
function applyHudScale(scale: number | null): void {
  const style = document.documentElement.style;
  if (scale === null) style.removeProperty('--hud-scale');
  else style.setProperty('--hud-scale', String(scale));
}

const PVP_FORM_KEY = 'crawlout.pvpForm.v1';
/** The name and relay address of the last "Speler tegen speler", so the form is filled in next time. */
function loadPvpForm(storage: Storage | null, params: URLSearchParams): PvpForm {
  let saved: Partial<PvpForm> = {};
  try {
    saved = JSON.parse(storage?.getItem(PVP_FORM_KEY) ?? '{}') as Partial<PvpForm>;
  } catch {
    // unreadable storage: the defaults
  }
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  return {
    name:
      params.get('name') ||
      str(saved.name) ||
      `Speler${String(1000 + Math.floor(Math.random() * 9000))}`,
    room: '',
    relayUrl: params.get('relayurl') || str(saved.relayUrl) || defaultRelayUrl(location),
  };
}

export async function bootClient(ctx: ClientContext): Promise<void> {
  const canvas = document.getElementById('view') as HTMLCanvasElement | null;
  const marquee = document.getElementById('marquee') as HTMLDivElement | null;
  const hudEl = document.getElementById('hud');
  const endEl = document.getElementById('end');
  const menuEl = document.getElementById('menu');
  if (!canvas || !marquee || !hudEl || !endEl || !menuEl)
    throw new Error('index.html mist #view, #marquee, #hud, #end of #menu');

  const urlParams = new URLSearchParams(location.search);
  const mode = startMode(urlParams);
  const storage = safeLocalStorage();
  // Options the player chose in the menu fill in whatever the URL does not say itself (the URL wins).
  ctx.settings = loadSettings(storage);
  const params = effectiveParams(urlParams, ctx.settings);
  applyHudScale(hudScaleFromParams(params));
  const perfEl = document.getElementById('perf');
  if (perfEl) perfEl.style.visibility = 'hidden';

  // The bitmap HUD skin (local art, assets/local/hud) is dev only; a production build drops this import. It loads first
  // so the splash already has the final look. `?noskin` (or the setting) shows the CSS-only look that production gets.
  const hudSkin = import.meta.env.DEV ? (await import('./ui/hudSkin.js')).loadHudSkin() : undefined;
  const skinOn = !params.has('noskin');
  const skinUsable = hudSkin !== undefined && skinComplete(hudSkin);

  // The match is started from the menu, or at once from URL parameters (`?skip=1`, `?relay=`, `?faction=`, ...).
  ctx.launchMatch = () => undefined;
  let menu: MenuMount | null = null;
  if (mode !== 'match') {
    menu = mountMenu(
      menuEl,
      {
        content: EMPTY_MENU_CONTENT,
        settings: ctx.settings,
        skinAvailable: skinUsable,
        initialForm: loadPvpForm(storage, urlParams),
        skipSplash: mode === 'menu',
        stillBackground: params.has('still'),
        startAi: (config) =>
          ctx.launchMatch(null, {
            faction: config.faction,
            aiFaction: config.aiFaction,
            heroArchetype: config.heroArchetype,
            // moeilijkheidsgraad (protocol 0.21.0): de keuze uit het menu gaat mee in MatchSettings
            difficulty: config.difficulty,
            mode:
              config.gameType === 'build'
                ? 'project'
                : config.gameType === 'survival'
                  ? 'survival'
                  : 'skirmish',
          }),
        connect: (config) => {
          try {
            storage?.setItem(
              PVP_FORM_KEY,
              JSON.stringify({ name: config.name, relayUrl: config.relayUrl }),
            );
          } catch {
            // not saved: the form is empty next time
          }
          ctx.launchMatch(
            { relayUrl: config.relayUrl, roomId: config.roomId, name: config.name, ai: false },
            { lobby: 'manual' },
          );
        },
        leave: () => ctx.session.current?.dispose(),
        lobbyRequest: (request) => ctx.session.lobbyRequest(request),
        onSettings: (next) => {
          ctx.settings = next;
          saveSettings(storage, next);
          applyHudScale(hudScaleFromParams(effectiveParams(urlParams, next)));
          const on = skinUsable && next.hudSkin && !urlParams.has('noskin');
          menu?.setSkin(on);
          for (const el of [hudEl, endEl]) setSkinAttribute(el, on);
        },
        reload: () => location.reload(),
      },
      { ...(hudSkin ? { skin: hudSkin } : {}), skinOn },
    );
    // Let the splash paint before the heavy loading starts.
    await nextFrame();
  }
  const step = (value: number, label: string): void => menu?.setProgress(value, label);

  step(0.04, 'Spelregels laden');
  const data = loadClientGameData();
  step(0.14, 'Kaart laden');
  const map = loadClientMap(SLICE_MAP);
  step(0.26, 'Lokale kunst');
  // Local fan art only in dev: a production build drops this import, so it never ships.
  const localAssets = import.meta.env.DEV ? await import('./game/localAssets.js') : null;
  const assets = assetConfig(params, data.heroes, localAssets);
  const textures = terrainTextures();
  step(0.34, 'Renderer starten');
  let renderer: CrawloutRenderer;
  try {
    renderer = await createRenderer({
      canvas,
      forceWebGL: params.has('webgl'),
      warmDraw: params.get('warmdraw') !== '0',
      ...(lodPixelsParam(params) ? { lodPixels: lodPixelsParam(params)! } : {}),
      shadows: shadowOption(params),
      // The frame stats are the compact badge in the top right (createPerfBadge), not the renderer's own overlay.
      stats: false,
      // A and S are HUD hotkeys (attack-move, stop); W, D, arrows and Q/E keep moving the camera.
      camera: { panKeys: { KeyA: null, KeyS: null } },
      ...(assets ? { assets } : {}),
      ...(textures ? { terrainTextures: textures } : {}),
      vegetation: params.get('vegetation') !== '0',
      occlusionFade: params.get('occlusion') !== '0',
    });
  } catch (err) {
    menu?.hide();
    throw err;
  }
  step(0.62, 'Terrein opbouwen');
  renderer.setTerrain(map.terrain, { albedoLayout: albedoLayoutForMap(SLICE_MAP) });
  renderer.setGameData(data);
  const propsLoaded = renderer.setProps(map.props, propSource());
  const water = loadClientMapWater(SLICE_MAP);
  if (water) renderer.setWater(water);
  renderer.setVegetation({
    w: map.grid.w,
    h: map.grid.h,
    passable: map.grid.passable,
    keepClear: map.grid.claimPoints.map((c) => ({
      x: c.ux / UNITS_PER_METER,
      y: c.uy / UNITS_PER_METER,
    })),
  });
  const minimapStatic = minimapLayers(map.grid.w, map.grid.h, map.grid.passable, map.props, water);
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  let ambient: AmbientCamera | null = null;
  if (menu) {
    menu.setContent(
      menuContent(data, map.grid, map.dominance, minimapStatic, `data ${data.dataVersion}`),
    );
    ambient = startAmbientCamera(
      renderer,
      { w: map.grid.w, h: map.grid.h },
      { still: reducedMotion },
    );
    step(0.8, 'Props plaatsen');
    await Promise.race([
      propsLoaded,
      new Promise((resolve) => window.setTimeout(resolve, PROPS_WAIT_MS)),
    ]);
    step(0.97, 'Eerste beeld');
    await nextFrame();
    menu.setLoaded();
  } else void propsLoaded;

  ctx.canvas = canvas;
  ctx.marquee = marquee;
  ctx.hudEl = hudEl;
  ctx.endEl = endEl;
  ctx.mode = mode;
  ctx.params = params;
  ctx.perfEl = perfEl;
  ctx.hudSkin = hudSkin;
  ctx.skinOn = skinOn;
  ctx.menu = menu;
  ctx.data = data;
  ctx.map = map;
  ctx.renderer = renderer;
  ctx.water = water;
  ctx.minimapStatic = minimapStatic;
  ctx.ambient = ambient;
}

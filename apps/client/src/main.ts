// Composition: sim worker (packages/sim) + renderer (packages/render) + HUD (packages/ui) + loopback relay.
// Local skirmish against the scripted AI on the slice map; the same session code drives the ws relay later.
import {
  ANIM,
  ENTITY_FLAG,
  ENTITY_NONE,
  MAX_ENTITIES_PER_COMMAND,
  OWNER_NEUTRAL,
  TICK_HZ,
  UNITS_PER_METER,
  type CommandPayload,
  type CommandType,
  type DesyncEvent,
  type FogMask,
  type PlayerStatus,
  type StallNotice,
} from '@crawlout/protocol';
import {
  BODY_TYPES,
  CLAIM_POINT_TYPE_ID,
  PROVIDES,
  ROLES,
  SCRAP_NODE_TYPE_ID,
  buildingTypeId,
  heroIdOfTypeId,
  kindOfTypeId,
  unitTypeId,
  type BuildingData,
} from '@crawlout/data';
import { createRenderer, snapFootprintCenter, type CrawloutRenderer } from '@crawlout/render';
import {
  defaultRelayUrl,
  effectiveParams,
  hudScaleFromParams,
  loadSettings,
  mountHud,
  mountMatchEnd,
  mountMenu,
  saveSettings,
  setSkinAttribute,
  skinComplete,
  type HudHandle,
  type MenuMount,
  type PvpForm,
  type BuildOption,
  type HudAlert,
  type HudDeps,
  type MinimapData,
  type MinimapFog,
  type NetworkState,
  type SelectedEntity,
  type TargetingKind,
} from '@crawlout/ui';
import type { SimWinner } from '@crawlout/sim';
import {
  AS_DEPOT,
  PLACE_HQ_RANGE,
  PLACE_OK,
  POINT_CLAIM,
  POINT_NODE,
  RECT_CLAIM,
  RECT_DEPOT,
  placementReason as simPlacementReason,
  territoryMask,
  type PlacementInput,
} from '@crawlout/sim/placement';
import {
  claimPlacement,
  placementCommand,
  type ClaimPlacement,
  type ClaimPointView,
  type OwnClaimSite,
} from './game/claimPlacement.js';
import { assetConfig } from './game/assets.js';
import { runBaseBench } from './render/bench.js';
import { lodPixelsParam } from './render/lodParams.js';
import { propSource } from './render/props.js';
import { terrainTextures } from './render/terrain.js';
import { shadowOption } from './render/shadows.js';
import { albedoLayoutForMap } from './render/terrainLayout.js';
import { loadClientMapWater } from './render/water.js';
import { loadClientGameData, loadClientMap } from './game/content.js';
import { startSession, type SessionEvents, type SessionOptions } from './game/session.js';
import { createSessionSlot } from './game/sessionSlot.js';
import { EMPTY_MENU_CONTENT, menuContent } from './game/menuContent.js';
import { menuUrl, startMode } from './game/menuParams.js';
import { startAmbientCamera, type AmbientCamera } from './ui/ambientCamera.js';
import { netOptionsFromSearch, type WsNetOptions } from './net/params.js';
import { createStatusOverlay } from './net/statusOverlay.js';
import {
  buildingButtons,
  buildingCards,
  buildingName,
  hasFinished,
  hasFinishedWorkshop,
  type CardContext,
} from './game/cards.js';
import { perkOptions } from './game/perks.js';
import { inspect, takeoverHint } from './game/inspect.js';
import { leftClickIs, nextSelection, type ClickMode } from './game/clickRules.js';
import {
  ABILITY_HINT_DELAY_MS,
  OUT_OF_RANGE_TEXT,
  abilityOutOfRange,
  type AbilityProbe,
} from './game/abilityHint.js';
import { placementIssue, type CellRect } from './game/placementRules.js';
import { createPerfBadge } from './net/perfBadge.js';
import { dominanceView } from './game/dominance.js';
import { FOG_POLL_MS, fogEnabled, minimapFogOf, sameMinimapFog } from './game/fogView.js';
import { minimapLayers } from './game/minimapLayers.js';
import { LOADOUT_NAMES, buildRoster } from './game/roster.js';
import { BedHintThrottle, bedHintText, cappedByBeds } from './game/beds.js';
import { raiderKindOf, raiderLines, raiderStats, seesEnemySlaves } from './game/raiders.js';
import { EVENT_TYPE, readSnapshot, type EntityRow } from './game/snapshot.js';

const SLICE_MAP = 'rustbelt';
const STATUS_POLL_MS = 250;
/** A press that moves less than this is a click, not a drag: trackpad clicks often wobble a few pixels. */
const DRAG_THRESHOLD_PX = 8;
/** A drag this small that catches no unit counts as a click at the press point. */
const SMALL_DRAG_PX = 24;
/** Under-attack alerts are rate limited so a long fight is one toast, not a flood. */
const ATTACK_ALERT_COOLDOWN_MS = 8000;
/** A Kooi with too few guards warns again after this long (the sim lets slaves escape every 25 s while it lasts). */
const REVOLT_ALERT_COOLDOWN_MS = 20000;

function showError(message: string): void {
  const el = document.getElementById('error');
  if (!el) return;
  el.textContent = message;
  el.style.display = 'grid';
}

const DEFAULT_YAW = Math.PI * 0.25;
const DEFAULT_ZOOM_M = 42;
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

async function main(): Promise<void> {
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
  let settings = loadSettings(storage);
  const params = effectiveParams(urlParams, settings);
  applyHudScale(hudScaleFromParams(params));
  const perfEl = document.getElementById('perf');
  if (perfEl) perfEl.style.visibility = 'hidden';

  // The bitmap HUD skin (local art, assets/local/hud) is dev only; a production build drops this import. It loads first
  // so the splash already has the final look. `?noskin` (or the setting) shows the CSS-only look that production gets.
  const hudSkin = import.meta.env.DEV ? (await import('./ui/hudSkin.js')).loadHudSkin() : undefined;
  const skinOn = !params.has('noskin');
  const skinUsable = hudSkin !== undefined && skinComplete(hudSkin);

  // The match is started from the menu, or at once from URL parameters (`?skip=1`, `?relay=`, `?faction=`, ...).
  let launchMatch: (net: WsNetOptions | null, options: SessionOptions) => void = () => undefined;
  let menu: MenuMount | null = null;
  if (mode !== 'match') {
    menu = mountMenu(
      menuEl,
      {
        content: EMPTY_MENU_CONTENT,
        settings,
        skinAvailable: skinUsable,
        initialForm: loadPvpForm(storage, urlParams),
        skipSplash: mode === 'menu',
        stillBackground: params.has('still'),
        startAi: (config) =>
          launchMatch(null, { faction: config.faction, aiFaction: config.aiFaction }),
        connect: (config) => {
          try {
            storage?.setItem(
              PVP_FORM_KEY,
              JSON.stringify({ name: config.name, relayUrl: config.relayUrl }),
            );
          } catch {
            // not saved: the form is empty next time
          }
          launchMatch(
            { relayUrl: config.relayUrl, roomId: config.roomId, name: config.name, ai: false },
            { lobby: 'manual' },
          );
        },
        leave: () => session.current?.dispose(),
        lobbyRequest: (request) => session.lobbyRequest(request),
        onSettings: (next) => {
          settings = next;
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

  // Selection is local UI state, never sim state: it is stamped into each snapshot's flags for the renderer.
  let selection = new Set<number>();
  let entities = new Map<number, EntityRow>();
  let ownCache: EntityRow[] | null = null;
  let status: PlayerStatus | null = null;
  let network: NetworkState = { desync: null, stall: null };
  const listeners = new Set<() => void>();
  const notify = (): void => listeners.forEach((l) => l());
  const alertListeners = new Set<(a: HudAlert) => void>();
  const alert = (a: HudAlert): void => alertListeners.forEach((l) => l(a));
  let lastAttackAlert = -Infinity;
  // Fog of war: `?fog=0` (or window.crawlout.revealAll(true)) turns it off; otherwise the sim's mask is asked for at
  // FOG_POLL_MS, drawn by the renderer in every material and handed to the minimap.
  let fogOn = fogEnabled(params);
  let minimapFog: MinimapFog | undefined;
  const applyFog = (mask: FogMask | null): void => {
    renderer.setFog(mask);
    if (!mask) minimapFog = undefined;
    else {
      const next = minimapFogOf(mask);
      if (!sameMinimapFog(minimapFog, next)) minimapFog = next;
    }
    notify();
  };

  const loadoutOf = (typeId: number) => {
    const k = kindOfTypeId(typeId);
    return k.kind === 'unit' ? data.loadouts[k.index] : undefined;
  };
  /** The hero is a unit in the unit typeId range (1000 + heroId); it has no loadout. */
  const heroOf = (typeId: number) => {
    const h = heroIdOfTypeId(typeId);
    return h < 0 ? undefined : data.heroes[h];
  };
  const buildingOf = (typeId: number): BuildingData | undefined => {
    const k = kindOfTypeId(typeId);
    return k.kind === 'building' ? data.buildings[k.index] : undefined;
  };
  const myFaction = () => data.factions.find((f) => f.key === session.faction);
  const myHero = () => {
    const id = status?.hero?.heroId;
    return id === undefined ? undefined : data.heroes[id];
  };
  /** Tech ids this player has researched (PlayerStatus.techs); prerequisites gate buildings, loadouts and techs. */
  const unlocked = (prereq: readonly number[]): boolean =>
    prereq.every((t) => status?.techs?.includes(t) ?? false);
  const hqProvidesIdx = PROVIDES.indexOf('hq');
  const cardContext = (selected: readonly EntityRow[]): CardContext => ({
    data,
    factionId: myFaction()?.id,
    playerId: session.playerId,
    status,
    selected,
    own: own(),
    heroDead: status?.hero?.state === 'dead' || status?.hero?.state === 'reviving',
  });
  const myHq = (): EntityRow | undefined =>
    [...entities.values()].find(
      (e) => e.owner === session.playerId && buildingOf(e.typeId)?.provides.includes(hqProvidesIdx),
    );

  const raiderStatsNow = (): ReturnType<typeof raiderStats> =>
    raiderStats(data, myFaction()?.id, session.playerId, own());
  /** Toast when a Kooi's garrison is below the revolt rule (computed from the visible own units; the status has no census). */
  let lastRevoltAlert = -Infinity;
  function checkRevolt(): void {
    const now = performance.now();
    if (now - lastRevoltAlert < REVOLT_ALERT_COOLDOWN_MS) return;
    const short = raiderStatsNow()?.cages.find((c) => c.slaves > 0 && c.guards < c.guardsNeeded);
    if (!short) return;
    lastRevoltAlert = now;
    alert({ kind: 'revolt', x: short.x, y: short.y });
  }
  /** Hint when the beds cap the population (playtest M5): build a house (Dwellers) or a tent (Raiders); throttled. */
  const bedHint = new BedHintThrottle();
  function checkBeds(s: PlayerStatus): void {
    if (!bedHint.check(cappedByBeds(data, s), performance.now())) return;
    const hq = myHq();
    alert({
      kind: 'noBeds',
      x: hq?.x ?? 0,
      y: hq?.y ?? 0,
      text: bedHintText(data, myFaction()?.id),
    });
  }

  const perfBadge = perfEl ? createPerfBadge(perfEl, () => renderer.stats()) : null;
  const netStatus = createStatusOverlay();
  const session = createSessionSlot();
  const sessionEvents: SessionEvents = {
    onSnapshot(buf) {
      const previous = entities;
      const snap = readSnapshot(buf, selection);
      entities = snap.entities;
      ownCache = null;
      for (const id of selection) if (!entities.has(id)) selection.delete(id);
      renderer.pushSnapshot(buf);
      renderer.setInspectedIds([...selection].filter(isEnemyId));
      for (const ev of snap.events) {
        if (ev.type === EVENT_TYPE.death) {
          const was = previous.get(ev.a);
          if (was?.owner === session.playerId && loadoutOf(was.typeId))
            alert({ kind: 'settlerLost', x: ev.x, y: ev.y });
        } else if (ev.type === EVENT_TYPE.claimTaken) {
          if (previous.get(ev.a)?.owner === session.playerId && ev.b !== session.playerId)
            alert({ kind: 'claimLost', x: ev.x, y: ev.y });
        } else if (ev.type === EVENT_TYPE.hit) {
          const now = performance.now();
          if (
            previous.get(ev.a)?.owner === session.playerId &&
            now - lastAttackAlert > ATTACK_ALERT_COOLDOWN_MS
          ) {
            lastAttackAlert = now;
            alert({ kind: 'attack', x: ev.x, y: ev.y });
          }
        }
      }
      checkRevolt();
      notify();
    },
    onFog(mask) {
      if (fogOn) applyFog(mask);
    },
    onStatus(next, winner) {
      status = next;
      renderer.setClaimStates(next.claimPoints);
      if (winner) showEnd(winner);
      else checkBeds(next);
      notify();
    },
    onDesync(event: DesyncEvent) {
      network = { ...network, desync: event };
      notify();
    },
    onStall(notice: StallNotice | null) {
      network = { ...network, stall: notice };
      notify();
    },
    // While the menu is up it shows the connection itself; the overlay is for the match (reconnects, waiting).
    onConnection: (text) => netStatus.set(menu?.isVisible() ? null : text),
    // The menu's lobby shows the relay's side of the story (the link, the lobby, its error messages).
    onLobby: (lobby) => menu?.setLobby(lobby.roomId, lobby.map, lobby.players, lobby.you),
    onLink: (link) => menu?.setLink(link),
    onError: (message) => {
      console.error(`sim: ${message}`);
      menu?.setError(message);
    },
  };
  const statusPoll = window.setInterval(() => session.requestStatus(), STATUS_POLL_MS);
  const fogPoll = window.setInterval(() => {
    if (fogOn) session.requestFog();
  }, FOG_POLL_MS);

  let ended = false;
  function showEnd(winner: SimWinner): void {
    if (ended) return;
    ended = true;
    const won = winner.playerId === session.playerId;
    const how = { destruction: 'vernietiging', dominance: 'dominantie', surrender: 'opgave' }[
      winner.reason
    ];
    mountMatchEnd(endEl!, {
      won,
      how,
      onMenu: () => location.assign(menuUrl(location)),
      ...(hudSkin ? { skin: hudSkin } : {}),
      skinOn: skinOn && settings.hudSkin,
    });
    endEl!.style.display = 'grid';
  }

  const mine = (ids: Iterable<number>): number[] =>
    [...ids].filter((id) => entities.get(id)?.owner === session.playerId);
  /**
   * Hostile: another player's unit or building, or a neutral unit (a bandit of a creep camp, sim 0.20.0; the sim refuses
   * an Attack on a neutral wanderer for anyone but a Slaver). Neutral nodes and claim points are not.
   */
  const hostileRow = (e: EntityRow): boolean =>
    e.owner !== session.playerId &&
    (e.owner !== OWNER_NEUTRAL || kindOfTypeId(e.typeId).kind === 'unit');
  /** An enemy unit or building (not own, not a neutral node or claim point): clicking one inspects it, nothing more. */
  const isEnemyId = (id: number): boolean => {
    const e = entities.get(id);
    return e !== undefined && hostileRow(e);
  };
  /** Own entities of the latest snapshot, shared by the card and building-button deps (read at 20 Hz). */
  const own = (): EntityRow[] =>
    (ownCache ??= [...entities.values()].filter((e) => e.owner === session.playerId));
  const roleIdx = (role: string): number => ROLES.indexOf(role as (typeof ROLES)[number]);
  /** Builds like a builder (sim common.ts canBuild): role builder, or a robot with canBuild (the Bouwrobot, data 0.26.0). */
  const canBuildId = (id: number): boolean => {
    const l = loadoutOf(entities.get(id)!.typeId);
    return l !== undefined && (l.role === roleIdx('builder') || l.canBuild);
  };

  /** Commands carry at most 64 entity ids; larger selections are split. */
  function sendChunked<T extends CommandType>(
    type: T,
    ids: number[],
    extra: Omit<CommandPayload<T>, 'ids'>,
  ): void {
    for (let i = 0; i < ids.length; i += MAX_ENTITIES_PER_COMMAND) {
      session.sendCommand(type, {
        ids: ids.slice(i, i + MAX_ENTITIES_PER_COMMAND),
        ...extra,
      } as CommandPayload<T>);
    }
  }

  /** Right click: attack an enemy, gather from a scrap node, claim a point, otherwise move. */
  function orderAt(px: number, py: number): void {
    const ids = mine(selection).filter(
      (id) => loadoutOf(entities.get(id)!.typeId) || heroOf(entities.get(id)!.typeId),
    );
    if (ids.length === 0) return;
    const hit = renderer.pickAt(px, py);
    const target = hit.entityId === null ? undefined : entities.get(hit.entityId);
    if (target) {
      const kind = kindOfTypeId(target.typeId).kind;
      const hostile = hostileRow(target);
      // fog of war: a ghost (an enemy building as last seen) is no valid Attack target; attack-move to its spot
      if (hostile && (target.flags & ENTITY_FLAG.ghost) !== 0)
        return sendChunked('AttackMove', ids, { x: target.x, y: target.y });
      if (hostile && (kind === 'unit' || kind === 'building'))
        return sendChunked('Attack', ids, { target: target.id });
      if (kind === 'scrapNode') {
        const scavengers = ids.filter(
          (id) => loadoutOf(entities.get(id)!.typeId)?.role === roleIdx('scavenger'),
        );
        if (scavengers.length > 0) return sendChunked('Gather', scavengers, { nodeId: target.id });
      }
      if (kind === 'building' && target.owner === session.playerId && target.anim === ANIM.build) {
        // Unfinished own building: builders resume or help (Build on an own site of the same type helps).
        const builders = ids.filter(canBuildId);
        if (builders.length > 0)
          return sendChunked('Build', builders, {
            typeId: target.typeId,
            x: target.x,
            y: target.y,
          });
      }
      if (kind === 'claimPoint') {
        // Claim builds the faction's claim post next to the point: only builders can (sim contract 2).
        const builders = ids.filter(canBuildId);
        if (builders.length > 0) return sendChunked('Claim', builders, { pointId: target.id });
      }
    }
    if (hit.ground)
      sendChunked('Move', ids, { x: Math.round(hit.ground.x), y: Math.round(hit.ground.y) });
  }

  // Build menu: this player's faction buildings that need no research yet (tech arrives later) and are not the HQ.
  const buildable = (): BuildingData[] => {
    const faction = data.factions.find((f) => f.key === session.faction);
    if (!faction) return [];
    return data.buildings.filter(
      (b) =>
        b.factionId === faction.id && unlocked(b.prereqTech) && !b.provides.includes(hqProvidesIdx),
    );
  };
  let placing: BuildOption | null = null;

  /** Why the footprint cannot go here (Dutch), or null when it can; the sim validates again on Build. */
  function hudPlacementReason(option: BuildOption, cx: number, cy: number): string | null {
    const { w, h } = option.footprint;
    const buildings: CellRect[] = [];
    for (const e of entities.values()) {
      const b = buildingOf(e.typeId);
      if (b)
        buildings.push({
          x0: (e.x >> 8) - (b.footprint.w >> 1),
          y0: (e.y >> 8) - (b.footprint.h >> 1),
          w: b.footprint.w,
          h: b.footprint.h,
        });
    }
    return placementIssue(
      {
        gridW: map.grid.w,
        gridH: map.grid.h,
        passable: map.grid.passable,
        water,
        buildings,
        scrap: status?.scrap ?? 0,
        scrapCost: option.scrapCost,
      },
      { x0: (cx >> 8) - (w >> 1), y0: (cy >> 8) - (h >> 1), w, h },
    );
  }
  /**
   * The sim's own placement rule (data 0.18.0, @crawlout/sim/placement): free footprint, a free walkable margin, the
   * aisle around a drop-off building, no scrap node or claim point; the sim validates again on Build. The reason code
   * (PLACEMENT_REASONS) is there for the preview to show why a spot is refused.
   */
  // sim 0.18.0: the Raiders' plundermarkt (provides depot) is a drop-off building too
  const DEPOT_PROVIDES = [
    PROVIDES.indexOf('hq'),
    PROVIDES.indexOf('werkplaats'),
    PROVIDES.indexOf('depot'),
  ];
  const isDepot = (b: BuildingData): boolean => b.provides.some((p) => DEPOT_PROVIDES.includes(p));
  const CLAIM_PROVIDES = PROVIDES.indexOf('claim');
  /** The sim placement rule's input from the snapshot: every building, scrap node and claim point. */
  /**
   * This player's territory (data 0.20.0, the sim's territoryMask): buildRange around every own building (sites too),
   * claimBuildRange around a finished own claim post. Rebuilt only when the own buildings change. null: no rule.
   */
  const HQ_PROVIDES = PROVIDES.indexOf('hq');
  let territoryKey = '';
  let territory: Uint8Array | null = null;
  function territoryNow(): Uint8Array | null {
    const pl = data.sim.placement;
    if (pl.buildRangeU <= 0) return null;
    const range = (pl.buildRangeU + 255) >> 8;
    const claimRange = (pl.claimBuildRangeU + 255) >> 8;
    const src: number[] = [];
    for (const e of entities.values()) {
      const b = buildingOf(e.typeId);
      if (!b || e.owner !== session.playerId) continue;
      const post = b.provides.includes(CLAIM_PROVIDES) && !b.provides.includes(HQ_PROVIDES);
      if (post && e.anim === ANIM.build) continue;
      const { w: bw, h: bh } = b.footprint;
      src.push((e.x >> 8) - (bw >> 1), (e.y >> 8) - (bh >> 1), bw, bh, post ? claimRange : range);
    }
    const key = src.join(',');
    if (key !== territoryKey || territory === null) {
      territoryKey = key;
      territory = territoryMask(map.grid.w, map.grid.h, map.grid.passable, src, src.length / 5);
    }
    return territory;
  }
  function placementInputNow(): PlacementInput {
    const rects: number[] = [];
    const points: number[] = [];
    for (const e of entities.values()) {
      const b = buildingOf(e.typeId);
      if (b) {
        const { w: bw, h: bh } = b.footprint;
        const flags =
          (isDepot(b) ? RECT_DEPOT : 0) | (b.provides.includes(CLAIM_PROVIDES) ? RECT_CLAIM : 0);
        rects.push((e.x >> 8) - (bw >> 1), (e.y >> 8) - (bh >> 1), bw, bh, flags);
      } else if (e.typeId === SCRAP_NODE_TYPE_ID) points.push(e.x, e.y, POINT_NODE);
      else if (e.typeId === CLAIM_POINT_TYPE_ID) points.push(e.x, e.y, POINT_CLAIM);
    }
    return {
      territory: territoryNow(),
      mapW: map.grid.w,
      mapH: map.grid.h,
      passable: map.grid.passable,
      rects,
      rectCount: rects.length / 5,
      points,
      pointCount: points.length / 3,
      clearance: data.sim.placement.clearanceU,
      depotClearance: data.sim.placement.depotClearanceU,
    };
  }
  /** Centres (x, y pairs, sim units) of this player's headquarters, for the distance rule of the Kooi. */
  function ownHqCentres(): number[] {
    const out: number[] = [];
    for (const e of entities.values()) {
      const b = buildingOf(e.typeId);
      if (b && e.owner === session.playerId && b.provides.includes(HQ_PROVIDES)) out.push(e.x, e.y);
    }
    return out;
  }
  const placeAsOf = (typeId: number): number => {
    const own = buildingOf(typeId);
    return own !== undefined && isDepot(own) ? AS_DEPOT : 0;
  };
  function placementReasonFor(
    option: Pick<BuildOption, 'typeId' | 'footprint'>,
    cx: number,
    cy: number,
  ): number {
    const { w, h } = option.footprint;
    // a building with a distance rule to the own headquarters (the Raiders' Kooi, data 0.21.0, sim 0.18.0)
    const rule = buildingOf(option.typeId)?.placement ?? null;
    const input = placementInputNow();
    return simPlacementReason(
      rule === null
        ? input
        : {
            ...input,
            hqRange: { hqs: ownHqCentres(), min: rule.minFromHqU, max: rule.maxFromHqU },
          },
      (cx >> 8) - (w >> 1),
      (cy >> 8) - (h >> 1),
      w,
      h,
      placeAsOf(option.typeId),
    );
  }
  /**
   * A claim building (the Claimpaal) from the build menu near a claim point is a Claim (data 0.20.0): the preview snaps
   * to the spot the sim will use and a click sends Claim (game/claimPlacement.ts). null: not a claim building, or not
   * near a claim point (then it is placed as a plain Build).
   */
  function claimPlacementFor(option: BuildOption, cx: number, cy: number): ClaimPlacement | null {
    if (!buildingOf(option.typeId)?.provides.includes(CLAIM_PROVIDES)) return null;
    const points: ClaimPointView[] = [];
    const ownSites: OwnClaimSite[] = [];
    for (const e of entities.values()) {
      if (e.typeId === CLAIM_POINT_TYPE_ID)
        points.push({
          id: e.id,
          x: e.x,
          y: e.y,
          owner: e.owner === OWNER_NEUTRAL ? null : e.owner,
        });
      const b = buildingOf(e.typeId);
      if (
        b &&
        e.owner === session.playerId &&
        e.anim === ANIM.build &&
        b.provides.includes(CLAIM_PROVIDES)
      ) {
        const { w: fw, h: fh } = b.footprint;
        ownSites.push({
          x: e.x,
          y: e.y,
          fx: (e.x >> 8) - (fw >> 1),
          fy: (e.y >> 8) - (fh >> 1),
          fw,
          fh,
        });
      }
    }
    return claimPlacement({
      input: placementInputNow(),
      cursor: { x: cx, y: cy },
      footprint: option.footprint,
      as: placeAsOf(option.typeId),
      claimRadius: data.sim.claimRadiusU,
      points,
      ownSites,
      me: session.playerId,
      scrap: status?.scrap ?? 0,
      scrapCost: option.scrapCost,
    });
  }
  /** Dutch text per sim reason code (index = code); PLACE_OK has none. */
  const SIM_REASON_TEXT: readonly (string | null)[] = [
    null,
    'Overlapt een gebouw of onbegaanbaar terrein',
    'Te weinig vrije, begaanbare ruimte rondom',
    'Te dicht bij een ander gebouw',
    'Te dicht bij een afleverpunt (houd een looppad vrij)',
    'Staat op een scrapbron of claimpunt',
    `Buiten je gebied (bouw binnen ${data.sim.placement.buildRangeU >> 8} m van je gebouwen, ${data.sim.placement.claimBuildRangeU >> 8} m van een claimpaal)`,
    'Te ver van of te dicht bij je hoofdgebouw (een Kooi staat aan de rand van je basis)',
  ];
  /** Why the footprint cannot go here (Dutch), or null when it can: the clear HUD reasons first, then the sim rule. */
  function placementReason(option: BuildOption, cx: number, cy: number): string | null {
    const hud = hudPlacementReason(option, cx, cy);
    if (hud) return hud;
    const code = placementReasonFor(option, cx, cy);
    if (code === PLACE_HQ_RANGE) {
      // the Kooi's rule, in meters from the data: "Kooi moet aan de rand van je basis staan (18–34 m van het kamp)"
      const rule = buildingOf(option.typeId)?.placement;
      const key = buildingOf(option.typeId)?.key ?? '';
      return rule
        ? `${buildingName(key)} moet aan de rand van je basis staan (${Math.round(rule.minFromHqU / UNITS_PER_METER)}–${Math.round(rule.maxFromHqU / UNITS_PER_METER)} m van het kamp)`
        : SIM_REASON_TEXT[code]!;
    }
    return code === PLACE_OK ? null : (SIM_REASON_TEXT[code] ?? 'Hier kun je niet bouwen');
  }

  function placementAt(
    px: number,
    py: number,
  ): {
    x: number;
    y: number;
    valid: boolean;
    reason: string | null;
    claimPointId?: number;
  } | null {
    if (!placing) return null;
    const ground = renderer.pickAt(px, py).ground;
    if (!ground) return null;
    const at = snapFootprintCenter(ground.x, ground.y, placing.footprint);
    const claim = claimPlacementFor(placing, Math.round(at.x), Math.round(at.y));
    if (claim)
      return {
        x: claim.x,
        y: claim.y,
        valid: claim.valid,
        reason: claim.reason,
        claimPointId: claim.pointId,
      };
    const reason = placementReason(placing, at.x, at.y);
    return { x: Math.round(at.x), y: Math.round(at.y), valid: reason === null, reason };
  }

  let targeting: TargetingKind | null = null;

  /** Position and cooldown of the hero's ability, for the out-of-range check (see game/abilityHint.ts). */
  const probeAbility = (abilityId: number): AbilityProbe | null => {
    const hero = status?.hero;
    const e = hero ? entities.get(hero.entityId) : undefined;
    return hero && e
      ? { x: e.x, y: e.y, cooldownTicks: hero.abilityCooldownTicks?.[abilityId] ?? 0 }
      : null;
  };
  /** After a cast: if the sim rejected it for range (nothing started, the hero stood still), say so. */
  function watchAbilityCast(cast: CommandPayload<'HeroAbility'>): void {
    const before = probeAbility(cast.abilityId);
    const ability = myHero()?.abilities[cast.abilityId];
    if (!before || !ability || cast.x === undefined || cast.y === undefined) return;
    const target = { x: cast.x, y: cast.y };
    window.setTimeout(() => {
      const after = probeAbility(cast.abilityId);
      if (after && abilityOutOfRange({ rangeU: ability.rangeU, target, before, after }))
        hud.showHint(OUT_OF_RANGE_TEXT);
    }, ABILITY_HINT_DELAY_MS);
  }

  const deps: HudDeps = {
    sendCommand: <T extends CommandType>(type: T, payload: CommandPayload<T>) => {
      if (type === 'HeroAbility') watchAbilityCast(payload as CommandPayload<'HeroAbility'>);
      return session.sendCommand(type, payload);
    },
    getStatus: () => status,
    getSelection: () => {
      const ownIds = mine(selection);
      if (ownIds.length === 0) {
        // No own unit selected: a clicked enemy is shown for inspection (type, owner, hp, weapon and armour), no commands.
        const foe = [...selection].map((id) => entities.get(id)).find((e) => e && isEnemyId(e.id));
        if (!foe) return [];
        const info = inspect(data, foe.typeId);
        // a bandit of a camp the player's faction takes over (data 0.27.0; PlayerStatus.camps, protocol 0.14.0)
        const hint =
          foe.owner === OWNER_NEUTRAL
            ? takeoverHint(data, myFaction()?.id, status?.camps, foe.x, foe.y)
            : null;
        return [
          {
            id: foe.id,
            typeId: foe.typeId,
            loadoutName: info.name,
            hpPct: foe.hpPct,
            role: null,
            enemy: true,
            ownerLabel: info.ownerLabel,
            ...(info.detail ? { detail: info.detail } : {}),
            ...(hint ? { note: hint } : {}),
            // A ghost (fog of war): an enemy building as the player last saw it.
            ...((foe.flags & ENTITY_FLAG.ghost) !== 0 ? { lastSeen: true } : {}),
          },
        ];
      }
      return ownIds.map((id): SelectedEntity => {
        const e = entities.get(id)!;
        const l = loadoutOf(e.typeId);
        const b = buildingOf(e.typeId);
        const name =
          (l ? (LOADOUT_NAMES[l.key] ?? l.key) : undefined) ??
          heroOf(e.typeId)?.naam ??
          (b ? buildingName(b.key) : null);
        // The protocol Role has only the three SetRole roles; technician and robot (data 0.16.0) show as no role for now.
        const dataRole = l === undefined ? undefined : ROLES[l.role];
        // a robot that builds (the Bouwrobot, data 0.26.0) is a builder for the HUD (Verplaats, Stop, Bouw)
        const settlerRole =
          dataRole === 'scavenger' || dataRole === 'builder' || dataRole === 'militia'
            ? dataRole
            : null;
        const role = l?.canBuild ? 'builder' : settlerRole;
        const robot = l !== undefined && BODY_TYPES[l.bodyType] === 'robot';
        const raiderKind = raiderKindOf(data, l);
        const lines = raiderLines(
          data,
          myFaction()?.id,
          session.playerId,
          e,
          entities.values(),
          TICK_HZ,
          status?.techs ?? [],
        );
        return {
          id,
          typeId: e.typeId,
          loadoutName: name,
          hpPct: e.hpPct,
          role,
          ...(robot ? { robot } : {}),
          ...(raiderKind ? { raiderKind } : {}),
          ...(lines.length > 0 ? { lines } : {}),
          // For the camera when the player clicks a unit card in the selection panel (HUD selections only).
          x: e.x,
          y: e.y,
          // A building site has nothing to offer yet: say so instead of showing an empty panel.
          ...(b && e.anim === ANIM.build ? { note: 'In aanbouw' } : {}),
        };
      });
    },
    getNetwork: () => network,
    playerName: (id) => session.playerName(id),
    beginTargeting: (kind) => {
      targeting = kind;
      canvas.style.cursor = 'crosshair';
    },
    endTargeting: () => {
      targeting = null;
      canvas.style.cursor = 'default';
    },
    getMinimap: (): MinimapData => {
      const blips: MinimapData['blips'][number][] = [];
      const claims: MinimapData['claims'][number][] = [];
      const claimStates = new Map(status?.claimPoints?.map((c) => [c.pointId, c]));
      for (const e of entities.values()) {
        const kind = kindOfTypeId(e.typeId).kind;
        if (kind === 'claimPoint') {
          const cs = claimStates.get(e.id);
          claims.push({
            x: e.x,
            y: e.y,
            owner: e.owner === OWNER_NEUTRAL ? null : e.owner,
            ...(cs && cs.activity !== 'none'
              ? { progress: cs.progressPermille / 1000, claimer: cs.by }
              : {}),
          });
        } else if (kind === 'scrapNode')
          blips.push({ x: e.x, y: e.y, owner: e.owner, kind: 'node' });
        else
          blips.push({
            x: e.x,
            y: e.y,
            owner: e.owner,
            kind: kind === 'building' ? 'building' : 'unit',
            ...((e.flags & ENTITY_FLAG.ghost) !== 0 ? { ghost: true } : {}),
          });
      }
      // creep camps (protocol 0.14.0, voorstel): neutral, or in the colour of whoever took it over (data 0.27.0)
      const camps = (status?.camps ?? []).map((c) => ({
        x: c.x,
        y: c.y,
        owner: c.state === 'taken' ? c.owner : null,
        ...(c.state === 'cleared' ? { cleared: true } : {}),
      }));
      return {
        w: map.grid.w,
        h: map.grid.h,
        passable: map.grid.passable,
        ...minimapStatic,
        blips,
        claims,
        camps,
        ...(minimapFog ? { fog: minimapFog } : {}),
      };
    },
    focusCamera: (x, y) => renderer.focus(x, y),
    getBuildOptions: () =>
      buildable().map((b) => ({
        buildingId: b.id,
        typeId: buildingTypeId(b.id),
        naam: buildingName(b.key),
        scrapCost: b.scrapCost,
        footprint: b.footprint,
        affordable: (status?.scrap ?? 0) >= b.scrapCost,
      })),
    beginPlacement: (option) => {
      placing = option;
      canvas.style.cursor = 'copy';
    },
    endPlacement: () => {
      placing = null;
      renderer.setPlacementPreview(null);
      canvas.style.cursor = 'default';
    },
    // Hero panel from PlayerStatus.hero (HeroStatus) plus names, abilities and perks from packages/data.
    heroName: (heroId) => data.heroes[heroId]?.naam,
    getPerkOptions: () => perkOptions(data, status?.hero ?? null),
    // Settlers switch role in a workshop (the sim walks them there): without a finished one the role buttons stay hidden.
    // a workshop, or (Raiders, sim 0.18.0) a cage where slaves switch between gathering and building
    canSwitchRole: () => hasFinishedWorkshop(data, own()) || hasFinished(data, own(), 'kooi'),
    getHeroAbilities: () =>
      (myHero()?.abilities ?? []).map((a, i) => {
        const left = status?.hero?.abilityCooldownTicks?.[i] ?? 0;
        const cooldownPct =
          a.cooldownTicks > 0 ? Math.min(100, Math.round((left * 100) / a.cooldownTicks)) : 0;
        return { abilityId: i, naam: a.naam, needsTarget: a.rangeU > 0, cooldownPct };
      }),
    isHeroDead: () => status?.hero?.state === 'dead',
    reviveHero: () => {
      const hq = myHq();
      if (hq) session.sendCommand('Recruit', { buildingId: hq.id });
    },
    getBuildingCards: () =>
      buildingCards(cardContext(mine(selection).map((id) => entities.get(id)!))),
    getBuildingButtons: () => buildingButtons(cardContext([])),
    startCard: (card) => {
      if (card.kind === 'research') session.sendCommand('Research', { techId: card.id });
      else if (card.kind === 'revive') session.sendCommand('Recruit', { buildingId: card.id });
      else if (card.kind === 'produce' && card.buildingId !== undefined)
        session.sendCommand('Produce', { buildingId: card.buildingId, loadoutId: card.id });
      else if (card.kind === 'train' && card.buildingId !== undefined)
        session.sendCommand('Train', { buildingId: card.buildingId, programId: card.id });
      else if (card.kind === 'craft') {
        const settlers = mine(selection).filter((id) => loadoutOf(entities.get(id)!.typeId));
        if (settlers.length > 0) sendChunked('Craft', settlers, { loadoutId: card.id });
      }
    },
    cancelCard: (card) => {
      // Research and revive run in the building, craft runs on the settler (contract 1, QueueItem.unitId).
      const items = status?.queue?.filter((q) => q.kind === card.kind && q.id === card.id) ?? [];
      const ids =
        card.kind === 'revive'
          ? [card.id]
          : card.kind === 'craft'
            ? items.flatMap((q) =>
                q.unitId !== undefined && q.unitId !== ENTITY_NONE ? [q.unitId] : [],
              )
            : items.flatMap((q) => (q.buildingId !== ENTITY_NONE ? [q.buildingId] : []));
      if (ids.length > 0) sendChunked('Cancel', ids, {});
    },
    getDominance: () => dominanceView(status, (id) => session.playerName(id), session.playerId),
    getRaiderStats: raiderStatsNow,
    hasEnemySlaves: () => seesEnemySlaves(data, session.playerId, OWNER_NEUTRAL, entities.values()),
    getRoster: () => buildRoster(data, myFaction()?.id, session.playerId, entities.values()),
    selectUnits: (ids, add) => {
      selection = add ? new Set([...selection, ...ids]) : new Set(ids);
      notify();
    },
    subscribeAlerts: (cb) => {
      alertListeners.add(cb);
      return () => alertListeners.delete(cb);
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  // The HUD mounts when the match starts (the menu has the screen until then); until then it is a stand-in that does
  // nothing, so the pointer code below needs no checks.
  let realHud: HudHandle | null = null;
  const hud: HudHandle = {
    completePlacement: (p) => realHud?.completePlacement(p) ?? false,
    cancelPlacement: () => realHud?.cancelPlacement(),
    setPlacementHint: (r) => realHud?.setPlacementHint(r),
    showHint: (t) => realHud?.showHint(t),
    completeTargeting: (t) => realHud?.completeTargeting(t) ?? false,
    cancelTargeting: () => realHud?.cancelTargeting(),
    targetingActive: () => realHud?.targetingActive() ?? false,
    placementActive: () => realHud?.placementActive() ?? false,
    refresh: () => realHud?.refresh(),
    unmount: () => realHud?.unmount(),
  };

  /** The match is on: the menu goes, the HUD and frame stats come, the camera goes to this player's base. */
  function enterMatch(): void {
    ambient?.stop();
    menu?.hide();
    realHud ??= mountHud(hudEl!, deps, { ...(hudSkin ? { skin: hudSkin } : {}), skinOn });
    if (perfEl) perfEl.style.visibility = '';
    const cam = renderer.cameraControls;
    cam.yaw = DEFAULT_YAW;
    cam.zoomTo(DEFAULT_ZOOM_M, true);
    const home = map.grid.spawns[session.playerId];
    if (home) renderer.focus(home.ux, home.uy);
    if (fogOn) session.requestFog();
    else session.revealAll(true);
  }

  launchMatch = (net, options) => {
    const real = startSession(data, map, sessionEvents, net, options);
    session.attach(real);
    void real.started.then(enterMatch);
  };
  // No menu: the match starts from the URL, as it always did (also over `?relay=` with the automatic lobby).
  if (mode === 'match') launchMatch(netOptionsFromSearch(location.search), {});

  // Pointer: left click/drag selects (shift adds); while placing or targeting a left click picks the spot.
  let drag: { x: number; y: number; moved: boolean } | null = null;
  const local = (e: PointerEvent | MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  /**
   * The HUD ends targeting and placement on its own (finished order, Escape, empty selection) and tells us through
   * endTargeting and endPlacement. If that ever goes missing, a stale mode would swallow every click and nothing
   * could be selected any more: so check with the HUD before treating a click as a target or a placement.
   */
  const syncModes = (): void => {
    if (targeting && !hud.targetingActive()) {
      targeting = null;
      canvas.style.cursor = 'default';
    }
    if (placing && !hud.placementActive()) {
      placing = null;
      renderer.setPlacementPreview(null);
      canvas.style.cursor = 'default';
    }
  };
  const endDrag = (): void => {
    marquee.style.display = 'none';
    drag = null;
  };
  canvas.addEventListener('pointerdown', (e) => {
    // Ctrl+click is the Mac right click: the contextmenu event that follows gives the order.
    if (e.button !== 0 || e.ctrlKey) return;
    const p = local(e);
    syncModes();
    if (placing || targeting) {
      const hit = renderer.pickAt(p.x, p.y);
      const picked = hit.entityId === null ? undefined : entities.get(hit.entityId);
      const hitKind = picked ? kindOfTypeId(picked.typeId).kind : 'none';
      const state: ClickMode = placing
        ? { mode: 'placement' }
        : { mode: 'targeting', kind: targeting! };
      const hostile = picked !== undefined && hostileRow(picked);
      // A ghost is no target (the sim refuses it): a click on one is a click on its spot.
      const ghost = picked !== undefined && (picked.flags & ENTITY_FLAG.ghost) !== 0;
      if (leftClickIs(state, hitKind, hostile) === 'complete') {
        if (placing) {
          const at = placementAt(p.x, p.y);
          if (at?.valid && at.claimPointId !== undefined) {
            // a claim post at a claim point: Claim, so the sim places it next to the point (claimPlacement.ts)
            const builders = mine(selection).filter(canBuildId);
            const order = placementCommand(at, placing.typeId, builders);
            if (builders.length > 0 && order.type === 'Claim')
              sendChunked('Claim', builders, { pointId: order.payload.pointId });
            hud.cancelPlacement();
            syncModes();
          } else if (at?.valid && hud.completePlacement({ x: at.x, y: at.y })) {
            placing = null;
            renderer.setPlacementPreview(null);
            canvas.style.cursor = 'default';
          }
        } else if (picked && hostile && !ghost && (hitKind === 'unit' || hitKind === 'building')) {
          hud.completeTargeting({ enemyId: picked.id, x: picked.x, y: picked.y });
        } else if (targeting === 'gather' && picked && hitKind === 'scrapNode') {
          hud.completeTargeting({ nodeId: picked.id });
        } else if (hit.ground) {
          hud.completeTargeting({ x: Math.round(hit.ground.x), y: Math.round(hit.ground.y) });
        }
        return;
      }
      // A click on a unit or building leaves placement or targeting and selects what was clicked (pointerup).
      hud.cancelPlacement();
      hud.cancelTargeting();
      syncModes();
    }
    canvas.setPointerCapture(e.pointerId);
    drag = { ...p, moved: false };
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (placing) {
      const at = placementAt(p.x, p.y);
      renderer.setPlacementPreview(
        at ? { typeId: placing.typeId, x: at.x, y: at.y, valid: at.valid } : null,
      );
      hud.setPlacementHint(at?.reason ?? null);
      return;
    }
    if (!drag) return;
    if (!drag.moved && Math.hypot(p.x - drag.x, p.y - drag.y) < DRAG_THRESHOLD_PX) return;
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
    let ids = drag.moved
      ? renderer.boxSelect(
          { x0: drag.x, y0: drag.y, x1: p.x, y1: p.y },
          { owner: session.playerId },
        )
      : [];
    if (ids.length === 0 && Math.hypot(p.x - drag.x, p.y - drag.y) < SMALL_DRAG_PX) {
      // A click, or a tiny drag that caught nobody: pick where the press started (buildings by their whole drawn volume, see the renderer's pick box).
      const hit = renderer.pickAt(drag.x, drag.y).entityId;
      ids = hit === null ? [] : [hit];
    }
    selection = nextSelection(selection, ids, e.shiftKey, isEnemyId);
    endDrag();
    notify();
  });
  // A press that never gets its pointerup (cancelled by the system, capture lost) must not leave the marquee on screen.
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    syncModes();
    if (placing) return hud.cancelPlacement();
    if (targeting) return hud.cancelTargeting();
    const p = local(e);
    orderAt(p.x, p.y);
  });

  // Edge scroll follows the pointer over the whole window, so a pointer resting on a panel near the screen edge kept
  // scrolling the map away. Pointer moves over HUD panels no longer reach the camera; one synthetic blur on entering a
  // panel makes it forget the last canvas position (and stop scrolling) until the pointer is over the canvas again.
  let overPanel = false;
  hudEl.addEventListener('pointermove', (e) => {
    e.stopPropagation();
    if (!overPanel) {
      overPanel = true;
      window.dispatchEvent(new Event('blur'));
    }
  });
  canvas.addEventListener('pointermove', () => {
    overPanel = false;
  });

  // Escape that the HUD did not use (no mode, menu or dialog to close) clears the selection, so a new pick is always free.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || selection.size === 0) return;
    selection = new Set();
    notify();
  });

  window.addEventListener('beforeunload', () => {
    perfBadge?.dispose();
    window.clearInterval(statusPoll);
    window.clearInterval(fogPoll);
    session.dispose();
    hud.unmount();
    renderer.dispose();
  });
  (window as unknown as { crawlout: unknown }).crawlout = {
    renderer,
    session,
    /** The pre-match menu (null when the URL started the match directly); for the browser tests. */
    menu,
    /** Scripted camera run for the render bench (render/bench.ts): base turn, pan to the middle, wide turns. */
    bench: (opts?: { seconds?: number }) => {
      const mine = own();
      const n = Math.max(1, mine.length);
      const bounds = renderer.cameraControls.bounds;
      return runBaseBench(
        renderer,
        bounds ? bounds.maxX : 384,
        [
          mine.reduce((a, e) => a + e.x, 0) / n / UNITS_PER_METER,
          mine.reduce((a, e) => a + e.y, 0) / n / UNITS_PER_METER,
        ],
        opts,
      );
    },
    entities: () => entities,
    status: () => status,
    /** Unit type id of a loadout by data key (-1 if unknown), so a browser test never hard-codes ids that shift with new data. */
    unitTypeId: (key: string): number => {
      const l = data.loadouts.find((x) => x.key === key);
      return l ? unitTypeId(l.id) : -1;
    },
    /** Fog of war, dev and tests (tools/replay hud-clicks): true shows every entity, false only what this player sees. */
    revealAll: (on: boolean) => {
      // The sim's reveal-all view shows every entity: the fog of war goes with it, and returns when switched off.
      fogOn = !on;
      if (on) applyFog(null);
      else session.requestFog();
      session.revealAll(on);
    },
    /** This player's territory mask (1 per cell, map width), for a later territory overlay in render or the HUD. */
    territory: () => territoryNow(),
    /** For the real-browser HUD test (tools/replay hud-clicks): building type ids by data key, and the sim's rule. */
    placement: {
      typeId: (key: string): number => {
        const b = data.buildings.find((x) => x.key === key);
        return b ? buildingTypeId(b.id) : -1;
      },
      footprint: (key: string) => data.buildings.find((x) => x.key === key)?.footprint,
      /** Sim reason code (PLACE_OK = 0) for the building with this data key centred on (cx, cy) in sim units. */
      reason: (key: string, cx: number, cy: number): number => {
        const b = data.buildings.find((x) => x.key === key);
        return b
          ? placementReasonFor({ typeId: buildingTypeId(b.id), footprint: b.footprint }, cx, cy)
          : -1;
      },
    },
  };
}

main().catch((err: unknown) => {
  console.error(err);
  showError(`Crawlout kon niet starten: ${err instanceof Error ? err.message : String(err)}`);
});

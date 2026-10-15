// Composition: sim worker (packages/sim) + renderer (packages/render) + HUD (packages/ui) + loopback relay.
// Local skirmish against the scripted AI on the slice map; the same session code drives the ws relay later.
import {
  ANIM,
  ENTITY_NONE,
  MAX_ENTITIES_PER_COMMAND,
  OWNER_NEUTRAL,
  type CommandPayload,
  type CommandType,
  type DesyncEvent,
  type PlayerStatus,
  type StallNotice,
} from '@crawlout/protocol';
import {
  PROVIDES,
  ROLES,
  buildingTypeId,
  heroIdOfTypeId,
  kindOfTypeId,
  type BuildingData,
} from '@crawlout/data';
import { createRenderer, snapFootprintCenter } from '@crawlout/render';
import {
  mountHud,
  type BuildOption,
  type HudAlert,
  type HudDeps,
  type MinimapData,
  type NetworkState,
  type SelectedEntity,
  type TargetingKind,
} from '@crawlout/ui';
import type { SimWinner } from '@crawlout/sim';
import { assetConfig } from './game/assets.js';
import { propSource } from './render/props.js';
import { terrainTextures } from './render/terrain.js';
import { loadClientMapWater } from './render/water.js';
import { loadClientGameData, loadClientMap } from './game/content.js';
import { startSession } from './game/session.js';
import { createStatusOverlay } from './net/statusOverlay.js';
import { buildingCards } from './game/cards.js';
import { dominanceView } from './game/dominance.js';
import { minimapLayers } from './game/minimapLayers.js';
import { buildRoster } from './game/roster.js';
import { EVENT_TYPE, readSnapshot, type EntityRow } from './game/snapshot.js';

const SLICE_MAP = 'rustbelt';
const STATUS_POLL_MS = 250;
/** A press that moves less than this is a click, not a drag: trackpad clicks often wobble a few pixels. */
const DRAG_THRESHOLD_PX = 8;
/** A drag this small that catches no unit counts as a click at the press point. */
const SMALL_DRAG_PX = 24;
/** Under-attack alerts are rate limited so a long fight is one toast, not a flood. */
const ATTACK_ALERT_COOLDOWN_MS = 8000;

function showError(message: string): void {
  const el = document.getElementById('error');
  if (!el) return;
  el.textContent = message;
  el.style.display = 'grid';
}

async function main(): Promise<void> {
  const canvas = document.getElementById('view') as HTMLCanvasElement | null;
  const marquee = document.getElementById('marquee') as HTMLDivElement | null;
  const hudEl = document.getElementById('hud');
  const endEl = document.getElementById('end');
  if (!canvas || !marquee || !hudEl || !endEl)
    throw new Error('index.html mist #view, #marquee, #hud of #end');

  const data = loadClientGameData();
  const map = loadClientMap(SLICE_MAP);
  const params = new URLSearchParams(location.search);
  const perf = document.getElementById('perf') ?? true;
  // Local fan art only in dev: a production build drops this import, so it never ships.
  const localAssets = import.meta.env.DEV ? await import('./game/localAssets.js') : null;
  const assets = assetConfig(params, data.heroes, localAssets);
  const textures = terrainTextures();
  const renderer = await createRenderer({
    canvas,
    forceWebGL: params.has('webgl'),
    stats: perf,
    // A and S are HUD hotkeys (attack-move, stop); W, D, arrows and Q/E keep moving the camera.
    camera: { panKeys: { KeyA: null, KeyS: null } },
    ...(assets ? { assets } : {}),
    ...(textures ? { terrainTextures: textures } : {}),
  });
  renderer.setTerrain(map.terrain);
  renderer.setGameData(data);
  void renderer.setProps(map.props, propSource());
  const water = loadClientMapWater(SLICE_MAP);
  if (water) renderer.setWater(water);
  const minimapStatic = minimapLayers(map.grid.w, map.grid.h, map.grid.passable, map.props, water);

  // Selection is local UI state, never sim state: it is stamped into each snapshot's flags for the renderer.
  let selection = new Set<number>();
  let entities = new Map<number, EntityRow>();
  let status: PlayerStatus | null = null;
  let network: NetworkState = { desync: null, stall: null };
  const listeners = new Set<() => void>();
  const notify = (): void => listeners.forEach((l) => l());
  const alertListeners = new Set<(a: HudAlert) => void>();
  const alert = (a: HudAlert): void => alertListeners.forEach((l) => l(a));
  let lastAttackAlert = -Infinity;

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
  const myHq = (): EntityRow | undefined =>
    [...entities.values()].find(
      (e) => e.owner === session.playerId && buildingOf(e.typeId)?.provides.includes(hqProvidesIdx),
    );

  const netStatus = createStatusOverlay();
  const session = startSession(data, map, {
    onSnapshot(buf) {
      const previous = entities;
      const snap = readSnapshot(buf, selection);
      entities = snap.entities;
      for (const id of selection) if (!entities.has(id)) selection.delete(id);
      renderer.pushSnapshot(buf);
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
      notify();
    },
    onStatus(next, winner) {
      status = next;
      if (winner) showEnd(winner);
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
    onConnection: (text) => netStatus.set(text),
    onError: (message) => console.error(`sim: ${message}`),
  });
  const statusPoll = window.setInterval(() => session.requestStatus(), STATUS_POLL_MS);

  let ended = false;
  function showEnd(winner: SimWinner): void {
    if (ended) return;
    ended = true;
    const won = winner.playerId === session.playerId;
    const how = { destruction: 'vernietiging', dominance: 'dominantie', surrender: 'opgave' }[
      winner.reason
    ];
    endEl!.textContent = `${won ? 'Gewonnen' : 'Verloren'} door ${how}. Herlaad de pagina voor een nieuw potje.`;
    endEl!.style.display = 'grid';
  }

  const mine = (ids: Iterable<number>): number[] =>
    [...ids].filter((id) => entities.get(id)?.owner === session.playerId);
  const roleIdx = (role: string): number => ROLES.indexOf(role as (typeof ROLES)[number]);

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
      const hostile = target.owner !== session.playerId && target.owner !== OWNER_NEUTRAL;
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
        const builders = ids.filter(
          (id) => loadoutOf(entities.get(id)!.typeId)?.role === roleIdx('builder'),
        );
        if (builders.length > 0)
          return sendChunked('Build', builders, {
            typeId: target.typeId,
            x: target.x,
            y: target.y,
          });
      }
      if (kind === 'claimPoint') {
        // Claim builds the faction's claim post next to the point: only builders can (sim contract 2).
        const builders = ids.filter(
          (id) => loadoutOf(entities.get(id)!.typeId)?.role === roleIdx('builder'),
        );
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

  /** Footprint cells must be passable and free of other buildings; the sim validates again on Build. */
  function placementValid(option: BuildOption, cx: number, cy: number): boolean {
    const { w, h } = option.footprint;
    const x0 = (cx >> 8) - (w >> 1);
    const y0 = (cy >> 8) - (h >> 1);
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (
          x < 0 ||
          y < 0 ||
          x >= map.grid.w ||
          y >= map.grid.h ||
          map.grid.passable[y * map.grid.w + x] !== 1
        )
          return false;
      }
    }
    for (const e of entities.values()) {
      const b = buildingOf(e.typeId);
      if (!b) continue;
      const bx0 = (e.x >> 8) - (b.footprint.w >> 1);
      const by0 = (e.y >> 8) - (b.footprint.h >> 1);
      if (x0 < bx0 + b.footprint.w && bx0 < x0 + w && y0 < by0 + b.footprint.h && by0 < y0 + h)
        return false;
    }
    return true;
  }

  function placementAt(px: number, py: number): { x: number; y: number; valid: boolean } | null {
    if (!placing) return null;
    const ground = renderer.pickAt(px, py).ground;
    if (!ground) return null;
    const at = snapFootprintCenter(ground.x, ground.y, placing.footprint);
    return { x: Math.round(at.x), y: Math.round(at.y), valid: placementValid(placing, at.x, at.y) };
  }

  let targeting: TargetingKind | null = null;

  const deps: HudDeps = {
    sendCommand: <T extends CommandType>(type: T, payload: CommandPayload<T>) =>
      session.sendCommand(type, payload),
    getStatus: () => status,
    getSelection: () =>
      mine(selection).map((id): SelectedEntity => {
        const e = entities.get(id)!;
        const l = loadoutOf(e.typeId);
        const name = l?.key ?? heroOf(e.typeId)?.naam ?? buildingOf(e.typeId)?.key ?? null;
        const role = l === undefined ? null : (ROLES[l.role] ?? null);
        return { id, typeId: e.typeId, loadoutName: name, hpPct: e.hpPct, role };
      }),
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
      for (const e of entities.values()) {
        const kind = kindOfTypeId(e.typeId).kind;
        if (kind === 'claimPoint')
          claims.push({ x: e.x, y: e.y, owner: e.owner === OWNER_NEUTRAL ? null : e.owner });
        else if (kind === 'scrapNode') blips.push({ x: e.x, y: e.y, owner: e.owner, kind: 'node' });
        else
          blips.push({
            x: e.x,
            y: e.y,
            owner: e.owner,
            kind: kind === 'building' ? 'building' : 'unit',
          });
      }
      return { w: map.grid.w, h: map.grid.h, passable: map.grid.passable, ...minimapStatic, blips, claims };
    },
    focusCamera: (x, y) => renderer.focus(x, y),
    getBuildOptions: () =>
      buildable().map((b) => ({
        buildingId: b.id,
        typeId: buildingTypeId(b.id),
        naam: b.key,
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
      buildingCards({
        data,
        factionId: myFaction()?.id,
        playerId: session.playerId,
        status,
        selected: mine(selection).map((id) => entities.get(id)!),
        own: [...entities.values()].filter((e) => e.owner === session.playerId),
        heroDead: status?.hero?.state === 'dead' || status?.hero?.state === 'reviving',
      }),
    startCard: (card) => {
      if (card.kind === 'research') session.sendCommand('Research', { techId: card.id });
      else if (card.kind === 'revive') session.sendCommand('Recruit', { buildingId: card.id });
      else {
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
            ? items.flatMap((q) => (q.unitId !== undefined && q.unitId !== ENTITY_NONE ? [q.unitId] : []))
            : items.flatMap((q) => (q.buildingId !== ENTITY_NONE ? [q.buildingId] : []));
      if (ids.length > 0) sendChunked('Cancel', ids, {});
    },
    getDominance: () => dominanceView(status, (id) => session.playerName(id), session.playerId),
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
  const hud = mountHud(hudEl, deps);

  // Over ws the start message arrives later than the loopback's; playerId is valid once `started` resolves.
  void session.started.then(() => {
    const home = map.grid.spawns[session.playerId];
    if (home) renderer.focus(home.ux, home.uy);
  });

  // Pointer: left click/drag selects (shift adds); while placing or targeting a left click picks the spot.
  let drag: { x: number; y: number; moved: boolean } | null = null;
  const local = (e: PointerEvent | MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  canvas.addEventListener('pointerdown', (e) => {
    // Ctrl+click is the Mac right click: the contextmenu event that follows gives the order.
    if (e.button !== 0 || e.ctrlKey) return;
    const p = local(e);
    if (placing) {
      const at = placementAt(p.x, p.y);
      if (at?.valid && hud.completePlacement({ x: at.x, y: at.y })) {
        placing = null;
        renderer.setPlacementPreview(null);
        canvas.style.cursor = 'default';
      }
      return;
    }
    if (targeting) {
      const hit = renderer.pickAt(p.x, p.y);
      const node = hit.entityId === null ? undefined : entities.get(hit.entityId);
      if (targeting === 'gather' && node && kindOfTypeId(node.typeId).kind === 'scrapNode')
        hud.completeTargeting({ nodeId: node.id });
      else if (hit.ground)
        hud.completeTargeting({ x: Math.round(hit.ground.x), y: Math.round(hit.ground.y) });
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    drag = { ...p, moved: false };
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (placing) {
      const at = placementAt(p.x, p.y);
      renderer.setPlacementPreview(at ? { typeId: placing.typeId, ...at } : null);
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
      // A click, or a tiny drag that caught nobody: pick where the press started.
      const hit = renderer.pickAt(drag.x, drag.y).entityId;
      ids = hit === null ? [] : [hit];
    }
    selection = e.shiftKey ? new Set([...selection, ...ids]) : new Set(ids);
    marquee.style.display = 'none';
    drag = null;
    notify();
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (placing) return hud.cancelPlacement();
    if (targeting) return hud.cancelTargeting();
    const p = local(e);
    orderAt(p.x, p.y);
  });

  window.addEventListener('beforeunload', () => {
    window.clearInterval(statusPoll);
    session.dispose();
    hud.unmount();
    renderer.dispose();
  });
  (window as unknown as { crawlout: unknown }).crawlout = {
    renderer,
    session,
    entities: () => entities,
    status: () => status,
  };
}

main().catch((err: unknown) => {
  console.error(err);
  showError(`Crawlout kon niet starten: ${err instanceof Error ? err.message : String(err)}`);
});

// Composition: sim worker (packages/sim) + renderer (packages/render) + HUD (packages/ui) + loopback relay.
// Local skirmish against the scripted AI on the slice map; the same session code drives the ws relay later.
import {
  ANIM,
  ENTITY_FLAG,
  ENTITY_NONE,
  MAX_ENTITIES_PER_COMMAND,
  OWNER_NEUTRAL,
  UNITS_PER_METER,
  type CommandPayload,
  type CommandType,
  type DesyncEvent,
  type PlayerStatus,
  type StallNotice,
} from '@crawlout/protocol';
import {
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
import {
  AS_DEPOT,
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
import { startSession } from './game/session.js';
import { createStatusOverlay } from './net/statusOverlay.js';
import {
  buildingButtons,
  buildingCards,
  buildingName,
  hasFinishedWorkshop,
  type CardContext,
} from './game/cards.js';
import { perkOptions } from './game/perks.js';
import { inspect } from './game/inspect.js';
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
import { minimapLayers } from './game/minimapLayers.js';
import { LOADOUT_NAMES, buildRoster } from './game/roster.js';
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
  const perfEl = document.getElementById('perf');
  // Local fan art only in dev: a production build drops this import, so it never ships.
  const localAssets = import.meta.env.DEV ? await import('./game/localAssets.js') : null;
  const assets = assetConfig(params, data.heroes, localAssets);
  const textures = terrainTextures();
  const renderer = await createRenderer({
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
  renderer.setTerrain(map.terrain, { albedoLayout: albedoLayoutForMap(SLICE_MAP) });
  renderer.setGameData(data);
  void renderer.setProps(map.props, propSource());
  const water = loadClientMapWater(SLICE_MAP);
  if (water) renderer.setWater(water);
  const minimapStatic = minimapLayers(map.grid.w, map.grid.h, map.grid.passable, map.props, water);

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

  const perfBadge = perfEl ? createPerfBadge(perfEl, () => renderer.stats()) : null;
  const netStatus = createStatusOverlay();
  const session = startSession(data, map, {
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
      notify();
    },
    onStatus(next, winner) {
      status = next;
      renderer.setClaimStates(next.claimPoints);
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
  /** An enemy unit or building (not own, not a neutral node or claim point): clicking one inspects it, nothing more. */
  const isEnemyId = (id: number): boolean => {
    const e = entities.get(id);
    return e !== undefined && e.owner !== session.playerId && e.owner !== OWNER_NEUTRAL;
  };
  /** Own entities of the latest snapshot, shared by the card and building-button deps (read at 20 Hz). */
  const own = (): EntityRow[] =>
    (ownCache ??= [...entities.values()].filter((e) => e.owner === session.playerId));
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
  const DEPOT_PROVIDES = [PROVIDES.indexOf('hq'), PROVIDES.indexOf('werkplaats')];
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
    return simPlacementReason(
      placementInputNow(),
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
  ];
  /** Why the footprint cannot go here (Dutch), or null when it can: the clear HUD reasons first, then the sim rule. */
  function placementReason(option: BuildOption, cx: number, cy: number): string | null {
    const hud = hudPlacementReason(option, cx, cy);
    if (hud) return hud;
    const code = placementReasonFor(option, cx, cy);
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
        const role =
          dataRole === 'scavenger' || dataRole === 'builder' || dataRole === 'militia'
            ? dataRole
            : null;
        return {
          id,
          typeId: e.typeId,
          loadoutName: name,
          hpPct: e.hpPct,
          role,
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
          });
      }
      return {
        w: map.grid.w,
        h: map.grid.h,
        passable: map.grid.passable,
        ...minimapStatic,
        blips,
        claims,
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
    canSwitchRole: () => hasFinishedWorkshop(data, own()),
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
  // The bitmap HUD skin (local art, assets/local/hud) is dev only; a production build drops this import. `?noskin`
  // shows the CSS-only look that production gets.
  const hudSkin =
    import.meta.env.DEV && !params.has('noskin')
      ? (await import('./ui/hudSkin.js')).loadHudSkin()
      : undefined;
  const hud = mountHud(hudEl, deps, hudSkin ? { skin: hudSkin } : {});

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
      const hostile =
        picked !== undefined && picked.owner !== session.playerId && picked.owner !== OWNER_NEUTRAL;
      if (leftClickIs(state, hitKind, hostile) === 'complete') {
        if (placing) {
          const at = placementAt(p.x, p.y);
          if (at?.valid && at.claimPointId !== undefined) {
            // a claim post at a claim point: Claim, so the sim places it next to the point (claimPlacement.ts)
            const builders = mine(selection).filter(
              (id) => loadoutOf(entities.get(id)!.typeId)?.role === roleIdx('builder'),
            );
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
        } else if (picked && hostile && (hitKind === 'unit' || hitKind === 'building')) {
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
    session.dispose();
    hud.unmount();
    renderer.dispose();
  });
  (window as unknown as { crawlout: unknown }).crawlout = {
    renderer,
    session,
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
    revealAll: (on: boolean) => session.revealAll(on),
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

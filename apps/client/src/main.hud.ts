// Client entry, stage 5 (see main.ts): the HUD's dependencies (what it reads and the commands it sends), the HUD
// stand-in until the match starts, and starting the match (from the menu, or at once from the URL).
import {
  ANIM,
  ENTITY_FLAG,
  ENTITY_NONE,
  OWNER_NEUTRAL,
  TICK_HZ,
  type CommandPayload,
  type CommandType,
} from '@crawlout/protocol';
import { BODY_TYPES, ROLES, buildingTypeId, kindOfTypeId } from '@crawlout/data';
import {
  mountHud,
  type HudHandle,
  type HudDeps,
  type MinimapData,
  type SelectedEntity,
} from '@crawlout/ui';
import { startSession } from './game/session.js';
import { netOptionsFromSearch } from './net/params.js';
import {
  buildingButtons,
  buildingCards,
  buildingName,
  hasFinished,
  hasFinishedWorkshop,
} from './game/cards.js';
import { perkOptions } from './game/perks.js';
import { inspect, takeoverHint } from './game/inspect.js';
import {
  ABILITY_HINT_DELAY_MS,
  OUT_OF_RANGE_TEXT,
  abilityOutOfRange,
  type AbilityProbe,
} from './game/abilityHint.js';
import { dominanceView } from './game/dominance.js';
import { nearestRuin, projectMinimap, projectView } from './game/project.js';
import { LOADOUT_NAMES, buildRoster } from './game/roster.js';
import { nodeGuardLines, raiderKindOf, raiderLines, seesEnemySlaves } from './game/raiders.js';
import type { ClientContext } from './main.context.js';

const DEFAULT_YAW = Math.PI * 0.25;
const DEFAULT_ZOOM_M = 42;

export function wireHud(ctx: ClientContext): void {
  const {
    canvas,
    hudEl,
    perfEl,
    hudSkin,
    skinOn,
    mode,
    menu,
    ambient,
    data,
    map,
    renderer,
    minimapStatic,
    listeners,
    notify,
    alertListeners,
    loadoutOf,
    heroOf,
    buildingOf,
    myFaction,
    myHero,
    cardContext,
    myHq,
    raiderStatsNow,
    session,
    sessionEvents,
    mine,
    isEnemyId,
    own,
    canBuildId,
    sendChunked,
    buildable,
  } = ctx;

  ctx.targeting = null;

  /** Position and cooldown of the hero's ability, for the out-of-range check (see game/abilityHint.ts). */
  const probeAbility = (abilityId: number): AbilityProbe | null => {
    const hero = ctx.status?.hero;
    const e = hero ? ctx.entities.get(hero.entityId) : undefined;
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
    getStatus: () => ctx.status,
    getSelection: () => {
      const ownIds = mine(ctx.selection);
      if (ownIds.length === 0) {
        // No own unit selected: a clicked enemy is shown for inspection (type, owner, hp, weapon and armour), no commands.
        const foe = [...ctx.selection]
          .map((id) => ctx.entities.get(id))
          .find((e) => e && isEnemyId(e.id));
        if (!foe) {
          // a scrap node (data 0.29.0, the guard rule): what guards its slaves need
          const node = [...ctx.selection]
            .map((id) => ctx.entities.get(id))
            .find((e) => e && kindOfTypeId(e.typeId).kind === 'scrapNode');
          if (!node) return [];
          const lines = nodeGuardLines(
            data,
            myFaction()?.id,
            node.id,
            ctx.status?.slaveGroups ?? [],
          );
          return [
            {
              id: node.id,
              typeId: node.typeId,
              loadoutName: 'Scrapbron',
              hpPct: node.hpPct,
              role: null,
              enemy: true,
              ownerLabel: 'Grondstof',
              ...(lines.length > 0 ? { lines } : {}),
            },
          ];
        }
        const info = inspect(data, foe.typeId);
        // a bandit of a camp the player's faction takes over (data 0.27.0; PlayerStatus.camps, protocol 0.14.0)
        const hint =
          foe.owner === OWNER_NEUTRAL
            ? takeoverHint(data, myFaction()?.id, ctx.status?.camps, foe.x, foe.y)
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
        const e = ctx.entities.get(id)!;
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
          ctx.entities.values(),
          TICK_HZ,
          ctx.status?.techs ?? [],
          ctx.status?.slaveGroups,
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
    getNetwork: () => ctx.network,
    playerName: (id) => session.playerName(id),
    beginTargeting: (kind) => {
      ctx.targeting = kind;
      canvas.style.cursor = 'crosshair';
    },
    endTargeting: () => {
      ctx.targeting = null;
      canvas.style.cursor = 'default';
    },
    getMinimap: (): MinimapData => {
      const blips: MinimapData['blips'][number][] = [];
      const claims: MinimapData['claims'][number][] = [];
      const claimStates = new Map(ctx.status?.claimPoints?.map((c) => [c.pointId, c]));
      for (const e of ctx.entities.values()) {
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
      const camps = (ctx.status?.camps ?? []).map((c) => ({
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
        project: projectMinimap(ctx.status),
        ...(ctx.minimapFog ? { fog: ctx.minimapFog } : {}),
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
        affordable: (ctx.status?.scrap ?? 0) >= b.scrapCost,
      })),
    beginPlacement: (option) => {
      ctx.placing = option;
      canvas.style.cursor = 'copy';
    },
    endPlacement: () => {
      ctx.placing = null;
      renderer.setPlacementPreview(null);
      canvas.style.cursor = 'default';
    },
    // Hero panel from PlayerStatus.hero (HeroStatus) plus names, abilities and perks from packages/data.
    heroName: (heroId) => data.heroes[heroId]?.naam,
    getPerkOptions: () => perkOptions(data, ctx.status?.hero ?? null),
    // Settlers switch role in a workshop (the sim walks them there): without a finished one the role buttons stay hidden.
    // a workshop, or (Raiders, sim 0.18.0) a cage where slaves switch between gathering and building
    canSwitchRole: () => hasFinishedWorkshop(data, own()) || hasFinished(data, own(), 'kooi'),
    getHeroAbilities: () =>
      (myHero()?.abilities ?? []).map((a, i) => {
        const left = ctx.status?.hero?.abilityCooldownTicks?.[i] ?? 0;
        const cooldownPct =
          a.cooldownTicks > 0 ? Math.min(100, Math.round((left * 100) / a.cooldownTicks)) : 0;
        return { abilityId: i, naam: a.naam, needsTarget: a.rangeU > 0, cooldownPct };
      }),
    isHeroDead: () => ctx.status?.hero?.state === 'dead',
    reviveHero: () => {
      const hq = myHq();
      if (hq) session.sendCommand('Recruit', { buildingId: hq.id });
    },
    getBuildingCards: () =>
      buildingCards(cardContext(mine(ctx.selection).map((id) => ctx.entities.get(id)!))),
    getBuildingButtons: () => buildingButtons(cardContext([])),
    startCard: (card) => {
      if (card.kind === 'research') session.sendCommand('Research', { techId: card.id });
      else if (card.kind === 'revive') session.sendCommand('Recruit', { buildingId: card.id });
      else if (card.kind === 'produce' && card.buildingId !== undefined)
        session.sendCommand('Produce', { buildingId: card.buildingId, loadoutId: card.id });
      else if (card.kind === 'train' && card.buildingId !== undefined)
        session.sendCommand('Train', { buildingId: card.buildingId, programId: card.id });
      else if (card.kind === 'craft') {
        const settlers = mine(ctx.selection).filter((id) =>
          loadoutOf(ctx.entities.get(id)!.typeId),
        );
        if (settlers.length > 0) sendChunked('Craft', settlers, { loadoutId: card.id });
      }
    },
    cancelCard: (card) => {
      // Research and revive run in the building, craft runs on the settler (contract 1, QueueItem.unitId).
      const items =
        ctx.status?.queue?.filter((q) => q.kind === card.kind && q.id === card.id) ?? [];
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
    getDominance: () => dominanceView(ctx.status, (id) => session.playerName(id), session.playerId),
    // win route C (client 0.11.0): the project panel and its restore cards
    getProject: () =>
      projectView(
        data,
        ctx.status,
        (id) => session.playerName(id),
        session.playerId,
        mine(ctx.selection).some(canBuildId),
      ),
    restoreProject: (kind) => {
      const builders = mine(ctx.selection).filter(canBuildId);
      const at = nearestRuin(
        data,
        ctx.status,
        kind,
        builders.map((id) => ctx.entities.get(id)!),
      );
      if (at) sendChunked('Build', builders, at);
    },
    getRaiderStats: raiderStatsNow,
    hasEnemySlaves: () =>
      seesEnemySlaves(data, session.playerId, OWNER_NEUTRAL, ctx.entities.values()),
    getRoster: () => buildRoster(data, myFaction()?.id, session.playerId, ctx.entities.values()),
    selectUnits: (ids, add) => {
      ctx.selection = add ? new Set([...ctx.selection, ...ids]) : new Set(ids);
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
  ctx.hud = hud;

  /** The match is on: the menu goes, the HUD and frame stats come, the camera goes to this player's base. */
  function enterMatch(): void {
    ambient?.stop();
    menu?.hide();
    realHud ??= mountHud(hudEl, deps, { ...(hudSkin ? { skin: hudSkin } : {}), skinOn });
    if (perfEl) perfEl.style.visibility = '';
    const cam = renderer.cameraControls;
    cam.yaw = DEFAULT_YAW;
    cam.zoomTo(DEFAULT_ZOOM_M, true);
    const home = map.grid.spawns[session.playerId];
    if (home) renderer.focus(home.ux, home.uy);
    if (ctx.fogOn) session.requestFog();
    else session.revealAll(true);
  }

  ctx.launchMatch = (net, options) => {
    const real = startSession(data, map, sessionEvents, net, options);
    session.attach(real);
    void real.started.then(enterMatch);
  };
  // No menu: the match starts from the URL, as it always did (also over `?relay=` with the automatic lobby).
  if (mode === 'match') ctx.launchMatch(netOptionsFromSearch(location.search), {});
}

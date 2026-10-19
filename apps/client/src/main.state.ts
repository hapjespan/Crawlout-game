// Client entry, stage 2 (see main.ts): the local view of the match (selection, latest snapshot, player status, fog),
// alerts, data lookups, the session with its event handlers and polls, and the end-of-match screen.
import type { DesyncEvent, FogMask, PlayerStatus, StallNotice } from '@crawlout/protocol';
import { PROVIDES, heroIdOfTypeId, kindOfTypeId, type BuildingData } from '@crawlout/data';
import { mountMatchEnd, type HudAlert } from '@crawlout/ui';
import type { SimWinner } from '@crawlout/sim';
import type { SessionEvents } from './game/session.js';
import type { CardContext } from './game/cards.js';
import { createSessionSlot } from './game/sessionSlot.js';
import { menuUrl } from './game/menuParams.js';
import { createStatusOverlay } from './net/statusOverlay.js';
import { createPerfBadge } from './net/perfBadge.js';
import { projectAlerts } from './game/project.js';
import { FOG_POLL_MS, fogEnabled, minimapFogOf, sameMinimapFog } from './game/fogView.js';
import { BedHintThrottle, bedHintText, cappedByBeds } from './game/beds.js';
import { raiderStats } from './game/raiders.js';
import { EVENT_TYPE, readSnapshot, type EntityRow } from './game/snapshot.js';
import type { ClientContext } from './main.context.js';

const STATUS_POLL_MS = 250;
/** Under-attack alerts are rate limited so a long fight is one toast, not a flood. */
const ATTACK_ALERT_COOLDOWN_MS = 8000;
/** A Kooi with too few guards warns again after this long (the sim lets slaves escape every 25 s while it lasts). */
const REVOLT_ALERT_COOLDOWN_MS = 20000;

export function wireMatchState(ctx: ClientContext): void {
  const { data, renderer, menu, params, perfEl, endEl, hudSkin, skinOn } = ctx;

  // Selection is local UI state, never sim state: it is stamped into each snapshot's flags for the renderer.
  ctx.selection = new Set<number>();
  ctx.entities = new Map<number, EntityRow>();
  ctx.ownCache = null;
  ctx.status = null;
  ctx.survival = null;
  ctx.network = { desync: null, stall: null };
  const listeners = new Set<() => void>();
  const notify = (): void => listeners.forEach((l) => l());
  const alertListeners = new Set<(a: HudAlert) => void>();
  const alert = (a: HudAlert): void => alertListeners.forEach((l) => l(a));
  let lastAttackAlert = -Infinity;
  // Fog of war: `?fog=0` (or window.crawlout.revealAll(true)) turns it off; otherwise the sim's mask is asked for at
  // FOG_POLL_MS, drawn by the renderer in every material and handed to the minimap.
  ctx.fogOn = fogEnabled(params);
  ctx.minimapFog = undefined;
  const applyFog = (mask: FogMask | null): void => {
    renderer.setFog(mask);
    if (!mask) ctx.minimapFog = undefined;
    else {
      const next = minimapFogOf(mask);
      if (!sameMinimapFog(ctx.minimapFog, next)) ctx.minimapFog = next;
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
    const id = ctx.status?.hero?.heroId;
    return id === undefined ? undefined : data.heroes[id];
  };
  /** Tech ids this player has researched (PlayerStatus.techs); prerequisites gate buildings, loadouts and techs. */
  const unlocked = (prereq: readonly number[]): boolean =>
    prereq.every((t) => ctx.status?.techs?.includes(t) ?? false);
  const hqProvidesIdx = PROVIDES.indexOf('hq');
  const cardContext = (selected: readonly EntityRow[]): CardContext => ({
    data,
    factionId: myFaction()?.id,
    playerId: session.playerId,
    status: ctx.status,
    selected,
    own: ctx.own(),
    heroDead: ctx.status?.hero?.state === 'dead' || ctx.status?.hero?.state === 'reviving',
  });
  const myHq = (): EntityRow | undefined =>
    [...ctx.entities.values()].find(
      (e) => e.owner === session.playerId && buildingOf(e.typeId)?.provides.includes(hqProvidesIdx),
    );

  const raiderStatsNow = (): ReturnType<typeof raiderStats> =>
    raiderStats(data, myFaction()?.id, session.playerId, ctx.own(), ctx.status?.slaveGroups);
  /** Toast when a slave group has fewer guards than the guard rule asks (PlayerStatus.slaveGroups, protocol 0.15.0). */
  let lastRevoltAlert = -Infinity;
  function checkRevolt(): void {
    const now = performance.now();
    if (now - lastRevoltAlert < REVOLT_ALERT_COOLDOWN_MS) return;
    const short = raiderStatsNow()?.guardGroups.find(
      (g) => g.slaves > 0 && g.guards < g.guardsNeeded,
    );
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
      const previous = ctx.entities;
      const snap = readSnapshot(buf, ctx.selection);
      ctx.entities = snap.entities;
      ctx.ownCache = null;
      for (const id of ctx.selection) if (!ctx.entities.has(id)) ctx.selection.delete(id);
      renderer.pushSnapshot(buf);
      renderer.setInspectedIds([...ctx.selection].filter(ctx.isEnemyId));
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
      if (ctx.fogOn) applyFog(mask);
    },
    onStatus(next, winner, survival) {
      for (const a of projectAlerts(data, ctx.status, next, session.playerId)) alert(a);
      ctx.status = next;
      ctx.survival = survival?.status ? { status: survival.status, frame: survival.frame } : null;
      renderer.setClaimStates(next.claimPoints);
      // survival: Sim.winner() stays null, the end is in survivalStatus().result
      const outcome = ctx.survival?.status.result?.outcome;
      if (outcome) showEnd(null, outcome);
      else if (winner) showEnd(winner);
      else checkBeds(next);
      notify();
    },
    onDesync(event: DesyncEvent) {
      ctx.network = { ...ctx.network, desync: event };
      notify();
    },
    onStall(notice: StallNotice | null) {
      ctx.network = { ...ctx.network, stall: notice };
      notify();
    },
    // While the menu is up it shows the connection itself; the overlay is for the match (reconnects, waiting).
    onConnection: (text) => netStatus.set(menu?.isVisible() ? null : text),
    // The menu's lobby shows the relay's side of the story (the link, the lobby, its error messages).
    onLobby: (lobby) =>
      menu?.setLobby(lobby.roomId, lobby.map, lobby.players, lobby.you, lobby.mode),
    onLink: (link) => menu?.setLink(link),
    onError: (message) => {
      console.error(`sim: ${message}`);
      menu?.setError(message);
    },
  };
  const statusPoll = window.setInterval(() => session.requestStatus(), STATUS_POLL_MS);
  const fogPoll = window.setInterval(() => {
    if (ctx.fogOn) session.requestFog();
  }, FOG_POLL_MS);

  let ended = false;
  function showEnd(winner: SimWinner | null, survival?: 'survived' | 'overrun'): void {
    if (ended) return;
    ended = true;
    const won = survival ? survival === 'survived' : winner?.playerId === session.playerId;
    const how = winner
      ? {
          destruction: 'vernietiging',
          dominance: 'dominantie',
          surrender: 'opgave',
          project: 'het Bouwproject',
        }[winner.reason]
      : '';
    mountMatchEnd(endEl, {
      won,
      how,
      ...(survival ? { survival } : {}),
      onMenu: () => location.assign(menuUrl(location)),
      ...(hudSkin ? { skin: hudSkin } : {}),
      skinOn: skinOn && ctx.settings.hudSkin,
    });
    endEl.style.display = 'grid';
  }

  ctx.listeners = listeners;
  ctx.notify = notify;
  ctx.alertListeners = alertListeners;
  ctx.applyFog = applyFog;
  ctx.loadoutOf = loadoutOf;
  ctx.heroOf = heroOf;
  ctx.buildingOf = buildingOf;
  ctx.myFaction = myFaction;
  ctx.myHero = myHero;
  ctx.unlocked = unlocked;
  ctx.hqProvidesIdx = hqProvidesIdx;
  ctx.cardContext = cardContext;
  ctx.myHq = myHq;
  ctx.raiderStatsNow = raiderStatsNow;
  ctx.perfBadge = perfBadge;
  ctx.session = session;
  ctx.sessionEvents = sessionEvents;
  ctx.statusPoll = statusPoll;
  ctx.fogPoll = fogPoll;
}

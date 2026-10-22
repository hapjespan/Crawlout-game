import { MAX_ENTITIES_PER_COMMAND } from '@crawlout/protocol';
import type { PlayerStatus } from '@crawlout/protocol';
import { kindOfTypeId } from '@crawlout/data';
import type { HudController } from './controller.js';
import { CARD_NOTICE_MS, MAX_TOASTS, TOAST_MS, isAlarm } from './controller.actions.js';
import type { ProjectView } from './project.js';
import type { SurvivalView } from './survival.js';
import type {
  BuildOption,
  BuildingButton,
  BuildingCard,
  CraftOption,
  DominanceView,
  HeroAbilityOption,
  HudAlert,
  HudDeps,
  LobbyView,
  MinimapData,
  NetworkState,
  PerkOption,
  RaiderStats,
  RecruitOption,
  ResearchOption,
  RosterGroup,
  SelectedEntity,
  TargetingKind,
  ToastAlert,
} from './types.js';

/** Kaarten uit de oude deps (getResearchOptions, getRecruitOptions, getCraftOptions): zonder icoon, effecten of duur. */
function legacyCards(
  research: readonly ResearchOption[],
  recruit: readonly RecruitOption[],
  craft: readonly CraftOption[],
): BuildingCard[] {
  const base = { seconds: 0, effects: [], unlocks: [], requires: [] } as const;
  const state = (affordable: boolean): BuildingCard['state'] =>
    affordable ? 'available' : 'tooExpensive';
  const all: Omit<BuildingCard, 'hotkey'>[] = [
    ...research.map((o) => ({
      ...base,
      kind: 'research' as const,
      id: o.techId,
      naam: o.naam,
      icon: 'research',
      scrapCost: o.scrapCost,
      state: state(o.affordable),
    })),
    ...recruit.map((o) => ({
      ...base,
      kind: 'revive' as const,
      id: o.buildingId,
      naam: o.naam,
      icon: 'revive',
      scrapCost: o.scrapCost,
      state: state(o.affordable),
    })),
    ...craft.map((o) => ({
      ...base,
      kind: 'craft' as const,
      id: o.loadoutId,
      naam: o.naam,
      icon: 'craft',
      scrapCost: o.scrapCost,
      state: state(o.affordable),
    })),
  ];
  return all.map((c, i) => ({ ...c, hotkey: String(i + 1) }));
}

export interface HudState {
  status: PlayerStatus | null;
  selection: readonly SelectedEntity[];
  network: NetworkState;
  targeting: TargetingKind | null;
  buildMenuOpen: boolean;
  confirmSurrender: boolean;
  minimap: MinimapData | null;
  dominance: DominanceView | null;
  /** Win route C (ui 0.19.0): the project panel, null without a Bouwproject. */
  project: ProjectView | null;
  /** Survival co-op (ui 0.20.0): the wave panel, null outside the game type Survival. */
  survival: SurvivalView | null;
  buildOptions: readonly BuildOption[];
  /** Gekozen bouwoptie in plaatsingsmodus. */
  placement: BuildOption | null;
  perkOptions: readonly PerkOption[];
  heroAbilities: readonly HeroAbilityOption[];
  heroDead: boolean;
  /** Ability die op een positie wacht (targeting 'heroAbility'). */
  pendingAbility: HeroAbilityOption | null;
  /** Kaarten van het gebouwpaneel voor de huidige selectie. */
  cards: readonly BuildingCard[];
  /** Bij een selectie met bewoners: K heeft de cijfertoetsen van de craftkaarten geactiveerd. */
  craftMenuOpen: boolean;
  /** Reden dat de laatst aangeklikte kaart niet startte (te duur, vergrendeld, gebouw bezig), tijdelijk; anders null. */
  cardNotice: string | null;
  /** Waarom het plaatsingsvoorbeeld rood is (door de client gezet), of null. */
  placementHint: string | null;
  /** Korte melding midden op het scherm (tijdelijk), of null. */
  hint: string | null;
  toasts: readonly ToastAlert[];
  lobby: LobbyView | null;
  showLobby: boolean;
  roster: readonly RosterGroup[];
  /** Eigen voltooide gebouwen waar iets te doen is, voor de knoppen naast de eenhedenbalk. */
  buildingButtons: readonly BuildingButton[];
  /** Uitgeklapte groep in de eenhedenbalk (key), of null. */
  rosterOpen: string | null;
  /** Staat er een voltooide werkplaats? Pas dan kunnen bewoners van rol wisselen (rolknoppen op de commandokaart). */
  canSwitchRole: boolean;
  /** Raiders: tellers voor de bovenbalk, of null zonder Raiders. */
  raider: RaiderStats | null;
  /** Ziet de speler een vijandelijke slaaf of gevangene (dan staat Bevrijd op de kaart)? */
  enemySlaves: boolean;
  /** Het perk-paneel is open (alleen zinvol zolang er een perk te kiezen is). */
  perkPanelOpen: boolean;
}

/** De tegenstander die telt (genoeg punten, niet jijzelf), of null. */
export function threatOf(d: DominanceView | null): NonNullable<DominanceView['leader']> | null {
  const l = d?.leader;
  return d && l && !l.isYou && l.pointsHeld >= d.pointsRequired ? l : null;
}

export const NO_NETWORK: NetworkState = { desync: null, stall: null };

/**
 * The internals of one HudController: its state, deps, listeners and timers, plus the controller itself so the logic
 * in the controller.* modules calls its public methods exactly where the class used to call `this`.
 */
export interface HudControllerCore {
  readonly ctl: HudController;
  readonly deps: HudDeps;
  /** Demo-only: keep the build menu open while a building is being placed (never set by the game). */
  readonly keepBuildMenuWhilePlacing: boolean;
  state: HudState;
  readonly listeners: Set<() => void>;
  unsubscribe: (() => void) | null;
  timer: ReturnType<typeof setInterval> | null;
  unsubscribeAlerts: (() => void) | null;
  readonly toastTimers: Map<number, ReturnType<typeof setTimeout>>;
  toastSeq: number;
  /** Telde de tegenstander bij de vorige lezing al? Alleen de overgang geeft een toast. */
  opponentCounting: boolean;
  noticeTimer: ReturnType<typeof setTimeout> | null;
  hintTimer: ReturnType<typeof setTimeout> | null;
  /** Laatst gestarte kaart, om één druk (pointerup plus klik) niet twee keer te starten. */
  lastCardStart: { key: string; at: number } | null;
  /** Kaart waarop de knop is ingedrukt en nog niet losgelaten (pointerdown), zie cardPress. */
  pressedCard: string | null;
}

/** The internals of a fresh controller, before its first read of the deps. */
export function createControllerCore(
  ctl: HudController,
  deps: HudDeps,
  keepBuildMenuWhilePlacing: boolean,
): HudControllerCore {
  return {
    ctl,
    deps,
    keepBuildMenuWhilePlacing,
    listeners: new Set<() => void>(),
    unsubscribe: null,
    timer: null,
    unsubscribeAlerts: null,
    toastTimers: new Map<number, ReturnType<typeof setTimeout>>(),
    toastSeq: 0,
    opponentCounting: false,
    noticeTimer: null,
    hintTimer: null,
    lastCardStart: null,
    pressedCard: null,
    state: {
      status: null,
      selection: [],
      roster: [],
      rosterOpen: null,
      canSwitchRole: true,
      raider: null,
      enemySlaves: false,
      perkPanelOpen: false,
      network: NO_NETWORK,
      targeting: null,
      buildMenuOpen: false,
      confirmSurrender: false,
      minimap: null,
      dominance: null,
      project: null,
      survival: null,
      buildOptions: [],
      placement: null,
      perkOptions: [],
      heroAbilities: [],
      heroDead: false,
      pendingAbility: null,
      cards: [],
      craftMenuOpen: false,
      cardNotice: null,
      placementHint: null,
      hint: null,
      buildingButtons: [],
      toasts: [],
      lobby: null,
      showLobby: false,
    },
  };
}

/** Alleen gebouwen geselecteerd (en er is een selectie). */
export function buildingsOnly(core: HudControllerCore): boolean {
  return (
    core.state.selection.length > 0 &&
    !core.ctl.enemySelected() &&
    core.state.selection.every((s) => kindOfTypeId(s.typeId).kind === 'building')
  );
}

export function hasCraftCards(core: HudControllerCore): boolean {
  return (
    core.state.cards.some((c) => c.kind === 'craft') &&
    core.state.selection.some((s) => !s.enemy && kindOfTypeId(s.typeId).kind !== 'building')
  );
}

/** Toont kort waarom een actie niet doorging. */
export function showNotice(core: HudControllerCore, text: string): void {
  if (core.noticeTimer) clearTimeout(core.noticeTimer);
  core.noticeTimer = setTimeout(() => {
    core.noticeTimer = null;
    setState(core, { cardNotice: null });
  }, CARD_NOTICE_MS);
  setState(core, { cardNotice: text });
}

export function focusLastAlert(core: HudControllerCore): void {
  const last = core.state.toasts.filter(isAlarm).pop();
  if (last) core.ctl.focusAlert(last);
}

export function pushAlert(core: HudControllerCore, alert: HudAlert): void {
  const id = ++core.toastSeq;
  const toasts = [...core.state.toasts, { ...alert, id }];
  while (toasts.length > MAX_TOASTS) {
    const old = toasts.shift();
    if (old) {
      const t = core.toastTimers.get(old.id);
      if (t) clearTimeout(t);
      core.toastTimers.delete(old.id);
    }
  }
  core.toastTimers.set(
    id,
    setTimeout(() => core.ctl.dismissToast(id), TOAST_MS),
  );
  setState(core, { toasts });
}

export function selectedIds(core: HudControllerCore, includeBuildings = true): number[] {
  const own = core.state.selection.filter((s) => !s.enemy);
  const sel = includeBuildings
    ? own
    : own.filter((s) => kindOfTypeId(s.typeId).kind !== 'building');
  return sel.slice(0, MAX_ENTITIES_PER_COMMAND).map((s) => s.id);
}

export function stopTargeting(core: HudControllerCore): void {
  if (!core.state.targeting) return;
  setState(core, { targeting: null, pendingAbility: null });
  core.deps.endTargeting?.();
}

export function stopPlacement(core: HudControllerCore): void {
  if (!core.state.placement) return;
  setState(core, { placement: null, placementHint: null });
  core.deps.endPlacement?.();
}

export function readState(core: HudControllerCore): void {
  const selection = [...core.deps.getSelection()];
  const d = core.deps;
  const status = d.getStatus();
  const hero = status?.hero ?? null;
  const pendingPerks = hero !== null && (hero.pendingPerks ?? 0) > 0;
  const buildingIds = [
    ...new Set(
      selection.flatMap((s) =>
        kindOfTypeId(s.typeId).kind === 'building' ? [kindOfTypeId(s.typeId).index] : [],
      ),
    ),
  ];
  const units = selection.some((s) => !s.enemy && kindOfTypeId(s.typeId).kind !== 'building');
  const cards = readCards(core, selection, buildingIds, units);
  const placement = selection.some((s) => s.role === 'builder') ? core.state.placement : null;
  if (core.state.placement && !placement) d.endPlacement?.();
  // Targeting without a selection makes no sense any more (a hero ability does not need one).
  const targeting =
    selection.every((s) => s.enemy) && core.state.targeting !== 'heroAbility'
      ? null
      : core.state.targeting;
  if (core.state.targeting && !targeting) d.endTargeting?.();
  core.state = {
    ...core.state,
    status,
    selection,
    minimap: d.getMinimap?.() ?? null,
    dominance: d.getDominance?.() ?? null,
    project: d.getProject?.() ?? null,
    survival: d.getSurvival?.() ?? null,
    buildOptions: core.state.buildMenuOpen ? (d.getBuildOptions?.() ?? []) : [],
    placement,
    perkOptions: pendingPerks
      ? (d.getPerkOptions?.() ?? []).filter((p) => !hero?.perks.includes(p.perkId))
      : [],
    heroAbilities: hero ? (d.getHeroAbilities?.() ?? []) : [],
    heroDead: hero !== null && (d.isHeroDead?.() ?? false),
    cards,
    // The build menu is for builders: without one selected it closes (a click on empty ground clears everything).
    buildMenuOpen: core.state.buildMenuOpen && selection.some((s) => s.role === 'builder'),
    craftMenuOpen:
      cards.some((c) => c.kind === 'craft') && units ? core.state.craftMenuOpen : false,
    lobby: core.state.showLobby ? (d.getLobby?.() ?? null) : null,
    roster: d.getRoster?.() ?? [],
    buildingButtons: d.getBuildingButtons?.() ?? [],
    canSwitchRole: d.canSwitchRole?.() ?? true,
    raider: d.getRaiderStats?.() ?? null,
    enemySlaves: d.hasEnemySlaves?.() ?? false,
    perkPanelOpen: pendingPerks && core.state.perkPanelOpen,
    network: core.deps.getNetwork?.() ?? NO_NETWORK,
    targeting,
  };
}

/** Kaarten voor de selectie: de nieuwe dep, of (tijdelijk) opgebouwd uit de oude deps. */
export function readCards(
  core: HudControllerCore,
  selection: readonly SelectedEntity[],
  buildingIds: readonly number[],
  units: boolean,
): readonly BuildingCard[] {
  const d = core.deps;
  if (selection.length === 0) return [];
  if (d.getBuildingCards) return d.getBuildingCards(selection);
  const research = buildingIds.length > 0 ? (d.getResearchOptions?.(buildingIds) ?? []) : [];
  const recruit = buildingIds.length > 0 ? (d.getRecruitOptions?.(buildingIds) ?? []) : [];
  const craft = units ? (d.getCraftOptions?.() ?? []) : [];
  return research.length + recruit.length + craft.length > 0
    ? legacyCards(research, recruit, craft)
    : [];
}

export function setState(core: HudControllerCore, patch: Partial<HudState>): void {
  core.state = { ...core.state, ...patch };
  emit(core);
}

export function emit(core: HudControllerCore): void {
  for (const fn of core.listeners) fn();
}

import { MAX_ENTITIES_PER_COMMAND } from '@crawlout/protocol';
import type { PlayerStatus, Role } from '@crawlout/protocol';
import { kindOfTypeId } from '@crawlout/data';
import type {
  BuildOption,
  CraftOption,
  HeroAbilityOption,
  HudAlert,
  HudDeps,
  HudHandle,
  LobbyView,
  MinimapData,
  NetworkState,
  PerkOption,
  RecruitOption,
  ResearchOption,
  SelectedEntity,
  TargetPoint,
  TargetResult,
  TargetingKind,
  ToastAlert,
} from './types.js';

export type ActionId =
  | 'move'
  | 'stop'
  | 'attackMove'
  | 'gather'
  | 'roleScavenger'
  | 'roleBuilder'
  | 'roleMilitia'
  | 'build'
  | 'hero'
  | 'revive'
  | 'craft'
  | 'minimap'
  | 'lastAlert'
  | 'lobby';

/** Zo lang blijft een toast staan en zoveel staan er maximaal tegelijk. */
export const TOAST_MS = 6000;
export const MAX_TOASTS = 4;
/** Perk-keuzes via F1, F2, F3 (de eerste drie opties); Q, W, E en A, S, D zijn van de camera. */
export const PERK_KEYS = ['f1', 'f2', 'f3'] as const;
/** Held-abilities in volgorde van getHeroAbilities(). */
export const ABILITY_KEYS = ['z', 'x', 'c'] as const;

export interface ActionDef {
  id: ActionId;
  label: string;
  /** Toets in kleine letters, zoals KeyboardEvent.key. */
  key: string;
  needsSelection: boolean;
  /** Alleen zichtbaar als de bijbehorende dep of data er is. */
  requires?: 'hero' | 'revive' | 'craft' | 'minimap' | 'alert' | 'lobby';
}

/** Commandokaart: volgorde is de volgorde op het scherm. */
export const ACTIONS: readonly ActionDef[] = [
  { id: 'move', label: 'Verplaats', key: 'm', needsSelection: true },
  { id: 'stop', label: 'Stop', key: 's', needsSelection: true },
  { id: 'attackMove', label: 'Val aan', key: 'a', needsSelection: true },
  { id: 'gather', label: 'Verzamel', key: 'g', needsSelection: true },
  { id: 'roleScavenger', label: 'Plunderaar', key: '1', needsSelection: true },
  { id: 'roleBuilder', label: 'Bouwer', key: '2', needsSelection: true },
  { id: 'roleMilitia', label: 'Militie', key: '3', needsSelection: true },
  { id: 'build', label: 'Bouw', key: 'b', needsSelection: false },
  { id: 'hero', label: 'Held', key: 'h', needsSelection: false, requires: 'hero' },
  { id: 'revive', label: 'Oplappen', key: 'v', needsSelection: false, requires: 'revive' },
  { id: 'craft', label: 'Craft', key: 'k', needsSelection: true, requires: 'craft' },
  { id: 'minimap', label: 'Minimap', key: 'n', needsSelection: false, requires: 'minimap' },
  { id: 'lastAlert', label: 'Alarm', key: ' ', needsSelection: false, requires: 'alert' },
  { id: 'lobby', label: 'Lobby', key: 'l', needsSelection: false, requires: 'lobby' },
];

/** Sneltoets als label. */
export const keyLabel = (key: string): string => (key === ' ' ? 'Spatie' : key.toUpperCase());

/** Een regel in het gebouwpaneel: research of rekruteren, genummerd 1..n. */
export type BuildingEntry = ({ kind: 'research' } & ResearchOption) | ({ kind: 'recruit' } & RecruitOption);

export const ROLE_LABEL: Record<Role, string> = { scavenger: 'Plunderaar', builder: 'Bouwer', militia: 'Militie' };
const ACTION_ROLE: Partial<Record<ActionId, Role>> = { roleScavenger: 'scavenger', roleBuilder: 'builder', roleMilitia: 'militia' };
const ACTION_TARGETING: Partial<Record<ActionId, TargetingKind>> = { move: 'move', attackMove: 'attackMove', gather: 'gather' };

export interface HudState {
  status: PlayerStatus | null;
  selection: readonly SelectedEntity[];
  network: NetworkState;
  targeting: TargetingKind | null;
  buildMenuOpen: boolean;
  confirmSurrender: boolean;
  minimap: MinimapData | null;
  buildOptions: readonly BuildOption[];
  /** Gekozen bouwoptie in plaatsingsmodus. */
  placement: BuildOption | null;
  perkOptions: readonly PerkOption[];
  heroAbilities: readonly HeroAbilityOption[];
  heroDead: boolean;
  /** Ability die op een positie wacht (targeting 'heroAbility'). */
  pendingAbility: HeroAbilityOption | null;
  researchOptions: readonly ResearchOption[];
  recruitOptions: readonly RecruitOption[];
  craftOptions: readonly CraftOption[];
  craftMenuOpen: boolean;
  toasts: readonly ToastAlert[];
  lobby: LobbyView | null;
  showMinimap: boolean;
  showHero: boolean;
  showLobby: boolean;
}

const NO_NETWORK: NetworkState = { desync: null, stall: null };

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true;
}

/** HUD-logica zonder Preact: state, sneltoetsen en commando-opbouw. De view tekent alleen de state. */
export class HudController implements HudHandle {
  private state: HudState;
  private readonly listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeAlerts: (() => void) | null = null;
  private readonly toastTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private toastSeq = 0;

  constructor(private readonly deps: HudDeps) {
    this.state = {
      status: null,
      selection: [],
      network: NO_NETWORK,
      targeting: null,
      buildMenuOpen: false,
      confirmSurrender: false,
      minimap: null,
      buildOptions: [],
      placement: null,
      perkOptions: [],
      heroAbilities: [],
      heroDead: false,
      pendingAbility: null,
      researchOptions: [],
      recruitOptions: [],
      craftOptions: [],
      craftMenuOpen: false,
      toasts: [],
      lobby: null,
      showMinimap: true,
      showHero: true,
      showLobby: false,
    };
    this.read();
  }

  getState(): HudState {
    return this.state;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Begin met luisteren op de deps (subscribe of polling). */
  start(): void {
    if (this.deps.subscribe) this.unsubscribe = this.deps.subscribe(() => this.refresh());
    else this.timer = setInterval(() => this.refresh(), 250);
    this.unsubscribeAlerts = this.deps.subscribeAlerts?.((a) => this.pushAlert(a)) ?? null;
  }

  unmount(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribeAlerts?.();
    this.unsubscribeAlerts = null;
    for (const t of this.toastTimers.values()) clearTimeout(t);
    this.toastTimers.clear();
    this.listeners.clear();
  }

  refresh(): void {
    this.read();
    this.emit();
  }

  heroName(heroId: number): string | undefined {
    return this.deps.heroName?.(heroId);
  }

  playerName(playerId: number): string {
    return this.deps.playerName?.(playerId) ?? `speler ${playerId + 1}`;
  }

  isEnabled(action: ActionDef): boolean {
    return this.isAvailable(action) && (!action.needsSelection || this.state.selection.length > 0);
  }

  /** Is het onderdeel van deze actie er (dep aanwezig, data beschikbaar)? */
  isAvailable(action: ActionDef): boolean {
    switch (action.requires) {
      case 'hero':
        return this.hasHero();
      case 'revive':
        return this.canRevive();
      case 'craft':
        return this.state.craftOptions.length > 0;
      case 'minimap':
        return this.deps.getMinimap !== undefined;
      case 'alert':
        return this.state.toasts.length > 0;
      case 'lobby':
        return this.deps.getLobby !== undefined;
      default:
        return true;
    }
  }

  hasHero(): boolean {
    return this.state.status?.hero != null;
  }

  /** Onbestede perk-keuzes van de held (0 zolang de sim het veld niet levert). */
  pendingPerks(): number {
    return this.state.status?.hero?.pendingPerks ?? 0;
  }

  /** Dode held met nog minstens een oplap-beurt (onbekend aantal telt als mogelijk). */
  canRevive(): boolean {
    const hero = this.state.status?.hero;
    return hero != null && this.state.heroDead && this.deps.reviveHero !== undefined && (hero.revivesLeft ?? 1) > 0;
  }

  /** Is een ability nu bruikbaar (held leeft, heeft id, cooldown klaar)? */
  canUseAbility(a: HeroAbilityOption): boolean {
    const hero = this.state.status?.hero;
    return hero?.heroId !== undefined && !this.state.heroDead && a.cooldownPct <= 0;
  }

  /** Research gevolgd door rekruteren: de genummerde regels van het gebouwpaneel. */
  buildingEntries(): BuildingEntry[] {
    return [
      ...this.state.researchOptions.map((o) => ({ kind: 'research' as const, ...o })),
      ...this.state.recruitOptions.map((o) => ({ kind: 'recruit' as const, ...o })),
    ];
  }

  /** Cijfers 1..n gaan naar het gebouwpaneel zodra alleen gebouwen geselecteerd zijn. */
  buildingPanelActive(): boolean {
    return this.state.selection.length > 0 && this.state.selection.every((s) => kindOfTypeId(s.typeId).kind === 'building') && this.buildingEntries().length > 0;
  }

  chooseBuildingEntry(index: number): boolean {
    const e = this.buildingEntries()[index];
    if (!e || !e.affordable) return false;
    if (e.kind === 'research') this.deps.sendCommand('Research', { techId: e.techId });
    else this.deps.sendCommand('Recruit', { buildingId: e.buildingId });
    return true;
  }

  chooseCraft(loadoutId: number): boolean {
    const o = this.state.craftOptions.find((c) => c.loadoutId === loadoutId);
    const ids = this.selectedIds(false);
    if (!o || !o.affordable || ids.length === 0) return false;
    this.deps.sendCommand('Craft', { ids, loadoutId });
    this.set({ craftMenuOpen: false });
    return true;
  }

  /** Gebruikt een ability: direct, of via targeting als ze een positie vraagt. */
  useAbility(abilityId: number): boolean {
    const a = this.state.heroAbilities.find((x) => x.abilityId === abilityId);
    const heroId = this.state.status?.hero?.heroId;
    if (!a || heroId === undefined || !this.canUseAbility(a) || this.state.confirmSurrender) return false;
    if (a.needsTarget) {
      this.stopTargeting();
      this.set({ targeting: 'heroAbility', pendingAbility: a, buildMenuOpen: false, craftMenuOpen: false });
      this.deps.beginTargeting('heroAbility');
    } else {
      this.stopTargeting();
      this.deps.sendCommand('HeroAbility', { heroId, abilityId });
    }
    return true;
  }

  revive(): boolean {
    if (!this.canRevive()) return false;
    this.deps.reviveHero?.();
    return true;
  }

  /** Bouwers uit de selectie: alleen units met rol builder bouwen. */
  selectedBuilders(): number[] {
    return this.state.selection.filter((s) => s.role === 'builder').slice(0, MAX_ENTITIES_PER_COMMAND).map((s) => s.id);
  }

  /** Is een bouwoptie nu kiesbaar (betaalbaar en er is een bouwer geselecteerd)? */
  canChooseBuild(option: BuildOption): boolean {
    return option.affordable && this.selectedBuilders().length > 0;
  }

  /** Voert een actie uit; geeft false als ze niet beschikbaar is. */
  run(id: ActionId): boolean {
    const action = ACTIONS.find((a) => a.id === id);
    if (!action || !this.isEnabled(action) || this.state.confirmSurrender) return false;
    const ids = this.selectedIds();
    const targeting = ACTION_TARGETING[id];
    const role = ACTION_ROLE[id];
    if (targeting) {
      this.set({ targeting, buildMenuOpen: false });
      this.deps.beginTargeting(targeting);
    } else if (role) {
      this.stopTargeting();
      this.deps.sendCommand('SetRole', { ids, role });
    } else if (id === 'stop') {
      this.stopTargeting();
      this.deps.sendCommand('Stop', { ids });
    } else if (id === 'build') {
      this.stopTargeting();
      this.stopPlacement();
      this.set({ buildMenuOpen: !this.state.buildMenuOpen, craftMenuOpen: false });
      this.read();
      this.emit();
    } else if (id === 'revive') {
      this.revive();
    } else if (id === 'craft') {
      this.stopTargeting();
      this.stopPlacement();
      this.set({ craftMenuOpen: !this.state.craftMenuOpen, buildMenuOpen: false });
    } else if (id === 'hero') {
      this.set({ showHero: !this.state.showHero });
    } else if (id === 'minimap') {
      this.set({ showMinimap: !this.state.showMinimap });
    } else if (id === 'lastAlert') {
      this.focusLastAlert();
    } else if (id === 'lobby') {
      this.set({ showLobby: !this.state.showLobby });
      this.read();
      this.emit();
    }
    return true;
  }

  /** Bouwmenu-keuze: gaat in plaatsingsmodus. Geeft false als de optie niet kiesbaar is. */
  chooseBuild(buildingId: number): boolean {
    const option = this.state.buildOptions.find((o) => o.buildingId === buildingId);
    if (!option || !this.canChooseBuild(option)) return false;
    this.stopTargeting();
    this.set({ placement: option, buildMenuOpen: false });
    this.deps.beginPlacement?.(option);
    return true;
  }

  completePlacement(pos: TargetPoint): boolean {
    const option = this.state.placement;
    if (!option) return false;
    const ids = this.selectedBuilders();
    if (ids.length === 0) {
      this.cancelPlacement();
      return false;
    }
    this.deps.sendCommand('Build', { ids, typeId: option.typeId, x: Math.round(pos.x), y: Math.round(pos.y) });
    this.set({ placement: null });
    return true;
  }

  cancelPlacement(): void {
    this.stopPlacement();
  }

  pickPerk(perkId: number): boolean {
    const heroId = this.state.status?.hero?.heroId;
    if (heroId === undefined || this.pendingPerks() <= 0 || !this.state.perkOptions.some((p) => p.perkId === perkId)) return false;
    this.deps.sendCommand('PickPerk', { heroId, perkId });
    return true;
  }

  /** Minimap-klik; fx en fy zijn 0..1 over de kaart. */
  minimapClick(fx: number, fy: number): void {
    const m = this.state.minimap;
    if (!m) return;
    const cell = m.cellU ?? 256;
    const x = Math.round(Math.min(1, Math.max(0, fx)) * m.w * cell);
    const y = Math.round(Math.min(1, Math.max(0, fy)) * m.h * cell);
    if (this.state.targeting && this.completeTargeting({ x, y })) return;
    this.deps.focusCamera?.(x, y);
  }

  focusAlert(alert: HudAlert): void {
    this.deps.focusCamera?.(alert.x, alert.y);
  }

  dismissToast(id: number): void {
    const t = this.toastTimers.get(id);
    if (t) clearTimeout(t);
    this.toastTimers.delete(id);
    this.set({ toasts: this.state.toasts.filter((a) => a.id !== id) });
  }

  private focusLastAlert(): void {
    const last = this.state.toasts[this.state.toasts.length - 1];
    if (last) this.focusAlert(last);
  }

  private pushAlert(alert: HudAlert): void {
    const id = ++this.toastSeq;
    const toasts = [...this.state.toasts, { ...alert, id }];
    while (toasts.length > MAX_TOASTS) {
      const old = toasts.shift();
      if (old) {
        const t = this.toastTimers.get(old.id);
        if (t) clearTimeout(t);
        this.toastTimers.delete(old.id);
      }
    }
    this.toastTimers.set(id, setTimeout(() => this.dismissToast(id), TOAST_MS));
    this.set({ toasts });
  }

  completeTargeting(target: TargetResult): boolean {
    const kind = this.state.targeting;
    if (!kind) return false;
    if (kind === 'heroAbility') {
      const a = this.state.pendingAbility;
      const heroId = this.state.status?.hero?.heroId;
      if (!('x' in target)) return false;
      if (!a || heroId === undefined) {
        this.cancelTargeting();
        return false;
      }
      this.deps.sendCommand('HeroAbility', { heroId, abilityId: a.abilityId, x: Math.round(target.x), y: Math.round(target.y) });
      this.set({ targeting: null, pendingAbility: null });
      return true;
    }
    const ids = this.selectedIds();
    if (ids.length === 0) {
      this.cancelTargeting();
      return false;
    }
    if (kind === 'gather') {
      if (!('nodeId' in target)) return false;
      this.deps.sendCommand('Gather', { ids, nodeId: target.nodeId });
    } else {
      if (!('x' in target)) return false;
      const pos = { x: Math.round(target.x), y: Math.round(target.y) };
      this.deps.sendCommand(kind === 'move' ? 'Move' : 'AttackMove', { ids, ...pos });
    }
    this.set({ targeting: null });
    return true;
  }

  cancelTargeting(): void {
    this.stopTargeting();
  }

  requestSurrender(): void {
    this.stopTargeting();
    this.stopPlacement();
    this.set({ confirmSurrender: true, buildMenuOpen: false, craftMenuOpen: false });
  }

  cancelSurrender(): void {
    this.set({ confirmSurrender: false });
  }

  confirmSurrender(): void {
    if (!this.state.confirmSurrender) return;
    this.set({ confirmSurrender: false });
    this.deps.sendCommand('Surrender', {});
  }

  closeBuildMenu(): void {
    this.set({ buildMenuOpen: false });
  }

  /** Verwerkt een sneltoets. Geeft true als de toets is afgehandeld (dan preventDefault). */
  handleKeyDown(e: KeyboardEvent): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return false;
    const key = e.key.toLowerCase();
    if (key === 'escape') {
      if (this.state.confirmSurrender) this.cancelSurrender();
      else if (this.state.targeting) this.cancelTargeting();
      else if (this.state.placement) this.cancelPlacement();
      else if (this.state.buildMenuOpen) this.closeBuildMenu();
      else if (this.state.craftMenuOpen) this.set({ craftMenuOpen: false });
      else return false;
      return true;
    }
    if (this.state.confirmSurrender) return false;
    // Bouwmenu open: cijfers kiezen een gebouw (gaat voor de rolletoetsen).
    if (this.state.buildMenuOpen && /^[1-9]$/.test(key)) {
      const option = this.state.buildOptions[Number(key) - 1];
      return option ? this.chooseBuild(option.buildingId) || true : true;
    }
    if (this.state.craftMenuOpen && /^[1-9]$/.test(key)) {
      const option = this.state.craftOptions[Number(key) - 1];
      return option ? this.chooseCraft(option.loadoutId) || true : true;
    }
    // Gebouwpaneel (alleen gebouwen geselecteerd): cijfers kiezen research of rekruteren.
    if (/^[1-9]$/.test(key) && this.buildingPanelActive()) return this.chooseBuildingEntry(Number(key) - 1) || true;
    // Perk-keuze bij een level-up: F1, F2, F3 (browser-hulp op F1 wordt onderdrukt).
    const perkIdx = PERK_KEYS.indexOf(key as (typeof PERK_KEYS)[number]);
    if (perkIdx >= 0) {
      const perk = this.pendingPerks() > 0 ? this.state.perkOptions[perkIdx] : undefined;
      return perk ? this.pickPerk(perk.perkId) || true : this.hasHero();
    }
    // Abilities: Z, X, C.
    const abilityIdx = ABILITY_KEYS.indexOf(key as (typeof ABILITY_KEYS)[number]);
    if (abilityIdx >= 0) {
      const ability = this.state.heroAbilities[abilityIdx];
      return ability ? this.useAbility(ability.abilityId) || true : false;
    }
    if (key === 'r' && this.state.showLobby && this.deps.toggleReady) {
      this.toggleReady();
      return true;
    }
    if (key === 'o' && this.state.showLobby && this.deps.openHostSettings && this.isHost()) {
      this.openHostSettings();
      return true;
    }
    const action = ACTIONS.find((a) => a.key === key);
    return action ? this.run(action.id) : false;
  }

  canToggleReady(): boolean {
    return this.deps.toggleReady !== undefined;
  }

  toggleReady(): void {
    this.deps.toggleReady?.();
  }

  openHostSettings(): void {
    this.deps.openHostSettings?.();
  }

  isHost(): boolean {
    const l = this.state.lobby;
    return l !== null && l.hostId === l.you;
  }

  private selectedIds(includeBuildings = true): number[] {
    const sel = includeBuildings ? this.state.selection : this.state.selection.filter((s) => kindOfTypeId(s.typeId).kind !== 'building');
    return sel.slice(0, MAX_ENTITIES_PER_COMMAND).map((s) => s.id);
  }

  private stopTargeting(): void {
    if (!this.state.targeting) return;
    this.set({ targeting: null, pendingAbility: null });
    this.deps.endTargeting?.();
  }

  private stopPlacement(): void {
    if (!this.state.placement) return;
    this.set({ placement: null });
    this.deps.endPlacement?.();
  }

  private read(): void {
    const selection = [...this.deps.getSelection()];
    const d = this.deps;
    const status = d.getStatus();
    const hero = status?.hero ?? null;
    const pendingPerks = hero !== null && (hero.pendingPerks ?? 0) > 0;
    const buildingIds = [...new Set(selection.flatMap((s) => (kindOfTypeId(s.typeId).kind === 'building' ? [kindOfTypeId(s.typeId).index] : [])))];
    const units = selection.some((s) => kindOfTypeId(s.typeId).kind !== 'building');
    const craftOptions = units ? (d.getCraftOptions?.() ?? []) : [];
    const placement = selection.some((s) => s.role === 'builder') ? this.state.placement : null;
    if (this.state.placement && !placement) d.endPlacement?.();
    this.state = {
      ...this.state,
      status,
      selection,
      minimap: d.getMinimap?.() ?? null,
      buildOptions: this.state.buildMenuOpen ? (d.getBuildOptions?.() ?? []) : [],
      placement,
      perkOptions: pendingPerks ? (d.getPerkOptions?.() ?? []).filter((p) => !hero?.perks.includes(p.perkId)) : [],
      heroAbilities: hero ? (d.getHeroAbilities?.() ?? []) : [],
      heroDead: hero !== null && (d.isHeroDead?.() ?? false),
      researchOptions: buildingIds.length > 0 ? (d.getResearchOptions?.(buildingIds) ?? []) : [],
      recruitOptions: buildingIds.length > 0 ? (d.getRecruitOptions?.(buildingIds) ?? []) : [],
      craftOptions,
      craftMenuOpen: craftOptions.length > 0 ? this.state.craftMenuOpen : false,
      lobby: this.state.showLobby ? (d.getLobby?.() ?? null) : null,
      network: this.deps.getNetwork?.() ?? NO_NETWORK,
      // Targeting zonder selectie heeft geen zin meer.
      targeting: selection.length === 0 && this.state.targeting !== 'heroAbility' ? null : this.state.targeting,
    };
  }

  private set(patch: Partial<HudState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

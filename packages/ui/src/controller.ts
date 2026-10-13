import { MAX_ENTITIES_PER_COMMAND } from '@crawlout/protocol';
import type { PlayerStatus, Role } from '@crawlout/protocol';
import type {
  BuildOption,
  HeroInfo,
  HudAlert,
  HudDeps,
  HudHandle,
  LobbyView,
  MinimapData,
  NetworkState,
  PerkOption,
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
  | 'minimap'
  | 'lastAlert'
  | 'lobby';

/** Zo lang blijft een toast staan en zoveel staan er maximaal tegelijk. */
export const TOAST_MS = 6000;
export const MAX_TOASTS = 4;
/** Perk-keuzes via Q, W, E (de eerste drie opties). */
export const PERK_KEYS = ['q', 'w', 'e'] as const;

export interface ActionDef {
  id: ActionId;
  label: string;
  /** Toets in kleine letters, zoals KeyboardEvent.key. */
  key: string;
  needsSelection: boolean;
  /** Alleen zichtbaar als de bijbehorende dep of data er is. */
  requires?: 'hero' | 'minimap' | 'alert' | 'lobby';
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
  { id: 'minimap', label: 'Minimap', key: 'n', needsSelection: false, requires: 'minimap' },
  { id: 'lastAlert', label: 'Alarm', key: ' ', needsSelection: false, requires: 'alert' },
  { id: 'lobby', label: 'Lobby', key: 'l', needsSelection: false, requires: 'lobby' },
];

/** Sneltoets als label. */
export const keyLabel = (key: string): string => (key === ' ' ? 'Spatie' : key.toUpperCase());

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
  heroInfo: HeroInfo | null;
  perkOptions: readonly PerkOption[];
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
      heroInfo: null,
      perkOptions: [],
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
    return this.state.status?.hero != null && this.state.heroInfo !== null;
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
      this.set({ buildMenuOpen: !this.state.buildMenuOpen });
      this.read();
      this.emit();
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
    const info = this.state.heroInfo;
    if (!info || info.pendingPerks <= 0 || !this.state.perkOptions.some((p) => p.perkId === perkId)) return false;
    this.deps.sendCommand('PickPerk', { heroId: info.heroId, perkId });
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
    this.set({ confirmSurrender: true, buildMenuOpen: false });
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
      else return false;
      return true;
    }
    if (this.state.confirmSurrender) return false;
    // Bouwmenu open: cijfers kiezen een gebouw (gaat voor de rolletoetsen).
    if (this.state.buildMenuOpen && /^[1-9]$/.test(key)) {
      const option = this.state.buildOptions[Number(key) - 1];
      return option ? this.chooseBuild(option.buildingId) || true : true;
    }
    // Perk-keuze bij een level-up: Q, W, E.
    const perkIdx = PERK_KEYS.indexOf(key as (typeof PERK_KEYS)[number]);
    if (perkIdx >= 0 && this.state.heroInfo && this.state.heroInfo.pendingPerks > 0) {
      const perk = this.state.perkOptions[perkIdx];
      if (perk) return this.pickPerk(perk.perkId) || true;
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

  private selectedIds(): number[] {
    return this.state.selection.slice(0, MAX_ENTITIES_PER_COMMAND).map((s) => s.id);
  }

  private stopTargeting(): void {
    if (!this.state.targeting) return;
    this.set({ targeting: null });
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
    const heroInfo = status?.hero ? (d.getHeroInfo?.() ?? null) : null;
    const pendingPerks = heroInfo !== null && heroInfo.pendingPerks > 0;
    const placement = selection.some((s) => s.role === 'builder') ? this.state.placement : null;
    if (this.state.placement && !placement) d.endPlacement?.();
    this.state = {
      ...this.state,
      status,
      selection,
      minimap: d.getMinimap?.() ?? null,
      buildOptions: this.state.buildMenuOpen ? (d.getBuildOptions?.() ?? []) : [],
      placement,
      heroInfo,
      perkOptions: pendingPerks ? (d.getPerkOptions?.() ?? []).filter((p) => !status?.hero?.perks.includes(p.perkId)) : [],
      lobby: this.state.showLobby ? (d.getLobby?.() ?? null) : null,
      network: this.deps.getNetwork?.() ?? NO_NETWORK,
      // Targeting zonder selectie heeft geen zin meer.
      targeting: selection.length === 0 ? null : this.state.targeting,
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

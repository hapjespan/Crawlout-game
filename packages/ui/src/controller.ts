import { MAX_ENTITIES_PER_COMMAND } from '@crawlout/protocol';
import type { PlayerStatus, Role } from '@crawlout/protocol';
import { kindOfTypeId } from '@crawlout/data';
import type {
  BuildOption,
  BuildingCard,
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
  RosterGroup,
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

/** Tekst per kaartstatus; de view toont die naast een symbool, zodat de status nooit alleen via kleur te zien is. */
export const CARD_STATE_LABEL: Record<BuildingCard['state'], string> = {
  available: 'Beschikbaar',
  tooExpensive: 'Te duur',
  locked: 'Vergrendeld',
  running: 'Bezig',
  done: 'Klaar',
};

/** Kaarten uit de oude deps (getResearchOptions, getRecruitOptions, getCraftOptions): zonder icoon, effecten of duur. */
function legacyCards(research: readonly ResearchOption[], recruit: readonly RecruitOption[], craft: readonly CraftOption[]): BuildingCard[] {
  const base = { seconds: 0, effects: [], unlocks: [], requires: [] } as const;
  const state = (affordable: boolean): BuildingCard['state'] => (affordable ? 'available' : 'tooExpensive');
  const all: Omit<BuildingCard, 'hotkey'>[] = [
    ...research.map((o) => ({ ...base, kind: 'research' as const, id: o.techId, naam: o.naam, icon: 'research', scrapCost: o.scrapCost, state: state(o.affordable) })),
    ...recruit.map((o) => ({ ...base, kind: 'revive' as const, id: o.buildingId, naam: o.naam, icon: 'revive', scrapCost: o.scrapCost, state: state(o.affordable) })),
    ...craft.map((o) => ({ ...base, kind: 'craft' as const, id: o.loadoutId, naam: o.naam, icon: 'craft', scrapCost: o.scrapCost, state: state(o.affordable) })),
  ];
  return all.map((c, i) => ({ ...c, hotkey: String(i + 1) }));
}

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
  /** Kaarten van het gebouwpaneel voor de huidige selectie. */
  cards: readonly BuildingCard[];
  /** Bij een selectie met bewoners: K heeft de cijfertoetsen van de craftkaarten geactiveerd. */
  craftMenuOpen: boolean;
  toasts: readonly ToastAlert[];
  lobby: LobbyView | null;
  showMinimap: boolean;
  showHero: boolean;
  showLobby: boolean;
  roster: readonly RosterGroup[];
  /** Uitgeklapte groep in de eenhedenbalk (key), of null. */
  rosterOpen: string | null;
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
      roster: [],
      rosterOpen: null,
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
      cards: [],
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
        return this.hasCraftCards();
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

  /** Alleen gebouwen geselecteerd (en er is een selectie). */
  private buildingsOnly(): boolean {
    return this.state.selection.length > 0 && this.state.selection.every((s) => kindOfTypeId(s.typeId).kind === 'building');
  }

  hasCraftCardsForKeys(): boolean {
    return this.hasCraftCards();
  }

  /** Kan deze lopende kaart geannuleerd worden (is er een cancelCard-dep)? */
  canCancelCard(card: BuildingCard): boolean {
    return card.state === 'running' && this.deps.cancelCard !== undefined;
  }

  private hasCraftCards(): boolean {
    return this.state.cards.some((c) => c.kind === 'craft') && this.state.selection.some((s) => kindOfTypeId(s.typeId).kind !== 'building');
  }

  /** Werken de cijfertoetsen nu voor de kaarten? Bij alleen gebouwen altijd; bij bewoners na K (craft). */
  cardKeysActive(): boolean {
    if (this.state.cards.length === 0) return false;
    return this.buildingsOnly() || (this.state.craftMenuOpen && this.hasCraftCards());
  }

  /** Mag deze kaart nu starten? Alleen state available, en bij craft moet er een bewoner in de selectie zijn. */
  canStartCard(card: BuildingCard): boolean {
    if (card.state !== 'available' || this.state.confirmSurrender) return false;
    return card.kind !== 'craft' || this.selectedIds(false).length > 0;
  }

  /** Start een kaart (klik of sneltoets). Geeft false als ze niet start (vergrendeld, te duur, loopt of klaar). */
  startCard(card: BuildingCard): boolean {
    if (!this.canStartCard(card)) return false;
    if (this.deps.startCard) this.deps.startCard(card);
    else if (card.kind === 'research') this.deps.sendCommand('Research', { techId: card.id });
    else if (card.kind === 'revive') this.deps.sendCommand('Recruit', { buildingId: card.id });
    else this.deps.sendCommand('Craft', { ids: this.selectedIds(false), loadoutId: card.id });
    if (card.kind === 'craft') this.set({ craftMenuOpen: false });
    return true;
  }

  /** Annuleert een lopende kaart. De oude deps hebben geen annuleren; dan blijft de kaart ongemoeid. */
  cancelCard(card: BuildingCard): boolean {
    if (card.state !== 'running' || !this.deps.cancelCard) return false;
    this.deps.cancelCard(card);
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
    // Kaarten van het gebouwpaneel (alleen gebouwen, of bewoners na K): cijfers starten de kaart met die sneltoets.
    if (/^[1-9]$/.test(key) && this.cardKeysActive()) {
      const card = this.state.cards.find((c) => c.hotkey === key);
      return card ? this.startCard(card) || true : true;
    }
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
    if (key === '.' && this.deps.getRoster) return this.selectNextIdle() || true;
    const action = ACTIONS.find((a) => a.key === key);
    return action ? this.run(action.id) : false;
  }

  /** Klik op een type in de eenhedenbalk: selecteer alle units van dat type en klap de lijst uit (nogmaals: inklappen). */
  selectGroup(key: string, add = false): boolean {
    const group = this.state.roster.find((g) => g.key === key);
    if (!group || !this.deps.selectUnits) return false;
    this.deps.selectUnits(
      group.units.map((u) => u.id),
      add,
    );
    this.read();
    this.set({ rosterOpen: this.state.rosterOpen === key && !add ? null : key });
    return true;
  }

  /** Klik op één unit in de uitgeklapte lijst: alleen die unit selecteren en de camera erheen. */
  selectRosterUnit(id: number, add = false): boolean {
    const unit = this.state.roster.flatMap((g) => g.units).find((u) => u.id === id);
    if (!unit || !this.deps.selectUnits) return false;
    this.deps.selectUnits([id], add);
    if (!add) this.deps.focusCamera?.(unit.x, unit.y);
    this.refresh();
    return true;
  }

  /** Punt (.): de volgende unit zonder taak selecteren en de camera erheen; elke druk gaat een unit verder. */
  selectNextIdle(): boolean {
    const idle = this.state.roster.flatMap((g) => g.units).filter((u) => u.activity === 'idle');
    if (idle.length === 0 || !this.deps.selectUnits) return false;
    const current = this.state.selection.length === 1 ? this.state.selection[0]?.id : undefined;
    const at = idle.findIndex((u) => u.id === current);
    const next = idle[(at + 1) % idle.length]!;
    return this.selectRosterUnit(next.id);
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
    const cards = this.readCards(selection, buildingIds, units);
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
      cards,
      craftMenuOpen: cards.some((c) => c.kind === 'craft') && units ? this.state.craftMenuOpen : false,
      lobby: this.state.showLobby ? (d.getLobby?.() ?? null) : null,
      roster: d.getRoster?.() ?? [],
      network: this.deps.getNetwork?.() ?? NO_NETWORK,
      // Targeting zonder selectie heeft geen zin meer.
      targeting: selection.length === 0 && this.state.targeting !== 'heroAbility' ? null : this.state.targeting,
    };
  }

  /** Kaarten voor de selectie: de nieuwe dep, of (tijdelijk) opgebouwd uit de oude deps. */
  private readCards(selection: readonly SelectedEntity[], buildingIds: readonly number[], units: boolean): readonly BuildingCard[] {
    const d = this.deps;
    if (selection.length === 0) return [];
    if (d.getBuildingCards) return d.getBuildingCards(selection);
    const research = buildingIds.length > 0 ? (d.getResearchOptions?.(buildingIds) ?? []) : [];
    const recruit = buildingIds.length > 0 ? (d.getRecruitOptions?.(buildingIds) ?? []) : [];
    const craft = units ? (d.getCraftOptions?.() ?? []) : [];
    return research.length + recruit.length + craft.length > 0 ? legacyCards(research, recruit, craft) : [];
  }

  private set(patch: Partial<HudState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

import { MAX_ENTITIES_PER_COMMAND } from '@crawlout/protocol';
import type { PlayerStatus, Role } from '@crawlout/protocol';
import { heroIdOfTypeId, kindOfTypeId } from '@crawlout/data';
import type {
  BuildOption,
  BuildingButton,
  BuildingCard,
  CraftOption,
  HeroAbilityOption,
  DominanceView,
  HudAlert,
  HudDeps,
  HudHandle,
  LobbyView,
  MinimapData,
  NetworkState,
  PerkOption,
  RaiderStats,
  RecruitOption,
  ResearchOption,
  RosterGroup,
  SelectedEntity,
  TargetPoint,
  TargetResult,
  TargetingKind,
  ToastAlert,
  UnitActivity,
  UnitState,
} from './types.js';

export type ActionId =
  | 'move'
  | 'stop'
  | 'attackMove'
  | 'capture'
  | 'liberate'
  | 'gather'
  | 'roleScavenger'
  | 'roleBuilder'
  | 'roleMilitia'
  | 'build'
  | 'revive'
  | 'lastAlert'
  | 'lobby';

/**
 * Snelknoppen van de consoles (zijconsole links, sleutelplaten rechts, ronde knopjes): elk is een echte HUD-actie die al
 * een sneltoets of knop had, of zegt waarom hij nu niets kan doen.
 */
export type QuickId =
  | 'hero'
  | 'building'
  | 'idle'
  | 'build'
  | 'lobby'
  | 'perks'
  | 'craft'
  | 'training'
  | 'alert'
  | 'menu';

/** Wat een snelknop meldt als hij nu niets kan doen. */
export const QUICK_HINT: Record<QuickId, string> = {
  hero: 'Er is nu geen held om te selecteren.',
  building: 'Je hebt nog geen gebouw met een taak.',
  idle: 'Alle eenheden hebben een taak.',
  build: 'Selecteer eerst een bouwer om te bouwen.',
  lobby: 'Er is geen lobby in dit potje.',
  perks: 'Je hebt geen perk om te kiezen.',
  craft: 'Selecteer een bewoner om uit te rusten.',
  training: 'Je hebt nog geen trainingsfaciliteit.',
  alert: 'Er is geen alarm om naartoe te gaan.',
  menu: 'Menu',
};

/** De gebouwknop van de trainingsfaciliteit (data-key), voor de CHR-knop. */
export const TRAINING_BUILDING_KEY = 'trainingsfaciliteit';

/** Zo lang blijft een toast staan en zoveel staan er maximaal tegelijk. */
export const TOAST_MS = 6000;
export const MAX_TOASTS = 4;
/** Perk-keuzes via F1, F2, F3 (de eerste drie opties); Q, W, E en A, S, D zijn van de camera. */
export const PERK_KEYS = ['f1', 'f2', 'f3'] as const;
/** Held-abilities in volgorde van getHeroAbilities(). */
export const ABILITY_KEYS = ['z', 'x', 'c'] as const;
/** Sneltoetsen zonder knop: H zoekt de held op, K schakelt de cijfertoetsen van de craftkaarten. */
export const HERO_KEY = 'h';
/** P opent en sluit het perk-paneel zolang er een perk te kiezen is. */
export const PERK_PANEL_KEY = 'p';
export const CRAFT_KEY = 'k';
/** Een kaartstart binnen dit venster na dezelfde kaart telt niet mee (pointerup en klik van dezelfde druk). */
const CARD_DEDUPE_MS = 350;
/** Zo lang blijft de reden staan nadat de speler op een kaart klikt die niet start. */
export const CARD_NOTICE_MS = 3500;
export const HINT_MS = 1800;

export interface ActionDef {
  id: ActionId;
  label: string;
  /** Toets in kleine letters, zoals KeyboardEvent.key. */
  key: string;
  needsSelection: boolean;
  /** Alleen zichtbaar als de bijbehorende dep of data er is; deze acties hangen niet van de selectie af. */
  requires?: 'revive' | 'alert' | 'lobby';
}

/** Wat er geselecteerd is, per soort; bepaalt welke commando's op de kaart staan. */
export interface SelectionSummary {
  /** Alles wat geen gebouw is (held en robots incluis). */
  units: number;
  buildings: number;
  hero: boolean;
  builders: number;
  scavengers: number;
  militia: number;
  /** Units zonder een van de drie rollen en zonder held: robots, technici. */
  other: number;
  /** Raiders: slaven die verzamelen of bouwen, Slavers, en andere Raider-vechters (de laatste twee tellen niet als militie). */
  slaveScavengers: number;
  slaveBuilders: number;
  slavers: number;
  raiderFighters: number;
}

/** Commandokaart: volgorde is de volgorde op het scherm. Wat er staat hangt af van de selectie (zie appliesTo). */
export const ACTIONS: readonly ActionDef[] = [
  { id: 'move', label: 'Verplaats', key: 'm', needsSelection: true },
  { id: 'stop', label: 'Stop', key: 's', needsSelection: true },
  { id: 'attackMove', label: 'Val aan', key: 'a', needsSelection: true },
  { id: 'capture', label: 'Vang', key: 'f', needsSelection: true },
  { id: 'liberate', label: 'Bevrijd', key: 'r', needsSelection: true },
  { id: 'gather', label: 'Verzamel', key: 'g', needsSelection: true },
  { id: 'build', label: 'Bouw', key: 'b', needsSelection: true },
  { id: 'roleScavenger', label: 'Plunderaar', key: '1', needsSelection: true },
  { id: 'roleBuilder', label: 'Bouwer', key: '2', needsSelection: true },
  { id: 'roleMilitia', label: 'Militie', key: '3', needsSelection: true },
  { id: 'revive', label: 'Oplappen', key: 'v', needsSelection: false, requires: 'revive' },
  { id: 'lastAlert', label: 'Alarm', key: ' ', needsSelection: false, requires: 'alert' },
  { id: 'lobby', label: 'Lobby', key: 'l', needsSelection: false, requires: 'lobby' },
];

/** Telt de selectie per soort. */
export function summarize(selection: readonly SelectedEntity[]): SelectionSummary {
  const sum: SelectionSummary = {
    units: 0,
    buildings: 0,
    hero: false,
    builders: 0,
    scavengers: 0,
    militia: 0,
    other: 0,
    slaveScavengers: 0,
    slaveBuilders: 0,
    slavers: 0,
    raiderFighters: 0,
  };
  for (const s of selection) {
    if (s.enemy) continue; // an enemy is inspected, never commanded
    if (kindOfTypeId(s.typeId).kind === 'building') sum.buildings++;
    else if (heroIdOfTypeId(s.typeId) >= 0) {
      sum.units++;
      sum.hero = true;
    } else {
      sum.units++;
      if (s.raiderKind === 'slave') {
        if (s.role === 'builder') sum.slaveBuilders++;
        else sum.slaveScavengers++;
      } else if (s.raiderKind === 'slaver') sum.slavers++;
      else if (s.raiderKind) sum.raiderFighters++;
      else if (s.role === 'builder') sum.builders++;
      else if (s.role === 'scavenger') sum.scavengers++;
      else if (s.role === 'militia') sum.militia++;
      else sum.other++;
    }
  }
  return sum;
}

/**
 * Past deze selectie-afhankelijke actie bij de selectie? Verplaats en Stop bij elke unit; Val aan bij wie vecht (niet bij
 * alleen plunderaars of bouwers); Verzamel bij plunderaars; Bouw bij bouwers; een rol alleen met een voltooide
 * werkplaats (canSwitchRole) en als minstens een bewoner die rol nog niet heeft.
 */
function appliesTo(
  id: ActionId,
  s: SelectionSummary,
  canSwitchRole: boolean,
  enemySlaves = false,
): boolean {
  const slaves = s.slaveScavengers + s.slaveBuilders;
  switch (id) {
    case 'capture':
      return s.slavers > 0;
    case 'liberate':
      // Attack on an enemy slave is "go and touch him" for any unit that can walk and is no slave itself.
      return enemySlaves && s.militia + s.other + s.slavers + s.raiderFighters > 0;
    case 'move':
    case 'stop':
      return s.units > 0;
    case 'attackMove':
      return s.militia + s.other + s.raiderFighters > 0 || s.hero;
    case 'gather':
      return s.scavengers + s.slaveScavengers > 0;
    case 'build':
      return s.builders + s.slaveBuilders > 0;
    case 'roleScavenger':
      return canSwitchRole && (s.builders + s.militia > 0 || s.slaveBuilders > 0);
    case 'roleBuilder':
      return canSwitchRole && (s.scavengers + s.militia > 0 || s.slaveScavengers > 0);
    case 'roleMilitia':
      return canSwitchRole && slaves === 0 && s.scavengers + s.builders > 0;
    default:
      return true;
  }
}

/**
 * Kleur van een eenheidsbalk: beschikbaar (niets te doen), werkt (verzamelen en terugbrengen, bouwen, craften of
 * repareren) of bezig (onderweg onder een bevel, vechten).
 */
export function unitStateOf(activity: UnitActivity): UnitState {
  switch (activity) {
    case 'idle':
      return 'available';
    case 'gathering':
    case 'carrying':
    case 'building':
      return 'working';
    default:
      return 'busy';
  }
}

/**
 * Label of a command for this selection: a Raider slave's role switch is "Slaaf" / "Slaaf-bouwer" (the Dweller names would
 * be wrong), everything else is the static label.
 */
export function actionLabel(a: ActionDef, s: SelectionSummary): string {
  if (s.slaveScavengers + s.slaveBuilders > 0) {
    if (a.id === 'roleScavenger') return 'Slaaf';
    if (a.id === 'roleBuilder') return 'Slaaf-bouwer';
  }
  return a.label;
}

/** Role of a selected unit in plain Dutch: a Raider slave is a "Slaaf", a Raider fighter a "Vechter", else the SetRole role. */
export function roleLabelOf(u: Pick<SelectedEntity, 'role' | 'raiderKind'>): string | undefined {
  if (u.raiderKind === 'slave') return u.role === 'builder' ? 'Slaaf-bouwer' : 'Slaaf';
  if (u.raiderKind) return 'Vechter';
  return u.role ? ROLE_LABEL[u.role] : undefined;
}

/** Sneltoets als label. */
export const keyLabel = (key: string): string => (key === ' ' ? 'Spatie' : key.toUpperCase());

/** Tekst per kaartstatus; de view toont die naast een symbool, zodat de status nooit alleen via kleur te zien is. */
export const CARD_STATE_LABEL: Record<BuildingCard['state'], string> = {
  available: 'Beschikbaar',
  tooExpensive: 'Te duur',
  locked: 'Vergrendeld',
  busy: 'Gebouw bezig',
  running: 'Bezig',
  done: 'Klaar',
};

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

export const ROLE_LABEL: Record<Role, string> = {
  scavenger: 'Plunderaar',
  builder: 'Bouwer',
  militia: 'Militie',
};
const ACTION_ROLE: Partial<Record<ActionId, Role>> = {
  roleScavenger: 'scavenger',
  roleBuilder: 'builder',
  roleMilitia: 'militia',
};
const ACTION_TARGETING: Partial<Record<ActionId, TargetingKind>> = {
  move: 'move',
  attackMove: 'attackMove',
  capture: 'capture',
  liberate: 'liberate',
  gather: 'gather',
};

export interface HudState {
  status: PlayerStatus | null;
  selection: readonly SelectedEntity[];
  network: NetworkState;
  targeting: TargetingKind | null;
  buildMenuOpen: boolean;
  confirmSurrender: boolean;
  minimap: MinimapData | null;
  dominance: DominanceView | null;
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

const NO_NETWORK: NetworkState = { desync: null, stall: null };

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable === true
  );
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
  /** Telde de tegenstander bij de vorige lezing al? Alleen de overgang geeft een toast. */
  private opponentCounting = false;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private hintTimer: ReturnType<typeof setTimeout> | null = null;
  /** Laatst gestarte kaart, om één druk (pointerup plus klik) niet twee keer te starten. */
  private lastCardStart: { key: string; at: number } | null = null;
  /** Kaart waarop de knop is ingedrukt en nog niet losgelaten (pointerdown), zie cardPress. */
  private pressedCard: string | null = null;

  constructor(
    private readonly deps: HudDeps,
    /** Demo-only: keep the build menu open while a building is being placed (never set by the game). */
    private readonly keepBuildMenuWhilePlacing = false,
  ) {
    this.state = {
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
    };
    this.read();
    this.opponentCounting = threatOf(this.state.dominance) !== null;
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
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = null;
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hintTimer = null;
    this.listeners.clear();
  }

  refresh(): void {
    this.read();
    const counting = threatOf(this.state.dominance) !== null;
    const started = counting && !this.opponentCounting;
    this.opponentCounting = counting;
    if (started) this.pushAlert({ kind: 'dominance', x: 0, y: 0 });
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

  /** Telt de huidige selectie per soort. */
  selectionSummary(): SelectionSummary {
    return summarize(this.state.selection);
  }

  /** Is de held (ook) geselecteerd? */
  heroSelected(): boolean {
    return this.state.selection.some((s) => !s.enemy && heroIdOfTypeId(s.typeId) >= 0);
  }

  /** De acties die nu op de commandokaart staan: alleen wat bij de selectie past, plus oplappen, alarm en lobby. */
  visibleActions(): readonly ActionDef[] {
    return ACTIONS.filter((a) => this.isAvailable(a));
  }

  /** Staat deze actie op de kaart (past bij de selectie, dep aanwezig, data beschikbaar)? */
  isAvailable(action: ActionDef): boolean {
    switch (action.requires) {
      case 'revive':
        return this.canRevive();
      case 'alert':
        return this.state.toasts.some((t) => t.kind !== 'dominance');
      case 'lobby':
        return this.deps.getLobby !== undefined;
      default:
        return appliesTo(
          action.id,
          this.selectionSummary(),
          this.state.canSwitchRole,
          this.state.enemySlaves,
        );
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
    return (
      hero != null &&
      this.state.heroDead &&
      this.deps.reviveHero !== undefined &&
      (hero.revivesLeft ?? 1) > 0
    );
  }

  /** Is een ability nu bruikbaar (held leeft, heeft id, cooldown klaar)? */
  canUseAbility(a: HeroAbilityOption): boolean {
    const hero = this.state.status?.hero;
    return hero?.heroId !== undefined && !this.state.heroDead && a.cooldownPct <= 0;
  }

  /** Is een vijand geselecteerd om te bekijken? */
  enemySelected(): boolean {
    return this.state.selection.some((s) => s.enemy === true);
  }

  /** Alleen gebouwen geselecteerd (en er is een selectie). */
  private buildingsOnly(): boolean {
    return (
      this.state.selection.length > 0 &&
      !this.enemySelected() &&
      this.state.selection.every((s) => kindOfTypeId(s.typeId).kind === 'building')
    );
  }

  hasCraftCardsForKeys(): boolean {
    return this.hasCraftCards();
  }

  /** Kan deze lopende kaart geannuleerd worden (is er een cancelCard-dep)? */
  canCancelCard(card: BuildingCard): boolean {
    return card.state === 'running' && this.deps.cancelCard !== undefined;
  }

  private hasCraftCards(): boolean {
    return (
      this.state.cards.some((c) => c.kind === 'craft') &&
      this.state.selection.some((s) => !s.enemy && kindOfTypeId(s.typeId).kind !== 'building')
    );
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

  /** Waarom deze kaart nu niet start, in gewone taal; null als ze wel start. De client kan een eigen reden meegeven. */
  cardReason(card: BuildingCard): string | null {
    if (this.canStartCard(card)) return null;
    if (card.reason) return card.reason;
    switch (card.state) {
      case 'tooExpensive':
        return `Te duur: ${card.naam} kost ${card.scrapCost} scrap`;
      case 'locked':
        return card.requires.length > 0
          ? `Vergrendeld: vereist ${card.requires.join(', ')}`
          : 'Vergrendeld';
      case 'busy':
        return 'Dit gebouw is al bezig met ander werk';
      case 'running':
        return `${card.naam} loopt al`;
      case 'done':
        return `${card.naam} is al klaar`;
      default:
        return card.kind === 'craft' ? 'Selecteer eerst een bewoner om te craften' : null;
    }
  }

  private cardKey(card: BuildingCard): string {
    return `${card.kind}:${card.id}`;
  }

  /** Muis of vinger gaat omlaag op een kaart; de start volgt bij loslaten op dezelfde kaart (cardRelease). */
  cardPress(card: BuildingCard): void {
    this.pressedCard = this.cardKey(card);
  }

  /**
   * Loslaten op een kaart: starten als de druk ook op deze kaart begon. Zo gaat de klik niet verloren als de lijst
   * tussen indrukken en loslaten opnieuw getekend wordt en de browser daardoor geen click meer stuurt.
   */
  cardRelease(card: BuildingCard): void {
    const key = this.cardKey(card);
    if (this.pressedCard !== key) return;
    this.pressedCard = null;
    this.lastCardStart = { key, at: Date.now() };
    this.startCard(card);
  }

  /** De click na een cardRelease van dezelfde druk telt niet nog een keer; toetsenbord en losse clicks starten wel. */
  cardClick(card: BuildingCard): void {
    const last = this.lastCardStart;
    this.lastCardStart = null;
    if (last && last.key === this.cardKey(card) && Date.now() - last.at < CARD_DEDUPE_MS) return;
    this.startCard(card);
  }

  /** Toont kort waarom een actie niet doorging. */
  private showNotice(text: string): void {
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      this.noticeTimer = null;
      this.set({ cardNotice: null });
    }, CARD_NOTICE_MS);
    this.set({ cardNotice: text });
  }

  /**
   * Start een kaart (klik of sneltoets). Geeft false als ze niet start (vergrendeld, te duur, bezig, loopt of klaar);
   * de speler krijgt dan de reden te zien.
   */
  startCard(card: BuildingCard): boolean {
    if (!this.canStartCard(card)) {
      const reason = this.cardReason(card);
      if (reason) this.showNotice(reason);
      return false;
    }
    if (this.state.cardNotice) this.set({ cardNotice: null });
    if (this.deps.startCard) this.deps.startCard(card);
    else if (card.kind === 'research') this.deps.sendCommand('Research', { techId: card.id });
    else if (card.kind === 'revive') this.deps.sendCommand('Recruit', { buildingId: card.id });
    else if (card.kind === 'produce' && card.buildingId !== undefined)
      this.deps.sendCommand('Produce', { buildingId: card.buildingId, loadoutId: card.id });
    else if (card.kind === 'train' && card.buildingId !== undefined)
      this.deps.sendCommand('Train', { buildingId: card.buildingId, programId: card.id });
    else if (card.kind === 'craft')
      this.deps.sendCommand('Craft', { ids: this.selectedIds(false), loadoutId: card.id });
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
    if (!a || heroId === undefined || !this.canUseAbility(a) || this.state.confirmSurrender)
      return false;
    if (a.needsTarget) {
      this.stopTargeting();
      this.set({
        targeting: 'heroAbility',
        pendingAbility: a,
        buildMenuOpen: false,
        craftMenuOpen: false,
      });
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
    return this.state.selection
      .filter((s) => !s.enemy && s.role === 'builder')
      .slice(0, MAX_ENTITIES_PER_COMMAND)
      .map((s) => s.id);
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
      // Only settlers switch role: the hero and robots would be ignored by the sim anyway.
      const settlers = this.state.selection
        .filter((s) => !s.enemy && s.role !== null && s.role !== role)
        .slice(0, MAX_ENTITIES_PER_COMMAND)
        .map((s) => s.id);
      if (settlers.length === 0) return false;
      this.stopTargeting();
      this.deps.sendCommand('SetRole', { ids: settlers, role });
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
    } else if (id === 'lastAlert') {
      this.focusLastAlert();
    } else if (id === 'lobby') {
      this.set({ showLobby: !this.state.showLobby });
      this.read();
      this.emit();
    }
    return true;
  }

  /** K: schakelt de cijfertoetsen van de craftkaarten (alleen bij een selectie met bewoners en craftkaarten). */
  toggleCraftMenu(): boolean {
    if (!this.hasCraftCards() || this.state.confirmSurrender) return false;
    this.stopTargeting();
    this.stopPlacement();
    this.set({ craftMenuOpen: !this.state.craftMenuOpen, buildMenuOpen: false });
    return true;
  }

  /** H: selecteert de held en zet de camera op hem. Geeft false zonder held in het veld. */
  focusHero(): boolean {
    const unit = this.state.roster.find((g) => g.key === 'hero')?.units[0];
    if (unit) return this.selectRosterUnit(unit.id);
    const entityId = this.state.status?.hero?.entityId;
    // ENTITY_NONE (0) means no living hero entity.
    if (!entityId || !this.deps.selectUnits || this.state.heroDead) return false;
    this.deps.selectUnits([entityId], false);
    this.refresh();
    return true;
  }

  /**
   * Klik op een gebouwknop: selecteer een gebouw van dat type, zodat zijn kaarten verschijnen, en zet de camera erop.
   * Nog een klik gaat naar het volgende gebouw van hetzelfde type (doorklikken). Met `focus` (dubbelklik) blijft de keuze
   * staan: het geselecteerde gebouw van het type, of het eerste als er geen geselecteerd is. Met `add` (shift) komt het
   * gebouw erbij en blijft de camera staan.
   */
  selectBuilding(key: string, focus = false, add = false): boolean {
    const group = this.state.buildingButtons.find((b) => b.key === key);
    if (!group || group.sites.length === 0 || !this.deps.selectUnits) return false;
    const selected = new Set(this.state.selection.map((s) => s.id));
    const at = group.sites.findIndex((s) => selected.has(s.id));
    const only = this.state.selection.length === 1;
    const site = focus
      ? (group.sites[at] ?? group.sites[0]!)
      : (group.sites[at >= 0 && only ? (at + 1) % group.sites.length : 0] ?? group.sites[0]!);
    this.deps.selectUnits([site.id], add);
    if (focus || !add) this.deps.focusCamera?.(site.x, site.y);
    this.refresh();
    return true;
  }

  /** Bouwmenu-keuze: gaat in plaatsingsmodus. Geeft false als de optie niet kiesbaar is. */
  chooseBuild(buildingId: number): boolean {
    const option = this.state.buildOptions.find((o) => o.buildingId === buildingId);
    if (!option || !this.canChooseBuild(option)) return false;
    this.stopTargeting();
    this.set({ placement: option, buildMenuOpen: this.keepBuildMenuWhilePlacing });
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
    this.deps.sendCommand('Build', {
      ids,
      typeId: option.typeId,
      x: Math.round(pos.x),
      y: Math.round(pos.y),
    });
    this.set({ placement: null, placementHint: null });
    this.deps.endPlacement?.();
    return true;
  }

  cancelPlacement(): void {
    this.stopPlacement();
  }

  setPlacementHint(reason: string | null): void {
    if (this.state.placementHint === reason) return;
    this.set({ placementHint: this.state.placement ? reason : null });
  }

  showHint(text: string): void {
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => {
      this.hintTimer = null;
      this.set({ hint: null });
    }, HINT_MS);
    this.set({ hint: text });
  }

  /** Opent of sluit het perk-paneel; alleen zolang er een perk te kiezen is. */
  togglePerkPanel(): boolean {
    if (this.pendingPerks() <= 0 || this.state.confirmSurrender) return false;
    this.set({ perkPanelOpen: !this.state.perkPanelOpen });
    return true;
  }

  closePerkPanel(): void {
    if (this.state.perkPanelOpen) this.set({ perkPanelOpen: false });
  }

  /** Kiest een perk (PickPerk). Een perk waarvan de held de vereiste niet haalt (available false) is niet te kiezen. */
  pickPerk(perkId: number): boolean {
    const heroId = this.state.status?.hero?.heroId;
    const option = this.state.perkOptions.find((p) => p.perkId === perkId);
    if (heroId === undefined || this.pendingPerks() <= 0 || !option || option.available === false)
      return false;
    this.deps.sendCommand('PickPerk', { heroId, perkId });
    // The last pending pick closes the panel; with more picks left it stays open (the sim answers on the next status).
    if (this.pendingPerks() <= 1) this.set({ perkPanelOpen: false });
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
    if (alert.kind === 'dominance') return; // geen locatie
    this.deps.focusCamera?.(alert.x, alert.y);
  }

  dismissToast(id: number): void {
    const t = this.toastTimers.get(id);
    if (t) clearTimeout(t);
    this.toastTimers.delete(id);
    this.set({ toasts: this.state.toasts.filter((a) => a.id !== id) });
  }

  private focusLastAlert(): void {
    const last = this.state.toasts.filter((t) => t.kind !== 'dominance').pop();
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
    this.toastTimers.set(
      id,
      setTimeout(() => this.dismissToast(id), TOAST_MS),
    );
    this.set({ toasts });
  }

  completeTargeting(target: TargetResult): boolean {
    const kind = this.state.targeting;
    if (!kind) return false;
    if (kind === 'heroAbility') {
      const a = this.state.pendingAbility;
      const heroId = this.state.status?.hero?.heroId;
      if (!('x' in target)) return false; // a clicked enemy also carries its position
      if (!a || heroId === undefined) {
        this.cancelTargeting();
        return false;
      }
      this.deps.sendCommand('HeroAbility', {
        heroId,
        abilityId: a.abilityId,
        x: Math.round(target.x),
        y: Math.round(target.y),
      });
      this.set({ targeting: null, pendingAbility: null });
      this.deps.endTargeting?.();
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
    } else if ('enemyId' in target) {
      // Attack-move onto an enemy unit or building: attack that entity.
      if (kind !== 'attackMove' && kind !== 'capture' && kind !== 'liberate') return false;
      this.deps.sendCommand('Attack', { ids, target: target.enemyId });
    } else {
      if (!('x' in target)) return false;
      const pos = { x: Math.round(target.x), y: Math.round(target.y) };
      this.deps.sendCommand(kind === 'move' ? 'Move' : 'AttackMove', { ids, ...pos });
    }
    this.set({ targeting: null });
    // The client keeps its own cursor and click mode; without this a finished order left it in targeting mode for good.
    this.deps.endTargeting?.();
    return true;
  }

  cancelTargeting(): void {
    this.stopTargeting();
  }

  targetingActive(): boolean {
    return this.state.targeting !== null;
  }

  placementActive(): boolean {
    return this.state.placement !== null;
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
      else if (this.state.perkPanelOpen) this.closePerkPanel();
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
    if (key === PERK_PANEL_KEY) return this.togglePerkPanel();
    if (key === HERO_KEY) return this.focusHero() || this.hasHero();
    if (key === CRAFT_KEY) return this.toggleCraftMenu();
    const action = ACTIONS.find((a) => a.key === key);
    return action ? this.run(action.id) : false;
  }

  /**
   * Klik op een type in de eenhedenbalk: selecteer alle units van dat type, zet de camera op hun zwaartepunt en klap de
   * lijst uit (nogmaals: inklappen). Met `add` (shift) komen ze erbij en blijft de camera staan.
   */
  selectGroup(key: string, add = false): boolean {
    const group = this.state.roster.find((g) => g.key === key);
    if (!group || !this.deps.selectUnits) return false;
    this.deps.selectUnits(
      group.units.map((u) => u.id),
      add,
    );
    if (!add && group.units.length > 0) {
      const n = group.units.length;
      const cx = group.units.reduce((sum, u) => sum + u.x, 0) / n;
      const cy = group.units.reduce((sum, u) => sum + u.y, 0) / n;
      this.deps.focusCamera?.(Math.round(cx), Math.round(cy));
    }
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

  /**
   * Klik op een kaart in het selectiepaneel: alleen die eenheid (of dat gebouw) selecteren en de camera erheen. De
   * positie komt van de selectie zelf (SelectedEntity.x en y); zonder positie blijft de camera staan.
   */
  selectSelected(id: number): boolean {
    const entry = this.state.selection.find((s) => s.id === id);
    if (!entry || !this.deps.selectUnits) return false;
    this.deps.selectUnits([id], false);
    if (entry.x !== undefined && entry.y !== undefined) this.deps.focusCamera?.(entry.x, entry.y);
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

  /** Eerstvolgende eigen gebouw met een taak (in volgorde van de gebouwenbalk): selecteren en de camera erheen. */
  selectNextBuilding(): boolean {
    const sites = this.state.buildingButtons.flatMap((b) => b.sites);
    if (sites.length === 0 || !this.deps.selectUnits) return false;
    const current = this.state.selection.length === 1 ? this.state.selection[0]?.id : undefined;
    const at = sites.findIndex((s) => s.id === current);
    const next = sites[(at + 1) % sites.length]!;
    this.deps.selectUnits([next.id], false);
    this.deps.focusCamera?.(next.x, next.y);
    this.refresh();
    return true;
  }

  /**
   * Kan deze snelknop nu iets doen? De knoppen van de zijconsole en de rechterconsole zijn nooit dood: zonder
   * mogelijkheid zegt een klik waarom (QUICK_HINT) in plaats van niets te doen.
   */
  quickAvailable(id: QuickId): boolean {
    const s = this.state;
    switch (id) {
      case 'hero':
        return (
          s.roster.some((g) => g.key === 'hero' && g.units.length > 0) ||
          (!!s.status?.hero?.entityId && !s.heroDead && this.deps.selectUnits !== undefined)
        );
      case 'building':
        return s.buildingButtons.some((b) => b.sites.length > 0) && !!this.deps.selectUnits;
      case 'idle':
        return (
          s.roster.some((g) => g.units.some((u) => u.activity === 'idle')) &&
          !!this.deps.selectUnits
        );
      case 'build':
        return this.isEnabled(ACTIONS.find((a) => a.id === 'build')!);
      case 'lobby':
        return this.deps.getLobby !== undefined;
      case 'perks':
        return this.pendingPerks() > 0;
      case 'craft':
        return this.hasCraftCards();
      case 'training':
        return (
          s.buildingButtons.some((b) => b.key === TRAINING_BUILDING_KEY && b.sites.length > 0) &&
          !!this.deps.selectUnits
        );
      case 'alert':
        return s.toasts.some((t) => t.kind !== 'dominance');
      case 'menu':
        return true;
    }
  }

  /** Voert een snelknop uit; geeft false (met een korte melding) als ze nu niets kan doen. */
  quick(id: QuickId): boolean {
    if (this.state.confirmSurrender) return false;
    if (!this.quickAvailable(id)) {
      this.showHint(QUICK_HINT[id]);
      return false;
    }
    switch (id) {
      case 'hero':
        return this.focusHero();
      case 'building':
        return this.selectNextBuilding();
      case 'idle':
        return this.selectNextIdle();
      case 'build':
        return this.run('build');
      case 'lobby':
        return this.run('lobby');
      case 'perks':
        return this.togglePerkPanel();
      case 'craft':
        return this.toggleCraftMenu();
      case 'training':
        return this.selectBuilding(TRAINING_BUILDING_KEY, true);
      case 'alert':
        return this.run('lastAlert');
      case 'menu':
        this.requestSurrender();
        return true;
    }
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
    const own = this.state.selection.filter((s) => !s.enemy);
    const sel = includeBuildings
      ? own
      : own.filter((s) => kindOfTypeId(s.typeId).kind !== 'building');
    return sel.slice(0, MAX_ENTITIES_PER_COMMAND).map((s) => s.id);
  }

  private stopTargeting(): void {
    if (!this.state.targeting) return;
    this.set({ targeting: null, pendingAbility: null });
    this.deps.endTargeting?.();
  }

  private stopPlacement(): void {
    if (!this.state.placement) return;
    this.set({ placement: null, placementHint: null });
    this.deps.endPlacement?.();
  }

  private read(): void {
    const selection = [...this.deps.getSelection()];
    const d = this.deps;
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
    const cards = this.readCards(selection, buildingIds, units);
    const placement = selection.some((s) => s.role === 'builder') ? this.state.placement : null;
    if (this.state.placement && !placement) d.endPlacement?.();
    // Targeting without a selection makes no sense any more (a hero ability does not need one).
    const targeting =
      selection.every((s) => s.enemy) && this.state.targeting !== 'heroAbility'
        ? null
        : this.state.targeting;
    if (this.state.targeting && !targeting) d.endTargeting?.();
    this.state = {
      ...this.state,
      status,
      selection,
      minimap: d.getMinimap?.() ?? null,
      dominance: d.getDominance?.() ?? null,
      buildOptions: this.state.buildMenuOpen ? (d.getBuildOptions?.() ?? []) : [],
      placement,
      perkOptions: pendingPerks
        ? (d.getPerkOptions?.() ?? []).filter((p) => !hero?.perks.includes(p.perkId))
        : [],
      heroAbilities: hero ? (d.getHeroAbilities?.() ?? []) : [],
      heroDead: hero !== null && (d.isHeroDead?.() ?? false),
      cards,
      // The build menu is for builders: without one selected it closes (a click on empty ground clears everything).
      buildMenuOpen: this.state.buildMenuOpen && selection.some((s) => s.role === 'builder'),
      craftMenuOpen:
        cards.some((c) => c.kind === 'craft') && units ? this.state.craftMenuOpen : false,
      lobby: this.state.showLobby ? (d.getLobby?.() ?? null) : null,
      roster: d.getRoster?.() ?? [],
      buildingButtons: d.getBuildingButtons?.() ?? [],
      canSwitchRole: d.canSwitchRole?.() ?? true,
      raider: d.getRaiderStats?.() ?? null,
      enemySlaves: d.hasEnemySlaves?.() ?? false,
      perkPanelOpen: pendingPerks && this.state.perkPanelOpen,
      network: this.deps.getNetwork?.() ?? NO_NETWORK,
      targeting,
    };
  }

  /** Kaarten voor de selectie: de nieuwe dep, of (tijdelijk) opgebouwd uit de oude deps. */
  private readCards(
    selection: readonly SelectedEntity[],
    buildingIds: readonly number[],
    units: boolean,
  ): readonly BuildingCard[] {
    const d = this.deps;
    if (selection.length === 0) return [];
    if (d.getBuildingCards) return d.getBuildingCards(selection);
    const research = buildingIds.length > 0 ? (d.getResearchOptions?.(buildingIds) ?? []) : [];
    const recruit = buildingIds.length > 0 ? (d.getRecruitOptions?.(buildingIds) ?? []) : [];
    const craft = units ? (d.getCraftOptions?.() ?? []) : [];
    return research.length + recruit.length + craft.length > 0
      ? legacyCards(research, recruit, craft)
      : [];
  }

  private set(patch: Partial<HudState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

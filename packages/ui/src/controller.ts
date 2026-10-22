import { MAX_ENTITIES_PER_COMMAND } from '@crawlout/protocol';
import { heroIdOfTypeId } from '@crawlout/data';
import type {
  BuildOption,
  BuildingCard,
  HeroAbilityOption,
  HudAlert,
  HudDeps,
  HudHandle,
  TargetPoint,
  TargetResult,
} from './types.js';
import {
  ACTIONS,
  HINT_MS,
  appliesTo,
  isAlarm,
  summarize,
  type ActionDef,
  type ActionId,
  type QuickId,
  type SelectionSummary,
} from './controller.actions.js';
import {
  buildingsOnly,
  createControllerCore,
  emit,
  hasCraftCards,
  pushAlert,
  readState,
  setState,
  stopPlacement,
  stopTargeting,
  threatOf,
  type HudControllerCore,
  type HudState,
} from './controller.core.js';
import * as cards from './controller.cards.js';
import * as commands from './controller.commands.js';
import * as keys from './controller.keys.js';
import * as select from './controller.select.js';

export {
  ABILITY_KEYS,
  ACTIONS,
  CARD_NOTICE_MS,
  CARD_STATE_LABEL,
  CRAFT_KEY,
  HERO_KEY,
  HINT_MS,
  MAX_TOASTS,
  PERK_KEYS,
  PERK_PANEL_KEY,
  QUICK_HINT,
  ROLE_LABEL,
  TOAST_MS,
  TRAINING_BUILDING_KEY,
  actionLabel,
  keyLabel,
  roleLabelOf,
  roleTagOf,
  summarize,
  unitStateOf,
} from './controller.actions.js';
export type { ActionDef, ActionId, QuickId, SelectionSummary } from './controller.actions.js';
export { threatOf } from './controller.core.js';
export type { HudState } from './controller.core.js';

/** HUD-logica zonder Preact: state, sneltoetsen en commando-opbouw. De view tekent alleen de state. */
export class HudController implements HudHandle {
  /** State, deps, timers and listeners; the logic in the controller.* modules works on it. */
  private readonly core: HudControllerCore;

  constructor(
    deps: HudDeps,
    /** Demo-only: keep the build menu open while a building is being placed (never set by the game). */
    keepBuildMenuWhilePlacing = false,
  ) {
    this.core = createControllerCore(this, deps, keepBuildMenuWhilePlacing);
    readState(this.core);
    this.core.opponentCounting = threatOf(this.core.state.dominance) !== null;
  }

  getState(): HudState {
    return this.core.state;
  }

  onChange(fn: () => void): () => void {
    this.core.listeners.add(fn);
    return () => this.core.listeners.delete(fn);
  }

  /** Begin met luisteren op de deps (subscribe of polling). */
  start(): void {
    if (this.core.deps.subscribe)
      this.core.unsubscribe = this.core.deps.subscribe(() => this.refresh());
    else this.core.timer = setInterval(() => this.refresh(), 250);
    this.core.unsubscribeAlerts =
      this.core.deps.subscribeAlerts?.((a) => pushAlert(this.core, a)) ?? null;
  }

  unmount(): void {
    this.core.unsubscribe?.();
    this.core.unsubscribe = null;
    if (this.core.timer) clearInterval(this.core.timer);
    this.core.timer = null;
    this.core.unsubscribeAlerts?.();
    this.core.unsubscribeAlerts = null;
    for (const t of this.core.toastTimers.values()) clearTimeout(t);
    this.core.toastTimers.clear();
    if (this.core.noticeTimer) clearTimeout(this.core.noticeTimer);
    this.core.noticeTimer = null;
    if (this.core.hintTimer) clearTimeout(this.core.hintTimer);
    this.core.hintTimer = null;
    this.core.listeners.clear();
  }

  refresh(): void {
    readState(this.core);
    const counting = threatOf(this.core.state.dominance) !== null;
    const started = counting && !this.core.opponentCounting;
    this.core.opponentCounting = counting;
    if (started) pushAlert(this.core, { kind: 'dominance', x: 0, y: 0 });
    emit(this.core);
  }

  heroName(heroId: number): string | undefined {
    return this.core.deps.heroName?.(heroId);
  }

  playerName(playerId: number): string {
    return this.core.deps.playerName?.(playerId) ?? `speler ${playerId + 1}`;
  }

  isEnabled(action: ActionDef): boolean {
    return (
      this.isAvailable(action) && (!action.needsSelection || this.core.state.selection.length > 0)
    );
  }

  /** Telt de huidige selectie per soort. */
  selectionSummary(): SelectionSummary {
    return summarize(this.core.state.selection);
  }

  /** Is de held (ook) geselecteerd? */
  heroSelected(): boolean {
    return this.core.state.selection.some((s) => !s.enemy && heroIdOfTypeId(s.typeId) >= 0);
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
        return this.core.state.toasts.some(isAlarm);
      case 'lobby':
        return this.core.deps.getLobby !== undefined;
      default:
        return appliesTo(
          action.id,
          this.selectionSummary(),
          this.core.state.canSwitchRole,
          this.core.state.enemySlaves,
        );
    }
  }

  hasHero(): boolean {
    return this.core.state.status?.hero != null;
  }

  /** Onbestede perk-keuzes van de held (0 zolang de sim het veld niet levert). */
  pendingPerks(): number {
    return this.core.state.status?.hero?.pendingPerks ?? 0;
  }

  /** Dode held met nog minstens een oplap-beurt (onbekend aantal telt als mogelijk). */
  canRevive(): boolean {
    const hero = this.core.state.status?.hero;
    return (
      hero != null &&
      this.core.state.heroDead &&
      this.core.deps.reviveHero !== undefined &&
      (hero.revivesLeft ?? 1) > 0
    );
  }

  /** Is een ability nu bruikbaar (held leeft, heeft id, cooldown klaar)? */
  canUseAbility(a: HeroAbilityOption): boolean {
    const hero = this.core.state.status?.hero;
    return hero?.heroId !== undefined && !this.core.state.heroDead && a.cooldownPct <= 0;
  }

  /** Is een vijand geselecteerd om te bekijken? */
  enemySelected(): boolean {
    return this.core.state.selection.some((s) => s.enemy === true);
  }

  hasCraftCardsForKeys(): boolean {
    return hasCraftCards(this.core);
  }

  /** Kan deze lopende kaart geannuleerd worden (is er een cancelCard-dep)? */
  canCancelCard(card: BuildingCard): boolean {
    return card.state === 'running' && this.core.deps.cancelCard !== undefined;
  }

  /** Werken de cijfertoetsen nu voor de kaarten? Bij alleen gebouwen altijd; bij bewoners na K (craft). */
  cardKeysActive(): boolean {
    if (this.core.state.cards.length === 0) return false;
    return buildingsOnly(this.core) || (this.core.state.craftMenuOpen && hasCraftCards(this.core));
  }

  /** Mag deze kaart nu starten? Alleen state available, en bij craft moet er een bewoner in de selectie zijn. */
  canStartCard(card: BuildingCard): boolean {
    return cards.canStartCard(this.core, card);
  }

  /** Waarom deze kaart nu niet start, in gewone taal; null als ze wel start. De client kan een eigen reden meegeven. */
  cardReason(card: BuildingCard): string | null {
    return cards.cardReason(this.core, card);
  }

  /** Muis of vinger gaat omlaag op een kaart; de start volgt bij loslaten op dezelfde kaart (cardRelease). */
  cardPress(card: BuildingCard): void {
    cards.cardPress(this.core, card);
  }

  /**
   * Loslaten op een kaart: starten als de druk ook op deze kaart begon. Zo gaat de klik niet verloren als de lijst
   * tussen indrukken en loslaten opnieuw getekend wordt en de browser daardoor geen click meer stuurt.
   */
  cardRelease(card: BuildingCard): void {
    cards.cardRelease(this.core, card);
  }

  /** De click na een cardRelease van dezelfde druk telt niet nog een keer; toetsenbord en losse clicks starten wel. */
  cardClick(card: BuildingCard): void {
    cards.cardClick(this.core, card);
  }

  /**
   * Start een kaart (klik of sneltoets). Geeft false als ze niet start (vergrendeld, te duur, bezig, loopt of klaar);
   * de speler krijgt dan de reden te zien.
   */
  startCard(card: BuildingCard): boolean {
    return cards.startCard(this.core, card);
  }

  /** Annuleert een lopende kaart. De oude deps hebben geen annuleren; dan blijft de kaart ongemoeid. */
  cancelCard(card: BuildingCard): boolean {
    return cards.cancelCard(this.core, card);
  }

  /** Gebruikt een ability: direct, of via targeting als ze een positie vraagt. */
  useAbility(abilityId: number): boolean {
    return cards.useAbility(this.core, abilityId);
  }

  revive(): boolean {
    if (!this.canRevive()) return false;
    this.core.deps.reviveHero?.();
    return true;
  }

  /** Bouwers uit de selectie: alleen units met rol builder bouwen. */
  selectedBuilders(): number[] {
    return this.core.state.selection
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
    return commands.run(this.core, id);
  }

  /** K: schakelt de cijfertoetsen van de craftkaarten (alleen bij een selectie met bewoners en craftkaarten). */
  toggleCraftMenu(): boolean {
    return commands.toggleCraftMenu(this.core);
  }

  /** H: selecteert de held en zet de camera op hem. Geeft false zonder held in het veld. */
  focusHero(): boolean {
    return select.focusHero(this.core);
  }

  /**
   * Klik op een gebouwknop: selecteer een gebouw van dat type, zodat zijn kaarten verschijnen, en zet de camera erop.
   * Nog een klik gaat naar het volgende gebouw van hetzelfde type (doorklikken). Met `focus` (dubbelklik) blijft de keuze
   * staan: het geselecteerde gebouw van het type, of het eerste als er geen geselecteerd is. Met `add` (shift) komt het
   * gebouw erbij en blijft de camera staan.
   */
  selectBuilding(key: string, focus = false, add = false): boolean {
    return select.selectBuilding(this.core, key, focus, add);
  }

  /** Bouwmenu-keuze: gaat in plaatsingsmodus. Geeft false als de optie niet kiesbaar is. */
  chooseBuild(buildingId: number): boolean {
    return commands.chooseBuild(this.core, buildingId);
  }

  completePlacement(pos: TargetPoint): boolean {
    return commands.completePlacement(this.core, pos);
  }

  cancelPlacement(): void {
    stopPlacement(this.core);
  }

  setPlacementHint(reason: string | null): void {
    if (this.core.state.placementHint === reason) return;
    setState(this.core, { placementHint: this.core.state.placement ? reason : null });
  }

  showHint(text: string): void {
    if (this.core.hintTimer) clearTimeout(this.core.hintTimer);
    this.core.hintTimer = setTimeout(() => {
      this.core.hintTimer = null;
      setState(this.core, { hint: null });
    }, HINT_MS);
    setState(this.core, { hint: text });
  }

  /** Opent of sluit het perk-paneel; alleen zolang er een perk te kiezen is. */
  togglePerkPanel(): boolean {
    if (this.pendingPerks() <= 0 || this.core.state.confirmSurrender) return false;
    setState(this.core, { perkPanelOpen: !this.core.state.perkPanelOpen });
    return true;
  }

  closePerkPanel(): void {
    if (this.core.state.perkPanelOpen) setState(this.core, { perkPanelOpen: false });
  }

  /** Kiest een perk (PickPerk). Een perk waarvan de held de vereiste niet haalt (available false) is niet te kiezen. */
  pickPerk(perkId: number): boolean {
    return commands.pickPerk(this.core, perkId);
  }

  /** Minimap-klik; fx en fy zijn 0..1 over de kaart. */
  minimapClick(fx: number, fy: number): void {
    commands.minimapClick(this.core, fx, fy);
  }

  /** Win route C: the restore card of a kind in the project panel. */
  restoreProject(kind: number): void {
    this.core.deps.restoreProject?.(kind);
  }

  focusAlert(alert: HudAlert): void {
    if (alert.kind === 'dominance') return; // geen locatie
    this.core.deps.focusCamera?.(alert.x, alert.y);
  }

  dismissToast(id: number): void {
    const t = this.core.toastTimers.get(id);
    if (t) clearTimeout(t);
    this.core.toastTimers.delete(id);
    setState(this.core, { toasts: this.core.state.toasts.filter((a) => a.id !== id) });
  }

  completeTargeting(target: TargetResult): boolean {
    return commands.completeTargeting(this.core, target);
  }

  cancelTargeting(): void {
    stopTargeting(this.core);
  }

  targetingActive(): boolean {
    return this.core.state.targeting !== null;
  }

  placementActive(): boolean {
    return this.core.state.placement !== null;
  }

  requestSurrender(): void {
    stopTargeting(this.core);
    stopPlacement(this.core);
    setState(this.core, { confirmSurrender: true, buildMenuOpen: false, craftMenuOpen: false });
  }

  cancelSurrender(): void {
    setState(this.core, { confirmSurrender: false });
  }

  confirmSurrender(): void {
    if (!this.core.state.confirmSurrender) return;
    setState(this.core, { confirmSurrender: false });
    this.core.deps.sendCommand('Surrender', {});
  }

  closeBuildMenu(): void {
    setState(this.core, { buildMenuOpen: false });
  }

  /** Verwerkt een sneltoets. Geeft true als de toets is afgehandeld (dan preventDefault). */
  handleKeyDown(e: KeyboardEvent): boolean {
    return keys.handleKeyDown(this.core, e);
  }

  /**
   * Klik op een type in de eenhedenbalk: selecteer alle units van dat type, zet de camera op hun zwaartepunt en klap de
   * lijst uit (nogmaals: inklappen). Met `add` (shift) komen ze erbij en blijft de camera staan.
   */
  selectGroup(key: string, add = false): boolean {
    return select.selectGroup(this.core, key, add);
  }

  /** Klik op één unit in de uitgeklapte lijst: alleen die unit selecteren en de camera erheen. */
  selectRosterUnit(id: number, add = false): boolean {
    return select.selectRosterUnit(this.core, id, add);
  }

  /**
   * Klik op een kaart in het selectiepaneel: alleen die eenheid (of dat gebouw) selecteren en de camera erheen. De
   * positie komt van de selectie zelf (SelectedEntity.x en y); zonder positie blijft de camera staan.
   */
  selectSelected(id: number): boolean {
    return select.selectSelected(this.core, id);
  }

  /** Punt (.): de volgende unit zonder taak selecteren en de camera erheen; elke druk gaat een unit verder. */
  selectNextIdle(): boolean {
    return select.selectNextIdle(this.core);
  }

  /** Eerstvolgende eigen gebouw met een taak (in volgorde van de gebouwenbalk): selecteren en de camera erheen. */
  selectNextBuilding(): boolean {
    return select.selectNextBuilding(this.core);
  }

  /**
   * Kan deze snelknop nu iets doen? De knoppen van de zijconsole en de rechterconsole zijn nooit dood: zonder
   * mogelijkheid zegt een klik waarom (QUICK_HINT) in plaats van niets te doen.
   */
  quickAvailable(id: QuickId): boolean {
    return keys.quickAvailable(this.core, id);
  }

  /** Voert een snelknop uit; geeft false (met een korte melding) als ze nu niets kan doen. */
  quick(id: QuickId): boolean {
    return keys.quick(this.core, id);
  }

  canToggleReady(): boolean {
    return this.core.deps.toggleReady !== undefined;
  }

  toggleReady(): void {
    this.core.deps.toggleReady?.();
  }

  openHostSettings(): void {
    this.core.deps.openHostSettings?.();
  }

  isHost(): boolean {
    const l = this.core.state.lobby;
    return l !== null && l.hostId === l.you;
  }
}

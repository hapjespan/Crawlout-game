// Split from types.ts to stay under the 5,000-token file limit; types.ts re-exports the public surface.
// Holds: HudDeps, HudHandle.
import type { CommandType, CommandPayload, PlayerStatus } from '@crawlout/protocol';
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
} from './types.part1.js';

/** Alles wat de HUD van buiten nodig heeft. Frame, seq en playerId vult de netwerklaag in. */
export interface HudDeps {
  /** Stuurt een commando; payload volgt COMMAND_PAYLOADS. */
  sendCommand<T extends CommandType>(type: T, payload: CommandPayload<T>): void;
  /** Laatste spelerstatus uit de queryMessage, of null zolang die er niet is. */
  getStatus(): PlayerStatus | null;
  /** Huidige selectie. */
  getSelection(): readonly SelectedEntity[];
  /** Desync en stall; optioneel, zonder is er geen melding. */
  getNetwork?(): NetworkState;
  /** Naam van een speler voor de stall-melding; valt terug op "speler N". */
  playerName?(playerId: number): string;
  /** De volgende wereldklik is een doel. De client roept daarna HudHandle.completeTargeting of cancelTargeting aan. */
  beginTargeting(kind: TargetingKind): void;
  /** Wordt aangeroepen als de HUD de targeting zelf stopt (Escape, ander commando). */
  endTargeting?(): void;
  /** Meldt wijzigingen in status, selectie of netwerk. Zonder subscribe pollt de HUD elke 250 ms. */
  subscribe?(listener: () => void): () => void;

  // Sprint 2 (allemaal optioneel: ontbreekt een dep, dan ontbreekt dat onderdeel).
  /** Minimap-invoer; zonder deze dep geen minimap. */
  getMinimap?(): MinimapData | null;
  /** Camera naar een positie in sim-eenheden (minimap- en alert-klik). */
  focusCamera?(x: number, y: number): void;
  /** Bouwopties voor het bouwmenu. */
  getBuildOptions?(): readonly BuildOption[];
  /** HUD gaat in plaatsingsmodus: toon het voorbeeld en meld de klik via HudHandle.completePlacement. */
  beginPlacement?(option: BuildOption): void;
  /** De HUD stopt de plaatsing zelf (Escape, selectie zonder bouwers). */
  endPlacement?(): void;
  /** Naam van de held uit data (heroes); zonder valt het paneel terug op "Held". Het paneel zelf leest PlayerStatus.hero. */
  heroName?(heroId: number): string | undefined;
  /** Te kiezen perks bij een level-up. */
  getPerkOptions?(): readonly PerkOption[];
  /** Abilities van de held (een knop per ability, sneltoetsen Z, X, C). Zonder deze dep geen ability-knoppen. */
  getHeroAbilities?(): readonly HeroAbilityOption[];
  /** Is de held dood? Dan toont het paneel Oplappen (zolang revivesLeft niet 0 is). PlayerStatus kent geen dood-vlag. */
  isHeroDead?(): boolean;
  /** Oplappen van de dode held. Er is geen protocol-commando voor; de client regelt dit (zie README). */
  reviveHero?(): void;
  // Sprint 4: gebouwpaneel met kaarten.
  /**
   * Kaarten voor het gebouwpaneel, voor de huidige selectie: gebouwen (research, oplappen) of bewoners bij een werkplaats (craft).
   * Leeg of ontbrekend: geen paneel. De HUD kent geen spelregels; status, kosten en teksten komen volledig van de client.
   * Houd de kaartobjecten stabiel als niets verandert (de HUD leest bij elke refresh).
   */
  getBuildingCards?(selection: readonly SelectedEntity[]): readonly BuildingCard[];
  /** De speler start een kaart (klik of sneltoets). De HUD roept dit alleen aan voor state available; de client stuurt het commando (Research, Craft of Recruit). */
  startCard?(card: BuildingCard): void;
  /** De speler annuleert een lopende kaart (state running); de client stuurt Cancel op het gebouw. */
  cancelCard?(card: BuildingCard): void;

  // Verouderd sinds sprint 4: gebruik getBuildingCards. Zonder getBuildingCards bouwt de HUD er zelf kaarten van (zonder icoon, effecten of duur).
  /** @deprecated Gebruik getBuildingCards. Research-opties voor de geselecteerde gebouwen (buildingIds van de selectie). */
  getResearchOptions?(buildingIds: readonly number[]): readonly ResearchOption[];
  /** @deprecated Gebruik getBuildingCards. Recruit-opties voor de geselecteerde gebouwen. */
  getRecruitOptions?(buildingIds: readonly number[]): readonly RecruitOption[];
  /** @deprecated Gebruik getBuildingCards. Craft-opties voor de geselecteerde bewoners; leeg of ontbrekend als ze niet bij een werkplaats staan. */
  getCraftOptions?(): readonly CraftOption[];
  /**
   * Dominantie-teller (winroute B); null of ontbrekend: geen teller. De HUD toont een balk, en een toast (kind 'dominance')
   * zodra een tegenstander genoeg punten heeft en begint te tellen. Houd het object stabiel als niets verandert.
   */
  getDominance?(): DominanceView | null;
  /** Win route C (ui 0.19.0): the project panel; null or absent without a Bouwproject. Keep the object stable. */
  getProject?(): ProjectView | null;
  /** Survival co-op (ui 0.20.0): the wave panel; null or absent outside Survival. Keep the object stable. */
  getSurvival?(): SurvivalView | null;
  /** Win route C: send the selected builders to restore the nearest ruin of this kind (index in GameData.project.parts). */
  restoreProject?(kind: number): void;
  /** Waarschuwingen; geeft de afmelder terug. */
  subscribeAlerts?(cb: (alert: HudAlert) => void): () => void;
  /** Lobby-paneel (multiplayer). */
  getLobby?(): LobbyView | null;
  toggleReady?(): void;
  openHostSettings?(): void;
  /** Eenhedenbalk: eigen units per type met wat ze doen. Ontbreekt: geen balk. */
  getRoster?(): readonly RosterGroup[];
  /** Zet de selectie van de client (add: bij de huidige selectie voegen). Nodig voor de eenhedenbalk en de gebouwknoppen. */
  selectUnits?(ids: readonly number[], add: boolean): void;
  /** Gebouwknoppen naast de eenhedenbalk: alleen eigen voltooide gebouwen met een actie (onderzoek, productie, training, oplappen). Ontbreekt of leeg: geen paneel. */
  getBuildingButtons?(): readonly BuildingButton[];
  /**
   * Mag een bewoner nu van rol wisselen? Alleen met een voltooide werkplaats: zonder staan de rolknoppen (Plunderaar,
   * Bouwer, Militie; 1 tot 3) niet op de commandokaart. Ontbreekt de dep: de knoppen staan er altijd.
   */
  canSwitchRole?(): boolean;
  /** Raiders: tellers voor de bovenbalk (slaven, vechters, Kooien). Null of ontbrekend: geen Raiders. */
  getRaiderStats?(): RaiderStats | null;
  /** Ziet de speler een vijandelijke slaaf of gevangene? Dan staat Bevrijd op de commandokaart. */
  hasEnemySlaves?(): boolean;
}

export interface HudHandle {
  /** De klik van de plaatsing: positie in sim-eenheden. Stuurt Build met de geselecteerde bouwers. False als er geen plaatsing actief is of er geen bouwer geselecteerd is. */
  completePlacement(pos: TargetPoint): boolean;
  cancelPlacement(): void;
  /** Reden (Nederlands) dat het voorbeeld van de plaatsing rood is; null als de plek geldig is. Alleen zichtbaar tijdens de plaatsing. */
  setPlacementHint(reason: string | null): void;
  /** Korte, tijdelijke melding bij de ability-balk of het veld (bijvoorbeeld "Buiten bereik"). */
  showHint(text: string): void;
  /** Een wereldklik die het doel van de actieve targeting is. Geeft false als er geen passende targeting actief is. */
  completeTargeting(target: TargetResult): boolean;
  cancelTargeting(): void;
  /** Wacht de HUD nu op een wereldklik als doel? De client controleert dit voor een klik, zodat een verouderde modus de selectie niet blokkeert. */
  targetingActive(): boolean;
  /** Is de HUD in plaatsingsmodus? */
  placementActive(): boolean;
  /** Forceer een nieuwe lezing van de deps. */
  refresh(): void;
  unmount(): void;
}

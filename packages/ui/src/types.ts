import type {
  CommandPayload,
  CommandType,
  DesyncEvent,
  PlayerStatus,
  Role,
  StallNotice,
} from '@crawlout/protocol';

/** Eén geselecteerde entity, zoals de client die uit snapshot en queryMessage samenstelt. */
export interface SelectedEntity {
  id: number;
  typeId: number;
  /** Naam van de loadout, of null als de entity er geen heeft (bijvoorbeeld een gebouw). */
  loadoutName: string | null;
  hpPct: number;
  /** Rol van een unit, of null voor gebouwen en nodes. */
  role: Role | null;
}

/** Netwerktoestand die de HUD toont: desync en stall komen uit de relay (frames.ts). */
export interface NetworkState {
  desync: DesyncEvent | null;
  stall: StallNotice | null;
}

/** Soorten doel die de HUD van de volgende wereldklik verwacht. */
export type TargetingKind = 'move' | 'attackMove' | 'gather' | 'heroAbility';
export interface TargetPoint {
  x: number;
  y: number;
}
export interface TargetNode {
  nodeId: number;
}
export type TargetResult = TargetPoint | TargetNode;

/** Eén punt op de minimap, in sim-eenheden. */
export interface MinimapBlip {
  x: number;
  y: number;
  owner: number;
  kind: 'unit' | 'building' | 'hero' | 'node';
}
/** Een claimpunt; owner null = niemand. */
export interface MinimapClaim {
  x: number;
  y: number;
  owner: number | null;
}
/**
 * Minimap-invoer. Houd het object stabiel tussen lezingen als er niets verandert (de HUD leest elke refresh).
 * passable, water, terrain en visible worden als statische laag gecachet op referentie: wijzigt de inhoud, lever dan een nieuwe array.
 */
export interface MinimapData {
  w: number;
  h: number;
  /** w*h cellen, 1 = begaanbaar. */
  passable: Uint8Array;
  /** w*h cellen: 0 = droog, 1 = water, 2 = ondiep of doorwaadbaar. Ontbreekt: geen water. */
  water?: Uint8Array;
  /** w*h cellen: 0 = open, 1 = bos of onbegaanbaar groen, 2 = rots of klif. Ontbreekt: onbegaanbaar is overal een muur. */
  terrain?: Uint8Array;
  /** Sim-eenheden per cel; standaard 256 (1 m). */
  cellU?: number;
  blips: readonly MinimapBlip[];
  claims: readonly MinimapClaim[];
  /** w*h cellen, 1 = zichtbaar. Ontbreekt: geen fog. Vijandelijke blips buiten het zicht worden verborgen. */
  visible?: Uint8Array;
}

export interface BuildOption {
  buildingId: number;
  typeId: number;
  naam: string;
  scrapCost: number;
  /** Footprint in cellen. */
  footprint: { w: number; h: number };
  affordable: boolean;
}

/** Een ability van de held; de lijst komt uit data (heroes.abilities) plus de cooldown uit de sim. */
export interface HeroAbilityOption {
  abilityId: number;
  naam: string;
  /** True als de ability een positie op de kaart vraagt (HUD gaat in targeting). */
  needsTarget: boolean;
  /** 0 = klaar, 100 = net gebruikt. */
  cooldownPct: number;
}
/** Optie in het gebouwpaneel (research, rekruteren) of het craft-menu. */
interface CostedOption {
  naam: string;
  scrapCost: number;
  affordable: boolean;
}
export interface ResearchOption extends CostedOption {
  techId: number;
}
export interface RecruitOption extends CostedOption {
  /** Het gebouw dat rekruteert; gaat als buildingId mee in Recruit. */
  buildingId: number;
}
export interface CraftOption extends CostedOption {
  loadoutId: number;
}
export interface PerkOption {
  perkId: number;
  naam: string;
  beschrijving?: string;
}

/** Soort kaart in het gebouwpaneel. `revive` is het oplappen van de held (Recruit in het protocol). */
export type CardKind = 'research' | 'craft' | 'revive';
/**
 * Status van een kaart. De client bepaalt die uit data, voorraad en PlayerStatus.queue:
 * - available: te starten; tooExpensive: genoeg slots maar te weinig scrap; locked: er ontbreekt een vereiste;
 * - running: loopt nu (progressPct hoort erbij); done: klaar (eenmalig onderzoek).
 */
export type CardState = 'available' | 'tooExpensive' | 'locked' | 'running' | 'done';
/** Bekende icoonnamen; een onbekende naam valt terug op een neutraal symbool. */
export const CARD_ICON_IDS = [
  'research',
  'craft',
  'revive',
  'shield',
  'blade',
  'gun',
  'tower',
  'patrol',
  'wrench',
  'heart',
  'crate',
  'bolt',
  'gear',
] as const;
export type CardIconId = (typeof CARD_ICON_IDS)[number];

/** Eén kaart in het gebouwpaneel: een onderzoek, een craft of het oplappen van de held. Alle teksten zijn kant-en-klaar Nederlands. */
export interface BuildingCard {
  kind: CardKind;
  /** techId bij research, loadoutId bij craft, buildingId (hoofdgebouw) bij revive. Samen met kind uniek binnen het paneel. */
  id: number;
  naam: string;
  /** Een CardIconId; onbekende waarden geven het neutrale symbool. */
  icon: string;
  scrapCost: number;
  /** Duur in seconden; 0 verbergt de duur. */
  seconds: number;
  /** Effect in gewone taal, een regel per effect, bijvoorbeeld "+20% schade voor militie". */
  effects: readonly string[];
  /** Wat dit ontgrendelt, bijvoorbeeld ["Patrouille", "Turret"]. */
  unlocks: readonly string[];
  /** Namen van wat er nog ontbreekt (alleen bij locked), bijvoorbeeld ["Geweerrek"]. */
  requires: readonly string[];
  state: CardState;
  /** 0..100, alleen bij running. */
  progressPct?: number;
  /** Sneltoets, een cijfer "1" tot "9" (de client nummert de kaarten in de getoonde volgorde). */
  hotkey: string;
}

export type AlertKind = 'attack' | 'settlerLost' | 'claimLost' | 'dominance';
export interface HudAlert {
  kind: AlertKind;
  /** Locatie in sim-eenheden. Bij 'dominance' zonder betekenis (0): die toast heeft geen locatie en verplaatst de camera niet. */
  x: number;
  y: number;
}
export interface ToastAlert extends HudAlert {
  id: number;
}

/** Dominantie-stand (winroute B). De client vertaalt dit uit de sim; het type komt bewust niet uit protocol. */
export interface DominanceView {
  /** Claimpunten die jij nu vasthoudt. */
  pointsHeld: number;
  /** Aantal punten dat nodig is om te tellen (X). */
  pointsRequired: number;
  /** Seconden dat jij al genoeg punten vasthoudt (0 zolang je er te weinig hebt). */
  secondsHeld: number;
  /** Seconden vasthouden voor de winst (Z). */
  secondsRequired: number;
  /** De speler met de meeste punten, of null als niemand punten heeft. Volgens het protocol altijd een tegenstander (DominanceStatus.leader is nooit de speler zelf). */
  leader: {
    name: string;
    pointsHeld: number;
    secondsHeld: number;
    /** Altijd false vanuit de client; blijft als verdediging in threatOf (de eigen stand zit in de velden hierboven). */
    isYou: boolean;
  } | null;
}

export interface LobbyPlayerView {
  playerId: number;
  name: string;
  ai: boolean;
  ready: boolean;
}
export interface LobbyView {
  players: readonly LobbyPlayerView[];
  /** Host = laagste playerId. */
  hostId: number;
  you: number;
}

/** Wat een unit nu doet, afgeleid uit de snapshot (anim en flags). */
export type UnitActivity = 'idle' | 'moving' | 'gathering' | 'carrying' | 'building' | 'fighting';

/** Eén eigen unit in de eenhedenbalk; x en y in sim-eenheden (voor de camera). */
export interface RosterUnit {
  id: number;
  hpPct: number;
  activity: UnitActivity;
  x: number;
  y: number;
}

/** Eigen units van één type (loadout of held), in vaste volgorde. */
export interface RosterGroup {
  key: string;
  naam: string;
  units: readonly RosterUnit[];
}

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
  /** Waarschuwingen; geeft de afmelder terug. */
  subscribeAlerts?(cb: (alert: HudAlert) => void): () => void;
  /** Lobby-paneel (multiplayer). */
  getLobby?(): LobbyView | null;
  toggleReady?(): void;
  openHostSettings?(): void;
  /** Eenhedenbalk: eigen units per type met wat ze doen. Ontbreekt: geen balk. */
  getRoster?(): readonly RosterGroup[];
  /** Zet de selectie van de client (add: bij de huidige selectie voegen). Nodig voor de eenhedenbalk. */
  selectUnits?(ids: readonly number[], add: boolean): void;
}

export interface HudHandle {
  /** De klik van de plaatsing: positie in sim-eenheden. Stuurt Build met de geselecteerde bouwers. False als er geen plaatsing actief is of er geen bouwer geselecteerd is. */
  completePlacement(pos: TargetPoint): boolean;
  cancelPlacement(): void;
  /** Een wereldklik die het doel van de actieve targeting is. Geeft false als er geen passende targeting actief is. */
  completeTargeting(target: TargetResult): boolean;
  cancelTargeting(): void;
  /** Forceer een nieuwe lezing van de deps. */
  refresh(): void;
  unmount(): void;
}

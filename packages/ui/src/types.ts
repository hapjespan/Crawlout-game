import type { CommandPayload, CommandType, DesyncEvent, PlayerStatus, Role, StallNotice } from '@crawlout/protocol';

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
/** Minimap-invoer. Houd het object stabiel tussen lezingen als er niets verandert (de HUD leest elke refresh). */
export interface MinimapData {
  w: number;
  h: number;
  /** w*h cellen, 1 = begaanbaar. */
  passable: Uint8Array;
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

export type AlertKind = 'attack' | 'settlerLost' | 'claimLost';
export interface HudAlert {
  kind: AlertKind;
  /** Locatie in sim-eenheden. */
  x: number;
  y: number;
}
export interface ToastAlert extends HudAlert {
  id: number;
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
  /** Research-opties voor de geselecteerde gebouwen (buildingIds van de selectie). */
  getResearchOptions?(buildingIds: readonly number[]): readonly ResearchOption[];
  /** Recruit-opties voor de geselecteerde gebouwen. */
  getRecruitOptions?(buildingIds: readonly number[]): readonly RecruitOption[];
  /** Craft-opties voor de geselecteerde bewoners; leeg of ontbrekend als ze niet bij een werkplaats staan. */
  getCraftOptions?(): readonly CraftOption[];
  /** Waarschuwingen; geeft de afmelder terug. */
  subscribeAlerts?(cb: (alert: HudAlert) => void): () => void;
  /** Lobby-paneel (multiplayer). */
  getLobby?(): LobbyView | null;
  toggleReady?(): void;
  openHostSettings?(): void;
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

// Split from types.ts to stay under the 5,000-token file limit; types.ts re-exports the public surface.
// Holds: SelectedEntity, NetworkState, TargetingKind, RaiderKind, TargetPoint, TargetNode, +35 more.
import type { DesyncEvent, StallNotice, Role } from '@crawlout/protocol';
import type { MinimapProjectPart } from './project.js';
import type { MinimapZone } from './survival.js';

/** Eén geselecteerde entity, zoals de client die uit snapshot en queryMessage samenstelt. */
export interface SelectedEntity {
  id: number;
  typeId: number;
  /** Naam van de loadout, of null als de entity er geen heeft (bijvoorbeeld een gebouw). */
  loadoutName: string | null;
  hpPct: number;
  /** Rol van een unit, of null voor gebouwen en nodes. */
  role: Role | null;
  /** Korte toelichting in het selectiepaneel, bijvoorbeeld "In aanbouw" voor een gebouw dat nog niet af is. */
  note?: string;
  /**
   * True voor een vijandelijke eenheid of gebouw die de speler aanklikte om te bekijken. Een vijand is alleen te
   * bekijken: de commandokaart blijft leeg (een hint), geen enkel commando gaat erheen, en hij komt nooit in een groep
   * met eigen eenheden.
   */
  enemy?: boolean;
  /** Bij een vijand: wie hij is, bijvoorbeeld "Vijand (Dwellers)". */
  ownerLabel?: string;
  /** Bij een vijand: korte extra regel, bijvoorbeeld "Wapen: Geweer (ballistisch) · Pantser: Licht". */
  detail?: string;
  /**
   * True voor een ghost: een vijandelijk gebouw dat de speler eerder zag en nu niet meer ziet. Het paneel toont "Laatst
   * gezien" en de hp en staat van toen; hij is niet te bevelen en geen doelwit (de sim weigert het).
   */
  lastSeen?: boolean;
  /**
   * Soort Raider-unit (Raiders, sim 0.18.0): een slaaf (verzamelt of bouwt, vecht nooit, is aan een Kooi gebonden), de Slaver
   * (Attack is vangen), de Chem-dealer (doseert in gevecht) of een andere vechter. Ontbreekt bij de Dwellers.
   */
  raiderKind?: RaiderKind;
  /**
   * True for a robot (bodyType robot): never retrains, so the role buttons leave it out. A robot that builds (the
   * Bouwrobot, data 0.26.0) has role builder and gets Verplaats, Stop and Bouw.
   */
  robot?: boolean;
  /** Extra regels in het selectiepaneel, kant-en-klaar Nederlands (bijvoorbeeld "Kooi: Raiderkamp, werkstraal 45 m"). */
  lines?: readonly string[];
  /** Positie in sim-eenheden: een klik op de kaart in het selectiepaneel zet de camera erop. Zonder positie blijft de camera staan. */
  x?: number;
  y?: number;
}

/** Netwerktoestand die de HUD toont: desync en stall komen uit de relay (frames.ts). */
export interface NetworkState {
  desync: DesyncEvent | null;
  stall: StallNotice | null;
}

/** Soorten doel die de HUD van de volgende wereldklik verwacht. */
export type TargetingKind =
  'move' | 'attackMove' | 'gather' | 'heroAbility' | 'capture' | 'liberate' | 'guard';

/** Soort Raider-unit in de selectie, zie SelectedEntity.raiderKind. */
export type RaiderKind = 'slave' | 'slaver' | 'chemDealer' | 'fighter';

export interface TargetPoint {
  x: number;
  y: number;
}

export interface TargetNode {
  nodeId: number;
}

/** An enemy unit or building that was clicked in attack-move or ability targeting: attack it, or cast at its spot. */
export interface TargetEnemy {
  enemyId: number;
  x: number;
  y: number;
}

/** An own building that was clicked as the target of Bewaak (a Kooi, protocol 0.15.0 Guard). */
export interface TargetOwn {
  ownId: number;
}

export type TargetResult = TargetPoint | TargetNode | TargetEnemy | TargetOwn;

/** Eén punt op de minimap, in sim-eenheden. */
export interface MinimapBlip {
  x: number;
  y: number;
  owner: number;
  kind: 'unit' | 'building' | 'hero' | 'node';
  /** Een vijandelijk gebouw dat de speler eerder zag maar nu niet ziet (ghost, protocol 0.11.0): gedimd getekend. */
  ghost?: boolean;
}

/** Een claimpunt; owner null = niemand. */
export interface MinimapClaim {
  x: number;
  y: number;
  owner: number | null;
  /** Claim in progress (hero claim, post, takeover): 0..1 and who is claiming; drawn as an arc around the marker. */
  progress?: number;
  claimer?: number;
}

/**
 * Een creep-kamp op de minimap (PlayerStatus.camps, protocol 0.14.0; voorstel): owner null = nog bandieten (neutraal),
 * anders de speler wiens buitenpost het is (overgenomen, data 0.27.0). cleared: geruimd, geen markering.
 */
export interface MinimapCamp {
  x: number;
  y: number;
  owner: number | null;
  cleared?: boolean;
}

/**
 * Fog of war voor de minimap (zichtraster van de sim, cellen van 2 m; het hele raster beslaat de hele kaart). Per cel 1
 * of 0: `visible` = nu in beeld, `explored` = ooit gezien (ook de zichtbare cellen).
 */
export interface MinimapFog {
  w: number;
  h: number;
  visible: Uint8Array;
  explored: Uint8Array;
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
  /** Creep-kampen (kaartkennis): neutraal grijsbruin, een overgenomen kamp in de kleur van zijn eigenaar. */
  camps?: readonly MinimapCamp[];
  /** Win route C (ui 0.19.0): the parts of the strip mall (map knowledge), ruins outlined, held ones in the owner's colour. */
  project?: readonly MinimapProjectPart[];
  /** Survival co-op (ui 0.20.0): the build zones in sim units; the own one is drawn brighter. Absent outside Survival. */
  zones?: readonly MinimapZone[];
  /** w*h cellen, 1 = zichtbaar. Ontbreekt: geen fog. Vijandelijke blips buiten het zicht worden verborgen. */
  visible?: Uint8Array;
  /**
   * Klassieke fog of war op het zichtraster (onverkend donker, verkend gedimd, zichtbaar helder; zachte randen). Gaat
   * voor `visible`. Houd het object stabiel tot er een nieuw masker komt: de laag wordt gecachet op de arrays.
   * Vijandelijke eenheden buiten het zicht en ghost-gebouwen (`MinimapBlip.ghost`, gedimd) volgen daaruit.
   */
  fog?: MinimapFog;
}

export interface BuildOption {
  buildingId: number;
  typeId: number;
  naam: string;
  scrapCost: number;
  /** Footprint in cellen. */
  footprint: { w: number; h: number };
  affordable: boolean;
  /** Beds the building adds (data beds); shown as "+6 bedden" when above 0. */
  beds?: number;
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
  /** Effect in gewone taal, een regel per effect, bijvoorbeeld "+10% leven voor de held". */
  effects?: readonly string[];
  /** Vereiste in gewone taal, bijvoorbeeld "Uithoudingsvermogen 5". */
  requirement?: string;
  /** False als de held de vereiste (nog) niet haalt: de perk staat er wel, maar is niet te kiezen. Ontbreekt: kiesbaar. */
  available?: boolean;
  /** Kleurentekst uit de data. */
  flavour?: string;
}

/**
 * Soort kaart in het gebouwpaneel. `revive` is het oplappen van de held (Recruit in het protocol); `produce` bouwt een
 * robot in de robotfabriek (Produce) en `train` loopt een SPECIAL-trainingsprogramma in de trainingsfaciliteit (Train).
 */
export type CardKind = 'research' | 'craft' | 'revive' | 'produce' | 'train';

/**
 * Status van een kaart. De client bepaalt die uit data, voorraad en PlayerStatus.queue:
 * - available: te starten; tooExpensive: te weinig scrap; locked: er ontbreekt een vereiste;
 * - busy: het gebouw (of de letter, bij training) is al bezig met ander werk, dus de sim weigert de start;
 * - running: loopt nu (progressPct hoort erbij); done: klaar (eenmalig onderzoek, of de training is vol).
 */
export type CardState = 'available' | 'tooExpensive' | 'locked' | 'busy' | 'running' | 'done';

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
  'robot',
  'training',
] as const;

export type CardIconId = (typeof CARD_ICON_IDS)[number];

/** Eén kaart in het gebouwpaneel: onderzoek, craft, oplappen, robotproductie of training. Alle teksten zijn kant-en-klaar Nederlands. */
export interface BuildingCard {
  kind: CardKind;
  /**
   * techId bij research, loadoutId bij craft en produce, buildingId (hoofdgebouw) bij revive, programId bij train.
   * Samen met kind uniek binnen het paneel.
   */
  id: number;
  /**
   * Entity-id van het gebouw waarin de kaart draait (produce en train gaan als buildingId mee in het commando); bij
   * research en craft ontbreekt het of is het het gekozen gebouw.
   */
  buildingId?: number;
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
  /** Waarom de kaart nu niet start (bij tooExpensive, locked, busy), kant-en-klaar Nederlands; de HUD toont het als reden. */
  reason?: string;
  state: CardState;
  /** 0..100, alleen bij running. */
  progressPct?: number;
  /** Sneltoets, een cijfer "1" tot "9" (de client nummert de kaarten in de getoonde volgorde). */
  hotkey: string;
}

/** Eén eigen, voltooid gebouw met een actie, binnen een gebouwknop. */
export interface BuildingSite {
  /** Entity-id van het gebouw. */
  id: number;
  /** Positie in sim-eenheden (voor de camera bij een klik op de knop). */
  x: number;
  y: number;
  /** Aantal kaarten (onderzoek, robots, training, oplappen) dat nu te starten is. */
  available: number;
  /** Aantal lopende taken in dit gebouw. */
  running: number;
  /** 0..100, voortgang van de lopende taak; ontbreekt zonder lopende taak. */
  progressPct?: number;
}

/**
 * Eén knop in het gebouwenpaneel: alle eigen voltooide gebouwen van één type met een actie ("Werkplaats", "Lab",
 * "Robotfabriek x2"). Gebouwen zonder actie (woning, claimpaal, turret, radiobaken) levert de client niet; de HUD toont
 * ze naast de eenhedenbalk. Een klik selecteert het eerste gebouw, opent zijn kaarten en zet de camera erop, nog een
 * klik gaat naar het volgende van hetzelfde type.
 */
export interface BuildingButton {
  /** Vaste sleutel van het type (bijvoorbeeld de data-key), stabiel tussen lezingen. */
  key: string;
  /** Naam voor op de knop, bijvoorbeeld "Basis" of "Lab". */
  naam: string;
  /** De gebouwen van dit type in vaste volgorde (de volgorde van doorklikken). */
  sites: readonly BuildingSite[];
  /** Som over de gebouwen: te starten kaarten, lopende taken, en de voortgang van de verst gevorderde taak. */
  available: number;
  running: number;
  progressPct?: number;
}

// project (ui 0.19.0, win route C): a part restored, lost or sabotaged, or an opponent's countdown; with its own text
export type AlertKind =
  'attack' | 'settlerLost' | 'claimLost' | 'dominance' | 'revolt' | 'noBeds' | 'project';

export interface HudAlert {
  kind: AlertKind;
  /** Locatie in sim-eenheden. Bij 'dominance' zonder betekenis (0): die toast heeft geen locatie en verplaatst de camera niet. */
  x: number;
  y: number;
  /**
   * Eigen tekst in plaats van de vaste tekst van de soort, bijvoorbeeld bij 'noBeds' het gebouw van de factie ("Geen vrije
   * bedden: bouw een woning" of "…: bouw een tent").
   */
  text?: string;
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

/** Kleur van een eenheidsbalk: groen beschikbaar (idle), oranje aan het werk (verzamelen, bouwen, craften), rood bezig (onderweg, vechten). */
export type UnitState = 'available' | 'working' | 'busy';

/** Eén eigen unit in de eenhedenbalk; x en y in sim-eenheden (voor de camera). */
export interface RosterUnit {
  id: number;
  hpPct: number;
  activity: UnitActivity;
  x: number;
  y: number;
  /** 0..100: voortgang van de lopende verzameltaak (alleen bij `gathering`); de balk toont dit als laadbalkje. */
  progressPct?: number;
}

/** Eigen units van één type (loadout of held), in vaste volgorde. */
export interface RosterGroup {
  key: string;
  /** Volledige Nederlandse naam: tooltip en schermlezer. */
  naam: string;
  /** Korte naam voor op de tegel als `naam` er niet op past (bijvoorbeeld "Molotov"); ontbreekt: `naam`. */
  short?: string;
  units: readonly RosterUnit[];
}

/** Eén Kooi met zijn slaven en bewakers (Raiders). */
export interface RaiderCage {
  id: number;
  x: number;
  y: number;
  naam: string;
  /** Slaven van de Kooi-groep (protocol 0.15.0 slaveGroups): bij nodes met deze Kooi dichtbij, en die hier wachten. */
  slaves: number;
  capacity: number;
  /** Bewakers van de groep en hoeveel de bewaakregel eist (0 zonder slaven). */
  guards: number;
  guardsNeeded: number;
}

/**
 * Eén slavengroep onder de bewaakregel (data 0.29.0, protocol 0.15.0 PlayerStatus.slaveGroups): een Kooi met de slaven
 * bij nodes in de buurt, of een scrapbron zonder Kooi dichtbij.
 */
export interface RaiderGuardGroup {
  kind: 'kooi' | 'node';
  /** Entity-id van de Kooi of de scrapbron. */
  id: number;
  x: number;
  y: number;
  /** "Raiderkamp", "Kooi" of "Scrapbron". */
  naam: string;
  slaves: number;
  guards: number;
  guardsNeeded: number;
}

/**
 * Raider-tellers voor de bovenbalk; de client leidt ze af uit de eigen units die hij ziet, en de bewakers uit
 * PlayerStatus.slaveGroups (protocol 0.15.0: de bewaakmodus staat niet in de snapshot).
 */
export interface RaiderStats {
  /** Slaven (werkers) en hoeveel daarvan nu verzamelen, bouwen of afleveren. */
  slaves: number;
  slavesWorking: number;
  /** Gevangenen onderweg naar of in een Kooi (nog geen slaaf). */
  prisoners: number;
  /** Vechters (geen held, geen slaaf) en de drempel van het tentenvangnet. */
  fighters: number;
  safetyThreshold: number;
  /** Staat er een voltooide tent? Dan komt er onder de drempel een Rover bij. */
  tentReady: boolean;
  cages: readonly RaiderCage[];
  /** Alle slavengroepen met hun bewakers (bewaakregel, data 0.29.0); de bovenbalk telt ze op. */
  guardGroups: readonly RaiderGuardGroup[];
}

import type { Role } from '@crawlout/protocol';
import { heroIdOfTypeId, kindOfTypeId } from '@crawlout/data';
import type {
  BuildingCard,
  HudAlert,
  SelectedEntity,
  TargetingKind,
  UnitActivity,
  UnitState,
} from './types.js';

// The HUD's commands, quick buttons, keys and labels, and how a selection maps onto them (re-exported by controller.ts).

export type ActionId =
  | 'move'
  | 'stop'
  | 'attackMove'
  | 'capture'
  | 'liberate'
  | 'guard'
  | 'gather'
  | 'roleScavenger'
  | 'roleBuilder'
  | 'roleMilitia'
  | 'build'
  | 'claim'
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

/**
 * A toast the alarm button (Alarm) jumps to: something happening at a place. Not the dominance counter (no place) and
 * not the no-free-beds hint (advice, playtest M5: at the start of a match it would put the alarm button up).
 */
export const isAlarm = (t: HudAlert): boolean => t.kind !== 'dominance' && t.kind !== 'noBeds';

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
export const CARD_DEDUPE_MS = 350;
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
  /** Robots that build (the Bouwrobot, data 0.26.0): Bouw like a builder, never a role switch. */
  robotBuilders: number;
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

/**
 * Welke actie bij welke factie hoort. `appliesTo` kent de factie niet: het leest alleen de selectie. Dat kan ook, want
 * de selectie verraadt de factie (alleen de Raiders hebben slaven, Slavers en vechters met een `raiderKind`) en de drie
 * facties delen dezelfde rollen. Deze tabel legt per actie vast WAAROM hij er voor die factie staat, zodat een knop die
 * voor een factie niets doet opvalt. Zie ook `docs/fase-0/05-contract-2-commandoprotocol.md`.
 *
 * | Actie             | Dwellers | Raiders | Garde | Waarom                                                             |
 * |-------------------|----------|---------|-------|--------------------------------------------------------------------|
 * | Verplaats, Stop   | ja       | ja      | ja    | elke eigen unit                                                      |
 * | Val aan           | ja       | ja      | ja    | wie vecht (militie, robots, Raidervechters) en de held               |
 * | Vang              | nee      | ja      | nee   | alleen de Slaver heeft `capture`; andere facties hebben geen Slaver  |
 * | Bevrijd           | ja       | ja      | ja    | iedereen die loopt en zelf geen slaaf is; Raiders alleen tegen een   |
 * |                   |          |         |       | andere Raider (die neemt de slaaf over als gevangene)                |
 * | Bewaak            | ja       | ja      | ja    | de enige order met een leiband: loop erheen, vecht binnen            |
 * |                   |          |         |       | `guard.leashM` en kom terug. Doel (sim applyGuard, besluit fase-0    |
 * |                   |          |         |       | sectie 27): een scrapbron met scrap, of een eigen voltooid gebouw    |
 * |                   |          |         |       | dat `provides` kooi, claim of turret heeft. Raiders dekken er hun    |
 * |                   |          |         |       | Kooi mee tegen een opstand (factions.json slaves.revolt); elke       |
 * |                   |          |         |       | factie dekt er haar verzamelaars, haar claimpost (claimpaal,         |
 * |                   |          |         |       | plunderpost, wachtpost), haar hoofdgebouw en haar torens mee.        |
 * | Verzamel          | ja       | ja      | ja    | plunderaars, bij de Raiders de slaven                                |
 * | Bouw              | ja       | ja      | ja    | bouwers, de Bouwrobot en de slaaf-bouwer                             |
 * | Claim             | ja       | ja      | ja    | dezelfde bouwers: de sim zet het claimgebouw van de factie bij het    |
 * |                   |          |         |       | punt (claimpaal, plunderpost, wachtpost; alle drie `provides claim`) |
 * | Rolknoppen        | ja       | ja      | ja    | met een voltooide werkplaats (Raiders: een Kooi); Militie nooit voor |
 * |                   |          |         |       | een slaaf                                                            |
 */

/** Commandokaart: volgorde is de volgorde op het scherm. Wat er staat hangt af van de selectie (zie appliesTo). */
export const ACTIONS: readonly ActionDef[] = [
  { id: 'move', label: 'Verplaats', key: 'm', needsSelection: true },
  { id: 'stop', label: 'Stop', key: 's', needsSelection: true },
  { id: 'attackMove', label: 'Val aan', key: 'a', needsSelection: true },
  { id: 'capture', label: 'Vang', key: 'f', needsSelection: true },
  { id: 'liberate', label: 'Bevrijd', key: 'r', needsSelection: true },
  { id: 'guard', label: 'Bewaak', key: 'g', needsSelection: true },
  { id: 'gather', label: 'Verzamel', key: 't', needsSelection: true },
  { id: 'build', label: 'Bouw', key: 'b', needsSelection: true },
  // Claim (contract 2 Claim): N, want C is de derde held-ability en B is Bouw.
  { id: 'claim', label: 'Claim', key: 'n', needsSelection: true },
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
    robotBuilders: 0,
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
      else if (s.robot && s.role === 'builder') sum.robotBuilders++;
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
 * alleen plunderaars of bouwers); Verzamel bij plunderaars; Bouw bij bouwers (ook de Bouwrobot); een rol alleen met een voltooide
 * werkplaats (canSwitchRole) en als minstens een bewoner die rol nog niet heeft.
 */
export function appliesTo(
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
    case 'guard':
      // Bewaak (protocol 0.15.0 Guard): fighters (militia, robots, Raider fighters); the sim leaves the hero and
      // workers out, so a selection of only those has no Bewaak
      return s.militia + s.other + s.raiderFighters + s.slavers > 0;
    case 'gather':
      return s.scavengers + s.slaveScavengers > 0;
    case 'build':
    case 'claim':
      // Claim is Bouw op een claimpunt: dezelfde bouwers, en elke factie heeft een claimgebouw (claimpaal,
      // plunderpost, wachtpost). Een slaaf-bouwer mag dit ook buiten de werkstraal van zijn Kooi (sim mayBuildAt).
      return s.builders + s.robotBuilders + s.slaveBuilders > 0;
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

/**
 * Short tag of the role on the small cards of a multi-selection: the first letter of each part of the role label, so a
 * slave builder ("Slaaf-bouwer", SB) stands apart from a slave ("Slaaf", S) after SetRole (playtest M3). '?' without a role.
 */
export function roleTagOf(u: Pick<SelectedEntity, 'role' | 'raiderKind'>): string {
  const label = roleLabelOf(u);
  if (!label) return '?';
  return label
    .split('-')
    .map((p) => p.slice(0, 1).toUpperCase())
    .join('');
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

export const ROLE_LABEL: Record<Role, string> = {
  scavenger: 'Plunderaar',
  builder: 'Bouwer',
  militia: 'Militie',
};
export const ACTION_ROLE: Partial<Record<ActionId, Role>> = {
  roleScavenger: 'scavenger',
  roleBuilder: 'builder',
  roleMilitia: 'militia',
};
export const ACTION_TARGETING: Partial<Record<ActionId, TargetingKind>> = {
  move: 'move',
  attackMove: 'attackMove',
  capture: 'capture',
  liberate: 'liberate',
  guard: 'guard',
  gather: 'gather',
  claim: 'claim',
};

/**
 * Wat de speler moet aanklikken nadat hij een richtactie koos. De Bewaak-tekst hangt van de selectie af: alleen de
 * Raiders hebben een Kooi, dus alleen in hun tekst staat die erbij (sim applyGuard, besluit fase-0 sectie 27). De
 * andere twee facties noemen hun eigen claimpost en toren; de selectie verraadt de factie niet fijner dan
 * Raiders-of-niet, dus staan beide namen in dezelfde regel.
 */
export function targetingHint(kind: TargetingKind, s: SelectionSummary): string | null {
  switch (kind) {
    case 'claim':
      return 'Klik een claimpunt: de bouwer zet er het claimgebouw van je factie neer.';
    case 'guard':
      return s.slavers + s.raiderFighters + s.slaveScavengers + s.slaveBuilders > 0
        ? 'Bewaak: klik een eigen Kooi, plunderpost, Raiderkamp of mitrailleursnest, of een scrapbron.'
        : 'Bewaak: klik een eigen claimpaal of wachtpost, hoofdgebouw of toren, of een scrapbron.';
    default:
      return null;
  }
}

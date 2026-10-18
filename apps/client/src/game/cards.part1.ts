// Split from cards.ts to stay under the 5,000-token file limit; cards.ts re-exports the public surface.
// Holds: BUILDING_NAMES, BUTTON_ORDER, SPECIAL_LABELS, STAT_TEXT, STAT_ICON, humanize, +14 more.
import type { CardIconId } from '@crawlout/ui';
import { LOADOUT_NAMES } from './roster.js';
import { type EffectData, type GameData, BODY_TYPES, PROVIDES, kindOfTypeId } from '@crawlout/data';
import {
  UNITS_PER_METER,
  type PlayerStatus,
  type QueueItem,
  ENTITY_NONE,
  TICK_HZ,
  ANIM,
} from '@crawlout/protocol';
import type { EntityRow } from './snapshot.js';
import { chemLines } from './raiders.js';

/** Display names per building key; data/buildings/*.json has no name field yet, so unknown keys are humanized. */
export const BUILDING_NAMES: Record<string, string> = {
  hoofdgebouw: 'Basis',
  woning: 'Woning',
  werkplaats: 'Werkplaats',
  radiobaken: 'Radiobaken',
  claimpaal: 'Claimpaal',
  turret: 'Turret',
  turret_laser: 'Lasertoren',
  robotfabriek: 'Robotfabriek',
  lab: 'Lab',
  trainingsfaciliteit: 'Training',
  // Raiders (data 0.21.0)
  raiderkamp: 'Raiderkamp',
  tent: 'Tent',
  kooi: 'Kooi',
  plundermarkt: 'Plundermarkt',
  chemlab: 'Chemlab',
  autosloperij: 'Autosloperij',
  mitrailleursnest: 'Mitrailleursnest',
  plunderpost: 'Plunderpost',
  // win route C (data 0.31.0): the parts of the strip mall, restored and as a ruin
  site_supermarket: 'Supermarkt',
  site_supermarket_ruin: 'Supermarkt (ruïne)',
  site_gas_station: 'Benzinestation',
  site_gas_station_ruin: 'Benzinestation (ruïne)',
  site_garage: 'Garage',
  site_garage_ruin: 'Garage (ruïne)',
  site_water_tower: 'Watertoren',
  site_water_tower_ruin: 'Watertoren (ruïne)',
};

/** Order of the building buttons: what the player works with first, then the rest in data order. */
export const BUTTON_ORDER = [
  'raiderkamp',
  'plundermarkt',
  'chemlab',
  'tent',
  'autosloperij',
  'hoofdgebouw',
  'werkplaats',
  'lab',
  'trainingsfaciliteit',
  'robotfabriek',
  'woning',
];

/** The SPECIAL letters in data order (S P E C I A L), for the training cards. */
export const SPECIAL_LABELS = [
  'Kracht',
  'Perceptie',
  'Uithoudingsvermogen',
  'Charisma',
  'Intelligentie',
  'Behendigheid',
  'Geluk',
] as const;

const STAT_TEXT: Record<string, { label: string; unit: 'pct' | 'm' | 'raw' }> = {
  hpPct: { label: 'leven', unit: 'pct' },
  damagePct: { label: 'schade', unit: 'pct' },
  speedPct: { label: 'snelheid', unit: 'pct' },
  rangeM: { label: 'bereik', unit: 'm' },
  gatherRatePct: { label: 'verzameltempo', unit: 'pct' },
  buildTimePct: { label: 'bouwtijd', unit: 'pct' },
  researchTimePct: { label: 'onderzoekstijd', unit: 'pct' },
};

export const STAT_ICON: Record<string, CardIconId> = {
  hpPct: 'shield',
  damagePct: 'gun',
  speedPct: 'bolt',
  rangeM: 'tower',
  gatherRatePct: 'crate',
  buildTimePct: 'wrench',
  researchTimePct: 'gear',
};

/** "composiet_pantser" → "Composiet pantser": data keys until the data carries display names. */
export const humanize = (key: string): string => {
  const words = key.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Dutch name of a building key. */
export const buildingName = (key: string): string => BUILDING_NAMES[key] ?? humanize(key);

const TARGET_NAMES: Record<string, string> = {
  held: 'de held',
  scavenger: 'plunderaars',
  turret: 'turrets',
  turret_laser: 'lasertorens',
  alle: 'alle eenheden',
};

const targetName = (target: string): string =>
  TARGET_NAMES[target] ?? (LOADOUT_NAMES[target] ?? humanize(target)).toLowerCase();

/** Stats that apply to the whole player, not to units: "-10% onderzoekstijd", without a "voor alle eenheden". */
const PLAYER_WIDE_STATS = new Set(['researchTimePct', 'buildTimePct']);

/** One effect in plain language, e.g. "+20% schade voor turrets" or "+1 m bereik voor turrets". */
export function effectText(e: EffectData): string {
  const t = STAT_TEXT[e.stat];
  if (!t) return `${e.stat} ${e.delta > 0 ? '+' : ''}${e.delta} voor ${targetName(e.target)}`;
  const value =
    t.unit === 'pct' ? e.delta / 10 : t.unit === 'm' ? e.delta / UNITS_PER_METER : e.delta;
  const sign = value > 0 ? '+' : '';
  const amount =
    t.unit === 'pct'
      ? `${sign}${value}%`
      : t.unit === 'm'
        ? `${sign}${value} m`
        : `${sign}${value}`;
  if (e.target === 'alle' && PLAYER_WIDE_STATS.has(e.stat)) return `${amount} ${t.label}`;
  return `${amount} ${t.label} voor ${targetName(e.target)}`;
}

/** Effects in plain language, one line per stat and amount: "+15% leven voor militie, patrouille, ...". */
export function effectTexts(effects: readonly EffectData[]): string[] {
  const groups = new Map<string, { first: EffectData; targets: string[] }>();
  for (const e of effects) {
    const key = `${e.stat}:${e.delta}`;
    const g = groups.get(key) ?? { first: e, targets: [] };
    g.targets.push(targetName(e.target));
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => {
    const line = effectText(g.first);
    const at = line.lastIndexOf(' voor ');
    return at < 0 ? line : `${line.slice(0, at)} voor ${g.targets.join(', ')}`;
  });
}

export interface CardContext {
  data: GameData;
  factionId: number | undefined;
  playerId: number;
  status: PlayerStatus | null;
  /** Own selected entities, from the latest snapshot. */
  selected: readonly EntityRow[];
  /** Own entities, to find workshops for crafting. */
  own: readonly EntityRow[];
  heroDead: boolean;
}

export const queueItem = (
  status: PlayerStatus | null,
  kind: QueueItem['kind'],
  id: number,
): QueueItem | undefined => status?.queue?.find((q) => q.kind === kind && q.id === id);

/** Work that occupies a building in the sim (idleOwnBuilding): research, robot production or training; crafting does not. */
export const occupiesBuilding = (q: QueueItem): boolean =>
  q.kind !== 'craft' && q.buildingId !== ENTITY_NONE;

export const isRobotBody = (data: GameData, l: { bodyType: number }): boolean =>
  BODY_TYPES[l.bodyType] === 'robot';

/**
 * What a Raider tech does when its effect list is empty (chems, the plunder bonus, refined chems): read from the faction
 * data and put in plain Dutch, so the card says what the player gets.
 */
export function raiderTechEffects(
  data: GameData,
  factionId: number | undefined,
  techKey: string,
): string[] {
  const faction = factionId === undefined ? undefined : data.factions[factionId];
  if (!faction) return [];
  const chem = faction.chems.find((c) => c.key === techKey);
  if (chem) return chemLines(chem, TICK_HZ);
  const techId = data.tech.find((t) => t.key === techKey && t.factionId === faction.id)?.id;
  const out: string[] = [];
  if (faction.plunder && faction.plunder.bonusTech === techId)
    out.push(
      `+${faction.plunder.bonusPermille / 10}% buit uit gesloopte gebouwen en gedode verzamelaars`,
    );
  if (faction.tribute && faction.tribute.bonusTech === techId)
    out.push(`+${faction.tribute.bonusPermille / 10}% tribuut van bezette nederzettingen`);
  const refined = faction.chems.filter((c) => c.refined?.requiresTech === techId);
  if (refined.length > 0) {
    const r = refined[0]!.refined!;
    out.push(
      `Chems werken ${r.activePermille / 10}% langer en de crash is ${Math.abs(r.crashPermille) / 10}% korter (${refined.map((c) => c.naam).join(', ')})`,
    );
  }
  return out;
}

/** Does the player own a finished workshop? Crafting and role switching (SetRole) both walk to one. */
export function hasFinishedWorkshop(data: GameData, own: readonly EntityRow[]): boolean {
  return hasFinished(data, own, 'werkplaats');
}

/**
 * Does the player own a finished building that provides `what`? A Raider slave switches role at a cage (provides
 * kooi; the Raiderkamp is one), sim 0.18.0.
 */
export function hasFinished(
  data: GameData,
  own: readonly EntityRow[],
  what: (typeof PROVIDES)[number],
): boolean {
  const idx = PROVIDES.indexOf(what);
  return own.some((e) => {
    const k = kindOfTypeId(e.typeId);
    return (
      k.kind === 'building' &&
      data.buildings[k.index]?.provides.includes(idx) === true &&
      e.anim !== ANIM.build
    );
  });
}

/** Pop that robots in production already claim (their popCost), for the pop-limit check of a new robot. */
export function producingPop(data: GameData, status: PlayerStatus | null): number {
  let pop = 0;
  for (const q of status?.queue ?? [])
    if (q.kind === 'produce') pop += data.loadouts[q.id]?.popCost ?? 0;
  return pop;
}

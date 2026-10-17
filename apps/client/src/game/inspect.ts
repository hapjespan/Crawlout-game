// What the selection panel shows for an enemy unit or building the player clicked to inspect it: its type in Dutch,
// whose it is, and for a unit its weapon and armour. Data only; the sim never sees an inspection.
import {
  ARMOR_TYPES,
  DAMAGE_TYPES,
  heroIdOfTypeId,
  kindOfTypeId,
  NEUTRAL_FACTION_ID,
  type GameData,
} from '@crawlout/data';
import { buildingName, humanize } from './cards.js';
import { LOADOUT_NAMES } from './roster.js';

const ARMOR_NL: Record<string, string> = {
  none: 'geen',
  light: 'licht',
  medium: 'middel',
  heavy: 'zwaar',
  robot: 'robot',
};
const DAMAGE_NL: Record<string, string> = {
  ballistic: 'ballistisch',
  energy: 'energie',
  melee: 'melee',
  fire: 'vuur',
};

/** The owner line of a bandit of a creep camp (sim 0.19.0): neutral, the third side. */
export const NEUTRAL_LABEL = 'Neutraal · Bandiet';

export interface Inspection {
  name: string;
  /** "Vijand (Dwellers)". */
  ownerLabel: string;
  /** Weapon and armour of a unit; null for heroes and buildings. */
  detail: string | null;
}

/** "Dwellers (De Kluis)" becomes "Vijand (Dwellers)"; an unknown faction is just "Vijand". */
function enemyLabel(data: GameData, factionId: number | undefined): string {
  const name = factionId === undefined ? undefined : data.factions[factionId]?.naam;
  return name ? `Vijand (${name.replace(/\s*\(.*\)$/, '')})` : 'Vijand';
}

export function inspect(data: GameData, typeId: number): Inspection {
  const heroId = heroIdOfTypeId(typeId);
  if (heroId >= 0) {
    const hero = data.heroes[heroId];
    return {
      name: hero?.naam ?? 'Held',
      ownerLabel: enemyLabel(data, hero?.factionId),
      detail: null,
    };
  }
  const k = kindOfTypeId(typeId);
  if (k.kind === 'building') {
    const b = data.buildings[k.index];
    return {
      name: b ? buildingName(b.key) : 'Gebouw',
      ownerLabel: enemyLabel(data, b?.factionId),
      detail: null,
    };
  }
  if (k.kind === 'unit') {
    const l = data.loadouts[k.index];
    if (!l) return { name: 'Eenheid', ownerLabel: 'Vijand', detail: null };
    const armor = ARMOR_TYPES[l.armorType] ?? '';
    const damage = DAMAGE_TYPES[l.damageType] ?? '';
    // a bandit of a creep camp (data 0.24.0): neutral, named from data/creeps.json
    const creep = l.factionId === NEUTRAL_FACTION_ID ? data.creeps.units.indexOf(l.id) : -1;
    return {
      name:
        creep >= 0
          ? (data.creeps.names[creep] ?? 'Bandiet')
          : (LOADOUT_NAMES[l.key] ?? humanize(l.key)),
      ownerLabel:
        l.factionId === NEUTRAL_FACTION_ID ? NEUTRAL_LABEL : enemyLabel(data, l.factionId),
      detail: `Wapen: ${humanize(l.weapon)} (${DAMAGE_NL[damage] ?? damage}) · Pantser: ${ARMOR_NL[armor] ?? armor}`,
    };
  }
  return { name: 'Onbekend', ownerLabel: 'Vijand', detail: null };
}

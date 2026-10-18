import { heroIdOfTypeId, kindOfTypeId } from '@crawlout/data';
import type { SelectedEntity } from './types.js';

/**
 * Which green CRT portrait a unit type wears. The portraits themselves are local art (the bitmap skin maps
 * `[data-portrait="1".."11"|"robot"|"building"]` to a picture); without a skin the CSS draws a plain silhouette, so the
 * id is all the committed code knows. Ids 1 to 11 are the eleven faces of the Recruits sheet.
 */
export type PortraitId = string;

/** The fixed faces: the hero and the roles of the mockup, plus a technician. */
const BY_LOADOUT: Record<string, PortraitId> = {
  hero: '1', // Opziener
  scavenger: '4', // Plunderaar
  bouwer: '3', // Bouwer
  militie: '5', // Militie
  technicus: '2',
  patrol: '7',
  geweer_leer: '6',
  shotgun_leer: '9',
  shotgun_composiet: '9',
  slagwapen_leer: '10',
  slagwapen_composiet: '10',
  // Raiders: distinct faces per type inside the faction; the dog and the buggy get the generic CRT unit
  plunderaar: '8',
  plunderaar_staal: '11',
  knuppelaar: '10',
  molotovgooier: '9',
  slaver: '7',
  chemdealer: '2',
  slaaf: '4',
  slaaf_bouwer: '3',
  hond: 'robot',
  buggy: 'robot',
  beveiligingsrobot: 'robot',
  reparatiedrone: 'robot',
  sentinel: 'robot',
  bouwrobot: 'robot',
};

const BY_ROLE: Record<string, PortraitId> = { scavenger: '4', builder: '3', militia: '5' };

/** A stable face for a name nobody assigned one to, so the same unit type always looks the same. */
function hashed(name: string): PortraitId {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return String((h % 11) + 1);
}

/** Raider loadouts by their Dutch display name (selected entities carry the name, not the key); order matters. */
const RAIDER_BY_NAME: readonly (readonly [RegExp, PortraitId])[] = [
  [/staal/, BY_LOADOUT.plunderaar_staal!],
  [/molotov/, BY_LOADOUT.molotovgooier!],
  [/slaver/, BY_LOADOUT.slaver!],
  [/chem/, BY_LOADOUT.chemdealer!],
  [/slaaf-bouwer/, BY_LOADOUT.slaaf_bouwer!],
  [/slaaf/, BY_LOADOUT.slaaf!],
  [/hond|buggy/, 'robot'],
];

/** The portrait of a unit-bar group (key: `hero` or a loadout key). */
export function portraitOfGroup(key: string): PortraitId {
  return BY_LOADOUT[key] ?? hashed(key);
}

/** The portrait of a selected entity: the hero, a settler by role, a building, a robot or another unit by its loadout. */
export function portraitOfEntity(e: SelectedEntity): PortraitId {
  if (kindOfTypeId(e.typeId).kind === 'building') return 'building';
  if (heroIdOfTypeId(e.typeId) >= 0) return BY_LOADOUT.hero!;
  const name = (e.loadoutName ?? '').toLowerCase();
  // Raider types first: their role (militia) would otherwise give every fighter the Dwellers' militia face.
  const raider = RAIDER_BY_NAME.find(([pattern]) => pattern.test(name));
  if (raider) return raider[1];
  if (name === 'plunderaar' && e.role === 'militia') return BY_LOADOUT.plunderaar!; // a Raider fighter, not the Dweller scavenger
  if (e.robot) return 'robot'; // the Bouwrobot has role builder but no builder's face
  if (e.role && BY_ROLE[e.role]) return BY_ROLE[e.role]!;
  if (/robot|drone|sentinel/.test(name)) return 'robot';
  if (name.includes('technicus')) return BY_LOADOUT.technicus!;
  if (name.includes('geweer')) return BY_LOADOUT.geweer_leer!;
  if (name.includes('shotgun')) return BY_LOADOUT.shotgun_leer!;
  if (name.includes('knuppel')) return BY_LOADOUT.slagwapen_leer!;
  return hashed(name || String(e.typeId));
}

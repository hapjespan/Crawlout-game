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
  beveiligingsrobot: 'robot',
  reparatiedrone: 'robot',
  sentinel: 'robot',
};

const BY_ROLE: Record<string, PortraitId> = { scavenger: '4', builder: '3', militia: '5' };

/** A stable face for a name nobody assigned one to, so the same unit type always looks the same. */
function hashed(name: string): PortraitId {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return String((h % 11) + 1);
}

/** The portrait of a unit-bar group (key: `hero` or a loadout key). */
export function portraitOfGroup(key: string): PortraitId {
  return BY_LOADOUT[key] ?? hashed(key);
}

/** The portrait of a selected entity: the hero, a settler by role, a building, a robot or another unit by its loadout. */
export function portraitOfEntity(e: SelectedEntity): PortraitId {
  if (kindOfTypeId(e.typeId).kind === 'building') return 'building';
  if (heroIdOfTypeId(e.typeId) >= 0) return BY_LOADOUT.hero!;
  if (e.role && BY_ROLE[e.role]) return BY_ROLE[e.role]!;
  const name = (e.loadoutName ?? '').toLowerCase();
  if (/robot|drone|sentinel/.test(name)) return 'robot';
  if (name.includes('technicus')) return BY_LOADOUT.technicus!;
  if (name.includes('geweer')) return BY_LOADOUT.geweer_leer!;
  if (name.includes('shotgun')) return BY_LOADOUT.shotgun_leer!;
  if (name.includes('knuppel')) return BY_LOADOUT.slagwapen_leer!;
  return hashed(name || String(e.typeId));
}

// Own units grouped by type for the HUD's unit bar, with what each one is doing. Everything comes from the
// snapshot (anim and flags), so the bar needs no extra sim query.
import { ANIM, ENTITY_FLAG } from '@crawlout/protocol';
import { heroIdOfTypeId, kindOfTypeId, type GameData } from '@crawlout/data';
import type { RosterGroup, RosterUnit, UnitActivity } from '@crawlout/ui';
import type { EntityRow } from './snapshot.js';

/** Display names per loadout key; data/loadouts/*.json has no name field yet, so unknown keys show as-is. */
export const LOADOUT_NAMES: Record<string, string> = {
  scavenger: 'Plunderaar',
  bouwer: 'Bouwer',
  militie: 'Militie',
  patrol: 'Patrouille',
  geweer_leer: 'Geweerschutter',
  shotgun_leer: 'Shotgunner',
  shotgun_composiet: 'Shotgunner (composiet)',
  slagwapen_leer: 'Knuppelaar',
  slagwapen_composiet: 'Knuppelaar (composiet)',
  technicus: 'Technicus',
  beveiligingsrobot: 'Beveiligingsrobot',
  reparatiedrone: 'Reparatiedrone',
  sentinel: 'Sentinel',
  bouwrobot: 'Bouwrobot',
  // Raiders (data 0.21.0)
  slaaf: 'Slaaf',
  slaaf_bouwer: 'Slaaf-bouwer',
  // the Raider fighter is a "Rover" on screen (playtest L4): "Plunderaar" is the Dwellers' scavenger; the data ids stay
  plunderaar: 'Rover',
  plunderaar_staal: 'Rover in staal',
  knuppelaar: 'Knuppelaar',
  molotovgooier: 'Molotovgooier',
  hond: 'Hond',
  slaver: 'Slaver',
  chemdealer: 'Chem-dealer',
  buggy: 'Buggy',
  // Garde (data 0.37.0); without these the tiles showed the raw data keys ("initiate_zoeker")
  initiate_zoeker: 'Initiate-zoeker',
  initiate_bouwer: 'Initiate-bouwer',
  initiate_wacht: 'Initiate-wacht',
  krachtpantser: 'Krachtpantser',
  plasmaridder: 'Plasmaridder',
  klerk: 'Klerk',
  vertibird: 'Vertibird',
};

/**
 * Short labels for the unit-bar tiles, which are about 50 px wide at 1280x720 (about 7 letters at the 11 px minimum; the tile fits what the 11 px bold text of 7 letters needs): only
 * the names that do not fit have one; the tooltip and the screen reader get the full name.
 */
export const LOADOUT_SHORT_NAMES: Record<string, string> = {
  plunderaar_staal: 'Staal',
  knuppelaar: 'Knuppel',
  molotovgooier: 'Molotov',
  chemdealer: 'Chem',
  slaaf_bouwer: 'Sl-bouw',
  bouwrobot: 'Bouwbot',
  initiate_zoeker: 'Zoeker',
  initiate_bouwer: 'Bouwer',
  initiate_wacht: 'Wacht',
  krachtpantser: 'Kracht',
  plasmaridder: 'Plasma',
};

/** animT is 0..65535 over the clip; a gathering unit's clip is its gather job. */
const ANIM_T_MAX = 65535;

export function activityOf(e: Pick<EntityRow, 'anim' | 'flags'>): UnitActivity {
  if (e.anim === ANIM.attack1 || e.anim === ANIM.attack2 || (e.flags & ENTITY_FLAG.inCombat) !== 0)
    return 'fighting';
  if (e.anim === ANIM.gather) return 'gathering';
  if (e.anim === ANIM.build) return 'building';
  if ((e.flags & ENTITY_FLAG.carrying) !== 0) return 'carrying';
  if (e.anim === ANIM.walk || e.anim === ANIM.run) return 'moving';
  return 'idle';
}

/**
 * One group per loadout of the faction in data order, plus the hero first when alive. A loadout that needs research or a
 * factory (patrol, robots, technician) only shows once you have one: empty groups of things you cannot make yet are noise.
 */
export function buildRoster(
  data: GameData,
  factionId: number | undefined,
  playerId: number,
  entities: Iterable<EntityRow>,
): RosterGroup[] {
  const byKey = new Map<string, RosterUnit[]>();
  let hero: { naam: string; unit: RosterUnit } | null = null;
  for (const e of entities) {
    if (e.owner !== playerId) continue;
    const activity = activityOf(e);
    const unit: RosterUnit = {
      id: e.id,
      hpPct: e.hpPct,
      activity,
      x: e.x,
      y: e.y,
      // The gather time as a loading bar: the sim puts work / gatherTicks in animT while a unit gathers.
      ...(activity === 'gathering'
        ? { progressPct: Math.round((e.animT * 100) / ANIM_T_MAX) }
        : {}),
    };
    const heroId = heroIdOfTypeId(e.typeId);
    if (heroId >= 0) {
      hero = { naam: data.heroes[heroId]?.naam ?? 'Held', unit };
      continue;
    }
    const k = kindOfTypeId(e.typeId);
    if (k.kind !== 'unit') continue;
    const key = data.loadouts[k.index]?.key;
    if (key === undefined) continue;
    const list = byKey.get(key) ?? [];
    list.push(unit);
    byKey.set(key, list);
  }
  // A hero's body loadout gets no empty tile of its own: a body that exists only to dress the hero (warlord_basis)
  // would otherwise stand in the bar as "Warlord 0". It is only a reason to hide an EMPTY group, never to hide units:
  // a hero body is often a real, buildable unit as well (the Garde's initiate_wacht, the Dwellers' patrol), and those
  // used to disappear from the bar altogether however many you built. The hero entity itself is counted above (it has
  // its own typeId) and never lands in a loadout group, so a tile here never double-counts him.
  const heroBodies = new Set(data.heroes.map((h) => h.baseLoadoutId));
  const groups: RosterGroup[] = hero ? [{ key: 'hero', naam: hero.naam, units: [hero.unit] }] : [];
  for (const l of data.loadouts) {
    if (l.factionId !== factionId) continue;
    const units = (byKey.get(l.key) ?? []).sort((a, b) => a.id - b.id);
    if (
      units.length === 0 &&
      (heroBodies.has(l.id) || l.prereqTech.length > 0 || l.producedAt >= 0)
    )
      continue;
    const short = LOADOUT_SHORT_NAMES[l.key];
    groups.push({
      key: l.key,
      naam: LOADOUT_NAMES[l.key] ?? l.key,
      ...(short !== undefined ? { short } : {}),
      units,
    });
  }
  return groups;
}

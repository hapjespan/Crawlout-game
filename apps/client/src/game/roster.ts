// Own units grouped by type for the HUD's unit bar, with what each one is doing. Everything comes from the
// snapshot (anim and flags), so the bar needs no extra sim query.
import { ANIM, ENTITY_FLAG } from '@crawlout/protocol';
import { heroIdOfTypeId, kindOfTypeId, type GameData } from '@crawlout/data';
import type { RosterGroup, RosterUnit, UnitActivity } from '@crawlout/ui';
import type { EntityRow } from './snapshot.js';

/** Display names per loadout key; loadouts.json has no name field yet, so unknown keys show as-is. */
export const LOADOUT_NAMES: Record<string, string> = {
  scavenger: 'Plunderaar',
  bouwer: 'Bouwer',
  militie: 'Militie',
  patrol: 'Patrouille',
};

export function activityOf(e: Pick<EntityRow, 'anim' | 'flags'>): UnitActivity {
  if (e.anim === ANIM.attack1 || e.anim === ANIM.attack2 || (e.flags & ENTITY_FLAG.inCombat) !== 0) return 'fighting';
  if (e.anim === ANIM.gather) return 'gathering';
  if (e.anim === ANIM.build) return 'building';
  if ((e.flags & ENTITY_FLAG.carrying) !== 0) return 'carrying';
  if (e.anim === ANIM.walk || e.anim === ANIM.run) return 'moving';
  return 'idle';
}

/** One group per loadout of the faction (also empty ones, in data order), plus the hero first when alive. */
export function buildRoster(data: GameData, factionId: number | undefined, playerId: number, entities: Iterable<EntityRow>): RosterGroup[] {
  const byKey = new Map<string, RosterUnit[]>();
  let hero: { naam: string; unit: RosterUnit } | null = null;
  for (const e of entities) {
    if (e.owner !== playerId) continue;
    const unit: RosterUnit = { id: e.id, hpPct: e.hpPct, activity: activityOf(e), x: e.x, y: e.y };
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
  const groups: RosterGroup[] = hero ? [{ key: 'hero', naam: hero.naam, units: [hero.unit] }] : [];
  for (const l of data.loadouts) {
    if (l.factionId !== factionId) continue;
    const units = (byKey.get(l.key) ?? []).sort((a, b) => a.id - b.id);
    groups.push({ key: l.key, naam: LOADOUT_NAMES[l.key] ?? l.key, units });
  }
  return groups;
}

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { ANIM, ENTITY_FLAG } from '@crawlout/protocol';
import { heroTypeId, unitTypeId } from '@crawlout/data';
import { loadGameDataFromDir } from '@crawlout/data/node';
import { activityOf, buildRoster } from '../src/game/roster.js';
import type { EntityRow } from '../src/game/snapshot.js';

const data = loadGameDataFromDir(fileURLToPath(new URL('../../../data', import.meta.url)));
const loadout = (key: string) => data.loadouts.find((l) => l.key === key)!;
const row = (id: number, typeId: number, over: Partial<EntityRow> = {}): EntityRow => ({
  id,
  typeId,
  owner: 0,
  x: id * 256,
  y: 0,
  hpPct: 100,
  anim: ANIM.idle,
  flags: 0,
  ...over,
});

describe('activityOf', () => {
  it('reads what a unit does from its anim and flags', () => {
    expect(activityOf({ anim: ANIM.idle, flags: 0 })).toBe('idle');
    expect(activityOf({ anim: ANIM.walk, flags: 0 })).toBe('moving');
    expect(activityOf({ anim: ANIM.walk, flags: ENTITY_FLAG.carrying })).toBe('carrying');
    expect(activityOf({ anim: ANIM.gather, flags: 0 })).toBe('gathering');
    expect(activityOf({ anim: ANIM.build, flags: 0 })).toBe('building');
    expect(activityOf({ anim: ANIM.attack1, flags: 0 })).toBe('fighting');
    expect(activityOf({ anim: ANIM.walk, flags: ENTITY_FLAG.inCombat })).toBe('fighting');
  });
});

describe('buildRoster', () => {
  const scav = loadout('scavenger');
  const faction = scav.factionId;

  it('groups own units per loadout of the faction, hero first, enemies left out', () => {
    const roster = buildRoster(data, faction, 0, [
      row(3, unitTypeId(scav.id), { anim: ANIM.gather }),
      row(2, unitTypeId(scav.id)),
      row(9, unitTypeId(scav.id), { owner: 1 }),
      row(5, heroTypeId(0), { anim: ANIM.walk }),
    ]);
    expect(roster[0]).toMatchObject({ key: 'hero', units: [{ id: 5, activity: 'moving' }] });
    const scavs = roster.find((g) => g.key === 'scavenger')!;
    expect(scavs.naam).toBe('Plunderaar');
    expect(scavs.units.map((u) => [u.id, u.activity])).toEqual([
      [2, 'idle'],
      [3, 'gathering'],
    ]);
    expect(roster.filter((g) => g.key !== 'hero').map((g) => g.key)).toEqual(
      data.loadouts.filter((l) => l.factionId === faction).map((l) => l.key),
    );
  });
});

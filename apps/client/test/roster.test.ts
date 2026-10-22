import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { ANIM, ENTITY_FLAG } from '@crawlout/protocol';
import { heroTypeId, unitTypeId } from '@crawlout/data';
import { loadGameDataFromDir } from '@crawlout/data/node';
import { LOADOUT_NAMES, activityOf, buildRoster } from '../src/game/roster.js';
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
  animT: 0,
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

  it('groups own units per basic loadout of the faction, hero first, enemies left out', () => {
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
    // the gather job shows as a loading bar: animT 0..65535 becomes 0..100
    expect(scavs.units.find((u) => u.id === 3)?.progressPct).toBe(0);
    expect(scavs.units.find((u) => u.id === 2)?.progressPct).toBeUndefined();
    expect(roster.filter((g) => g.key !== 'hero').map((g) => g.key)).toEqual(
      data.loadouts
        .filter((l) => l.factionId === faction && l.prereqTech.length === 0 && l.producedAt < 0)
        .map((l) => l.key),
    );
  });
});

describe('a loadout that is also a hero body', () => {
  // Martien, playtest: "niet alle garde poppetjes die ik build komen onder in de navigatie/hud terug". The Garde's
  // Initiate-wacht is the body of two of its heroes, and the bar used to drop that whole tile, however many you built.
  const wacht = loadout('initiate_wacht');
  const garde = wacht.factionId;

  it('keeps its tile as soon as there are units of it, and stays away while there are none', () => {
    expect(data.heroes.some((hero) => hero.baseLoadoutId === wacht.id)).toBe(true);
    const roster = buildRoster(data, garde, 0, [
      row(2, unitTypeId(wacht.id)),
      row(3, unitTypeId(wacht.id)),
    ]);
    const tile = roster.find((g) => g.key === 'initiate_wacht');
    expect(tile?.naam).toBe('Initiate-wacht');
    expect(tile?.units.map((u) => u.id)).toEqual([2, 3]);
    // No units of it: no empty tile either (that is what the hero-body rule is for).
    expect(buildRoster(data, garde, 0, []).some((g) => g.key === 'initiate_wacht')).toBe(false);
  });

  it('the hero himself never lands in the tile of his own body loadout', () => {
    const heroId = data.heroes.findIndex((hero) => hero.baseLoadoutId === wacht.id);
    const roster = buildRoster(data, garde, 0, [
      row(2, unitTypeId(wacht.id)),
      row(5, heroTypeId(heroId)),
    ]);
    expect(roster[0]?.key).toBe('hero');
    expect(roster.find((g) => g.key === 'initiate_wacht')?.units.map((u) => u.id)).toEqual([2]);
  });

  it('every Garde loadout has a Dutch name, so no tile shows a raw data key', () => {
    for (const l of data.loadouts.filter((x) => x.factionId === garde))
      expect(LOADOUT_NAMES[l.key], l.key).toBeDefined();
  });
});

describe('gather progress', () => {
  const scav = loadout('scavenger');
  it('turns animT into a percentage for gathering units only', () => {
    const roster = buildRoster(data, scav.factionId, 0, [
      row(1, unitTypeId(scav.id), { anim: ANIM.gather, animT: 32768 }),
      row(2, unitTypeId(scav.id), { anim: ANIM.gather, animT: 65535 }),
      row(3, unitTypeId(scav.id), { anim: ANIM.walk, animT: 20000 }),
    ]);
    const units = roster.find((g) => g.key === 'scavenger')!.units;
    expect(units.map((u) => u.progressPct)).toEqual([50, 100, undefined]);
  });
});

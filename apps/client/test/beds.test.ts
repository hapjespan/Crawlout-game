import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { PlayerStatus } from '@crawlout/protocol';
import { loadGameDataFromDir } from '@crawlout/data/node';
import {
  BEDS_ALERT_COOLDOWN_MS,
  BEDS_REPEAT_MS,
  BedHintThrottle,
  bedHintText,
  cappedByBeds,
} from '../src/game/beds.js';

// Playtest M5: a short hint when the beds cap the population, with the faction's bed building, throttled.

const data = loadGameDataFromDir(fileURLToPath(new URL('../../../data', import.meta.url)));
const dwellers = data.factions.find((f) => f.key === 'dwellers')!;
const raiders = data.factions.find((f) => f.key === 'raiders')!;
const garde = data.factions.find((f) => f.key === 'garde')!;
const status = (over: Partial<PlayerStatus> = {}): PlayerStatus => ({
  playerId: 0,
  scrap: 100,
  settlers: 8,
  pop: 8,
  popCap: 8,
  beds: 8,
  hero: null,
  queue: [],
  dominance: { pointsHeld: 0, pointsRequired: 2, ticksHeld: 0, ticksRequired: 9600, leader: null },
  noBedPop: 0,
  trained: [0, 0, 0, 0, 0, 0, 0],
  claimPoints: [],
  ...over,
});

describe('no free beds hint', () => {
  it('names the bed building of the faction', () => {
    expect(bedHintText(data, dwellers.id)).toBe('Geen vrije bedden: bouw een woning');
    expect(bedHintText(data, raiders.id)).toBe('Geen vrije bedden: bouw een tent');
    // data 0.41.0: the Slaapzaal is the cheapest Garde bed building (the kazerne recruits)
    expect(bedHintText(data, garde.id)).toBe('Geen vrije bedden: bouw een slaapzaal');
  });

  it('only when the beds are what caps the population, not popCapMax', () => {
    expect(cappedByBeds(data, status())).toBe(true);
    expect(cappedByBeds(data, status({ pop: 7 }))).toBe(false);
    const max = data.sim.popCapMax;
    expect(cappedByBeds(data, status({ pop: max, popCap: max, beds: max + 10 }))).toBe(false);
    // no-bed units take room under popCapMax: the cap left for settlers is popCapMax - noBedPop
    expect(cappedByBeds(data, status({ pop: max - 6, popCap: max - 6, noBedPop: 6 }))).toBe(false);
    expect(cappedByBeds(data, status({ pop: 10, popCap: 10, noBedPop: 6 }))).toBe(true);
  });

  it('is throttled: once when the cap starts, again only after a while', () => {
    const t = new BedHintThrottle();
    expect(t.check(true, 0)).toBe(true);
    expect(t.check(true, 1000)).toBe(false);
    expect(t.check(true, BEDS_REPEAT_MS - 1)).toBe(false);
    expect(t.check(true, BEDS_REPEAT_MS)).toBe(true);
    // the cap lifts and comes back: the hint again, but never sooner than the cooldown
    expect(t.check(false, BEDS_REPEAT_MS + 100)).toBe(false);
    expect(t.check(true, BEDS_REPEAT_MS + 200)).toBe(false);
    expect(t.check(false, BEDS_REPEAT_MS + 300)).toBe(false);
    expect(t.check(true, BEDS_REPEAT_MS + BEDS_ALERT_COOLDOWN_MS)).toBe(true);
  });
});

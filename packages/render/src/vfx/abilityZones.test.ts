import { describe, expect, it } from 'vitest';
import type { GameData } from '@crawlout/data';
import { TICK_MS, UNITS_PER_METER } from '@crawlout/protocol';
import { DECAL_SHAPE, type DecalStyle } from '../decals/decalLayer.js';
import { abilitiesFromGameData, AbilityZones, ZONE_FADE_S, ZONE_OPEN_S, zoneFade, type DecalSink } from './abilityZones.js';

class Decals implements DecalSink {
  readonly items: { x: number; z: number; halfX: number; halfZ: number; style: DecalStyle }[] = [];
  push(x: number, z: number, halfX: number, halfZ: number, style: DecalStyle): void {
    this.items.push({ x, z, halfX, halfZ, style: { ...style } });
  }
}

function heroes(radiusU: number, durationTicks: number): Pick<GameData, 'heroes'> {
  return { heroes: [{ abilities: [{ radiusU, durationTicks }] }] } as unknown as Pick<GameData, 'heroes'>;
}

describe('abilitiesFromGameData', () => {
  it('reads radiusU and durationTicks of heroes[heroId].abilities[abilityId] in meters and seconds', () => {
    const lookup = abilitiesFromGameData(heroes(6 * UNITS_PER_METER, 160));
    expect(lookup(0, 0)).toEqual({ radius: 6, duration: (160 * TICK_MS) / 1000 });
  });

  it('returns null for an unknown hero or ability, or a zone without size or duration', () => {
    const lookup = abilitiesFromGameData(heroes(6 * UNITS_PER_METER, 160));
    expect(lookup(1, 0)).toBeNull();
    expect(lookup(0, 1)).toBeNull();
    expect(abilitiesFromGameData(heroes(0, 160))(0, 0)).toBeNull();
    expect(abilitiesFromGameData(heroes(6 * UNITS_PER_METER, 0))(0, 0)).toBeNull();
  });
});

describe('zoneFade', () => {
  it('fades in, holds, and fades out by itself at the end of the duration', () => {
    expect(zoneFade(-0.01, 8)).toBe(0);
    expect(zoneFade(ZONE_OPEN_S / 2, 8)).toBeCloseTo(0.5);
    expect(zoneFade(4, 8)).toBe(1);
    expect(zoneFade(8 - ZONE_FADE_S / 2, 8)).toBeCloseTo(0.5);
    expect(zoneFade(8, 8)).toBe(0);
  });
});

describe('AbilityZones', () => {
  it('pushes one circular decal per zone in the team color, with ring and soft fill', () => {
    const zones = new AbilityZones();
    zones.addZone(20, 30, 6, 2, 10, 8);
    const decals = new Decals();
    zones.draw(14, decals);
    expect(decals.items).toHaveLength(1);
    const d = decals.items[0]!;
    expect([d.x, d.z, d.halfX, d.halfZ]).toEqual([20, 30, 6, 6]);
    expect(d.style.shape).toBe(DECAL_SHAPE.circle);
    expect(d.style.color).toBe(2);
    expect(d.style.shadow).toBe(0);
    expect(d.style.ring).toBeGreaterThan(0.5);
    expect(d.style.fill).toBeGreaterThan(0);
    expect(d.style.fill).toBeLessThan(d.style.ring);
    expect(d.style.fillEdge).toBe(1);
  });

  it('opens from a smaller ring, then fades out and forgets the zone after its duration', () => {
    const zones = new AbilityZones();
    zones.addZone(0, 0, 6, 0, 10, 8);
    const at = (t: number) => {
      const decals = new Decals();
      zones.draw(t, decals);
      return decals.items[0];
    };
    expect(at(9.9)).toBeUndefined(); // not started: nothing drawn, but kept
    expect(zones.count).toBe(1);
    const opening = at(10.05)!;
    expect(opening.halfX).toBeLessThan(6);
    expect(opening.halfX).toBeGreaterThan(4);
    const full = at(13)!;
    const late = at(17.7)!;
    expect(late.style.ring).toBeLessThan(full.style.ring);
    expect(late.style.fill).toBeLessThan(full.style.fill);
    expect(at(18)).toBeUndefined();
    expect(zones.count).toBe(0);
  });

  it('ignores zones without radius or duration', () => {
    const zones = new AbilityZones();
    zones.addZone(0, 0, 0, 0, 0, 8);
    zones.addZone(0, 0, 6, 0, 0, 0);
    expect(zones.count).toBe(0);
  });
});

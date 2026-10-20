import { describe, expect, it } from 'vitest';
import type { SurvivalStatus } from '@crawlout/protocol';
import { survivalView, survivalZones, zoneReason } from '../src/game/survivalStatus.js';

const names = ['Eén', 'Twee', 'Drie'];
const status = (over: Partial<SurvivalStatus> = {}): SurvivalStatus => ({
  wavesStarted: 1,
  waves: 15,
  next: { wave: 2, atFrame: 3000, rank: 'normal' },
  active: [{ target: 1, alive: 7 }],
  result: null,
  ...over,
});
const name = (id: number): string => `Speler ${id + 1}`;

describe('survivalView', () => {
  it('is null outside Survival', () => {
    expect(survivalView(null, 0, names, name, 0)).toBeNull();
  });

  it('counts down against the status frame and names the target', () => {
    const v = survivalView(status(), 2000, names, name, 0);
    expect(v).toMatchObject({
      wave: 1,
      waves: 15,
      next: { wave: 2, naam: 'Twee', rank: 'normal', inSeconds: 50 },
      target: { name: 'Speler 2', isYou: false, alive: 7 },
      alive: 7,
    });
  });

  it('maps the ranks and flags yourself as the target', () => {
    const boss = survivalView(
      status({
        next: { wave: 3, atFrame: 100, rank: 'boss' },
        active: [{ target: 0, alive: 1 }],
      }),
      0,
      names,
      name,
      0,
    );
    expect(boss?.next?.rank).toBe('boss');
    expect(boss?.target?.isYou).toBe(true);
    const mini = survivalView(
      status({ next: { wave: 2, atFrame: 1, rank: 'miniboss' } }),
      5,
      names,
      name,
      0,
    );
    expect(mini?.next?.rank).toBe('miniboss');
    expect(mini?.next?.inSeconds).toBe(0);
  });

  it('keeps the same object while nothing changed, and has no next after the last wave', () => {
    const a = survivalView(status({ next: null }), 0, names, name, 0);
    expect(survivalView(status({ next: null }), 0, names, name, 0)).toBe(a);
    expect(a?.next).toBeNull();
  });
});

describe('build zone', () => {
  const zone = { x: 10000, y: 10000, radius: 45 * 256 };
  it('marks the own zone on the minimap', () => {
    expect(survivalZones([zone, zone], 1).map((z) => z.own)).toEqual([false, true]);
    expect(survivalZones(undefined, 0)).toEqual([]);
  });

  it('refuses a footprint centre outside the zone, but not claim buildings or without survival', () => {
    const cx = (10000 >> 8) - 2;
    expect(zoneReason(zone, cx, cx, 4, 4, false)).toBeNull();
    expect(zoneReason(zone, cx + 60, cx, 4, 4, false)).toContain('Buiten je bouwzone');
    expect(zoneReason(zone, cx + 60, cx, 4, 4, true)).toBeNull();
    expect(zoneReason(null, cx + 60, cx, 4, 4, false)).toBeNull();
  });
});

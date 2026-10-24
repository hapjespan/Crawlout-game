// De hellingbegrenzing op de root-lift: dekt hij de vraag, houdt hij zich aan zijn eigen limiet, en loopt hij door
// over de naad van een lus heen?
import { describe, expect, it } from 'vitest';
import { isLoop, rateLimited } from '../src/liftCurve.js';

const steps = (a: readonly number[], loop = false): number => {
  const last = loop ? a.length - 1 : a.length;
  let worst = 0;
  for (let i = 1; i < last; i++) worst = Math.max(worst, Math.abs(a[i]! - a[i - 1]!));
  if (loop && last > 1) worst = Math.max(worst, Math.abs(a[0]! - a[last - 1]!));
  return worst;
};

describe('rateLimited', () => {
  it('dekt elke frame-vraag en verandert nooit sneller dan de helling', () => {
    const required = [0, 0, 0, 10, 0, 0, 0, 0, 0, 0];
    const out = rateLimited(required, 2, false);
    required.forEach((value, i) => expect(out[i]!).toBeGreaterThanOrEqual(value));
    expect(out[3]).toBe(10);
    expect(steps(out)).toBeLessThanOrEqual(2);
    // De piek wordt een driehoek: zijn buren betalen mee, en op 5 frames afstand is er niets meer over.
    expect(out).toEqual([4, 6, 8, 10, 8, 6, 4, 2, 0, 0]);
  });

  it('laat een vraag die al langzaam genoeg verloopt ongemoeid', () => {
    const required = [0, 1, 2, 3, 2, 1, 0];
    expect(rateLimited(required, 2, false)).toEqual(required);
  });

  it('loopt bij een lus door over de naad, met het laatste frame als kopie van het eerste', () => {
    // 9 frames waarvan de laatste een kopie van de eerste is: de cyclus is 0 tot en met 7.
    const required = [0, 0, 0, 0, 0, 0, 0, 8, 0];
    const out = rateLimited(required, 2, true);
    expect(out[7]).toBe(8);
    // Frame 0 grenst aan frame 7, dus het betaalt mee; zonder de wrap zou het 0 blijven.
    expect(out[0]).toBe(6);
    expect(out[8]).toBe(out[0]);
    expect(steps(out, true)).toBeLessThanOrEqual(2);
  });

  it('geeft de vraag onveranderd terug zonder helling of zonder frames', () => {
    expect(rateLimited([1, 9], 0, false)).toEqual([1, 9]);
    expect(rateLimited([], 2, false)).toEqual([]);
  });
});

describe('isLoop', () => {
  const quat = (...values: number[]): number[] => values;
  it('herkent een clip waarvan het laatste keyframe het eerste herhaalt', () => {
    expect(isLoop([quat(0, 0, 0, 1, 0, 0, 0.1, 1, 0, 0, 0, 1)])).toBe(true);
    expect(isLoop([quat(0, 0, 0, 1, 0, 0, 0.1, 1, 0, 0, 0.5, 1)])).toBe(false);
  });

  it('is onwaar zonder kanaal met minstens twee keyframes', () => {
    expect(isLoop([])).toBe(false);
    expect(isLoop([quat(0, 0, 0, 1)])).toBe(false);
  });
});

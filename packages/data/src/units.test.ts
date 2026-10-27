import { describe, expect, it } from 'vitest';
import { perSecondToMilliPerTick } from './units.js';

describe('perSecondToMilliPerTick', () => {
  it('does not lose a milli-unit to float noise (4.02 * 1000 = 4019.999…)', () => {
    expect(perSecondToMilliPerTick(4.02)).toBe(201);
    expect(perSecondToMilliPerTick(8.04)).toBe(402);
    expect(perSecondToMilliPerTick(12)).toBe(600);
  });
});

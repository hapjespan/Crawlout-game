import { describe, expect, it } from 'vitest';
import { abilityOutOfRange } from '../src/game/abilityHint.js';

const at = (x: number, y: number, cooldownTicks = 0) => ({ x, y, cooldownTicks });
const target = { x: 10_000, y: 0 };

describe('abilityOutOfRange', () => {
  it('hints when the target was too far and nothing happened', () => {
    expect(abilityOutOfRange({ rangeU: 2560, target, before: at(0, 0), after: at(0, 0) })).toBe(
      true,
    );
  });
  it('stays quiet when the target was in range', () => {
    expect(
      abilityOutOfRange({
        rangeU: 2560,
        target: { x: 2560, y: 0 },
        before: at(0, 0),
        after: at(0, 0),
      }),
    ).toBe(false);
  });
  it('stays quiet when the cast started (cooldown running)', () => {
    expect(
      abilityOutOfRange({ rangeU: 2560, target, before: at(0, 0), after: at(0, 0, 100) }),
    ).toBe(false);
  });
  it('stays quiet when the hero walked (the sim moves him into range)', () => {
    expect(abilityOutOfRange({ rangeU: 2560, target, before: at(0, 0), after: at(300, 0) })).toBe(
      false,
    );
  });
  it('stays quiet for a self-cast ability without range', () => {
    expect(abilityOutOfRange({ rangeU: 0, target, before: at(0, 0), after: at(0, 0) })).toBe(false);
  });
});

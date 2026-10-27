// A hero ability cast out of range is rejected by the sim and nothing happens. The client cannot see the rejection
// directly, so it looks again shortly after sending: no cooldown started, the hero has not moved (a sim that walks the
// hero into range would have moved him) and the target was beyond the ability's range. Only then the hint is shown.
export const ABILITY_HINT_DELAY_MS = 1200;
export const OUT_OF_RANGE_TEXT = 'Buiten bereik';

export interface AbilityProbe {
  x: number;
  y: number;
  cooldownTicks: number;
}

export function abilityOutOfRange(args: {
  rangeU: number;
  target: { x: number; y: number };
  before: AbilityProbe;
  after: AbilityProbe;
}): boolean {
  const { rangeU, target, before, after } = args;
  if (rangeU <= 0 || before.cooldownTicks > 0 || after.cooldownTicks > 0) return false;
  if (before.x !== after.x || before.y !== after.y) return false;
  const dx = target.x - before.x;
  const dy = target.y - before.y;
  return dx * dx + dy * dy > rangeU * rangeU;
}

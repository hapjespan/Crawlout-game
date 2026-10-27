// Budget for the HUD render-time tests.
//
// The brief (spelfundament sectie 9) asks for a HUD that renders under 2 ms per frame. That is a product requirement on
// the hardware the game is played on, and the tests assert it directly. Fase-0 sectie 20 besluit 10 already noted the
// snag: the tests fail when vitest runs them beside the replay fixtures and pass on their own, and allowed either
// moving them out of the parallel workers or giving them "een drempel die eerst een referentie meet".
//
// The first real CI run (PR #1, 22 October) showed neither is enough on its own. A GitHub runner needs 4 to 10 ms for
// the same work, so the product budget simply does not hold on shared CI hardware — and asserting it there measures the
// runner, not the HUD. A synthetic calibration loop was tried and rejected: once warmed up the JIT optimises it away,
// so it reports JIT quality rather than machine speed, and it swung 50 percent between runs on one machine.
//
// So the budget is split by what the number is for:
//   - On a development machine the strict 2 ms of the brief applies, unchanged.
//   - On CI the ceiling is loose. It no longer proves the brief is met — only the dev machine and the playtest on real
//     hardware can do that — but it still catches a HUD render that suddenly costs an order of magnitude more.
//
// If this ever needs to be strict in CI again, the answer is a dedicated runner, not a smaller number here.

/** Hoeveel ruimer de grens in CI is dan de 2 ms van de brief. Vangt een orde-van-grootte-regressie, niet meer. */
const CI_SLACK = 8;

/** True on GitHub Actions and most other runners. */
function onCi(): boolean {
  return process.env.CI === 'true' || process.env.CI === '1';
}

/**
 * The render budget in milliseconds: the brief's 2 ms on a dev machine, a loose ceiling on CI.
 * `baseMs` is the budget for this particular test when it differs from the brief.
 */
export function renderBudgetMs(baseMs = 2): number {
  return onCi() ? baseMs * CI_SLACK : baseMs;
}

// Eerlijkheidsrapport (fair-ronde): AI tegen AI op Rustbelt XL over de seeds 1 tot 30, 42, 99 en 123 (of de seeds op de
// opdrachtregel): per seed winnaar, reden en lengte, en de verdeling over de spelers. Gebruik:
//   node --import tsx src/fairness-report.ts [seed ...]
// De potjes lopen parallel in losse processen (fairness.ts). Met --json speelt dit proces de seeds zelf, na elkaar, en
// schrijft het per seed één regel JSON (de volledige MatchResult); zo roept fairness.ts het aan.
import { FAIRNESS_SEEDS, TICKS_PER_MINUTE, playMatch } from './balance.js';
import { playMatchesParallel, summarize } from './fairness.js';

const args = process.argv.slice(2);
// --factions a,b: the faction of each player (sim 0.18.0; default both dwellers)
const fi = args.indexOf('--factions');
const factions = fi >= 0 ? args[fi + 1]!.split(',') : undefined;
const seeds = args
  .filter((_, k) => fi < 0 || k !== fi + 1)
  .map(Number)
  .filter((n) => Number.isInteger(n));
const list = seeds.length > 0 ? seeds : FAIRNESS_SEEDS;

if (args.includes('--json')) {
  for (const seed of list)
    console.log(JSON.stringify(playMatch(seed, { maxFrames: 45 * TICKS_PER_MINUTE, factions })));
} else {
  const t0 = Date.now();
  const results = await playMatchesParallel(list, undefined, factions);
  for (const r of results) {
    console.log(
      `seed ${r.seed}: winnaar ${r.winner ?? '-'} (${r.reason ?? 'geen'}) op frame ${r.frame} = ${r.minutes.toFixed(1)} min`,
    );
    // per speler wat hij uit de techboom haalde (data 0.17.0): techs, sentinels, laserturrets, getrainde punten, piek-scrap
    if (args.includes('--detail'))
      r.players.forEach((t, p) => {
        const last = Object.entries(t.techAt).sort((a, b) => a[1] - b[1]);
        console.log(
          `  p${p}${p === r.winner ? '*' : ' '} techs ${t.techs} (laatste ${last.at(-1)?.[0] ?? '-'} ${last.at(-1)?.[1] ?? ''}) sentinels ${t.robots['sentinel'] ?? 0} (protocol ${t.techAt['sentinel_protocol'] ?? '-'}) robots ${Object.values(t.robots).reduce((a, b) => a + b, 0)} laser ${t.built['turret_laser'] ?? 0} turret ${t.built['turret'] ?? 0} trained ${t.trained} piek ${t.peakScrap} ongebruikt ${t.income - t.spent} lab ${t.firstBuilt['lab'] ?? '-'} fabriek ${t.firstBuilt['robotfabriek'] ?? '-'} training ${t.firstBuilt['trainingsfaciliteit'] ?? '-'} held ${t.heroLevel}`,
        );
      });
  }
  const s = summarize(results);
  console.log(
    `speler 0 wint ${s.wins[0]}, speler 1 wint ${s.wins[1]} van ${list.length}; vernietiging ${s.reasons.destruction}, dominantie ${s.reasons.dominance}; lengte ${s.minMinutes.toFixed(1)} tot ${s.maxMinutes.toFixed(1)} min, ${s.inWindow} tussen 25 en 35  [${((Date.now() - t0) / 1000).toFixed(1)} s]`,
  );
}

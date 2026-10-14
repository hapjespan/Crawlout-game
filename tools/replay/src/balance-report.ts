// Balansrapport: AI tegen AI op Rustbelt over een reeks seeds (standaard 1, 7, 42, 99, 123), per seed winnaar, reden,
// lengte, scrap-verloop, leger en held-level. Gebruik: node --import tsx src/balance-report.ts [seed ...]
import { BOT_PLANS, playMatch } from './balance.js';
import type { MatchResult } from './balance.js';
import { settlementBot } from './bot.js';

const seeds = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n));
const list = seeds.length > 0 ? seeds : [1, 7, 42, 99, 123];

const fmt = (xs: number[], every = 3): string => xs.filter((_, i) => i % every === every - 1 || i === xs.length - 1).join(' ');

const results: MatchResult[] = [];
for (const seed of list) {
  const t0 = Date.now();
  const r = playMatch(seed);
  results.push(r);
  console.log(`seed ${seed}: winnaar ${r.winner ?? '-'} (${r.reason ?? 'geen'}) op frame ${r.frame} = ${r.minutes.toFixed(1)} min  [${((Date.now() - t0) / 1000).toFixed(1)} s]`);
  r.players.forEach((p, i) => {
    console.log(`  p${i}: inkomen ${p.income}, uitgegeven ${p.spent}, piek ${p.peakScrap}, held lvl ${p.heroLevel} (${p.heroXp} xp), techs ${p.techs}, verloren ${p.lost}`);
    console.log(`      gebouwd ${JSON.stringify(p.built)}`);
    console.log(`      scrap/3min   ${fmt(p.scrapByMinute)}`);
    console.log(`      bewoners     ${fmt(p.settlersByMinute)}  cap ${fmt(p.popCapByMinute)}`);
    console.log(`      militie      ${fmt(p.militiaByMinute)}  claims ${fmt(p.claimsByMinute)}`);
  });
}
const mins = results.map((r) => r.minutes);
console.log(`lengte: min ${Math.min(...mins).toFixed(1)}, max ${Math.max(...mins).toFixed(1)}, gemiddeld ${(mins.reduce((a, b) => a + b, 0) / mins.length).toFixed(1)} min`);

// Een bot-speler (speler 0) tegen de AI: passief (geeft na zijn plan niets meer uit) en actief (schoolt om boven een
// drempel). Ongebruikte scrap hoort niet eindeloos op te lopen.
for (const [name, plan] of Object.entries(BOT_PLANS)) {
  const r = playMatch(42, { ai: [false, true], controllers: [settlementBot(0, plan)], maxFrames: 40 * 1200 });
  const p = r.players[0]!;
  console.log(`bot ${name} tegen AI (seed 42): winnaar ${r.winner ?? '-'} (${r.reason ?? 'geen'}) na ${r.minutes.toFixed(1)} min`);
  console.log(`  bot: inkomen ${p.income}, uitgegeven ${p.spent}, piek ${p.peakScrap}, eind ${p.scrapByMinute[p.scrapByMinute.length - 1]}, held lvl ${p.heroLevel}`);
  console.log(`      scrap/3min   ${fmt(p.scrapByMinute)}`);
  console.log(`  AI:  piek ${r.players[1]!.peakScrap}, scrap/3min ${fmt(r.players[1]!.scrapByMinute)}, held lvl ${r.players[1]!.heroLevel}`);
}

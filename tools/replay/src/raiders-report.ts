// Raiders against Dwellers (sim 0.18.0): scripted AI against scripted AI on Rustbelt XL over a set of seeds, each seed
// on both sides (Raiders as player 0 and as player 1), in parallel processes (fairness.ts). Per match winner, reason
// and length; then the table the balance asks for (wins per faction and side, routes per minute bucket, captures and
// liberations; data 0.24.0).
// Usage: node --import tsx src/raiders-report.ts [--detail] [seed ...]   (default the 33 seeds of FAIRNESS_SEEDS)
import { FAIRNESS_SEEDS } from './balance.js';
import type { MatchResult } from './balance.js';
import { playMatchesParallel } from './fairness.js';
import { formatRaiderSummary, raiderSummary } from './raiders.js';

const args = process.argv.slice(2);
const seeds = args.map(Number).filter((n) => Number.isInteger(n));
const list = seeds.length > 0 ? seeds : FAIRNESS_SEEDS;
const fmt = (xs: number[], every = 3): string =>
  xs.filter((_, i) => i % every === every - 1 || i === xs.length - 1).join(' ');

const t0 = Date.now();
const [asP0, asP1] = await Promise.all([
  playMatchesParallel(list, undefined, ['raiders', 'dwellers']),
  playMatchesParallel(list, undefined, ['dwellers', 'raiders']),
]);
const rows: { raider: number; r: MatchResult }[] = [
  ...asP0.map((r) => ({ raider: 0, r })),
  ...asP1.map((r) => ({ raider: 1, r })),
];
for (const { raider, r } of rows) {
  const who = r.winner === null ? '-' : r.winner === raider ? 'Raiders' : 'Dwellers';
  console.log(
    `seed ${r.seed} raiders p${raider}: ${who} (${r.reason ?? 'geen'}) ${r.minutes.toFixed(1)} min`,
  );
  if (args.includes('--detail'))
    r.players.forEach((p, i) => {
      console.log(
        `  p${i} ${i === raider ? 'R' : 'D'}: inkomen ${p.income}, piek ${p.peakScrap}, held ${p.heroLevel}, techs ${p.techs}, verloren ${p.lost}, gevangen ${p.captured}, bevrijd ${p.freed}; leger ${fmt(p.militiaByMinute)}; slaven ${fmt(p.slavesByMinute)}; claims ${fmt(p.claimsByMinute)}`,
      );
      if (i === raider)
        console.log(
          `      gebouwd ${JSON.stringify(p.built)} units ${JSON.stringify(p.robots)} techs ${Object.keys(p.techAt).join(',')}`,
        );
    });
}
// creep camps (sim 0.20.0): who clears how many, and when
const camps = rows.flatMap(({ raider, r }) =>
  r.camps
    .filter((c) => c.clearedBy !== null)
    .map((c) => ({ tier: c.tier, raiders: c.clearedBy === raider, minute: c.minute! })),
);
const median = (xs: number[]): string =>
  xs.length === 0 ? '-' : [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!.toFixed(1);
for (const side of [true, false]) {
  const mine = camps.filter((c) => c.raiders === side);
  console.log(
    `kampen door de ${side ? 'Raiders' : 'Dwellers'}: ${mine.length} in ${rows.length} potjes (tier 1 ${mine.filter((c) => c.tier === 1).length}, tier 2 ${mine.filter((c) => c.tier === 2).length}); mediaan minuut ${median(mine.map((c) => c.minute))}`,
  );
}
const s = raiderSummary(rows);
for (const line of formatRaiderSummary(s)) console.log(line);
console.log(`[${((Date.now() - t0) / 1000).toFixed(1)} s]`);

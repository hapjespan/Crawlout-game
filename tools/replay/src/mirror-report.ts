// Spiegelrapport: waar breekt de spiegel tussen twee AI's op Rustbelt XL? Gebruik:
//   node --import tsx src/mirror-report.ts [--rng] [--full] [--minutes N] [--faction raiders] [seed]
// Zonder --rng gaat het toeval eruit (geen golf-jitter, geen kritieke schoten); --full speelt door na de breuk en
// toont de economie per minuut. Zie mirror.ts.
import { mirrorRun, mirrorSwap } from './mirror.js';

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(name);
const opt = (name: string): number | undefined => {
  const k = args.indexOf(name);
  return k >= 0 ? Number(args[k + 1]) : undefined;
};
const faction = args.includes('--faction') ? args[args.indexOf('--faction') + 1]! : 'dwellers';
const seed = Number(
  args.filter(
    (a, k) => !a.startsWith('--') && args[k - 1] !== '--minutes' && args[k - 1] !== '--faction',
  )[0] ?? 1,
);
const minutes = opt('--minutes') ?? (flag('--full') ? 40 : 20);

const t0 = Date.now();
const swapAt = args.indexOf('--swap');
if (swapAt >= 0) {
  const sa = Number(args[swapAt + 1]);
  const sb = Number(args[swapAt + 2]);
  const r = mirrorSwap(sa, sb, minutes * 1200, 30, faction);
  console.log(
    `verwisselproef seeds ${sa} en ${sb}: ${r.breakFrame === null ? 'geen breuk' : `breekt in frame ${r.breakFrame}`}; winnaars ${r.winners.join(' en ')} in frame ${r.frames.join(' en ')}  [${((Date.now() - t0) / 1000).toFixed(1)} s]`,
  );
  for (const d of r.diffs) console.log(`  ${d}`);
  process.exit(0);
}
const r = mirrorRun(seed, {
  neutral: !flag('--rng'),
  full: flag('--full'),
  maxFrames: minutes * 1200,
  maxDiffs: 30,
  faction,
});
const at = (f: number): string =>
  `${Math.floor(f / 1200)}:${String(Math.floor((f % 1200) / 20)).padStart(2, '0')}`;
console.log(
  `seed ${seed}${flag('--rng') ? '' : ' (zonder toeval)'}: ${r.breakFrame === null ? 'geen spiegelbreuk' : `spiegel breekt in frame ${r.breakFrame} (${at(r.breakFrame)})`}  [${((Date.now() - t0) / 1000).toFixed(1)} s]`,
);
for (const d of r.diffs) console.log(`  ${d}`);
const n = Math.max(r.buildOrder[0].length, r.buildOrder[1].length);
const rows: string[] = [];
for (let k = 0; k < Math.min(n, 16); k++)
  rows.push(`  #${k + 1}: p0 ${r.buildOrder[0][k] ?? '-'}  p1 ${r.buildOrder[1][k] ?? '-'}`);
console.log('eerste gebouwen (frame:type):');
console.log(rows.join('\n'));
if (flag('--full')) {
  console.log(`winnaar ${r.winner ?? '-'} in frame ${r.frame} (${at(r.frame)})`);
  const e = r.economy;
  for (let m = 0; m < e.scrap.length; m++)
    console.log(
      `  min ${String(m + 1).padStart(2)}: inkomen ${e.income[m]!.join('/')}  bank ${e.scrap[m]!.join('/')}  units ${e.units[m]!.join('/')}  gebouwen ${e.buildings[m]!.join('/')}  claims ${e.claims[m]!.join('/')}`,
    );
}

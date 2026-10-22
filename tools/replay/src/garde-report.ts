// Garde balance measurement: the Garde AI against the Raiders and the Dwellers, every seed on both sides.
// Usage: node --import tsx src/garde-report.ts [seed ...]   (default seeds 1 to 12)
// The target bands (Garde win share, Garde vs Raiders 55-70 percent, vs Dwellers 35-50) are report-only since phase3-final
// (Martien: "Marge verruimen + mensen-test"): the report flags them, no test blocks on them; garde-smoke.test.ts only
// asserts that every match has a winner within 45 minutes.
import { playMatchesParallel } from './fairness.js';

const BANDS: Record<string, readonly [number, number]> = { raiders: [55, 70], dwellers: [35, 50] };

const seeds = process.argv.slice(2).map(Number);
const list = seeds.length > 0 ? seeds : Array.from({ length: 12 }, (_, i) => i + 1);
for (const foe of ['raiders', 'dwellers']) {
  const [a, b] = await Promise.all([
    playMatchesParallel(list, 4, ['garde', foe]),
    playMatchesParallel(list, 4, [foe, 'garde']),
  ]);
  const wins = a.filter((r) => r.winner === 0).length + b.filter((r) => r.winner === 1).length;
  const all = [...a, ...b];
  const mins = all.map((r) => r.minutes);
  const early = all.filter((r) => r.minutes < 15).length;
  const pct = Math.round((100 * wins) / all.length);
  const [lo, hi] = BANDS[foe]!;
  const band = `target ${lo}-${hi}%: ${pct >= lo && pct <= hi ? 'in band' : 'outside (report-only)'}`;
  console.log(`garde v ${foe}, ${band}`);
  console.log(
    `garde v ${foe}: ${wins}/${all.length} (${Math.round((100 * wins) / all.length)}%), ${Math.min(...mins).toFixed(1)}-${Math.max(...mins).toFixed(1)} min, ${early} before min 15, none ${all.filter((r) => r.winner === null).length}`,
  );
}

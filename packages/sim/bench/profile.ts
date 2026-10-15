// Profiel van de benchmark (pnpm bench -- --profile [--xl | --ai] [--runs N]): tijd per systeemstap per tick, via de
// TickProbe van Sim.tick (die roept na elke stap een callback aan; de klok zit hier, buiten de sim). Elke run is
// deterministisch dezelfde, dus per tick en per stap telt het minimum over de runs: dat filtert ruis van andere processen
// en GC weg en laat de ticks staan die echt duur zijn. Rapport: de duurste ticks met hun verdeling over de stappen, en per
// stap het totaal en het maximum.
import { TICK_STAGES } from '../src/index.js';
import type { TickProbe } from '../src/index.js';

export interface BenchHooks {
  /** Probe voor de tick van frame f (of undefined: geen meting). */
  probe?: (f: number) => TickProbe | undefined;
  /** Na elke tick: frame en duur in ms. */
  onTick?: (f: number, dt: number) => void;
}

const S = TICK_STAGES.length;

/** Meet `runs` keer `run` met een probe per tick; per (tick, stap) het minimum over de runs, in ms. */
export function profile(
  clock: () => number,
  ticks: number,
  runs: number,
  run: (hooks: BenchHooks) => void,
): Float64Array {
  const best = new Float64Array(ticks * S).fill(Infinity);
  const cur = new Float64Array(S);
  for (let r = 0; r < runs; r++) {
    let t = 0;
    let frame = 0;
    const probe: TickProbe = (stage) => {
      const n = clock();
      cur[stage] = n - t;
      t = n;
      if (stage === S - 1)
        for (let k = 0; k < S; k++) {
          const at = frame * S + k;
          if (cur[k]! < best[at]!) best[at] = cur[k]!;
        }
    };
    run({
      probe: (f) => {
        frame = f;
        t = clock();
        return probe;
      },
    });
  }
  return best;
}

export function reportProfile(label: string, best: Float64Array, top = 12): void {
  const ticks = best.length / S;
  const totals: { f: number; ms: number }[] = [];
  const stageSum = new Float64Array(S);
  const stageMax = new Float64Array(S);
  const stageMaxAt = new Int32Array(S);
  for (let f = 1; f < ticks; f++) {
    let ms = 0;
    for (let k = 0; k < S; k++) {
      const v = best[f * S + k]!;
      ms += v;
      stageSum[k] = stageSum[k]! + v;
      if (v > stageMax[k]!) {
        stageMax[k] = v;
        stageMaxAt[k] = f;
      }
    }
    totals.push({ f, ms });
  }
  const avg = totals.reduce((a, b) => a + b.ms, 0) / totals.length;
  totals.sort((a, b) => b.ms - a.ms || a.f - b.f);
  console.log(
    `${label}: ${ticks} ticks, gemiddeld ${avg.toFixed(3)} ms, max ${totals[0]!.ms.toFixed(2)} ms in tick ${totals[0]!.f} (minimum over de runs, zonder tick 0)`,
  );
  for (const { f, ms } of totals.slice(0, top)) {
    const parts: string[] = [];
    for (let k = 0; k < S; k++) {
      const v = best[f * S + k]!;
      if (v >= 0.05) parts.push(`${TICK_STAGES[k]} ${v.toFixed(2)}`);
    }
    console.log(`  tick ${f}: ${ms.toFixed(2)} ms  (${parts.join(', ')})`);
  }
  console.log(
    `  per stap (totaal / max @tick): ` +
      TICK_STAGES.map(
        (n, k) => `${n} ${stageSum[k]!.toFixed(0)}/${stageMax[k]!.toFixed(2)}@${stageMaxAt[k]}`,
      ).join(', '),
  );
}

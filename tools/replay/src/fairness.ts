import { execFile } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { MatchResult } from './balance.js';

// Eerlijkheidsmeting (fair-ronde): veel AI-tegen-AI-potjes op Rustbelt XL tegelijk, elk deel in een eigen Node-proces
// (src/fairness-report.ts --json), zodat de 33 potjes van match-length.test.ts in ongeveer een halve minuut klaar zijn in
// plaats van twee. De sim is in elk proces dezelfde; een potje is een pure functie van seed, data en map.

const REPLAY_DIR = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = fileURLToPath(new URL('./fairness-report.ts', import.meta.url));

/** Speelt de potjes van `seeds` in hoogstens `procs` processen; de uitkomst in de volgorde van `seeds`. */
export async function playMatchesParallel(
  seeds: readonly number[],
  procs = Math.max(1, Math.min(8, availableParallelism() - 1)),
  factions?: readonly string[],
): Promise<MatchResult[]> {
  const parts: number[][] = Array.from({ length: Math.min(procs, seeds.length) }, () => []);
  seeds.forEach((s, k) => parts[k % parts.length]!.push(s));
  const runs = parts.map(
    (part) =>
      new Promise<MatchResult[]>((resolve, reject) => {
        execFile(
          process.execPath,
          [
            '--import',
            'tsx',
            SCRIPT,
            '--json',
            ...(factions === undefined ? [] : ['--factions', factions.join(',')]),
            ...part.map(String),
          ],
          { cwd: REPLAY_DIR, maxBuffer: 64 * 1024 * 1024 },
          (err, stdout) => {
            if (err !== null) {
              reject(err);
              return;
            }
            resolve(
              stdout
                .split('\n')
                .filter((l) => l.startsWith('{'))
                .map((l) => JSON.parse(l) as MatchResult),
            );
          },
        );
      }),
  );
  const all = (await Promise.all(runs)).flat();
  return seeds.map((s) => {
    const r = all.find((x) => x.seed === s);
    if (r === undefined) throw new Error(`fairness: geen uitkomst voor seed ${s}`);
    return r;
  });
}

export interface FairnessSummary {
  wins: [number, number];
  reasons: { destruction: number; dominance: number; surrender: number; none: number };
  minMinutes: number;
  maxMinutes: number;
  /** Potjes die tussen 25 en 35 minuten eindigen. */
  inWindow: number;
}

export function summarize(results: readonly MatchResult[]): FairnessSummary {
  const s: FairnessSummary = {
    wins: [0, 0],
    reasons: { destruction: 0, dominance: 0, surrender: 0, none: 0 },
    minMinutes: Infinity,
    maxMinutes: 0,
    inWindow: 0,
  };
  for (const r of results) {
    if (r.winner === 0 || r.winner === 1) s.wins[r.winner]++;
    s.reasons[r.reason ?? 'none']++;
    s.minMinutes = Math.min(s.minMinutes, r.minutes);
    s.maxMinutes = Math.max(s.maxMinutes, r.minutes);
    if (r.minutes >= 25 && r.minutes < 35) s.inWindow++;
  }
  return s;
}

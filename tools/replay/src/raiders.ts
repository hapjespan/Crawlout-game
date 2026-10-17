import type { MatchResult } from './balance.js';

// Summary of Raiders-against-Dwellers matches (sim 0.18.0; minute buckets, captures and liberations data 0.24.0): used
// by raiders-report.ts and raiders-balance.test.ts.

/** The minute buckets of the report: [from, to) in minutes. */
export const MINUTE_BUCKETS: readonly (readonly [number, number])[] = [
  [0, 15],
  [15, 22],
  [22, 30],
  [30, 38],
  [38, 60],
];

export interface BucketCount {
  from: number;
  to: number;
  matches: number;
  raiders: { destruction: number; dominance: number };
  dwellers: { destruction: number; dominance: number };
}

export interface RaiderSummary {
  matches: number;
  raiderWins: number;
  dwellerWins: number;
  none: number;
  /** Raider wins with the Raiders as player 0 and as player 1 (the side check). */
  raiderWinsAs: [number, number];
  reasons: { destruction: number; dominance: number; surrender: number; none: number };
  /** Decided before minute 12, and of those won by the Raiders. */
  early: number;
  earlyRaiders: number;
  /** Ended between 25 and 40 minutes, and the wins of each faction among them. */
  inWindow: number;
  windowRaiders: number;
  windowDwellers: number;
  /** Ended between 22 and 38 minutes (the target window of data 0.24.0). */
  inTarget: number;
  /** A destruction before minute 15. */
  destructionBefore15: number;
  /** Decided before minute 22, and of those won by the Raiders. */
  before22: number;
  before22Raiders: number;
  /** Decided at or after minute 30, and of those won by the Dwellers. */
  after30: number;
  after30Dwellers: number;
  /** Per minute bucket: wins by faction and route. */
  buckets: BucketCount[];
  /** Units the Raiders caught, and slaves or captives freed back to the Dwellers, over all matches. */
  captured: number;
  freed: number;
  /** Mean match length of the Raider and of the Dweller wins in minutes (0 without). */
  meanRaiderWin: number;
  meanDwellerWin: number;
  minMinutes: number;
  maxMinutes: number;
}

/** `raider` is the playerId of the Raiders in each match. */
export function raiderSummary(rows: readonly { raider: number; r: MatchResult }[]): RaiderSummary {
  const s: RaiderSummary = {
    matches: rows.length,
    raiderWins: 0,
    dwellerWins: 0,
    none: 0,
    raiderWinsAs: [0, 0],
    reasons: { destruction: 0, dominance: 0, surrender: 0, none: 0 },
    early: 0,
    earlyRaiders: 0,
    inWindow: 0,
    windowRaiders: 0,
    windowDwellers: 0,
    inTarget: 0,
    destructionBefore15: 0,
    before22: 0,
    before22Raiders: 0,
    after30: 0,
    after30Dwellers: 0,
    buckets: MINUTE_BUCKETS.map(([from, to]) => ({
      from,
      to,
      matches: 0,
      raiders: { destruction: 0, dominance: 0 },
      dwellers: { destruction: 0, dominance: 0 },
    })),
    captured: 0,
    freed: 0,
    meanRaiderWin: 0,
    meanDwellerWin: 0,
    minMinutes: Infinity,
    maxMinutes: 0,
  };
  let raiderMinutes = 0;
  let dwellerMinutes = 0;
  for (const { raider, r } of rows) {
    const raiders = r.winner === raider;
    if (r.winner === null) s.none++;
    else if (raiders) {
      s.raiderWins++;
      s.raiderWinsAs[raider === 0 ? 0 : 1]++;
      raiderMinutes += r.minutes;
    } else {
      s.dwellerWins++;
      dwellerMinutes += r.minutes;
    }
    s.reasons[r.reason ?? 'none']++;
    s.minMinutes = Math.min(s.minMinutes, r.minutes);
    s.maxMinutes = Math.max(s.maxMinutes, r.minutes);
    s.captured += r.players[raider]?.captured ?? 0;
    s.freed += r.players[1 - raider]?.freed ?? 0;
    if (r.winner !== null && r.minutes < 12) {
      s.early++;
      if (raiders) s.earlyRaiders++;
    }
    if (r.minutes >= 25 && r.minutes < 40) {
      s.inWindow++;
      if (r.winner !== null) {
        if (raiders) s.windowRaiders++;
        else s.windowDwellers++;
      }
    }
    if (r.minutes >= 22 && r.minutes < 38) s.inTarget++;
    if (r.reason === 'destruction' && r.minutes < 15) s.destructionBefore15++;
    if (r.winner !== null && r.minutes < 22) {
      s.before22++;
      if (raiders) s.before22Raiders++;
    }
    if (r.winner !== null && r.minutes >= 30) {
      s.after30++;
      if (!raiders) s.after30Dwellers++;
    }
    const b = s.buckets.find((x) => r.minutes >= x.from && r.minutes < x.to);
    if (b !== undefined && r.winner !== null) {
      b.matches++;
      const side = raiders ? b.raiders : b.dwellers;
      if (r.reason === 'destruction') side.destruction++;
      else if (r.reason === 'dominance') side.dominance++;
    }
  }
  s.meanRaiderWin = s.raiderWins > 0 ? raiderMinutes / s.raiderWins : 0;
  s.meanDwellerWin = s.dwellerWins > 0 ? dwellerMinutes / s.dwellerWins : 0;
  return s;
}

/** The summary as report lines (Dutch, like the other reports of tools/replay). */
export function formatRaiderSummary(s: RaiderSummary): string[] {
  const pct = (n: number, of: number): string => `${of > 0 ? Math.round((100 * n) / of) : 0}%`;
  const lines = [
    `Raiders winnen ${s.raiderWins} van ${s.matches} (${pct(s.raiderWins, s.matches)}; als speler 0 ${s.raiderWinsAs[0]}, als speler 1 ${s.raiderWinsAs[1]}), Dwellers ${s.dwellerWins}, geen winnaar ${s.none}; vernietiging ${s.reasons.destruction}, dominantie ${s.reasons.dominance}`,
    `lengte ${s.minMinutes.toFixed(1)} tot ${s.maxMinutes.toFixed(1)} min, ${s.inTarget} van ${s.matches} tussen 22 en 38; gemiddelde winst Raiders ${s.meanRaiderWin.toFixed(1)} min, Dwellers ${s.meanDwellerWin.toFixed(1)} min`,
    `vernietiging voor minuut 15: ${s.destructionBefore15}; voor minuut 22 beslist ${s.before22} (Raiders ${s.before22Raiders}); vanaf minuut 30 beslist ${s.after30} (Dwellers ${s.after30Dwellers})`,
    `gevangen door de Raiders ${s.captured}, bevrijd ${s.freed}`,
    'minuten   potjes  Raiders vern/dom  Dwellers vern/dom',
  ];
  for (const b of s.buckets)
    lines.push(
      `${String(b.from).padStart(2)}-${String(b.to).padEnd(2)}     ${String(b.matches).padStart(3)}      ${String(b.raiders.destruction).padStart(3)} / ${String(b.raiders.dominance).padEnd(3)}        ${String(b.dwellers.destruction).padStart(3)} / ${b.dwellers.dominance}`,
    );
  return lines;
}

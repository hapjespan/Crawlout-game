import type { MatchResult } from './balance.js';

// Summary of Raiders-against-Dwellers matches (sim 0.18.0): used by raiders-report.ts and raiders-balance.test.ts.

export interface RaiderSummary {
  matches: number;
  raiderWins: number;
  dwellerWins: number;
  none: number;
  reasons: { destruction: number; dominance: number; surrender: number; none: number };
  /** Decided before minute 12, and of those won by the Raiders. */
  early: number;
  earlyRaiders: number;
  /** Ended between 25 and 40 minutes, and the wins of each faction among them. */
  inWindow: number;
  windowRaiders: number;
  windowDwellers: number;
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
    reasons: { destruction: 0, dominance: 0, surrender: 0, none: 0 },
    early: 0,
    earlyRaiders: 0,
    inWindow: 0,
    windowRaiders: 0,
    windowDwellers: 0,
    minMinutes: Infinity,
    maxMinutes: 0,
  };
  for (const { raider, r } of rows) {
    const raiders = r.winner === raider;
    if (r.winner === null) s.none++;
    else if (raiders) s.raiderWins++;
    else s.dwellerWins++;
    s.reasons[r.reason ?? 'none']++;
    s.minMinutes = Math.min(s.minMinutes, r.minutes);
    s.maxMinutes = Math.max(s.maxMinutes, r.minutes);
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
  }
  return s;
}

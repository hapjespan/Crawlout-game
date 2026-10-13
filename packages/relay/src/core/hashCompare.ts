import type { DesyncEvent, HashReport } from '@crawlout/protocol';

/** Verzamelt hash-meldingen per frame en vergelijkt zodra alle verwachte spelers gemeld hebben. */
export class HashComparator {
  private readonly frames = new Map<number, Map<number, number>>();

  /** Geeft een DesyncEvent bij afwijking, anders null. `expected` = spelers waarvan een melding nodig is. */
  report(r: HashReport, expected: readonly number[]): DesyncEvent | null {
    let m = this.frames.get(r.frame);
    if (!m) this.frames.set(r.frame, (m = new Map()));
    m.set(r.playerId, r.hash);
    return this.check(r.frame, expected);
  }

  /** Opnieuw controleren, bijvoorbeeld nadat een speler wegviel en `expected` kleiner werd. */
  recheck(expected: readonly number[]): DesyncEvent | null {
    for (const frame of [...this.frames.keys()].sort((a, b) => a - b)) {
      const ev = this.check(frame, expected);
      if (ev) return ev;
    }
    return null;
  }

  private check(frame: number, expected: readonly number[]): DesyncEvent | null {
    const m = this.frames.get(frame);
    if (!m || expected.length === 0 || !expected.every((id) => m.has(id))) return null;
    this.frames.delete(frame);
    const hashes: Record<string, number> = {};
    for (const id of [...m.keys()].sort((a, b) => a - b)) hashes[String(id)] = m.get(id) as number;
    const values = expected.map((id) => m.get(id));
    return values.every((v) => v === values[0]) ? null : { frame, hashes };
  }
}

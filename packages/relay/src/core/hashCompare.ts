import type { DesyncEvent, HashReport } from '@crawlout/protocol';

/** Per frame: welke spelers moeten melden. Een terugkerende speler hoeft niet voor frames van voor zijn resync. */
export type ExpectedFor = (frame: number) => readonly number[];

/** Meer openstaande frames dan dit: de oudste vallen af (een speler die nooit meldt mag het geheugen niet laten groeien). */
const MAX_PENDING_FRAMES = 16;

interface Slot {
  since: number;
  hashes: Map<number, number>;
}

/** Verzamelt hash-meldingen per frame en vergelijkt zodra alle verwachte spelers gemeld hebben. */
export class HashComparator {
  private readonly frames = new Map<number, Slot>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Geeft een DesyncEvent bij afwijking, anders null. */
  report(r: HashReport, expected: ExpectedFor): DesyncEvent | null {
    let slot = this.frames.get(r.frame);
    if (!slot) {
      this.frames.set(r.frame, (slot = { since: this.now(), hashes: new Map() }));
      while (this.frames.size > MAX_PENDING_FRAMES) {
        const oldest = Math.min(...this.frames.keys());
        this.frames.delete(oldest);
      }
    }
    slot.hashes.set(r.playerId, r.hash);
    return this.check(r.frame, expected);
  }

  /** Opnieuw controleren, bijvoorbeeld nadat een speler wegviel en `expected` kleiner werd. */
  recheck(expected: ExpectedFor): DesyncEvent | null {
    for (const frame of [...this.frames.keys()].sort((a, b) => a - b)) {
      const ev = this.check(frame, expected);
      if (ev) return ev;
    }
    return null;
  }

  /** Het oudste frame waarvoor nog hashes ontbreken: sinds wanneer, en van wie. */
  oldestPending(expected: ExpectedFor): { frame: number; since: number; missing: number[] } | null {
    for (const frame of [...this.frames.keys()].sort((a, b) => a - b)) {
      const slot = this.frames.get(frame) as Slot;
      const missing = expected(frame).filter((id) => !slot.hashes.has(id));
      if (missing.length > 0) return { frame, since: slot.since, missing };
    }
    return null;
  }

  private check(frame: number, expected: ExpectedFor): DesyncEvent | null {
    const slot = this.frames.get(frame);
    const need = expected(frame);
    if (!slot || need.length === 0 || !need.every((id) => slot.hashes.has(id))) return null;
    this.frames.delete(frame);
    const hashes: Record<string, number> = {};
    for (const id of [...slot.hashes.keys()].sort((a, b) => a - b))
      hashes[String(id)] = slot.hashes.get(id) as number;
    const values = need.map((id) => slot.hashes.get(id));
    return values.every((v) => v === values[0]) ? null : { frame, hashes };
  }
}

import { DELAY_FRAMES_MAX, DELAY_FRAMES_MIN } from '@crawlout/protocol';

/** Aantal frames tussen twee beoordelingen van de DELAY (een halve seconde bij 20 Hz). */
export const DELAY_EVAL_INTERVAL_FRAMES = 10;
/** Zoveel opeenvolgende beoordelingen moet een lagere DELAY volstaan voor we hem met 1 verlagen. */
const LOWER_AFTER_EVALS = 3;
const EMA_ALPHA = 0.25;
/** Marge bovenop de gemeten vertraging, in frames. */
const MARGIN_FRAMES = 1;

/**
 * Adaptieve DELAY uit gemeten vertraging, zonder extra berichten.
 *
 * Meting: de relay vergelijkt het frame waarmee een client een bericht stuurt met het frame dat de relay dan
 * uitgeeft. Voor een commando is dat `next - envelope.frame`, voor een hashmelding van frame f `next - (f + 1)`.
 * Dat verschil is neerwaartse vertraging plus opwaartse vertraging plus de wachttijd van de client, dus een
 * round-trip in frames. Een commando dat de client op frame f geeft, moet uiterlijk op frame f + DELAY bij de relay
 * zijn om op tijd in een bundel te komen; DELAY >= round-trip is dus precies wat nodig is.
 *
 * De vertraging van de langzaamste speler bepaalt de DELAY (lockstep kan niet sneller dan de traagste).
 * Omhoog gaat direct, omlaag langzaam (hysterese), zodat jitter geen heen-en-weer geeft.
 */
export class DelayController {
  private readonly ema = new Map<number, number>();
  private lowerStreak = 0;

  /** lagFrames: gemeten round-trip in frames voor deze speler (negatieve waarden tellen als 0). */
  sample(playerId: number, lagFrames: number): void {
    const x = Math.min(Math.max(lagFrames, 0), DELAY_FRAMES_MAX * 2);
    const prev = this.ema.get(playerId);
    this.ema.set(playerId, prev === undefined ? x : prev + EMA_ALPHA * (x - prev));
  }

  forget(playerId: number): void {
    this.ema.delete(playerId);
  }

  /** Gemeten (afgevlakte) vertraging van de langzaamste speler in frames, of null zonder metingen. */
  get slowestLag(): number | null {
    let max: number | null = null;
    for (const v of this.ema.values()) if (max === null || v > max) max = v;
    return max;
  }

  /** Beoordeelt de huidige DELAY en geeft de nieuwe terug (binnen MIN..MAX). */
  evaluate(current: number): number {
    const lag = this.slowestLag;
    if (lag === null) return current;
    const target = Math.min(DELAY_FRAMES_MAX, Math.max(DELAY_FRAMES_MIN, Math.ceil(lag) + MARGIN_FRAMES));
    if (target > current) {
      this.lowerStreak = 0;
      return target;
    }
    if (target < current) {
      if (++this.lowerStreak >= LOWER_AFTER_EVALS) {
        this.lowerStreak = 0;
        return current - 1;
      }
      return current;
    }
    this.lowerStreak = 0;
    return current;
  }
}

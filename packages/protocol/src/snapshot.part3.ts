// Split from snapshot.part1.ts to stay under the 5,000-token file limit; snapshot.ts re-exports the public surface.
// Holds: the survival co-op status (PlayerStatus.survival, protocol 0.17.0, besluit fase-0 sectie 24).

/** Rang van een golfeenheid (SurvivalWaveStatus.rank): de hoogste rang van de eenheden in de golf. */
export type SurvivalRank = 'normal' | 'miniboss' | 'boss';

/**
 * Einde van een survival-run (SurvivalStatus.result.outcome): `survived` is een teamwinst (elke speler wint),
 * `overrun` de winst van de horde (elke speler verliest). Geen WinReason: SimWinner noemt één speler en een run eindigt
 * voor het hele team; Sim.winner() blijft null in Survival (besluit sectie 24).
 */
export type SurvivalOutcome = 'survived' | 'overrun';

/** De eerstvolgende golf (SurvivalStatus.next). */
export interface SurvivalWaveStatus {
  /** Golfnummer, 1-based. */
  wave: number;
  /** Simframe waarop de eerste batch spawnt; de aftelling is atFrame min het frame van de status. */
  atFrame: number;
  rank: SurvivalRank;
}

/** Eén gestarte golf (SurvivalStatus.active, index = golf − 1). */
export interface SurvivalActiveWave {
  /** playerId van het doel van de golf (de zwakste speler bij de start), −1 zonder doel. */
  target: number;
  /** Levende eenheden van de golf. */
  alive: number;
}

/**
 * Stand van een survival-run (PlayerStatus.survival, protocol 0.17.0; besluit fase-0 sectie 24): wat de HUD nodig
 * heeft voor het golfpaneel, de aftelling, de boss-waarschuwing en het eindscherm. Gedeelde kennis (dezelfde voor
 * elke speler). De sim levert hem altijd (Sim.status, survival.ts survivalStatusOf; leest alleen state, geen hash);
 * null buiten het speltype Survival.
 */
export interface SurvivalStatus {
  /** Gestarte golven (0 vóór golf 1) en het totaal. */
  wavesStarted: number;
  waves: number;
  /** null na de laatste golf. */
  next: SurvivalWaveStatus | null;
  active: SurvivalActiveWave[];
  /** null zolang de run loopt; frame als SimWinner.frame. */
  result: { outcome: SurvivalOutcome; frame: number } | null;
}

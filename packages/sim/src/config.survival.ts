// Survival co-op (sim 0.27.0, data 0.33.0; voorstel, ter bevestiging door de architect; docs/survival-coop.md): the sim
// side of data/survival/. SimConfig.survival is filled from GameData.survival (always, when the data has it); the game
// type is chosen by the map: SimMap.survival exists only with MatchSettings.mode 'survival' (simMapFromGrid). Without
// SimMap.survival nothing of this is read, hashed or serialized.

/** Rank of a hostile wave unit (index in SURVIVAL_RANKS of packages/data). */
export const RANK_NORMAL = 0;
export const RANK_MINIBOSS = 1;
export const RANK_BOSS = 2;

/** One wave of data/survival/waves.json in sim units. */
export interface SimSurvivalWave {
  readonly atTicks: number;
  /** Unit typeIds and counts for ONE player (before scaling), in file order. */
  readonly spawns: readonly { readonly typeId: number; readonly count: number }[];
  /** Edges the wave uses: from the edge nearest the target's zone, then clockwise. */
  readonly edges: number;
  readonly batches: number;
  readonly batchIntervalTicks: number;
}

/** Survival co-op rules (data/survival). The arrays typeIds, ranks, lootScrap and heroXp are parallel. */
export interface SimSurvival {
  readonly typeIds: readonly number[];
  /** RANK_NORMAL, RANK_MINIBOSS or RANK_BOSS: a miniboss or boss is never scaled in count. */
  readonly ranks: readonly number[];
  /** Scrap for the owner of the killing blow. */
  readonly lootScrap: readonly number[];
  /** Hero xp for the hero of the owner of the killing blow. */
  readonly heroXp: readonly number[];
  readonly playersMin: number;
  readonly playersMax: number;
  /** Per player count 1 to 4 (index players - 1), in permille. */
  readonly scaling: readonly {
    readonly countPermille: number;
    readonly hpPermille: number;
    readonly damagePermille: number;
  }[];
  /** The weakest-player rule: score weights in permille and the bonus for a living hero (scrap). */
  readonly unitScrapPermille: number;
  readonly turretScrapPermille: number;
  readonly heroScrap: number;
  /** Wave number (1-based) whose units must all be dead to win; the last wave. */
  readonly winWave: number;
  readonly requireAllWaveUnitsDead: boolean;
  readonly waves: readonly SimSurvivalWave[];
}

/** The survival geometry of one map (SimMap.survival), resolved from the percentages of the data, in sim units. */
export interface SimSurvivalMap {
  /** Clockwise from north (noord, oost, zuid, west): a walkable cell centre and the spread radius. */
  readonly edges: readonly { readonly x: number; readonly y: number; readonly spread: number }[];
  /** Per slot (= playerId): the centre of the build zone (a walkable cell centre, also spawns[slot]), radius, nearest edge. */
  readonly zones: readonly {
    readonly x: number;
    readonly y: number;
    readonly radius: number;
    readonly nearEdge: number;
  }[];
}

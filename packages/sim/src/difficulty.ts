import type { SimAiScript } from './config.faction.js';
import { DIFFICULTY_COUNT, type SimConfig, type SimEnv } from './config.env.js';
import { idiv } from './math/int.js';
import type { Rng } from './rng.js';

/**
 * Moeilijkheidsgraad (sim 0.37.0, data 0.45.0, protocol 0.21.0; voorstel, ter bevestiging door de architect; besluit
 * fase-0 sectie 26).
 *
 * Eén getal stuurt alles: de vermenigvuldiger op de reactietijd van de scripted AI, in promille. hard ligt op 750
 * (reageert sneller), normal op 1000, easy op 1500 (reageert trager). Binnen de band van het gekozen niveau trekt de sim
 * hem één keer in start(), vóór frame 0, uit sim.rng — nooit uit Math.random of Date. Elke client rekent dus dezelfde
 * tegenstander uit seed plus settings; de trekking staat daarna in de state (serialize), zodat een resync hem meeneemt.
 *
 * Units lopen en vechten niet sneller. Alleen het script schuift, in drie groepen:
 *   1. de klok: attackTimersTicks, waveIntervalTicks, researchFromTicks, claimFromTicks, buildOrder[].atTick,
 *      pushFromTicks — maal m (groter m = later);
 *   2. de legergroottes: waveMinArmy, pushMinArmy — maal m (een trage AI wacht op een groter leger);
 *   3. de economie: scavengersPerNode, builders — gedeeld door m (een snelle AI vordert sneller).
 * Alles daarbuiten (raidPlan, creeps, project, robots, reserve, training, radii) blijft staan zoals het in data/ai staat.
 */

/** Of dit niveau geldig is voor deze config (data zonder `difficulty`-blok kent geen niveaus). */
export const difficultyOn = (env: Pick<SimEnv, 'config' | 'difficulty'>): boolean =>
  env.difficulty !== undefined && env.config.difficulty !== undefined;

/** De band van een niveau, of null als de config hem niet kent. */
export function difficultyBand(
  config: SimConfig,
  level: number,
): { readonly lo: number; readonly hi: number } | null {
  const d = config.difficulty;
  if (d === undefined || !Number.isInteger(level) || level < 0 || level >= DIFFICULTY_COUNT)
    return null;
  const l = d.levels[level];
  if (l === undefined) return null;
  const half = idiv(l.reactionPermille * l.spreadPermille, 1000);
  return { lo: l.reactionPermille - half, hi: l.reactionPermille + half };
}

/**
 * De trekking van dit potje, in promille. Precies één rng-trekking; buiten een geldig niveau is de uitkomst 0 en raakt
 * de rng niets (de scripts blijven dan ongewijzigd, zoals in elk bestaand potje).
 */
export function rollDifficulty(env: Pick<SimEnv, 'config' | 'difficulty'>, rng: Rng): number {
  if (!difficultyOn(env)) return 0;
  const band = difficultyBand(env.config, env.difficulty!);
  if (band === null) return 0;
  return band.lo + rng.nextInt(band.hi - band.lo + 1);
}

/** Het niveau van deze env in de state zetten (afgeleid; de constructor van de sim doet dit één keer). */
export function initDifficulty(env: SimEnv, state: DifficultyState): void {
  state.active = difficultyOn(env);
  state.level = state.active ? env.difficulty! : -1;
}

/** De trekking van start(): precies één rng-stap met een niveau, geen enkele zonder. Geeft de scripts van dit potje. */
export function startDifficulty(
  config: SimConfig,
  state: DifficultyState,
  rng: Rng,
): readonly SimAiScript[] {
  if (state.active)
    state.roll[0] = rollDifficulty({ config, difficulty: state.level }, rng);
  return scriptsOf(config, state);
}

/** De scripten die bij de (getrokken of geladen) stand horen. Afgeleid, nooit state. */
export const scriptsOf = (config: SimConfig, state: DifficultyState): readonly SimAiScript[] =>
  state.active ? scaleAiScripts(config, state.roll[0]!) : config.aiScripts;

/** v maal m/1000, afgerond op het dichtstbijzijnde gehele getal (v en m zijn niet-negatieve integers). */
const slower = (v: number, m: number): number => idiv(v * m + 500, 1000);
/** v gedeeld door m/1000, afgerond; ten minste `min`. */
const faster = (v: number, m: number, min: number): number => {
  const r = idiv(v * 1000 + idiv(m, 2), m);
  return r < min ? min : r;
};
/** Een legergrootte maal m/1000, ten minste `min`. */
const army = (v: number, m: number, min: number): number => {
  const r = slower(v, m);
  return r < min ? min : r;
};

/**
 * De AI-scripts van deze config met de getrokken vermenigvuldiger erop. `permille` 0 (geen niveau) geeft de scripts zelf
 * terug, zonder kopie: een potje zonder moeilijkheidsgraad rekent exact zoals voorheen.
 */
export function scaleAiScripts(
  config: SimConfig,
  permille: number,
): readonly SimAiScript[] {
  const d = config.difficulty;
  if (permille <= 0 || d === undefined) return config.aiScripts;
  return config.aiScripts.map((s) => ({
    ...s,
    buildOrder: s.buildOrder.map((o) => ({ ...o, atTick: slower(o.atTick, permille) })),
    attackTimersTicks: s.attackTimersTicks.map((t) => slower(t, permille)),
    researchFromTicks: slower(s.researchFromTicks, permille),
    claimFromTicks: slower(s.claimFromTicks, permille),
    waveIntervalTicks: slower(s.waveIntervalTicks, permille),
    pushFromTicks: slower(s.pushFromTicks, permille),
    waveMinArmy: army(s.waveMinArmy, permille, d.minArmy),
    pushMinArmy: army(s.pushMinArmy, permille, d.minArmy),
    scavengersPerNode: faster(s.scavengersPerNode, permille, d.minScavengersPerNode),
    builders: faster(s.builders, permille, d.minBuilders),
  }));
}

/**
 * De trekking als state (sim 0.37.0). Alleen `active` (een env met een niveau) zet hem in de serialisatie en de hash,
 * zodat elke andere state zijn formaat en zijn hash houdt.
 */
export class DifficultyState {
  /** Afgeleid uit de env: een geldig niveau plus een config die niveaus kent. */
  active = false;
  /** DIFFICULTY_* van dit potje, -1 zonder niveau (afgeleid uit de env, niet uit de state). */
  level = -1;
  /** De getrokken vermenigvuldiger in promille; 0 zolang er niet geloot is. */
  readonly roll = new Int32Array(1);
}

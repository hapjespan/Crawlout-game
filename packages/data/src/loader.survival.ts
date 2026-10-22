import type { LoadoutData, RawGameData } from './loader.types.js';
import { neutralLoadout } from './loader.loadouts.js';
import type { LoadContext } from './loader.parse.js';
import { parseWith } from './loader.util.js';
import { degreesToAngle, metersToUnits, pctToPermille, secondsToTicks } from './units.js';
import { SURVIVAL_RANKS, Survival, SurvivalUnits } from './schemas.js';

// Part of the pure loader (see loader.ts): no IO, no clock; falls under the determinism lint.
// Survival co-op (data 0.33.0; voorstel, ter bevestiging door de architect; docs/survival-coop.md). Data only: the sim
// does not read it yet. Map-relative positions stay in percent of the map size (the sim resolves them per map).

/** The accepted raw input of RawGameData.survival: the contents of data/survival/units.json and waves.json. */
export interface RawSurvival {
  units: unknown;
  waves: unknown;
}

export interface SurvivalWaveData {
  wave: number;
  atTicks: number;
  naam: string;
  /** Loadout ids and counts for ONE player (before scaling), in file order. */
  spawns: { unit: number; count: number }[];
  /** How many edges the wave uses, starting at the edge nearest the target's zone, then clockwise. */
  edges: number;
  batches: number;
  batchIntervalTicks: number;
}

export interface SurvivalData {
  /** Loadout ids of the hostile units (after the creep bandits), in the order of units.json; rank is parallel (index in SURVIVAL_RANKS). */
  units: number[];
  names: string[];
  ranks: number[];
  lootScrap: number[];
  heroXp: number[];
  playersMin: number;
  playersMax: number;
  /** Clockwise from north; indices are what waves and zones refer to. */
  edges: { key: string; xPermille: number; yPermille: number; spreadU: number }[];
  /** Per slot 0 to 3. */
  buildZones: {
    slot: number;
    hqXPermille: number;
    hqYPermille: number;
    radiusU: number;
    nearEdge: number;
  }[];
  /**
   * Data 0.34.0: the fixed scrap nodes of every build zone, relative to its centre (distance in sim units, sim angle
   * uint16 with 0 = +x and 16384 = +y), in file order. In Survival they replace the map nodes inside the zones.
   */
  zoneScrap: { distU: number; angle: number; amount: number }[];
  /** Per player count 1 to 4 (index = players - 1), in permille. */
  scaling: { countPermille: number; hpPermille: number; damagePermille: number }[];
  targetRule: {
    unitScrapPermille: number;
    turretScrapPermille: number;
    heroScrap: number;
  };
  /** The wave whose enemies must all be dead to win (the Behemoth wave). */
  winWave: number;
  requireAllWaveUnitsDead: boolean;
  waves: SurvivalWaveData[];
}

/** Last stage: survival (absent = null). Appends the hostile loadouts to `loadouts` after the creep bandits. */
export function convertSurvival(
  ctx: LoadContext,
  raw: RawGameData,
  loadouts: LoadoutData[],
): SurvivalData | null {
  if (raw.survival === undefined) return null;
  const { loadoutIx, simRaw } = ctx;
  const unitsRaw = parseWith('survival/units.json', SurvivalUnits, raw.survival.units);
  const s = parseWith('survival/waves.json', Survival, raw.survival.waves);
  const where = 'data/survival';
  const base = loadouts.length;
  const unitIx = new Map<string, number>();
  unitsRaw.units.forEach((u, k) => {
    if (loadoutIx.has(u.id) || loadouts.some((l) => l.key === u.id) || unitIx.has(u.id))
      throw new Error(`${where}/units.json: dubbele id '${u.id}'`);
    unitIx.set(u.id, base + k);
  });
  for (const u of unitsRaw.units) loadouts.push(neutralLoadout(u, unitIx.get(u.id)!, simRaw));

  const edgeIx = new Map<string, number>();
  s.edges.forEach((e, k) => {
    if (edgeIx.has(e.id)) throw new Error(`${where}/waves.json: dubbele rand '${e.id}'`);
    edgeIx.set(e.id, k);
  });
  s.buildZones.forEach((z, k) => {
    if (z.slot !== k)
      throw new Error(`${where}/waves.json buildZones: slot ${k} verwacht, ${z.slot} gevonden`);
    if (!edgeIx.has(z.nearEdge))
      throw new Error(`${where}/waves.json buildZones[${k}]: onbekende rand '${z.nearEdge}'`);
  });
  const minRadius = Math.min(...s.buildZones.map((z) => z.radiusM));
  s.zoneScrap.nodes.forEach((n, k) => {
    if (n.distM >= minRadius)
      throw new Error(
        `${where}/waves.json zoneScrap.nodes[${k}]: distM ${n.distM} ligt niet binnen de zone (${minRadius} m)`,
      );
  });
  s.scaling.forEach((c, k) => {
    if (c.players !== k + 1)
      throw new Error(
        `${where}/waves.json scaling: spelers ${k + 1} verwacht, ${c.players} gevonden`,
      );
  });
  if (s.players.min > s.players.max) throw new Error(`${where}/waves.json players: min boven max`);

  let prevAt = -1;
  const waves = s.waves.map((w, k): SurvivalWaveData => {
    const at = `${where}/waves.json wave ${w.wave}`;
    if (w.wave !== k + 1)
      throw new Error(`${where}/waves.json: golf ${k + 1} verwacht, ${w.wave} gevonden`);
    if (w.atS <= prevAt) throw new Error(`${at}: atS moet oplopen`);
    prevAt = w.atS;
    return {
      wave: w.wave,
      atTicks: secondsToTicks(w.atS),
      naam: w.naam,
      spawns: w.spawns.map((e) => {
        const unit = unitIx.get(e.unit);
        if (unit === undefined) throw new Error(`${at}: onbekende vijand '${e.unit}'`);
        return { unit, count: e.count };
      }),
      edges: w.edges,
      batches: w.batches,
      batchIntervalTicks: secondsToTicks(w.batchIntervalS),
    };
  });
  if (s.win.surviveWave !== waves.length)
    throw new Error(
      `${where}/waves.json win: surviveWave ${s.win.surviveWave} is niet de laatste golf ${waves.length}`,
    );
  const rankOf = (key: string): string => unitsRaw.units.find((u) => u.id === key)!.rank;
  const hasRank = (waveNr: number, rank: string): boolean =>
    s.waves[waveNr - 1]!.spawns.some((e) => rankOf(e.unit) === rank);
  if (!hasRank(waves.length, 'boss'))
    throw new Error(`${where}/waves.json: de laatste golf bevat geen boss`);
  const mini = s.waves.filter((w) => w.spawns.some((e) => rankOf(e.unit) === 'miniboss'));
  if (mini.length !== 1)
    throw new Error(`${where}/waves.json: precies een golf met een miniboss verwacht`);
  const lastAtS = s.waves[s.waves.length - 1]!.atS;
  if (lastAtS < 1200 || lastAtS > 2100)
    throw new Error(
      `${where}/waves.json: de laatste golf start op ${lastAtS} s, buiten 1200 tot 2100 s`,
    );

  return {
    units: unitsRaw.units.map((u) => unitIx.get(u.id)!),
    names: unitsRaw.units.map((u) => u.naam),
    ranks: unitsRaw.units.map((u) => SURVIVAL_RANKS.indexOf(u.rank)),
    lootScrap: unitsRaw.units.map((u) => u.lootScrap),
    heroXp: unitsRaw.units.map((u) => u.heroXp),
    playersMin: s.players.min,
    playersMax: s.players.max,
    edges: s.edges.map((e) => ({
      key: e.id,
      xPermille: pctToPermille(e.xPct),
      yPermille: pctToPermille(e.yPct),
      spreadU: metersToUnits(e.spreadM),
    })),
    buildZones: s.buildZones.map((z) => ({
      slot: z.slot,
      hqXPermille: pctToPermille(z.hqXPct),
      hqYPermille: pctToPermille(z.hqYPct),
      radiusU: metersToUnits(z.radiusM),
      nearEdge: edgeIx.get(z.nearEdge)!,
    })),
    zoneScrap: s.zoneScrap.nodes.map((n) => ({
      distU: metersToUnits(n.distM),
      angle: degreesToAngle(n.angleDeg),
      amount: n.amount,
    })),
    scaling: s.scaling.map((c) => ({
      countPermille: pctToPermille(c.countPct),
      hpPermille: pctToPermille(c.hpPct),
      damagePermille: pctToPermille(c.damagePct),
    })),
    targetRule: {
      unitScrapPermille: pctToPermille(s.targetRule.unitScrapPct),
      turretScrapPermille: pctToPermille(s.targetRule.turretScrapPct),
      heroScrap: s.targetRule.heroScrap,
    },
    winWave: s.win.surviveWave,
    requireAllWaveUnitsDead: s.win.requireAllWaveUnitsDead,
    waves,
  };
}

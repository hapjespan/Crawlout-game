// Survival co-op (data 0.33.0; voorstel, ter bevestiging door de architect; docs/survival-coop.md): data/survival/.
// Data only: the sim reads none of this yet. Holds: SurvivalUnit, SurvivalUnits, Survival (waves, edges, zones).
import { z } from 'zod';
import { comment, id, nonneg, pct } from './schemas.part1.js';
import { CreepUnit } from './schemas.part4.js';

export const SURVIVAL_RANKS = ['normal', 'miniboss', 'boss'] as const;

/** A hostile wave unit: a creep loadout plus its rank and what a kill gives (loot to the killer, xp to his hero). */
export const SurvivalUnit = CreepUnit.extend({
  rank: z.enum(SURVIVAL_RANKS),
  lootScrap: z.number().int().nonnegative(),
  heroXp: z.number().int().nonnegative(),
});

export const SurvivalUnits = z
  .object({ units: z.array(SurvivalUnit).min(1), _comment: comment })
  .strict();

const percentOfMap = z.number().min(0).max(100);

export const SurvivalEdge = z
  .object({ id, xPct: percentOfMap, yPct: percentOfMap, spreadM: nonneg })
  .strict();

export const SurvivalBuildZone = z
  .object({
    slot: z.number().int().min(0).max(3),
    hqXPct: percentOfMap,
    hqYPct: percentOfMap,
    radiusM: z.number().positive(),
    nearEdge: id,
  })
  .strict();

export const SurvivalScaling = z
  .object({
    players: z.number().int().min(1).max(4),
    countPct: z.number().positive().max(1000),
    hpPct: z.number().positive().max(1000),
    damagePct: z.number().positive().max(1000),
  })
  .strict();

export const SurvivalTargetRule = z
  .object({
    kind: z.literal('weakest_player'),
    unitScrapPct: pct,
    turretScrapPct: pct,
    heroScrap: nonneg,
    tieBreak: z.tuple([z.literal('lowestHqHpPct'), z.literal('lowestSlot')]),
    _comment: comment,
  })
  .strict();

export const SurvivalWave = z
  .object({
    wave: z.number().int().positive(),
    atS: nonneg,
    naam: z.string().min(1),
    spawns: z.array(z.object({ unit: id, count: z.number().int().positive() }).strict()).min(1),
    edges: z.number().int().min(1).max(4),
    batches: z.number().int().positive(),
    batchIntervalS: nonneg,
  })
  .strict();

export const Survival = z
  .object({
    players: z.object({ min: z.number().int().min(1), max: z.number().int().max(4) }).strict(),
    edges: z.array(SurvivalEdge).length(4),
    buildZones: z.array(SurvivalBuildZone).length(4),
    buildZoneRule: z.string().min(1),
    scaling: z.array(SurvivalScaling).length(4),
    scalingRule: z.string().min(1),
    targetRule: SurvivalTargetRule,
    waveRule: z.string().min(1),
    win: z
      .object({
        surviveWave: z.number().int().positive(),
        requireAllWaveUnitsDead: z.boolean(),
        _comment: comment,
      })
      .strict(),
    loss: z.object({ kind: z.literal('allHqsDestroyed'), _comment: comment }).strict(),
    waves: z.array(SurvivalWave).min(1),
    _comment: comment,
  })
  .strict();

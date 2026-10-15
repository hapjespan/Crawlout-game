import type { CommandPayload } from '@crawlout/protocol';
import type { SimTraining } from '../config.js';
import { SPECIAL_COUNT } from '../config.js';
import { C, JOB_NONE, JOB_TRAIN } from '../ecs/world.js';
import { hasTechs, refreshPlayer } from '../effects.js';
import { isInt } from '../math/int.js';
import type { SimContext } from './common.js';
import { idleOwnBuilding } from './robots.js';

// SPECIAL-training (data 0.16.0, training.json, commando Train): in een eigen voltooid gebouw van het type uit het
// programma (de trainingsfaciliteit) loopt één programma tegelijk. Het kost scrapCost + scrapCostStep maal de punten die
// de speler al op die letter trainde, meteen afgerekend, en duurt trainTicks + trainTicksStep maal dat aantal. Klaar
// geeft pointsPerRun punten op de letter, tot maxPoints. De punten horen bij de speler (PlayerState.trained, zeven
// tellers per speler): heroSpecial = basis + getraind + effecten; ze blijven als de held sneuvelt of opgelapt wordt.
// Eén letter loopt nooit in twee gebouwen tegelijk, zodat maxPoints niet overschreden wordt. Cancel op het gebouw stopt
// het met teruggave (commands.ts).

/** Getrainde punten van speler p op de letter van programma tr. */
export const trainedOn = (ctx: SimContext, p: number, tr: SimTraining): number =>
  ctx.ps.trained[p * SPECIAL_COUNT + tr.special]!;

/** Kosten van de volgende run van programma tr voor speler p. */
export const trainCost = (ctx: SimContext, p: number, tr: SimTraining): number =>
  tr.scrapCost + tr.scrapCostStep * trainedOn(ctx, p, tr);

/** Duur van de volgende run in ticks. */
export const trainTicks = (ctx: SimContext, p: number, tr: SimTraining): number =>
  tr.trainTicks + tr.trainTicksStep * trainedOn(ctx, p, tr);

/** Of speler p ergens een programma op letter `special` heeft lopen. */
function letterRunning(ctx: SimContext, p: number, special: number): boolean {
  const w = ctx.world;
  for (let i = 0; i < w.highWater; i++) {
    if (!w.has(i, C.building) || w.owner[i] !== p || w.jobKind[i] !== JOB_TRAIN) continue;
    if (ctx.config.training[w.job[i]! - 1]?.special === special) return true;
  }
  return false;
}

/** Train (buildingId, programId). */
export function applyTrain(ctx: SimContext, p: number, pl: CommandPayload<'Train'>): boolean {
  const tr = isInt(pl.programId) ? ctx.config.training[pl.programId] : undefined;
  if (tr === undefined || tr.factionId !== ctx.players[p]!.factionId) return false;
  const b = idleOwnBuilding(ctx, p, pl.buildingId);
  const w = ctx.world;
  if (b < 0 || w.typeId[b] !== tr.buildingTypeId || !hasTechs(ctx, p, tr.prereqTech)) return false;
  if (trainedOn(ctx, p, tr) >= tr.maxPoints || letterRunning(ctx, p, tr.special)) return false;
  const cost = trainCost(ctx, p, tr);
  if (ctx.ps.scrap[p]! < cost) return false;
  ctx.ps.scrap[p] = ctx.ps.scrap[p]! - cost;
  w.job[b] = tr.programId + 1;
  w.jobKind[b] = JOB_TRAIN;
  w.jobWork[b] = 0;
  return true;
}

/** Systeem 6: training in gebouw b; klaar zet de punten en past de stats van de held aan. */
export function trainingWork(ctx: SimContext, b: number): void {
  const w = ctx.world;
  const tr = ctx.config.training[w.job[b]! - 1];
  const p = w.owner[b]!;
  if (tr === undefined) {
    w.job[b] = 0;
    w.jobKind[b] = JOB_NONE;
    w.jobWork[b] = 0;
    return;
  }
  w.jobWork[b] = w.jobWork[b]! + 1;
  if (w.jobWork[b]! < trainTicks(ctx, p, tr)) return;
  const k = p * SPECIAL_COUNT + tr.special;
  const pts = ctx.ps.trained[k]! + tr.pointsPerRun;
  ctx.ps.trained[k] = pts < tr.maxPoints ? pts : tr.maxPoints;
  w.job[b] = 0;
  w.jobKind[b] = JOB_NONE;
  w.jobWork[b] = 0;
  refreshPlayer(ctx, p);
}

/** De zeven getrainde tellers van speler p (PlayerStatus.trained). */
export function trainedOf(ctx: SimContext, p: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < SPECIAL_COUNT; k++) out.push(ctx.ps.trained[p * SPECIAL_COUNT + k]!);
  return out;
}

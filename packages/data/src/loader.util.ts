import { ZodError, type ZodTypeAny, type z } from 'zod';
import type { EffectStat } from './schemas.js';
import { metersToUnits, pctToPermille, secondsToTicks } from './units.js';
import type { EffectData } from './loader.types.js';

// Part of the pure loader (see loader.ts): no IO, no clock; falls under the determinism lint.
// Shared helpers of the loader stages: parsing with file names in errors, id sorting and references, unit conversions.

/** Dominantie-regel van een map in sim-eenheden (maps worden door packages/map geladen; deze omrekening is de enige plek). */
export interface DominanceData {
  pointsRequired: number;
  /** Tijdslimiet in ticks. */
  ticks: number;
}

/** Rekent MapDef.dominance om naar sim-eenheden. */
export function convertDominance(d: { pointsRequired: number; minutes: number }): DominanceData {
  return { pointsRequired: d.pointsRequired, ticks: secondsToTicks(d.minutes * 60) };
}

export function parseWith<S extends ZodTypeAny>(
  file: string,
  schema: S,
  value: unknown,
): z.infer<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data as z.infer<S>;
  throw new Error(`data/${file}: ${formatZodError(result.error)}`);
}

export function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

export function parseList<S extends ZodTypeAny>(
  file: string,
  schema: S,
  value: unknown,
): z.infer<S>[] {
  if (!Array.isArray(value)) throw new Error(`data/${file}: verwacht een array`);
  return value.map((item: unknown, index: number) => parseWith(`${file}[${index}]`, schema, item));
}

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Sorteert op (idGroup, string-id) (idGroup afwezig = 0; dubbele ids zijn een fout) en geeft record plus numerieke id.
 * Een nieuwe idGroup komt achter de oude ids, zodat geen bestaand id verschuift (data 0.39.0: helden en perks).
 */
export function sortById<T extends { id: string; idGroup?: number | undefined }>(
  file: string,
  records: T[],
): T[] {
  const sorted = [...records].sort(
    (a, b) => (a.idGroup ?? 0) - (b.idGroup ?? 0) || compareIds(a.id, b.id),
  );
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.id === sorted[i - 1]!.id)
      throw new Error(`data/${file}: dubbele id '${sorted[i]!.id}'`);
  }
  return sorted;
}

export type IdIndex = ReadonlyMap<string, number>;

export function indexOf(records: { id: string }[]): IdIndex {
  const map = new Map<string, number>();
  records.forEach((record, i) => map.set(record.id, i));
  return map;
}

export function ref(index: IdIndex, what: string, where: string, key: string): number {
  const found = index.get(key);
  if (found === undefined) throw new Error(`${where}: onbekende ${what} '${key}'`);
  return found;
}

/** Omrekening van een effect-delta op basis van het stat-suffix: Pct naar promille, M naar eenheden, S naar ticks. */
export function convertDelta(stat: EffectStat, delta: number): number {
  if (stat.length === 1) return Math.trunc(delta); // SPECIAL-letter, geen suffix
  if (stat.endsWith('Pct')) return pctToPermille(delta);
  if (stat.endsWith('M')) return metersToUnits(delta);
  if (stat.endsWith('S')) return secondsToTicks(delta);
  return Math.trunc(delta);
}

export const convertEffects = (
  effects: { stat: EffectStat; target: string; delta: number }[],
): EffectData[] =>
  effects.map((e) => ({ stat: e.stat, target: e.target, delta: convertDelta(e.stat, e.delta) }));

/** Cumulatieve som van xp per stap: [100, 200] wordt [100, 300]. */
export function cumulate(steps: readonly number[]): number[] {
  const out: number[] = [];
  let total = 0;
  for (const step of steps) {
    total += step;
    out.push(total);
  }
  return out;
}

export function parseVersion(version: string): { text: string; packed: number } {
  const text = version.trim();
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (!match) throw new Error(`data/VERSION: ongeldige semver '${text}'`);
  return { text, packed: Number(match[1]) * 1000000 + Number(match[2]) * 1000 + Number(match[3]) };
}

/** Index of an enum value in its fixed option list (the numeric value in GameData). */
export const idx = <T extends readonly string[]>(options: T, value: T[number]): number =>
  options.indexOf(value);

// Writes a generated config as a split JSON directory (see src/splitJson.ts): the inverse of readSplitJson. The value
// is cut in document order into fragments of at most `budget` bytes (as JSON.stringify with two spaces, an upper bound
// for the Prettier output), descending into objects and arrays larger than `unitMax`. Fragments are named
// `NN-<section>-<first key>.json`, so the filename order is the document order and the merge gives back the value.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Step = string | number;
interface Unit {
  path: Step[];
  value: unknown;
  group: string;
}

const size = (value: unknown): number => Buffer.byteLength(JSON.stringify(value, null, 2));

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  if (typeof value !== 'object' || value === null) return false;
  return Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0;
}

function collect(value: unknown, path: Step[], unitMax: number, out: Unit[]): void {
  if (path.length > 0 && !(isContainer(value) && size(value) > unitMax)) {
    out.push({ path, value, group: '' });
    return;
  }
  if (Array.isArray(value))
    value.forEach((item, index) => collect(item, [...path, index], unitMax, out));
  else
    for (const [key, item] of Object.entries(value as Record<string, unknown>))
      collect(item, [...path, key], unitMax, out);
}

/** Rebuilds the part of the original value that the units cover, with the original nesting. */
function prune(units: readonly Unit[]): unknown {
  const root: Record<string, unknown> = {};
  const arrayChildren = new Map<unknown[], Map<number, unknown>>();
  for (const unit of units) {
    let current: unknown = root;
    unit.path.forEach((step, depth) => {
      const last = depth === unit.path.length - 1;
      const nextIsIndex = typeof unit.path[depth + 1] === 'number';
      if (Array.isArray(current)) {
        const children = arrayChildren.get(current) ?? new Map<number, unknown>();
        arrayChildren.set(current, children);
        let child = children.get(step as number);
        if (child === undefined) {
          child = last ? unit.value : nextIsIndex ? [] : {};
          children.set(step as number, child);
          current.push(child);
        }
        current = child;
      } else {
        const object = current as Record<string, unknown>;
        if (!Object.hasOwn(object, step as string))
          object[step as string] = last ? unit.value : nextIsIndex ? [] : {};
        current = object[step as string];
      }
    });
  }
  return root;
}

const slug = (step: Step | undefined): string =>
  String(step ?? '')
    .replace(/^(raider|dweller|site)_/, '')
    .replace(/[^A-Za-z0-9_]+/g, '_');

/** Splits `value` (a config object) into named fragments; merging them in name order gives back `value`. */
export function splitConfig(
  value: Record<string, unknown>,
  budget = 22000,
  unitMax = 4000,
): { name: string; value: unknown }[] {
  const units: Unit[] = [];
  collect(value, [], unitMax, units);
  // Large top-level sections (descended into) each start their own run of fragments; small ones join the header.
  const big = new Set(units.filter((unit) => unit.path.length >= 2).map((unit) => unit.path[0]));
  let group = 'header';
  for (const unit of units) {
    if (big.has(unit.path[0])) group = String(unit.path[0]);
    unit.group = group;
  }
  const runs: Unit[][] = [];
  let run: Unit[] = [];
  for (const unit of units) {
    const previous = run[run.length - 1];
    if (previous && (previous.group !== unit.group || size(prune([...run, unit])) > budget)) {
      runs.push(run);
      run = [];
    }
    run.push(unit);
  }
  if (run.length > 0) runs.push(run);
  const seen = new Map<string, number>();
  return runs.map((units, index) => {
    const first = units[0] as Unit;
    const base =
      first.group === 'header' ? 'header' : `${slug(first.path[0])}-${slug(first.path[1])}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    const name = `${String(index + 1).padStart(2, '0')}-${base}${count > 1 ? `-${count}` : ''}.json`;
    return { name, value: prune(units) };
  });
}

/** Replaces every `*.json` in `dir` by the fragments of `value`. */
export function writeSplitConfig(
  dir: string,
  value: Record<string, unknown>,
  budget?: number,
  unitMax?: number,
): string[] {
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dir)) if (name.endsWith('.json')) rmSync(join(dir, name));
  const fragments = splitConfig(value, budget, unitMax);
  for (const fragment of fragments)
    writeFileSync(join(dir, fragment.name), `${JSON.stringify(fragment.value, null, 2)}\n`);
  return fragments.map((fragment) => fragment.name);
}

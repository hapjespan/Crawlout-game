// Split JSON configs. A large hand-written or generated config (assets/src/raiders.json, sites.json, robots.json,
// dwellers-gear.json, buildings/variants.json) lives as a directory of small fragments next to where the single file
// used to be (`raiders.json` -> `raiders/*.json`), so every file stays small enough to read and review. The logical path
// stays `<name>.json` (build options, report sources and the manifest keep it); readSplitJson resolves it.
//
// Merge order is fixed: fragments are read in filename order (plain code-unit sort, so name them `01-...`, `02-...`),
// objects merge recursively with keys in order of first appearance and arrays concatenate. A config split along its
// own order therefore merges back to exactly the original value, key order and array order included. Two fragments
// that both set the same scalar are an error, never a silent override.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The fragment directory of a split config: `<dir>/<name>.json` becomes `<dir>/<name>`. */
export function splitJsonDir(path: string): string {
  return path.replace(/\.json$/i, '');
}

/** True when there is a config at `path`: the file itself or its fragment directory. */
export function splitJsonExists(path: string): boolean {
  if (existsSync(path)) return true;
  const dir = splitJsonDir(path);
  return dir !== path && existsSync(dir) && statSync(dir).isDirectory();
}

/** The fragment files of a split config, in merge order. */
export function listJsonFragments(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .sort()
    .map((name) => join(dir, name));
}

/**
 * Reads the config at `path`: the single file when it exists, otherwise the fragments in `<name>/` merged in
 * filename order (see mergeJsonFragments).
 */
export function readSplitJson(path: string): unknown {
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  const dir = splitJsonDir(path);
  const files = listJsonFragments(dir);
  if (files.length === 0) throw new Error(`geen JSON-fragmenten in ${dir}`);
  return mergeJsonFragments(files.map((file) => JSON.parse(readFileSync(file, 'utf8'))));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeInto(target: unknown, source: unknown, at: string): unknown {
  if (Array.isArray(target) && Array.isArray(source)) return [...target, ...source];
  if (isPlainObject(target) && isPlainObject(source)) {
    for (const [key, value] of Object.entries(source)) {
      const merged = Object.hasOwn(target, key)
        ? mergeInto(target[key], value, `${at}.${key}`)
        : value;
      Object.defineProperty(target, key, {
        value: merged,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return target;
  }
  throw new Error(
    `JSON-fragmenten botsen op ${at}: alleen objecten en lijsten kunnen samengevoegd worden`,
  );
}

/**
 * Merges fragments in the given order: objects recursively (keys in order of first appearance), arrays concatenated.
 * The fragments themselves may be modified.
 */
export function mergeJsonFragments(fragments: readonly unknown[]): unknown {
  let result: unknown = undefined;
  for (const fragment of fragments)
    result = result === undefined ? fragment : mergeInto(result, fragment, '$');
  return result;
}

// Browser-bundel van de replay-runner (esbuild, IIFE, global `crawloutReplay`). Draait de replay-set in een pagina:
// dezelfde sim, dezelfde data-loader en map-loader als in Node, alleen de bestanden komen als JSON van buiten
// (tools/replay/src/browsers.ts geeft ze mee). Geen IO, geen DOM nodig.
import { MapDef, loadGameData } from '@crawlout/data';
import type { RawGameData } from '@crawlout/data';
import { loadMap } from '@crawlout/map';
import { Replay } from '@crawlout/protocol';
import { simConfigFromGameData } from '@crawlout/sim';
import { envFrom } from '../env-core.js';
import { compareRun, runReplayIn } from '../run-core.js';

export interface BrowserInput {
  readonly raw: RawGameData;
  readonly maps: Record<string, { readonly def: unknown; readonly files: Record<string, string> }>;
  readonly replays: readonly { readonly name: string; readonly replay: unknown }[];
}

export interface BrowserResult {
  readonly name: string;
  readonly ok: boolean;
  readonly frames: number;
  readonly checked: number;
  /** Eerste afwijkende hash (gewone run, of na serialize/deserialize halverwege). */
  readonly mismatch: { frame: number; expected: number; actual: number; reloaded: boolean } | null;
  /** Hash na het laatste frame. */
  readonly finalHash: number;
  readonly ms: number;
  readonly error?: string;
}

export function run(input: BrowserInput): { userAgent: string; results: BrowserResult[] } {
  const data = loadGameData(input.raw);
  const config = simConfigFromGameData(data);
  const results: BrowserResult[] = [];
  for (const { name, replay } of input.replays) {
    const t0 = performance.now();
    try {
      const r = Replay.parse(replay);
      if (r.dataVersion !== data.dataVersion)
        throw new Error(`replay is voor data ${r.dataVersion}, de data is ${data.dataVersion}`);
      const src = input.maps[r.map];
      if (src === undefined) throw new Error(`map ${r.map} niet meegegeven`);
      const def = MapDef.parse(src.def);
      const grid = loadMap(def, {
        read: (ref) => {
          const text = src.files[ref];
          if (text === undefined) throw new Error(`mapbestand ${ref} niet meegegeven`);
          return text;
        },
      });
      const env = envFrom(data, config, def, grid, r.players, r.settings);
      const plain = runReplayIn(r, env);
      const a = compareRun(r, plain);
      const mid = Math.floor(plain.lastFrame / 2);
      const b = a.ok ? compareRun(r, runReplayIn(r, env, { reloadAfterFrame: mid })) : a;
      const m = a.mismatch ?? b.mismatch;
      results.push({
        name,
        ok: a.ok && b.ok,
        frames: a.frames,
        checked: a.checked,
        mismatch: m === null ? null : { ...m, reloaded: a.ok },
        finalHash: plain.hashes[plain.lastFrame] ?? 0,
        ms: Math.round(performance.now() - t0),
      });
    } catch (e) {
      results.push({
        name,
        ok: false,
        frames: 0,
        checked: 0,
        mismatch: null,
        finalHash: 0,
        ms: Math.round(performance.now() - t0),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { userAgent: navigator.userAgent, results };
}

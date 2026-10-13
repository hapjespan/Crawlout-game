import { DELAY_FRAMES_DEFAULT } from '@crawlout/protocol';
import type { CommandEnvelope, FrameBundle, Replay } from '@crawlout/protocol';
import { TEST_SIM_CONFIG, cellCenter } from '@crawlout/sim/testing';
import { createReplaySim } from './run.js';

// Definities van de replay-fixtures in tools/replay/fixtures. `pnpm --filter @crawlout/replay record` draait ze
// en schrijft de JSON met verwachte hashes. Een fixture opnieuw opnemen mag alleen bij een bewuste
// gedragswijziging in de sim, met uitleg in de CHANGELOG.

export interface FixtureDef {
  readonly name: string;
  build(): Replay;
}

const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ playerId: i, name: `speler${i}`, faction: 'dwellers', ready: true, online: true, ai: false }));

const base = (map: string, seed: number): Replay => ({
  dataVersion: TEST_SIM_CONFIG.dataVersion,
  seed,
  map,
  players: players(2),
  settings: { mode: 'skirmish', delayFrames: DELAY_FRAMES_DEFAULT },
  bundles: [],
  hashes: [],
});

/** Ids per eigenaar na de startopstelling van het scenario, oplopend. */
function idsByOwner(r: Replay): number[][] {
  const sim = createReplaySim(r);
  const out: number[][] = r.players.map(() => []);
  for (const id of sim.entityIds()) out[sim.getUnit(id)!.owner]!.push(id);
  return out;
}

class Script {
  private readonly frames = new Map<number, CommandEnvelope[]>();
  private readonly seqs: number[] = [];

  /** Commando dat in `execFrame` wordt uitgevoerd; gegeven in execFrame - DELAY. */
  add(execFrame: number, playerId: number, type: CommandEnvelope['type'], payload: unknown, seq?: number): this {
    const s = seq ?? (this.seqs[playerId] ?? 0);
    this.seqs[playerId] = Math.max(this.seqs[playerId] ?? 0, s + 1);
    const list = this.frames.get(execFrame) ?? [];
    list.push({ frame: Math.max(0, execFrame - DELAY_FRAMES_DEFAULT), playerId, seq: s, type, payload });
    this.frames.set(execFrame, list);
    return this;
  }

  move(execFrame: number, playerId: number, ids: number[], cx: number, cy: number): this {
    for (let k = 0; k < ids.length; k += 64) {
      const c = cellCenter(cx, cy);
      this.add(execFrame, playerId, 'Move', { ids: ids.slice(k, k + 64), x: c.x, y: c.y });
    }
    return this;
  }

  bundles(): FrameBundle[] {
    return [...this.frames.keys()].sort((a, b) => a - b).map((frame) => ({ frame, commands: this.frames.get(frame)! }));
  }
}

export const FIXTURES: readonly FixtureDef[] = [
  {
    name: 'sprint1-arena-move-stop',
    build() {
      const r = base('test-arena-64', 20261013);
      const [a, b] = idsByOwner(r) as [number[], number[]];
      const s = new Script()
        .move(4, 0, a, 50, 40) // door de opening in de muur
        .move(5, 1, b, 10, 50) // andersom
        .add(6, 1, 'Move', { ids: a, x: 2000, y: 2000 }) // ongeldig: niet van speler 1
        .add(60, 0, 'Stop', { ids: a.slice(0, 5) })
        .move(90, 0, a.slice(0, 5), 20, 10)
        .move(120, 1, b.slice(0, 10), 55, 10) // langs het blok
        .add(150, 0, 'Move', { ids: a, x: -10, y: 500 }) // ongeldig: buiten de map
        .move(200, 1, b.slice(10), 50, 40) // zelfde doel als speler 0: veld hergebruiken
        .move(300, 0, a, 8, 8)
        .add(301, 0, 'Stop', { ids: a.slice(0, 10) })
        // zelfde frame, seq bepaalt de volgorde: het tweede Move-commando wint
        .add(302, 0, 'Move', { ids: a.slice(10, 15), x: cellCenter(12, 30).x, y: cellCenter(12, 30).y }, 101)
        .add(302, 0, 'Move', { ids: a.slice(10, 15), x: cellCenter(20, 30).x, y: cellCenter(20, 30).y }, 100)
        .move(400, 1, b, 30, 30)
        .add(450, 0, 'Surrender', {}) // sprint 1: no-op
        .add(450, 1, 'Gather', { ids: b.slice(0, 2), nodeId: 1 }); // sprint 1: no-op
      r.bundles = s.bundles();
      r.hashes = [{ frame: 599, hash: 0 }]; // lengte; record vult de echte hashes in
      return r;
    },
  },
  {
    name: 'sprint1-open-crossing',
    build() {
      const r = base('test-open-128', 777);
      const [a, b] = idsByOwner(r) as [number[], number[]];
      const s = new Script()
        .move(4, 0, a, 110, 100)
        .move(4, 1, b, 15, 25)
        .move(200, 0, a, 64, 64)
        .move(200, 1, b, 64, 64)
        .add(300, 0, 'Stop', { ids: a.slice(0, 64) });
      r.bundles = s.bundles();
      r.hashes = [{ frame: 399, hash: 0 }];
      return r;
    },
  },
];

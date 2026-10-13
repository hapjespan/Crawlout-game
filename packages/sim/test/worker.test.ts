import { describe, expect, it } from 'vitest';
import { readSnapshotHeader } from '@crawlout/protocol';
import { createSim, createSimWorkerCore } from '../src/index.js';
import type { SimWorkerOutbound } from '../src/index.js';
import { testInit } from '../src/testing.js';
import { bundle } from './helpers.js';

function harness() {
  const out: { msg: SimWorkerOutbound; transfer: ArrayBuffer[] }[] = [];
  const core = createSimWorkerCore({ post: (msg, transfer) => out.push({ msg, transfer }) });
  return { core, out };
}

describe('worker-schil', () => {
  it('tickt alleen als de bundel er is en post elke snapshot als transferable', () => {
    const { core, out } = harness();
    core.receive({ kind: 'init', init: testInit(3) });
    expect(out[0]!.msg.kind).toBe('ready');
    expect(core.step()).toBe(0); // geen bundel: wachten
    core.receive({ kind: 'bundle', bundle: bundle(0) });
    core.receive({ kind: 'bundle', bundle: bundle(1) });
    expect(core.step(8)).toBe(2);
    const snaps = out.filter((o) => o.msg.kind === 'snapshot');
    expect(snaps).toHaveLength(2);
    for (const s of snaps) {
      if (s.msg.kind !== 'snapshot') throw new Error();
      expect(s.transfer).toEqual([s.msg.buffer]);
    }
    const last = snaps[1]!.msg;
    if (last.kind !== 'snapshot') throw new Error();
    // zelfde hash als een directe sim met dezelfde invoer
    const ref = createSim(testInit(3));
    ref.applyBundle(bundle(0));
    ref.tick();
    ref.applyBundle(bundle(1));
    expect(readSnapshotHeader(last.buffer)).toMatchObject({ tick: 1, hash: ref.tick() });
  });

  it('dump en load geven dezelfde hash; fouten komen terug als bericht', () => {
    const { core, out } = harness();
    core.receive({ kind: 'bundle', bundle: bundle(0) });
    expect(out[0]!.msg.kind).toBe('error');
    core.receive({ kind: 'init', init: testInit(3) });
    core.receive({ kind: 'bundle', bundle: bundle(0) });
    core.step();
    core.receive({ kind: 'dump' });
    const st = out.find((o) => o.msg.kind === 'state')!.msg;
    if (st.kind !== 'state') throw new Error();
    const init = testInit(3);
    const env = { playerCount: init.playerCount, map: init.map, config: init.config };
    const b = harness();
    b.core.receive({ kind: 'load', state: st.buffer, env });
    const ready = b.out[0]!.msg;
    expect(ready).toEqual({ kind: 'ready', frame: st.frame, hash: st.hash });
  });
});

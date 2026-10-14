import { describe, expect, it } from 'vitest';
import { readSnapshotHeader } from '@crawlout/protocol';
import { CATCH_UP_BACKLOG, createSim, createSimWorkerCore } from '../src/index.js';
import type { SimWorkerOutbound } from '../src/index.js';
import { bundle, envOf, testInit } from './helpers.js';

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
    const env = envOf(testInit(3));
    const b = harness();
    b.core.receive({ kind: 'load', state: st.buffer, env });
    const ready = b.out[0]!.msg;
    expect(ready).toEqual({ kind: 'ready', frame: st.frame, hash: st.hash });
  });

  it('inhalen: bij een achterstand tikt pump door zolang er tijd is, post alleen de laatste snapshot en de tussenliggende hashes', () => {
    const { core, out } = harness();
    core.receive({ kind: 'init', init: testInit(5) });
    const ref = createSim(testInit(5));
    const hashes: number[] = [];
    for (let f = 0; f < 130; f++) {
      core.receive({ kind: 'bundle', bundle: bundle(f) });
      ref.applyBundle(bundle(f));
      hashes.push(ref.tick());
    }
    expect(core.catchingUp()).toBe(true);
    // tijdbudget van 50 ticks (de host gebruikt een klok)
    let left = 50;
    expect(core.pump(8, () => --left > 0)).toBe(50);
    const msgs = out.slice(1).map((o) => o.msg);
    expect(msgs.map((m) => m.kind)).toEqual(['hashes', 'snapshot']);
    const h = msgs[0]!;
    const snap = msgs[1]!;
    if (h.kind !== 'hashes' || snap.kind !== 'snapshot') throw new Error();
    expect(h.reports).toEqual([0, 20, 40].map((frame) => ({ frame, hash: hashes[frame] })));
    expect(readSnapshotHeader(snap.buffer)).toMatchObject({ tick: 49, hash: hashes[49] });
    // de rest in één slag; frame 120 meldt de hash, de laatste tick (129) zit in de snapshot
    out.length = 0;
    expect(core.pump(8, () => true)).toBe(80);
    const m2 = out.map((o) => o.msg);
    if (m2[0]!.kind !== 'hashes' || m2[1]!.kind !== 'snapshot') throw new Error();
    expect(m2[0]!.reports.map((r) => r.frame)).toEqual([60, 80, 100, 120]);
    expect(readSnapshotHeader(m2[1]!.buffer)).toMatchObject({ tick: 129, hash: hashes[129] });
    // bijgewerkt: weer de gewone gang, een snapshot per tick en hoogstens maxTicks
    expect(core.catchingUp()).toBe(false);
    out.length = 0;
    for (let f = 130; f < 130 + CATCH_UP_BACKLOG; f++)
      core.receive({ kind: 'bundle', bundle: bundle(f) });
    expect(core.catchingUp()).toBe(false);
    expect(core.pump(8, () => true)).toBe(8);
    expect(out.map((o) => o.msg.kind)).toEqual(Array(8).fill('snapshot'));
  });

  it('na load haalt hij in, ook met weinig bundels, tot er niets meer klaarligt', () => {
    const a = harness();
    a.core.receive({ kind: 'init', init: testInit(6) });
    for (let f = 0; f < 3; f++) a.core.receive({ kind: 'bundle', bundle: bundle(f) });
    a.core.step(3);
    a.core.receive({ kind: 'dump' });
    const st = a.out.find((o) => o.msg.kind === 'state')!.msg;
    if (st.kind !== 'state') throw new Error();
    const b = harness();
    b.core.receive({ kind: 'load', state: st.buffer, env: envOf(testInit(6)) });
    expect(b.core.catchingUp()).toBe(true);
    for (let f = 3; f < 8; f++) b.core.receive({ kind: 'bundle', bundle: bundle(f) });
    expect(b.core.pump(2, () => true)).toBe(5);
    expect(b.out.slice(1).map((o) => o.msg.kind)).toEqual(['snapshot']);
    expect(b.core.catchingUp()).toBe(false);
  });
});

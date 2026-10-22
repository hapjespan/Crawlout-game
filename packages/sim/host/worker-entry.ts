// Web Worker-entry voor de sim. Dit is de enige plek met een klok: de timer roept pump() aan.
// Staat bewust buiten packages/sim/src, dus buiten de determinisme-lint; de sim zelf blijft klokloos.
// Gebruik vanuit de client (Vite): import SimWorker from '@crawlout/sim/worker?worker'; const w = new SimWorker();
import { TICK_MS } from '@crawlout/protocol';
import { createSimWorkerCore } from '../src/worker.js';
import type { SimWorkerInbound, SimWorkerOutbound } from '../src/worker.js';

/** Maximaal aantal ticks per timer-slag in de gewone gang (een kleine hapering inhalen, met een snapshot per tick). */
const MAX_CATCH_UP_TICKS = 8;
/**
 * Tijdbudget per timer-slag tijdens het inhalen (meer dan CATCH_UP_BACKLOG bundels klaar, of net een state geladen):
 * onder TICK_MS, zodat berichten (bundels, queries) tussen de slagen door verwerkt worden. Zo haalt een resync van
 * 1200 frames in een paar seconden in, zonder 1200 snapshots naar de main thread te posten.
 */
const CATCH_UP_BUDGET_MS = 14;

const scope = globalThis as unknown as WorkerScope;
const core = createSimWorkerCore({ post: (msg, transfer) => scope.postMessage(msg, transfer) });
scope.onmessage = (ev) => core.receive(ev.data);
setInterval(() => {
  const end = performance.now() + CATCH_UP_BUDGET_MS;
  core.pump(MAX_CATCH_UP_TICKS, () => performance.now() < end);
}, TICK_MS);

interface WorkerScope {
  postMessage(msg: SimWorkerOutbound, transfer: ArrayBuffer[]): void;
  onmessage: ((ev: { data: SimWorkerInbound }) => void) | null;
}

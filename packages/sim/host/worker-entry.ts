// Web Worker-entry voor de sim. Dit is de enige plek met een klok: de timer roept step() aan.
// Staat bewust buiten packages/sim/src, dus buiten de determinisme-lint; de sim zelf blijft klokloos.
// Gebruik vanuit de client (Vite): import SimWorker from '@crawlout/sim/worker?worker'; const w = new SimWorker();
import { TICK_MS } from '@crawlout/protocol';
import { createSimWorkerCore } from '../src/worker.js';
import type { SimWorkerInbound, SimWorkerOutbound } from '../src/worker.js';

interface WorkerScope {
  postMessage(msg: SimWorkerOutbound, transfer: ArrayBuffer[]): void;
  onmessage: ((ev: { data: SimWorkerInbound }) => void) | null;
}

/** Maximaal aantal ticks per timer-slag: genoeg om na een hapering of resync in te halen. */
const MAX_CATCH_UP_TICKS = 8;

const scope = globalThis as unknown as WorkerScope;
const core = createSimWorkerCore({ post: (msg, transfer) => scope.postMessage(msg, transfer) });
scope.onmessage = (ev) => core.receive(ev.data);
setInterval(() => core.step(MAX_CATCH_UP_TICKS), TICK_MS);

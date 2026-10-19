// Web Worker entry of the client: the sim worker of packages/sim (host/worker-entry.ts) plus the survival status.
// Sim.survivalStatus() is a sim API without a protocol type yet (contract proposal), so it does not travel in
// PlayerStatus; this entry adds it to every `status` answer as a `survival` field (null outside the game type
// Survival). Everything else is the sim's own core, unchanged.
import { TICK_MS } from '@crawlout/protocol';
import { createSimWorkerCore } from '@crawlout/sim';
import type { SimWorkerInbound, SimWorkerOutbound } from '@crawlout/sim';
import type { SurvivalWorkerOutbound } from './survivalStatus.js';

/** Same pacing as host/worker-entry.ts. */
const MAX_CATCH_UP_TICKS = 8;
const CATCH_UP_BUDGET_MS = 14;

interface WorkerScope {
  postMessage(msg: SurvivalWorkerOutbound, transfer: ArrayBuffer[]): void;
  onmessage: ((ev: { data: SimWorkerInbound }) => void) | null;
}

const scope = globalThis as unknown as WorkerScope;
const core = createSimWorkerCore({
  post: (msg: SimWorkerOutbound, transfer) =>
    scope.postMessage(
      msg.kind === 'status' ? { ...msg, survival: core.sim?.survivalStatus() ?? null } : msg,
      transfer,
    ),
});
scope.onmessage = (ev) => core.receive(ev.data);
setInterval(() => {
  const end = performance.now() + CATCH_UP_BUDGET_MS;
  core.pump(MAX_CATCH_UP_TICKS, () => performance.now() < end);
}, TICK_MS);

import type { FrameBundle } from '@crawlout/protocol';
import type { SimEnv, SimInit } from './config.js';
import type { Sim } from './sim.js';
import { createSim, deserialize } from './sim.js';

// Worker-schil zonder klok: berichten in, tick() als de bundel er is, snapshot uit als transferable.
// De timer die step() aanroept staat buiten de sim (packages/sim/host/worker-entry.ts) en valt buiten de
// determinisme-lint. Deze module raakt geen globals aan; de host geeft een port mee.

export type SimWorkerInbound =
  | { readonly kind: 'init'; readonly init: SimInit }
  | { readonly kind: 'load'; readonly state: ArrayBuffer; readonly env: SimEnv }
  | { readonly kind: 'bundle'; readonly bundle: FrameBundle }
  | { readonly kind: 'dump' };

export type SimWorkerOutbound =
  | { readonly kind: 'ready'; readonly frame: number; readonly hash: number }
  | { readonly kind: 'snapshot'; readonly buffer: ArrayBuffer }
  | { readonly kind: 'state'; readonly frame: number; readonly hash: number; readonly buffer: ArrayBuffer }
  | { readonly kind: 'error'; readonly message: string };

export interface SimWorkerPort {
  post(msg: SimWorkerOutbound, transfer: ArrayBuffer[]): void;
}

export interface SimWorkerCore {
  receive(msg: SimWorkerInbound): void;
  /** Draait maximaal maxTicks ticks zolang de bundel voor het volgende frame er is. Geeft het aantal ticks. */
  step(maxTicks?: number): number;
  readonly sim: Sim | null;
}

export function createSimWorkerCore(port: SimWorkerPort): SimWorkerCore {
  let sim: Sim | null = null;

  const fail = (e: unknown): void => {
    port.post({ kind: 'error', message: e instanceof Error ? e.message : String(e) }, []);
  };

  const ready = (s: Sim): void => {
    port.post({ kind: 'ready', frame: s.frame, hash: s.hash() }, []);
  };

  return {
    get sim() {
      return sim;
    },
    receive(msg) {
      try {
        switch (msg.kind) {
          case 'init':
            sim = createSim(msg.init);
            ready(sim);
            return;
          case 'load':
            sim = deserialize(msg.state, msg.env);
            ready(sim);
            return;
          case 'bundle':
            if (sim === null) throw new Error('bundel ontvangen voor init');
            sim.applyBundle(msg.bundle);
            return;
          case 'dump': {
            if (sim === null) throw new Error('dump gevraagd voor init');
            const buffer = sim.serialize();
            port.post({ kind: 'state', frame: sim.frame, hash: sim.hash(), buffer }, [buffer]);
            return;
          }
        }
      } catch (e) {
        fail(e);
      }
    },
    step(maxTicks = 1) {
      if (sim === null) return 0;
      let n = 0;
      try {
        while (n < maxTicks && sim.hasBundle()) {
          sim.tick();
          n++;
          const buffer = sim.writeSnapshot();
          port.post({ kind: 'snapshot', buffer }, [buffer]);
        }
      } catch (e) {
        fail(e);
      }
      return n;
    },
  };
}

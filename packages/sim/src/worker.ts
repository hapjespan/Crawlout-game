import { HASH_INTERVAL_FRAMES } from '@crawlout/protocol';
import type { FrameBundle, PlayerStatus } from '@crawlout/protocol';
import type { SimEnv, SimInit } from './config.js';
import type { Sim, SimWinner } from './sim.js';
import { imod } from './math/int.js';
import { createSim, deserialize } from './sim.js';

// Worker-schil zonder klok: berichten in, tick() als de bundel er is, snapshot uit als transferable.
// De timer die step() aanroept staat buiten de sim (packages/sim/host/worker-entry.ts) en valt buiten de
// determinisme-lint. Deze module raakt geen globals aan; de host geeft een port mee.
// Commando's in een bundel worden in Sim.applyBundle met zod gevalideerd, dus buiten de tick.
//
// Inhalen (resync, hapering): staan er meer dan CATCH_UP_BACKLOG bundels klaar, of is er net een state geladen, dan
// tikt pump() door zolang de host tijd geeft (een tijdbudget per timer-slag, de klok zit in de host) en post hij alleen
// de snapshot van de laatste tick; de state-hashes van de tussenliggende meldframes (frame % HASH_INTERVAL_FRAMES == 0)
// gaan als één `hashes`-bericht mee, zodat de client ze aan de relay kan melden. Events van overgeslagen snapshots
// vervallen (alleen VFX, audio en meldingen). Anders tikt hij hoogstens maxTicks keer met een snapshot per tick.

export type SimWorkerInbound =
  /** Nieuwe sim met startopstelling (map-features, hoofdgebouwen, startunits) uit init. */
  | { readonly kind: 'init'; readonly init: SimInit }
  /** Geserialiseerde state laden (resync, desync-dump terugzetten). */
  | { readonly kind: 'load'; readonly state: ArrayBuffer; readonly env: SimEnv }
  | { readonly kind: 'bundle'; readonly bundle: FrameBundle }
  | { readonly kind: 'dump' }
  /** queryMessage (contract 1): spelerstatus voor de HUD, op verzoek. */
  | { readonly kind: 'query'; readonly playerId: number };

export type SimWorkerOutbound =
  | { readonly kind: 'ready'; readonly frame: number; readonly hash: number }
  | { readonly kind: 'snapshot'; readonly buffer: ArrayBuffer }
  /**
   * Tijdens het inhalen: de state-hash na elk meldframe (frame % HASH_INTERVAL_FRAMES == 0) waarvan geen snapshot
   * gepost is, oplopend. Komt vóór de snapshot van de laatste tick van dezelfde slag.
   */
  | {
      readonly kind: 'hashes';
      readonly reports: readonly { readonly frame: number; readonly hash: number }[];
    }
  | {
      readonly kind: 'state';
      readonly frame: number;
      readonly hash: number;
      readonly buffer: ArrayBuffer;
    }
  /** Antwoord op query: status na het laatst uitgevoerde frame (frame = aantal uitgevoerde ticks). */
  | {
      readonly kind: 'status';
      readonly frame: number;
      readonly status: PlayerStatus;
      readonly winner: SimWinner | null;
    }
  | { readonly kind: 'error'; readonly message: string };

export interface SimWorkerPort {
  post(msg: SimWorkerOutbound, transfer: ArrayBuffer[]): void;
}

export interface SimWorkerCore {
  receive(msg: SimWorkerInbound): void;
  /** Draait maximaal maxTicks ticks zolang de bundel voor het volgende frame er is. Geeft het aantal ticks. */
  step(maxTicks?: number): number;
  /** Of de volgende slag een inhaalslag is: meer dan CATCH_UP_BACKLOG bundels klaar, of net een state geladen. */
  catchingUp(): boolean;
  /**
   * Eén timer-slag. Inhalen: tikken zolang er bundels zijn en keepGoing() true geeft (minstens één tick), met alleen
   * de laatste snapshot plus een hashes-bericht. Anders step(maxTicks). Geeft het aantal ticks.
   */
  pump(maxTicks: number, keepGoing: () => boolean): number;
  readonly sim: Sim | null;
}

/** Meer klaarliggende bundels dan dit is een achterstand: de worker gaat inhalen. */
export const CATCH_UP_BACKLOG = 16;

export function createSimWorkerCore(port: SimWorkerPort): SimWorkerCore {
  let sim: Sim | null = null;
  /** Net een state geladen: de eerstvolgende slagen halen in tot er geen bundels meer klaarliggen. */
  let loaded = false;

  const fail = (e: unknown): void => {
    port.post({ kind: 'error', message: e instanceof Error ? e.message : String(e) }, []);
  };

  const ready = (s: Sim): void => {
    port.post({ kind: 'ready', frame: s.frame, hash: s.hash() }, []);
  };

  const catchingUp = (): boolean =>
    sim !== null && (loaded || sim.readyBundles() > CATCH_UP_BACKLOG);

  const core: SimWorkerCore = {
    get sim() {
      return sim;
    },
    receive(msg) {
      try {
        switch (msg.kind) {
          case 'init':
            sim = createSim(msg.init);
            loaded = false;
            ready(sim);
            return;
          case 'load':
            sim = deserialize(msg.state, msg.env);
            loaded = true;
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
          case 'query':
            if (sim === null) throw new Error('query voor init');
            port.post(
              {
                kind: 'status',
                frame: sim.frame,
                status: sim.playerStatus(msg.playerId),
                winner: sim.winner(),
              },
              [],
            );
            return;
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
    catchingUp,
    pump(maxTicks, keepGoing) {
      if (sim === null) return 0;
      if (!catchingUp()) return core.step(maxTicks);
      let n = 0;
      const reports: { frame: number; hash: number }[] = [];
      try {
        while (sim.hasBundle()) {
          const hash = sim.tick();
          n++;
          const frame = sim.frame - 1;
          if (imod(frame, HASH_INTERVAL_FRAMES) === 0) reports.push({ frame, hash });
          if (!keepGoing()) break;
        }
        if (!sim.hasBundle()) loaded = false;
        if (n === 0) return 0;
        // de laatste tick meldt zijn hash via de snapshot-header, zoals buiten het inhalen
        if (reports.length > 0 && reports[reports.length - 1]!.frame === sim.frame - 1)
          reports.pop();
        if (reports.length > 0) port.post({ kind: 'hashes', reports }, []);
        const buffer = sim.writeSnapshot();
        port.post({ kind: 'snapshot', buffer }, [buffer]);
      } catch (e) {
        fail(e);
      }
      return n;
    },
  };
  return core;
}

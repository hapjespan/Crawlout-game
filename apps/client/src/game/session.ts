// A local skirmish: loopback relay with the human plus an AI player (the AI itself runs in the sim), and the sim worker.
// Same messages as the ws relay, so switching to multiplayer only swaps the transport.
import { convertDominance, type GameData } from '@crawlout/data';
import {
  HASH_INTERVAL_FRAMES,
  TICK_MS,
  readSnapshotHeader,
  type CommandPayload,
  type CommandType,
  type DesyncEvent,
  type PlayerStatus,
  type StallNotice,
} from '@crawlout/protocol';
import { LoopbackRelay, type RelayTransport } from '@crawlout/relay/browser';
import { simConfigFromGameData, simMapFromGrid, simPlayersFromLobby, type SimInit, type SimWinner } from '@crawlout/sim';
import type { SimWorkerInbound, SimWorkerOutbound } from '@crawlout/sim';
import SimWorker from '@crawlout/sim/worker?worker';
import type { ClientMap } from './content.js';

export interface SessionEvents {
  onSnapshot(buf: ArrayBuffer): void;
  onDesync(event: DesyncEvent): void;
  onStall(notice: StallNotice | null): void;
  onError(message: string): void;
  /** Answer to requestStatus(): player status for the HUD plus the winner (null while the match runs). */
  onStatus?(status: PlayerStatus, winner: SimWinner | null): void;
}

export interface Session {
  readonly playerId: number;
  sendCommand<T extends CommandType>(type: T, payload: CommandPayload<T>): void;
  /** Asks the sim worker for this player's status (queryMessage, contract 1); the answer arrives in onStatus. */
  requestStatus(): void;
  dispose(): void;
}

const HUMAN = 0;

export function startSession(data: GameData, map: ClientMap, events: SessionEvents): Session {
  const relay = new LoopbackRelay({ dataVersion: data.dataVersion, defaultMap: map.grid.id });
  const human: RelayTransport = relay.connect();
  const worker = new SimWorker();
  const post = (msg: SimWorkerInbound, transfer: Transferable[] = []): void => worker.postMessage(msg, transfer);

  let lastFrame = -1;
  let seq = 0;
  let started = false;
  let disposed = false;

  worker.onmessage = (ev: MessageEvent<SimWorkerOutbound>) => {
    const msg = ev.data;
    if (msg.kind === 'snapshot') {
      const header = readSnapshotHeader(msg.buffer);
      lastFrame = header.tick;
      if (header.tick % HASH_INTERVAL_FRAMES === 0) {
        human.send({ kind: 'hash', report: { frame: header.tick, playerId: HUMAN, hash: header.hash } });
      }
      events.onSnapshot(msg.buffer);
    } else if (msg.kind === 'status') {
      events.onStatus?.(msg.status, msg.winner);
    } else if (msg.kind === 'error') {
      events.onError(msg.message);
    }
  };

  human.onMessage((msg) => {
    switch (msg.kind) {
      case 'start': {
        const players = msg.players.map((p) => ({ playerId: p.playerId, faction: p.faction, ai: p.ai }));
        const dominance = convertDominance({
          pointsRequired: map.dominance.pointsRequired,
          minutes: msg.settings.dominanceMinutes ?? map.dominance.minutes,
        });
        const init: SimInit = {
          seed: msg.seed,
          players: simPlayersFromLobby(data, players),
          map: simMapFromGrid({ ...map.grid, dominance }),
          config: simConfigFromGameData(data),
        };
        // The sim builds the start setup itself (map features, HQs, start units, start scrap) and runs the AI.
        post({ kind: 'init', init });
        started = true;
        return;
      }
      case 'bundle':
        post({ kind: 'bundle', bundle: msg.bundle });
        return;
      case 'desync':
        events.onDesync(msg.event);
        return;
      case 'stall':
        events.onStall(msg.notice);
        return;
      case 'error':
        events.onError(msg.message);
        return;
      default:
        return;
    }
  });
  // The AI is a lobby player without a connection; it runs in the sim on every client and reports no hashes.
  human.send({ kind: 'join', roomId: 'skirmish', name: 'Jij' });
  relay.addAi();
  human.send({ kind: 'ready', ready: true });

  const pump = window.setInterval(() => {
    if (started) relay.advance();
  }, TICK_MS);

  return {
    playerId: HUMAN,
    sendCommand(type, payload) {
      if (disposed) return;
      human.send({ kind: 'command', command: { frame: lastFrame + 1, playerId: HUMAN, seq: seq++, type, payload } });
    },
    requestStatus() {
      if (started && !disposed) post({ kind: 'query', playerId: HUMAN });
    },
    dispose() {
      disposed = true;
      window.clearInterval(pump);
      human.close();
      worker.terminate();
    },
  };
}


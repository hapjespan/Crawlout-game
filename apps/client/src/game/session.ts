// A local skirmish: loopback relay with the human and a (for now idle) AI seat, plus the sim worker.
// Same messages as the ws relay, so switching to multiplayer only swaps the transport.
import type { GameData } from '@crawlout/data';
import {
  HASH_INTERVAL_FRAMES,
  TICK_MS,
  readSnapshotHeader,
  type CommandPayload,
  type CommandType,
  type DesyncEvent,
  type StallNotice,
} from '@crawlout/protocol';
import { LoopbackRelay, type RelayTransport } from '@crawlout/relay/browser';
import { createSim, type SimEnv } from '@crawlout/sim';
import type { SimWorkerInbound, SimWorkerOutbound } from '@crawlout/sim';
import SimWorker from '@crawlout/sim/worker?worker';
import type { ClientMap } from './content.js';
import { toSimConfig, typeIdOfLoadout } from './simConfig.js';

export interface SessionEvents {
  onSnapshot(buf: ArrayBuffer): void;
  onDesync(event: DesyncEvent): void;
  onStall(notice: StallNotice | null): void;
  onError(message: string): void;
}

export interface Session {
  readonly playerId: number;
  sendCommand<T extends CommandType>(type: T, payload: CommandPayload<T>): void;
  dispose(): void;
}

const HUMAN = 0;
const AI = 1;

/** Places the faction's start units in a ring around each spawn, on passable cells only. */
function buildStartState(seed: number, env: SimEnv, data: GameData, map: ClientMap): ArrayBuffer {
  const sim = createSim({ seed, ...env });
  const faction = data.factions[0];
  if (!faction) throw new Error('geen factie in de data');
  map.grid.spawns.slice(0, env.playerCount).forEach((spawn, owner) => {
    let placed = 0;
    for (let ring = 0; ring < 12; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const want = faction.startUnits.reduce((n, u) => n + u.count, 0);
          if (placed >= want) return;
          let k = placed;
          const unit = faction.startUnits.find((u) => (k -= u.count) < 0);
          if (!unit) return;
          const id = sim.spawnUnit({
            typeId: typeIdOfLoadout(unit.loadoutId),
            owner,
            x: spawn.ux + dx * 2 * 256,
            y: spawn.uy + dy * 2 * 256,
          });
          if (id !== 0) placed++;
        }
      }
    }
  });
  return sim.serialize();
}

export function startSession(data: GameData, map: ClientMap, events: SessionEvents): Session {
  const relay = new LoopbackRelay({ dataVersion: data.dataVersion, defaultMap: map.grid.id });
  const human: RelayTransport = relay.connect();
  const ai: RelayTransport = relay.connect({ reportsHashes: false });
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
    } else if (msg.kind === 'error') {
      events.onError(msg.message);
    }
  };

  human.onMessage((msg) => {
    switch (msg.kind) {
      case 'start': {
        const env: SimEnv = {
          playerCount: msg.players.length,
          map: { w: map.grid.w, h: map.grid.h, passable: map.grid.passable },
          config: toSimConfig(data),
        };
        const state = buildStartState(msg.seed, env, data, map);
        post({ kind: 'load', state, env }, [state]);
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
  ai.onMessage(() => {
    // The scripted AI arrives in sprint 2; until then this seat only keeps the lobby at two players.
  });

  human.send({ kind: 'join', roomId: 'skirmish', name: 'Jij' });
  ai.send({ kind: 'join', roomId: 'skirmish', name: 'AI' });
  human.send({ kind: 'ready', ready: true });
  ai.send({ kind: 'ready', ready: true });

  const pump = window.setInterval(() => {
    if (started) relay.advance();
  }, TICK_MS);

  return {
    playerId: HUMAN,
    sendCommand(type, payload) {
      if (disposed) return;
      human.send({ kind: 'command', command: { frame: lastFrame + 1, playerId: HUMAN, seq: seq++, type, payload } });
    },
    dispose() {
      disposed = true;
      window.clearInterval(pump);
      human.close();
      ai.close();
      worker.terminate();
    },
  };
}

export { AI as AI_PLAYER_ID };

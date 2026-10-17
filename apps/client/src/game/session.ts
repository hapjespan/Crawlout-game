// A match session: sim worker plus a relay transport. Without URL parameters that is the in-memory loopback with the
// human plus an AI player (the AI itself runs in the sim); with `?relay=ws://host:8787&room=..&name=..` it is the ws
// relay. Both speak the same messages, so everything below the transport choice is shared.
//
// Lobby over ws (no HUD lobby yet): the session joins with a clientId from sessionStorage, sets the map to the one the
// client loaded, lets the host (`?ai=1`) add one AI, and readies up automatically; the relay starts once everyone is ready.
// Reconnect: a dropped socket is re-joined with the same clientId; the relay sends `start` again and a resync, which
// loads the peer's state into the worker (`load`), replays the bundles and continues live (net/resync.ts).
import { convertDominance, type GameData } from '@crawlout/data';
import {
  HASH_INTERVAL_FRAMES,
  TICK_MS,
  readSnapshotHeader,
  type CommandPayload,
  type CommandType,
  type DesyncEvent,
  type FogMask,
  type FrameBundle,
  type LobbyPlayer,
  type PlayerStatus,
  type ServerMessage,
  type StallNotice,
} from '@crawlout/protocol';
import { LoopbackRelay, type RelayTransport } from '@crawlout/relay/browser';
import {
  simConfigFromGameData,
  simMapFromGrid,
  simPlayersFromLobby,
  type SimEnv,
  type SimInit,
  type SimWinner,
} from '@crawlout/sim';
import type { SimWorkerInbound, SimWorkerOutbound } from '@crawlout/sim';
import SimWorker from '@crawlout/sim/worker?worker';
import type { ClientMap } from './content.js';
import { buildDesyncDump, saveDesyncDump } from '../net/desyncDump.js';
import { dataVersionError } from '../net/dataVersion.js';
import { getClientId, netOptionsFromSearch, type WsNetOptions } from '../net/params.js';
import { ReconnectingTransport } from '../net/reconnectingTransport.js';
import { BundleFeed, base64ToBuffer, bufferToBase64 } from '../net/resync.js';

/** No bundle for this long while a match runs = the lockstep is waiting; shown through onStall. */
const LOCAL_STALL_MS = 2000;
const STALL_CHECK_MS = 500;

export interface SessionEvents {
  onSnapshot(buf: ArrayBuffer): void;
  onDesync(event: DesyncEvent): void;
  onStall(notice: StallNotice | null): void;
  onError(message: string): void;
  /** Answer to requestStatus(): player status for the HUD plus the winner (null while the match runs). */
  onStatus?(status: PlayerStatus, winner: SimWinner | null): void;
  /** Answer to requestFog(): this player's fog of war on the vision grid (for a later fog overlay and minimap). */
  onFog?(mask: FogMask): void;
  /** Connection or lobby text for an overlay (Dutch, user-facing); null clears it. */
  onConnection?(text: string | null): void;
}

export interface Session {
  /** This client's playerId from the relay's start message (`you`); -1 before the match starts. */
  readonly playerId: number;
  /** Faction key of this player from the start message; null before the match starts. */
  readonly faction: string | null;
  /** Last executed frame seen in a snapshot (-1 before the first); for tests and debugging. */
  readonly frame: number;
  /** Resolves when the first `start` arrived (immediately for the loopback); playerId and faction are valid then. */
  readonly started: Promise<void>;
  /** Display name of a player from the start message (AI players included). */
  playerName(playerId: number): string;
  sendCommand<T extends CommandType>(type: T, payload: CommandPayload<T>): void;
  /** Asks the sim worker for this player's status (queryMessage, contract 1); the answer arrives in onStatus. */
  requestStatus(): void;
  /** Asks the sim worker for this player's fog mask (protocol 0.11.0); the answer arrives in onFog. */
  requestFog(): void;
  /** Fog of war, dev and tests: true shows everything (no snapshot filter), false this player's view again. */
  revealAll(on: boolean): void;
  dispose(): void;
}

export function startSession(
  data: GameData,
  map: ClientMap,
  events: SessionEvents,
  net: WsNetOptions | null = netOptionsFromSearch(location.search),
): Session {
  const worker = new SimWorker();
  const post = (msg: SimWorkerInbound, transfer: Transferable[] = []): void =>
    worker.postMessage(msg, transfer);
  const feed = new BundleFeed();

  let link: RelayTransport;
  let loopback: LoopbackRelay | null = null;
  let you = -1;
  let faction: string | null = null;
  let roster: readonly LobbyPlayer[] = [];
  let env: SimEnv | null = null;
  let lastFrame = -1;
  let seq = 0;
  let started = false;
  let awaitingResync = false;
  let disposed = false;
  let connected = true;
  let lastProgress = performance.now();
  let relayStall: StallNotice | null = null;
  let shownStall = '';
  let resolveStarted: () => void = () => undefined;
  const startedPromise = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  // Worker answers to `dump` come back in order; each waiter takes one.
  const dumpWaiters: Array<(state: { frame: number; hash: number; buffer: ArrayBuffer }) => void> =
    [];

  const emitStall = (): void => {
    const local =
      started &&
      !disposed &&
      (!connected || awaitingResync || performance.now() - lastProgress > LOCAL_STALL_MS);
    const others = roster.filter((p) => !p.ai && p.playerId !== you).map((p) => p.playerId);
    const notice =
      relayStall && relayStall.waitingFor.length > 0
        ? relayStall
        : local
          ? { waitingFor: others }
          : null;
    const key = JSON.stringify(notice);
    if (key === shownStall) return;
    shownStall = key;
    events.onStall(notice);
  };

  worker.onmessage = (ev: MessageEvent<SimWorkerOutbound>) => {
    const msg = ev.data;
    if (msg.kind === 'snapshot') {
      const header = readSnapshotHeader(msg.buffer);
      lastFrame = header.tick;
      lastProgress = performance.now();
      if (header.tick % HASH_INTERVAL_FRAMES === 0) {
        link.send({
          kind: 'hash',
          report: { frame: header.tick, playerId: you, hash: header.hash },
        });
      }
      events.onSnapshot(msg.buffer);
    } else if (msg.kind === 'hashes') {
      // Catch-up (resync, stall): the worker posts only the last snapshot of a beat and reports the hashes of the
      // frames in between here; the relay expects one per HASH_INTERVAL_FRAMES frames.
      for (const r of msg.reports)
        link.send({ kind: 'hash', report: { frame: r.frame, playerId: you, hash: r.hash } });
    } else if (msg.kind === 'state') {
      dumpWaiters.shift()?.(msg);
    } else if (msg.kind === 'status') {
      events.onStatus?.(msg.status, msg.winner);
    } else if (msg.kind === 'fog') {
      events.onFog?.(msg.mask);
    } else if (msg.kind === 'error') {
      events.onError(msg.message);
    }
  };

  /** The sim environment of this match from a start message; the seed travels separately. */
  const initFromStart = (msg: Extract<ServerMessage, { kind: 'start' }>): SimInit => {
    const players = msg.players.map((p) => ({
      playerId: p.playerId,
      faction: p.faction,
      ai: p.ai,
    }));
    const dominance = convertDominance({
      pointsRequired: map.dominance.pointsRequired,
      minutes: msg.settings.dominanceMinutes ?? map.dominance.minutes,
    });
    return {
      seed: msg.seed,
      players: simPlayersFromLobby(data, players),
      map: simMapFromGrid({ ...map.grid, dominance }),
      config: simConfigFromGameData(data),
    };
  };

  const release = (bundles: readonly FrameBundle[]): void => {
    for (const bundle of bundles) post({ kind: 'bundle', bundle });
  };

  // Lobby over ws: set the map, let the host add the AI, ready up once per distinct lobby (a join or a map change
  // un-readies everyone, so a changed lobby needs a fresh ready).
  let lobbyKeyReadied = '';
  let aiRequested = false;
  const onLobby = (msg: Extract<ServerMessage, { kind: 'lobby' }>): void => {
    if (!net) return;
    roster = msg.players;
    const humans = msg.players.filter((p) => !p.ai);
    events.onConnection?.(
      `Lobby ${msg.roomId}: ${humans.map((p) => p.name).join(', ')}${msg.players.length - humans.length > 0 ? ' + AI' : ''}. Het potje start zodra iedereen er is.`,
    );
    const key = JSON.stringify([
      msg.roomId,
      msg.map,
      msg.players.map((p) => [p.playerId, p.name, p.faction, p.ai]),
    ]);
    if (key === lobbyKeyReadied) return;
    if (msg.map !== map.grid.id) {
      lobbyKeyReadied = key;
      link.send({ kind: 'setMap', map: map.grid.id });
      return;
    }
    if (net.ai && !aiRequested && !msg.players.some((p) => p.ai)) {
      aiRequested = true;
      // Only the host (lowest human playerId) may add an AI; the relay answers any other with an error.
      // The AI plays Dwellers until the Raider mechanics exist in the sim (phase 2); `?aifaction=` overrides.
      const wanted = new URLSearchParams(window.location.search).get('aifaction');
      link.send({
        kind: 'addAi',
        faction: data.factions.find((f) => f.key === wanted)?.key ?? 'dwellers',
      });
      return;
    }
    lobbyKeyReadied = key;
    link.send({ kind: 'ready', ready: true });
  };

  const onServerMessage = (msg: ServerMessage): void => {
    switch (msg.kind) {
      case 'lobby':
        onLobby(msg);
        return;
      case 'start': {
        if (msg.map !== map.grid.id) {
          events.onError(`relay startte map ${msg.map}, maar de client laadde ${map.grid.id}`);
          return;
        }
        const versionError = dataVersionError(msg.dataVersion, data.dataVersion);
        if (versionError !== null) {
          events.onError(versionError);
          return;
        }
        you = msg.you;
        roster = msg.players;
        faction = msg.players.find((p) => p.playerId === you)?.faction ?? null;
        const init = initFromStart(msg);
        env = { players: init.players, map: init.map, config: init.config };
        if (started) {
          // Second start (same seed): this is a reconnect. Keep the worker, hold live bundles until the state arrives.
          awaitingResync = true;
          feed.pause();
          events.onConnection?.('Opnieuw verbonden, synchroniseren met de andere speler…');
        } else {
          // The sim builds the start setup itself (map features, HQs, start units, start scrap) and runs the AI.
          // Fog of war: the worker writes the snapshots of this player only (what he sees, plus ghosts).
          post({ kind: 'init', init, viewer: you });
          started = true;
          lastProgress = performance.now();
          events.onConnection?.(null);
          resolveStarted();
        }
        return;
      }
      case 'bundle':
        release(feed.push(msg.bundle));
        return;
      case 'resyncResponse': {
        // Also the path of a reloaded tab: it got a fresh `start`, built a new sim at frame 0, and now loads the real state.
        if (env === null) return;
        const { frame, stateBase64, bundles } = msg.response;
        post({ kind: 'load', state: base64ToBuffer(stateBase64), env, viewer: you });
        lastFrame = frame - 1;
        awaitingResync = false;
        lastProgress = performance.now();
        release(feed.resume(frame, bundles));
        events.onConnection?.(null);
        return;
      }
      case 'resyncRequest': {
        // Peer duty: answer with the worker's state; the relay fills in the bundles from its own history.
        if (!started || awaitingResync) return;
        dumpWaiters.push((state) => {
          link.send({
            kind: 'resyncResponse',
            response: {
              frame: state.frame,
              stateBase64: bufferToBase64(state.buffer),
              bundles: [],
            },
          });
        });
        post({ kind: 'dump' });
        return;
      }
      case 'desync': {
        events.onDesync(msg.event);
        if (!started) return;
        // The relay stops handing out bundles after a desync, so the sim halts within DELAY frames of this frame.
        const event = msg.event;
        dumpWaiters.push((state) => {
          saveDesyncDump(buildDesyncDump(event, you, state, Date.now())).catch((err: unknown) =>
            events.onError(`desync-dump mislukt: ${String(err)}`),
          );
        });
        post({ kind: 'dump' });
        return;
      }
      case 'stall':
        relayStall = msg.notice;
        emitStall();
        return;
      case 'error':
        events.onError(msg.message);
        return;
      default:
        return;
    }
  };

  let pump: number | null = null;
  if (net === null) {
    loopback = new LoopbackRelay({ dataVersion: data.dataVersion, defaultMap: map.grid.id });
    link = loopback.connect();
    link.onMessage(onServerMessage);
    // The AI is a lobby player without a connection; it runs in the sim on every client and reports no hashes.
    link.send({ kind: 'join', roomId: 'skirmish', name: 'Jij' });
    loopback.addAi();
    link.send({ kind: 'ready', ready: true });
    const relay = loopback;
    pump = window.setInterval(() => {
      if (started) relay.advance();
    }, TICK_MS);
  } else {
    const transport = new ReconnectingTransport({
      url: net.relayUrl,
      roomId: net.roomId,
      name: net.name,
      clientId: getClientId(safeSessionStorage()),
      onConnection: (up, reconnect) => {
        connected = up;
        if (!up) {
          lobbyKeyReadied = '';
          events.onConnection?.('Verbinding met de relay verbroken, opnieuw verbinden…');
        } else if (!reconnect)
          events.onConnection?.(`Verbonden met ${net.relayUrl}, lobby ${net.roomId}…`);
        emitStall();
      },
    });
    link = transport;
    transport.onMessage(onServerMessage);
    events.onConnection?.(`Verbinden met ${net.relayUrl}…`);
  }

  const stallCheck = window.setInterval(emitStall, STALL_CHECK_MS);

  return {
    get playerId() {
      return you;
    },
    get faction() {
      return faction;
    },
    get frame() {
      return lastFrame;
    },
    started: startedPromise,
    playerName(playerId) {
      const p = roster.find((r) => r.playerId === playerId);
      if (!p) return `Speler ${playerId + 1}`;
      return playerId === you ? 'Jij' : p.name;
    },
    sendCommand(type, payload) {
      if (disposed || you < 0 || awaitingResync) return;
      link.send({
        kind: 'command',
        command: { frame: lastFrame + 1, playerId: you, seq: seq++, type, payload },
      });
    },
    requestStatus() {
      if (started && !disposed && !awaitingResync) post({ kind: 'query', playerId: you });
    },
    requestFog() {
      if (started && !disposed && !awaitingResync) post({ kind: 'fog', playerId: you });
    },
    revealAll(on) {
      if (started && !disposed) post({ kind: 'viewer', viewer: on ? null : you });
    },
    dispose() {
      disposed = true;
      if (pump !== null) window.clearInterval(pump);
      window.clearInterval(stallCheck);
      link.close();
      worker.terminate();
    },
  };
}

function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

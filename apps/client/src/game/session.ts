// A match session: sim worker plus a relay transport. Without URL parameters that is the in-memory loopback with the
// human plus an AI player (the AI itself runs in the sim); with `?relay=ws://host:8787&room=..&name=..` it is the ws
// relay. Both speak the same messages, so everything below the transport choice is shared.
//
// Lobby over ws: the session joins with a clientId from sessionStorage (reused on a reload only, net/params.ts) and
// sets the map to the one the client loaded.
// With `lobby: 'auto'` (the URL shortcuts) it also lets the host (`?ai=1`) add one AI and readies up automatically; with
// `lobby: 'manual'` (the menu's "Speler tegen speler") it only reports the lobby (onLobby, onLink) and leaves faction,
// AI and ready to the player through `lobbyRequest`. The relay starts once everyone is ready.
// Factions (sim 0.18.0, the Raiders are simulated): `?faction=raiders` plays the Raiders, `?aifaction=raiders` gives the
// AI the Raiders; both default to the Dwellers. Over ws and in the loopback alike.
// Reconnect: a dropped socket is re-joined with the same clientId; the relay sends `start` again and a resync, which
// loads the peer's state into the worker (`load`), replays the bundles and continues live (net/resync.ts).
import type { GameData } from '@crawlout/data';
import {
  DELAY_FRAMES_DEFAULT,
  HASH_INTERVAL_FRAMES,
  TICK_MS,
  readSnapshotHeader,
  type CommandPayload,
  type CommandType,
  type Difficulty,
  type FrameBundle,
  type HeroArchetype,
  type LobbyPlayer,
  type ServerMessage,
  type StallNotice,
} from '@crawlout/protocol';
import { LoopbackRelay, type RelayTransport } from '@crawlout/relay/browser';
import type { SimEnv } from '@crawlout/sim';
import type { SimWorkerInbound } from '@crawlout/sim';
import { modeParam, type SessionEvents, type SessionLobbyRequest } from './sessionLobby.js';
import { envOfInit, initFromStart } from './sessionEnv.js';
import SimWorker from '@crawlout/sim/worker?worker';
import type { SimWorkerOutbound } from '@crawlout/sim';
import { identifyYou } from '@crawlout/ui';
import type { ClientMap } from './content.js';
import { buildDesyncDump, saveDesyncDump } from '../net/desyncDump.js';
import { dataVersionError } from '../net/dataVersion.js';
import { getClientId, netOptionsFromSearch, type WsNetOptions } from '../net/params.js';
import { ReconnectingTransport } from '../net/reconnectingTransport.js';
import { BundleFeed, base64ToBuffer, bufferToBase64 } from '../net/resync.js';

/** A faction key if the data knows it, else the default (dwellers). */
function knownFaction(data: GameData, wanted: string | null | undefined): string {
  return data.factions.find((f) => f.key === wanted)?.key ?? 'dwellers';
}

/** A faction key from a URL parameter if the data knows it, else the default (dwellers). */
function factionParam(data: GameData, name: 'faction' | 'aifaction'): string {
  return knownFaction(data, new URLSearchParams(window.location.search).get(name));
}

export interface SessionOptions {
  /** This player's faction; default `?faction=`. */
  faction?: string;
  /** The AI's faction (loopback and `?ai=1`); default `?aifaction=`. */
  aiFaction?: string;
  /** Hero choice (protocol 0.19.0): the archetype of this player's hero; absent = none sent (the Krijger). */
  heroArchetype?: HeroArchetype;
  /** Over ws: `auto` (default) readies itself from the URL options, `manual` leaves the lobby to the player (the menu). */
  lobby?: 'auto' | 'manual';
  /**
   * Game type of a local match (client 0.11.0): 'project' is Bouwproject, Skirmish plus win route C (MatchSettings.mode,
   * protocol 0.16.0); default `?mode=`, else 'skirmish'.
   */
  mode?: 'skirmish' | 'project' | 'survival';
  /** Difficulty of the AI (protocol 0.21.0); absent = not sent, so the AI plays its script as data/ai has it. */
  difficulty?: Difficulty;
}

export type { SessionLobby, SessionLobbyRequest } from './sessionLobby.js';

/** No bundle for this long while a match runs = the lockstep is waiting; shown through onStall. */
const LOCAL_STALL_MS = 2000;
const STALL_CHECK_MS = 500;

export type { SessionEvents } from './sessionLobby.js';

export interface Session {
  /** This client's playerId from the relay's start message (`you`); -1 before the match starts. */
  readonly playerId: number;
  /** Faction key of this player from the start message; null before the match starts. */
  readonly faction: string | null;
  /** Last executed frame seen in a snapshot (-1 before the first); for tests and debugging. */
  readonly frame: number;
  /** The state hash this client computed at a hash frame (every HASH_INTERVAL_FRAMES; the last 64 are kept), for the sync tests. */
  hashAt(frame: number): number | undefined;
  /** Resolves when the first `start` arrived (immediately for the loopback); playerId and faction are valid then. */
  readonly started: Promise<void>;
  /** Display name of a player from the start message (AI players included). */
  playerName(playerId: number): string;
  sendCommand<T extends CommandType>(type: T, payload: CommandPayload<T>): void;
  /** Lobby (ws, before the match): faction, AI, ready. Ignored without a relay connection. */
  lobbyRequest(request: SessionLobbyRequest): void;
  /** Survival co-op: the build zones per slot (sim units) of this match, undefined outside the game type Survival. */
  survivalZones(): readonly { x: number; y: number; radius: number }[] | undefined;
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
  options: SessionOptions = {},
): Session {
  const ownFaction = options.faction
    ? knownFaction(data, options.faction)
    : factionParam(data, 'faction');
  const aiFaction = options.aiFaction
    ? knownFaction(data, options.aiFaction)
    : factionParam(data, 'aifaction');
  const manualLobby = options.lobby === 'manual';
  const gameMode = options.mode ?? modeParam(new URLSearchParams(location.search).get('mode'));
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

  const hashLog = new Map<number, number>();

  worker.onmessage = (ev: MessageEvent<SimWorkerOutbound>) => {
    const msg = ev.data;
    if (msg.kind === 'snapshot') {
      const header = readSnapshotHeader(msg.buffer);
      lastFrame = header.tick;
      lastProgress = performance.now();
      if (header.tick % HASH_INTERVAL_FRAMES === 0) {
        hashLog.set(header.tick, header.hash);
        hashLog.delete(header.tick - 64 * HASH_INTERVAL_FRAMES);
        link.send({
          kind: 'hash',
          report: { frame: header.tick, playerId: you, hash: header.hash },
        });
      }
      events.onSnapshot(msg.buffer);
    } else if (msg.kind === 'hashes') {
      // Catch-up (resync, stall): the worker posts only the last snapshot of a beat and reports the hashes of the
      // frames in between here; the relay expects one per HASH_INTERVAL_FRAMES frames.
      for (const r of msg.reports) {
        hashLog.set(r.frame, r.hash);
        hashLog.delete(r.frame - 64 * HASH_INTERVAL_FRAMES);
      }
      for (const r of msg.reports)
        link.send({ kind: 'hash', report: { frame: r.frame, playerId: you, hash: r.hash } });
    } else if (msg.kind === 'state') {
      dumpWaiters.shift()?.(msg);
    } else if (msg.kind === 'status') {
      events.onStatus?.(msg.status, msg.winner, msg.frame);
    } else if (msg.kind === 'fog') {
      events.onFog?.(msg.mask);
    } else if (msg.kind === 'error') {
      events.onError(msg.message);
    }
  };

  const release = (bundles: readonly FrameBundle[]): void => {
    for (const bundle of bundles) post({ kind: 'bundle', bundle });
  };

  // Lobby over ws: set the map, let the host add the AI, ready up once per distinct lobby (a join or a map change
  // un-readies everyone, so a changed lobby needs a fresh ready).
  let lobbyKeyReadied = '';
  let youId: number | null = null;
  let aiRequested = false;
  const onLobby = (msg: Extract<ServerMessage, { kind: 'lobby' }>): void => {
    if (!net) return;
    roster = msg.players;
    events.onLobby?.({
      roomId: msg.roomId,
      map: msg.map,
      players: msg.players,
      you: msg.you ?? null,
      ...(msg.settings ? { mode: msg.settings.mode } : {}),
    });
    if (manualLobby) {
      // The player drives the lobby; only the map is ours to set (one map, the one this client loaded).
      if (msg.map !== map.grid.id) link.send({ kind: 'setMap', map: map.grid.id });
      return;
    }
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
      link.send({ kind: 'addAi', faction: aiFaction });
      return;
    }
    // this player's faction (`?faction=`): set it once the lobby shows another
    // (`you` from the relay; only without it match the name, which the relay may have renamed to "Naam 2")
    youId = msg.you ?? identifyYou(msg.players, net.name, youId);
    const mine = msg.players.find((p) => p.playerId === youId);
    if (mine !== undefined && mine.faction !== ownFaction) {
      link.send({ kind: 'setFaction', faction: ownFaction });
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
        const init = initFromStart(data, map, msg);
        env = envOfInit(init);
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
        // A failed resync (e.g. no peer) leaves the match paused for good: say why on the in-match overlay.
        if (awaitingResync) events.onConnection?.(`Synchroniseren mislukt: ${msg.message}`);
        return;
      default:
        return;
    }
  };

  let pump: number | null = null;
  if (net === null) {
    loopback = new LoopbackRelay({
      dataVersion: data.dataVersion,
      defaultMap: map.grid.id,
      ...(gameMode === 'survival' ? { minPlayers: 1 } : {}),
    });
    link = loopback.connect();
    link.onMessage(onServerMessage);
    // The AI is a lobby player without a connection; it runs in the sim on every client and reports no hashes.
    link.send({ kind: 'join', roomId: 'skirmish', name: 'Jij' });
    link.send({ kind: 'setFaction', faction: ownFaction });
    if (options.heroArchetype !== undefined)
      link.send({ kind: 'setHero', heroArchetype: options.heroArchetype });
    // win route C: the game type Bouwproject puts the strip mall into the sim (the host's settings); Survival co-op
    // too, but without the AI (the scripted AI does not know survival) and solo (the relay's minimum is 1 here).
    // Difficulty (protocol 0.21.0): only when the menu chose one; Survival has no AI player, so no level either.
    const difficulty = gameMode === 'survival' ? undefined : options.difficulty;

    if (gameMode !== 'skirmish' || difficulty !== undefined)
      link.send({
        kind: 'setSettings',
        settings: {
          mode: gameMode,
          delayFrames: DELAY_FRAMES_DEFAULT,
          ...(difficulty === undefined ? {} : { difficulty }),
        },
      });
    if (gameMode !== 'survival') loopback.addAi(aiFaction);
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
        events.onLink?.(up ? 'up' : 'down');
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
    hashAt: (frame) => hashLog.get(frame),
    started: startedPromise,
    playerName(playerId) {
      const p = roster.find((r) => r.playerId === playerId);
      if (!p) return `Speler ${playerId + 1}`;
      return playerId === you ? 'Jij' : p.name;
    },
    lobbyRequest(request) {
      if (!net || disposed || started) return;
      if (request.kind === 'setMode')
        link.send({
          kind: 'setSettings',
          settings: { mode: request.mode, delayFrames: DELAY_FRAMES_DEFAULT },
        });
      else link.send(request);
    },
    survivalZones: () => env?.map.survival?.zones,
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

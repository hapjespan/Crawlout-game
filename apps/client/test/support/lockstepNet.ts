// Deterministic, clock-free network harness for lockstep tests: the real Room, real sims (real data, Rustbelt),
// the real BundleFeed and base64 helpers, and a virtual clock in which every message takes `oneWayMs` each way.
// One step = one relay tick (TICK_MS). Nothing here uses timers or Math.random, so a run is reproducible.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MapDef, convertDominance } from '@crawlout/data';
import type { GameData } from '@crawlout/data';
import { loadGameDataFromDir } from '@crawlout/data/node';
import { loadMap } from '@crawlout/map';
import { HASH_INTERVAL_FRAMES, TICK_MS } from '@crawlout/protocol';
import type { ClientMessage, FrameBundle, ServerMessage } from '@crawlout/protocol';
import { Room } from '@crawlout/relay';
import {
  createSim,
  deserialize,
  simConfigFromGameData,
  simMapFromGrid,
  simPlayersFromLobby,
} from '@crawlout/sim';
import type { Sim, SimEnv } from '@crawlout/sim';
import { BundleFeed, base64ToBuffer, bufferToBase64 } from '../../src/net/resync.js';

const DATA_DIR = fileURLToPath(new URL('../../../../data', import.meta.url));
const SEED = 20261014;
/** Same as MAX_CATCH_UP_TICKS in packages/sim/host/worker-entry.ts: ticks per 50 ms timer slot. */
export const TICKS_PER_STEP = 8;

let cachedData: GameData | null = null;
const gameData = (): GameData => (cachedData ??= loadGameDataFromDir(DATA_DIR));

/** The sim environment for a `start` message, built from the real data files (as the client does in session.ts). */
export function envFromStart(start: Extract<ServerMessage, { kind: 'start' }>): SimEnv {
  const data = gameData();
  const def = MapDef.parse(JSON.parse(readFileSync(`${DATA_DIR}/maps/${start.map}.json`, 'utf8')));
  const grid = loadMap(def, { read: (ref) => readFileSync(`${DATA_DIR}/${ref}`, 'utf8') });
  const dominance = convertDominance({
    pointsRequired: def.dominance.pointsRequired,
    minutes: start.settings.dominanceMinutes ?? def.dominance.minutes,
  });
  const players = start.players.map((p) => ({
    playerId: p.playerId,
    faction: p.faction,
    ai: p.ai,
  }));
  return {
    players: simPlayersFromLobby(data, players),
    map: simMapFromGrid(
      { ...grid, dominance },
      start.settings.mode === 'project' ? { project: data.project } : {},
    ),
    config: simConfigFromGameData(data),
  };
}

interface Timed<T> {
  at: number;
  msg: T;
}

export interface CommandSample {
  playerId: number;
  /** envelope.frame: the frame in which the player gave it. */
  frame: number;
  /** The frame the relay issued next when the command arrived. */
  relayNext: number;
  /** The relay's DELAY at that moment. */
  delay: number;
}

export class TestClient {
  sim: Sim | null = null;
  env: SimEnv | null = null;
  readonly feed = new BundleFeed();
  readonly received: ServerMessage[] = [];
  /** Hash after every executed frame, by frame. */
  readonly hashes = new Map<number, number>();
  online = true;
  /** True between a second `start` and the resync state: the sim is stale and must not tick. */
  awaitingResync = false;
  connId: string;
  seq = 0;
  playerId = -1;
  private readonly released: FrameBundle[] = [];
  private readonly down: Timed<ServerMessage>[] = [];
  /** Ticks per step; a resyncing client runs at the same cap as the worker. */
  ticksPerStep = TICKS_PER_STEP;
  /** Frame the sim had when the resync state was loaded (for catch-up assertions). */
  resyncedAtFrame: number | null = null;

  constructor(
    private readonly net: TestNet,
    readonly name: string,
    readonly clientId: string,
  ) {
    this.connId = `${name}-0`;
  }

  deliver(msg: ServerMessage, at: number): void {
    this.down.push({ at, msg });
  }

  send(msg: ClientMessage): void {
    this.net.sendUp(this, msg);
  }

  /** The next frame this client will execute, or -1 before the match. */
  get frame(): number {
    return this.sim?.frame ?? -1;
  }

  /** Reads what has arrived, runs up to ticksPerStep ticks, reports hashes and gives a scripted command. */
  pump(clock: number): void {
    while (this.down.length > 0 && (this.down[0] as Timed<ServerMessage>).at <= clock)
      this.onServer((this.down.shift() as Timed<ServerMessage>).msg);
    const sim = this.sim;
    if (sim === null || this.awaitingResync) return;
    for (const b of this.released.splice(0)) sim.applyBundle(b);
    for (let n = 0; n < this.ticksPerStep && sim.hasBundle(); n++) {
      const hash = sim.tick();
      const frame = sim.frame - 1;
      this.hashes.set(frame, hash);
      if (frame % HASH_INTERVAL_FRAMES === 0)
        this.send({ kind: 'hash', report: { frame, playerId: this.playerId, hash } });
    }
    this.giveCommand(sim);
  }

  /** A deterministic Move for up to 10 own units every 6th frame; the relay schedules it at frame + DELAY. */
  private giveCommand(sim: Sim): void {
    if (sim.frame % 6 !== this.playerId) return;
    const ids = sim
      .entityIds()
      .filter((id) => {
        const u = sim.getUnit(id);
        return u?.kind === 'unit' && u.owner === this.playerId;
      })
      .slice(0, 10);
    if (ids.length === 0) return;
    const cell = 30 + ((sim.frame * 7 + this.playerId * 13) % 60);
    this.send({
      kind: 'command',
      command: {
        frame: sim.frame,
        playerId: this.playerId,
        seq: this.seq++,
        type: 'Move',
        payload: { ids, x: cell * 256 + 128, y: (127 - cell) * 256 + 128 },
      },
    });
  }

  private release(bundles: readonly FrameBundle[]): void {
    this.released.push(...bundles);
  }

  private onServer(msg: ServerMessage): void {
    this.received.push(msg);
    switch (msg.kind) {
      case 'start': {
        this.playerId = msg.you;
        this.env = envFromStart(msg);
        if (this.sim === null) {
          this.sim = createSim({ seed: msg.seed, ...this.env });
        } else {
          // Second start = reconnect: keep the (stale) sim until the state arrives, hold live bundles meanwhile.
          this.awaitingResync = true;
          this.feed.pause();
        }
        return;
      }
      case 'bundle':
        this.release(this.feed.push(msg.bundle));
        return;
      case 'resyncRequest': {
        if (this.sim === null || this.awaitingResync) return;
        this.send({
          kind: 'resyncResponse',
          response: {
            frame: this.sim.frame,
            stateBase64: bufferToBase64(this.sim.serialize()),
            bundles: [],
          },
        });
        return;
      }
      case 'resyncResponse': {
        const { frame, stateBase64, bundles } = msg.response;
        if (this.env === null) return;
        this.sim = deserialize(base64ToBuffer(stateBase64), this.env);
        this.resyncedAtFrame = frame;
        this.released.length = 0;
        this.awaitingResync = false;
        this.release(this.feed.resume(frame, bundles));
        return;
      }
      default:
        return;
    }
  }
}

export class TestNet {
  clock = 0;
  readonly room: Room;
  readonly clients: TestClient[] = [];
  readonly commandLog: CommandSample[] = [];
  private readonly up: Array<Timed<ClientMessage> & { client: TestClient; connId: string }> = [];
  private readonly byConn = new Map<string, TestClient>();

  constructor(readonly oneWayMs: number) {
    this.room = new Room({
      roomId: 'latency',
      chooseSeed: () => SEED,
      now: () => this.clock,
      recordReplay: true,
      send: (connId, msg) => this.byConn.get(connId)?.deliver(msg, this.clock + this.oneWayMs),
    });
  }

  /** Joins and readies the clients directly (the lobby is not under test); `start` then travels with latency. */
  addClients(count: number): TestClient[] {
    const added: TestClient[] = [];
    for (let i = 0; i < count; i++) {
      const c = new TestClient(
        this,
        `c${this.clients.length}`,
        `client-${this.clients.length}-testtest`,
      );
      this.clients.push(c);
      this.byConn.set(c.connId, c);
      this.room.handle(c.connId, {
        kind: 'join',
        roomId: 'latency',
        name: c.name,
        clientId: c.clientId,
      });
      added.push(c);
    }
    for (const c of added) this.room.handle(c.connId, { kind: 'ready', ready: true });
    return added;
  }

  sendUp(client: TestClient, msg: ClientMessage): void {
    if (client.online)
      this.up.push({ at: this.clock + this.oneWayMs, msg, client, connId: client.connId });
  }

  /** The connection drops: nothing in flight arrives, the relay sees a disconnect. */
  drop(client: TestClient): void {
    client.online = false;
    this.room.disconnect(client.connId);
    this.byConn.delete(client.connId);
    for (let i = this.up.length - 1; i >= 0; i--)
      if ((this.up[i] as { client: TestClient }).client === client) this.up.splice(i, 1);
  }

  /** A new connection with the same clientId: the relay answers with `start` and starts the resync. */
  reconnect(client: TestClient): void {
    client.connId = `${client.name}-${client.connId.endsWith('-0') ? 1 : 2}`;
    client.online = true;
    this.byConn.set(client.connId, client);
    client.send({ kind: 'join', roomId: 'latency', name: client.name, clientId: client.clientId });
  }

  step(): void {
    this.clock += TICK_MS;
    while (this.up.length > 0 && (this.up[0] as Timed<ClientMessage>).at <= this.clock) {
      const { msg, client, connId } = this.up.shift() as Timed<ClientMessage> & {
        client: TestClient;
        connId: string;
      };
      if (connId !== client.connId) continue;
      if (msg.kind === 'command') {
        this.commandLog.push({
          playerId: msg.command.playerId,
          frame: msg.command.frame,
          relayNext: this.relayNext,
          delay: this.room.delayFrames,
        });
      }
      this.room.handle(connId, msg);
    }
    this.room.advance();
    for (const c of this.clients) if (c.online) c.pump(this.clock);
  }

  run(steps: number): void {
    for (let i = 0; i < steps; i++) this.step();
  }

  /** Frame of the next bundle the relay will issue. */
  get relayNext(): number {
    return this.room.recordedBundles.length;
  }
}

/** Frames both clients executed with differing hashes (empty = identical). */
export function hashMismatches(
  a: TestClient,
  b: TestClient,
  fromFrame = 0,
): Array<{ frame: number; a: number; b: number }> {
  const out: Array<{ frame: number; a: number; b: number }> = [];
  for (const [frame, hash] of a.hashes) {
    const other = b.hashes.get(frame);
    if (frame >= fromFrame && other !== undefined && other !== hash)
      out.push({ frame, a: hash, b: other });
  }
  return out;
}

export function commonFrames(a: TestClient, b: TestClient, fromFrame = 0): number {
  let n = 0;
  for (const frame of a.hashes.keys()) if (frame >= fromFrame && b.hashes.has(frame)) n++;
  return n;
}

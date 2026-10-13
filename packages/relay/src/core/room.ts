import {
  DELAY_FRAMES_DEFAULT,
  DELAY_FRAMES_MAX,
  DELAY_FRAMES_MIN,
  MAX_PLAYERS,
  type ClientMessage,
  type DesyncEvent,
  type FrameBundle,
  type ServerMessage,
} from '@crawlout/protocol';
import { HashComparator } from './hashCompare.js';
import { FrameScheduler } from './scheduler.js';

type StartMessage = Extract<ServerMessage, { kind: 'start' }>;
type Settings = StartMessage['settings'];
type Player = StartMessage['players'][number];

export interface RoomOptions {
  roomId: string;
  /** Levert een bericht af bij een verbinding. De schil (ws, loopback) implementeert dit. */
  send: (connId: string, msg: ServerMessage) => void;
  /** Seed voor de sim; standaard Math.random. Injecteerbaar voor tests. */
  chooseSeed?: () => number;
  dataVersion?: string;
  defaultMap?: string;
  defaultFaction?: string;
  /** Minimaal aantal spelers voordat alle-ready het potje start. */
  minPlayers?: number;
  settings?: Partial<Settings>;
}

/** Lobby plus lockstep-relay voor één room. Geen timers: de schil roept advance() aan per tick. */
export class Room {
  readonly roomId: string;
  private readonly send: RoomOptions['send'];
  private readonly chooseSeed: () => number;
  private readonly dataVersion: string;
  private readonly defaultFaction: string;
  private readonly minPlayers: number;
  private readonly settings: Settings;
  private readonly conns = new Map<string, number>(); // connId -> playerId
  private readonly players = new Map<number, Player>();
  private readonly hashExempt = new Set<number>();
  private readonly comparator = new HashComparator();
  private scheduler: FrameScheduler | null = null;
  private map: string;
  private started = false;
  private halted = false;
  private readonly history: FrameBundle[] = [];

  constructor(options: RoomOptions) {
    this.roomId = options.roomId;
    this.send = options.send;
    this.chooseSeed = options.chooseSeed ?? (() => Math.floor(Math.random() * 0x1_0000_0000));
    this.dataVersion = options.dataVersion ?? '0';
    this.defaultFaction = options.defaultFaction ?? 'dwellers';
    this.minPlayers = options.minPlayers ?? 2;
    const delay = Math.min(DELAY_FRAMES_MAX, Math.max(DELAY_FRAMES_MIN, options.settings?.delayFrames ?? DELAY_FRAMES_DEFAULT));
    this.settings = { mode: 'skirmish', dominanceMinutes: 10, ...options.settings, delayFrames: delay };
    this.map = options.defaultMap ?? 'rustbelt';
  }

  get isStarted(): boolean {
    return this.started;
  }
  get isHalted(): boolean {
    return this.halted;
  }
  get connectionCount(): number {
    return this.conns.size;
  }
  /** Alle tot nu toe uitgegeven bundels (voor replay-opname). */
  get bundles(): readonly FrameBundle[] {
    return this.history;
  }

  /** Markeert een verbinding (bijv. de AI in loopback) als niet-hashend; zij telt niet mee in de vergelijking. */
  setHashExempt(connId: string, exempt: boolean): void {
    const id = this.conns.get(connId);
    if (id === undefined) return;
    if (exempt) this.hashExempt.add(id);
    else this.hashExempt.delete(id);
  }

  handle(connId: string, msg: ClientMessage): void {
    if (msg.kind === 'join') return this.join(connId, msg.name);
    const playerId = this.conns.get(connId);
    if (playerId === undefined) return this.error(connId, 'eerst joinen');
    const player = this.players.get(playerId) as Player;
    switch (msg.kind) {
      case 'leave':
        return this.disconnect(connId);
      case 'ready':
        if (this.started) return this.error(connId, 'potje is al gestart');
        player.ready = msg.ready;
        this.broadcastLobby();
        return this.maybeStart();
      case 'setFaction':
        if (this.started) return this.error(connId, 'potje is al gestart');
        player.faction = msg.faction;
        player.ready = false;
        return this.broadcastLobby();
      case 'setMap':
        if (this.started) return this.error(connId, 'potje is al gestart');
        this.map = msg.map;
        for (const p of this.players.values()) p.ready = false;
        return this.broadcastLobby();
      case 'chat':
        return this.broadcast({ kind: 'chat', playerId, text: msg.text });
      case 'command': {
        if (!this.scheduler || this.halted) return this.error(connId, 'geen lopend potje');
        if (msg.command.playerId !== playerId) return this.error(connId, 'playerId komt niet overeen met verbinding');
        if (this.scheduler.submit(msg.command) === null) this.error(connId, 'commando te ver vooruit');
        return;
      }
      case 'hash': {
        if (!this.started || this.halted) return;
        if (msg.report.playerId !== playerId) return this.error(connId, 'playerId komt niet overeen met verbinding');
        return this.afterHash(this.comparator.report(msg.report, this.expectedHashers()));
      }
      case 'resyncRequest':
      case 'resyncResponse':
        return this.error(connId, 'resync nog niet ondersteund');
    }
  }

  /** Verbinding weg. In de lobby verdwijnt de speler; in een potje wordt hij offline. */
  disconnect(connId: string): void {
    const playerId = this.conns.get(connId);
    if (playerId === undefined) return;
    this.conns.delete(connId);
    this.hashExempt.delete(playerId);
    if (this.started) {
      const p = this.players.get(playerId);
      if (p) p.online = false;
      if (!this.halted) this.afterHash(this.comparator.recheck(this.expectedHashers()));
    } else {
      this.players.delete(playerId);
      this.broadcastLobby();
    }
  }

  /** Eén tick: geeft de volgende bundel uit aan alle verbonden spelers. Geen effect voor start of na desync. */
  advance(): FrameBundle | null {
    if (!this.scheduler || this.halted) return null;
    const bundle = this.scheduler.advance();
    this.history.push(bundle);
    this.broadcast({ kind: 'bundle', bundle });
    return bundle;
  }

  private join(connId: string, name: string): void {
    if (this.conns.has(connId)) return this.error(connId, 'al gejoind');
    if (this.started) return this.error(connId, 'potje is al gestart');
    let playerId = -1;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      if (!this.players.has(i)) {
        playerId = i;
        break;
      }
    }
    if (playerId < 0) return this.error(connId, 'room is vol');
    this.conns.set(connId, playerId);
    this.players.set(playerId, { playerId, name, faction: this.defaultFaction, ready: false, online: true });
    for (const p of this.players.values()) p.ready = false;
    this.broadcastLobby();
  }

  private maybeStart(): void {
    const list = this.sortedPlayers();
    if (list.length < this.minPlayers || !list.every((p) => p.ready)) return;
    this.started = true;
    const seed = this.chooseSeed() >>> 0;
    this.scheduler = new FrameScheduler(this.settings.delayFrames);
    for (const [connId, playerId] of this.conns) {
      this.send(connId, {
        kind: 'start',
        seed,
        map: this.map,
        players: this.sortedPlayers(),
        settings: { ...this.settings },
        dataVersion: this.dataVersion,
        you: playerId,
      });
    }
  }

  private afterHash(ev: DesyncEvent | null): void {
    if (!ev) return;
    this.halted = true; // slice: een desync stopt het potje
    this.broadcast({ kind: 'desync', event: ev });
  }

  private expectedHashers(): number[] {
    return this.sortedPlayers()
      .filter((p) => p.online && !this.hashExempt.has(p.playerId))
      .map((p) => p.playerId);
  }

  private sortedPlayers(): Player[] {
    return [...this.players.values()].sort((a, b) => a.playerId - b.playerId).map((p) => ({ ...p }));
  }

  private broadcastLobby(): void {
    this.broadcast({ kind: 'lobby', roomId: this.roomId, map: this.map, players: this.sortedPlayers() });
  }

  private broadcast(msg: ServerMessage): void {
    for (const connId of this.conns.keys()) this.send(connId, msg);
  }

  private error(connId: string, message: string): void {
    this.send(connId, { kind: 'error', message });
  }
}

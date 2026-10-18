import {
  DELAY_FRAMES_DEFAULT,
  type ClientMessage,
  type DesyncEvent,
  type FrameBundle,
  type ResyncResponse,
  type ServerMessage,
} from '@crawlout/protocol';
import { DELAY_EVAL_INTERVAL_FRAMES, DelayController } from './delay.js';
import { HashComparator } from './hashCompare.js';
import { FrameScheduler } from './scheduler.js';
import {
  RESYNC_HISTORY_FRAMES,
  clampDelay,
  type PendingResync,
  type Player,
  type RoomInternals,
  type RoomOptions,
  type Settings,
  type StartMessage,
} from './room.shared.js';
import { roomDisconnect, roomHandle } from './room.handle.js';
import {
  roomBroadcastLobby,
  roomFreeSlot,
  roomHostCheck,
  roomHostId,
  roomJoin,
  roomMaybeStart,
  roomRejoin,
  roomSortedPlayers,
  roomStartMessage,
  roomUniqueName,
  roomUnreadyHumans,
} from './room.lobby.js';
import {
  roomAfterHash,
  roomAssignPeer,
  roomCheckResyncTimeouts,
  roomCheckStall,
  roomExpectedFor,
  roomOnResyncResponse,
  roomSampleLag,
} from './room.sync.js';

export { RESYNC_HISTORY_FRAMES, RESYNC_TIMEOUT_MS, type RoomOptions } from './room.shared.js';

/** The sibling modules see the room through its internal view (private fields and helpers). */
const internals = (room: Room): RoomInternals => room as unknown as RoomInternals;

/** Lobby plus lockstep-relay voor één room. Geen timers: de schil roept advance() aan per tick. */
export class Room {
  readonly roomId: string;
  private readonly send: RoomOptions['send'];
  private readonly chooseSeed: () => number;
  private readonly dataVersion: string;
  private readonly defaultFaction: string;
  private readonly minPlayers: number;
  private readonly now: () => number;
  private readonly adaptiveDelay: boolean;
  private settings: Settings;
  private readonly conns = new Map<string, number>(); // connId -> playerId
  private readonly connOf = new Map<number, string>(); // playerId -> connId
  private readonly clientIds = new Map<number, string>();
  private readonly players = new Map<number, Player>();
  private readonly hashExempt = new Set<number>();
  /** Vanaf welk frame een speler hashes moet melden; Infinity zolang hij zijn resync nog niet heeft. */
  private readonly hashFrom = new Map<number, number>();
  private readonly sampleAfter = new Map<number, number>();
  private readonly lastFrameOffline = new Map<number, number>();
  private readonly resyncs = new Map<number, PendingResync>(); // doelspeler -> verzoek
  private readonly comparator: HashComparator;
  private readonly delay = new DelayController();
  private scheduler: FrameScheduler | null = null;
  private map: string;
  private started = false;
  private halted = false;
  private stallKey = '';
  private history: FrameBundle[] = [];
  private readonly recording: FrameBundle[] | null;

  constructor(options: RoomOptions) {
    this.roomId = options.roomId;
    this.send = options.send;
    this.now = options.now ?? Date.now;
    this.comparator = new HashComparator(this.now);
    this.chooseSeed = options.chooseSeed ?? (() => Math.floor(Math.random() * 0x1_0000_0000));
    this.dataVersion = options.dataVersion ?? '0';
    this.defaultFaction = options.defaultFaction ?? 'dwellers';
    this.minPlayers = options.minPlayers ?? 2;
    this.adaptiveDelay = options.adaptiveDelay ?? true;
    this.recording = options.recordReplay ? [] : null;
    // Geen spelregelgetallen hier: dominanceMinutes komt via setSettings of, als hij ontbreekt, uit de map.
    this.settings = {
      mode: 'skirmish',
      ...options.settings,
      delayFrames: clampDelay(options.settings?.delayFrames ?? DELAY_FRAMES_DEFAULT),
    };
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
  /** Huidige (adaptieve) DELAY in frames. */
  get delayFrames(): number {
    return this.scheduler?.delayFrames ?? this.settings.delayFrames;
  }
  /** Afgevlakte gemeten round-trip van de langzaamste speler in frames, of null zonder metingen. */
  get measuredLagFrames(): number | null {
    return this.delay.slowestLag;
  }
  /** De recent uitgegeven bundels (laatste RESYNC_HISTORY_FRAMES); begrensd. */
  get bundles(): readonly FrameBundle[] {
    return this.history;
  }
  /** Alle bundels sinds de start, alleen met `recordReplay`; anders de recente. */
  get recordedBundles(): readonly FrameBundle[] {
    return this.recording ?? this.history;
  }
  /** Spelers met een resync in uitvoering (doel, peer). Voor tests en debug. */
  get pendingResyncs(): ReadonlyMap<number, { peer: number }> {
    return this.resyncs;
  }

  /** Markeert een verbinding als niet-hashend (spectator of debug); zij telt niet mee in de vergelijking. */
  setHashExempt(connId: string, exempt: boolean): void {
    const id = this.conns.get(connId);
    if (id === undefined) return;
    if (exempt) this.hashExempt.add(id);
    else this.hashExempt.delete(id);
  }

  /** Voegt een AI-speler toe (zonder host-controle; de schil van de host, bijv. loopback). Geeft playerId of null. */
  addAi(faction: string): number | null {
    if (this.started) return null;
    const playerId = this.freeSlot();
    if (playerId < 0) return null;
    this.players.set(playerId, {
      playerId,
      name: `AI ${playerId + 1}`,
      faction,
      ready: true,
      online: true,
      ai: true,
    });
    this.unreadyHumans();
    this.broadcastLobby();
    return playerId;
  }

  removeAi(playerId: number): boolean {
    if (this.started || !this.players.get(playerId)?.ai) return false;
    this.players.delete(playerId);
    this.unreadyHumans();
    this.broadcastLobby();
    return true;
  }

  handle(connId: string, msg: ClientMessage): void {
    return roomHandle(internals(this), connId, msg);
  }

  /** Verbinding weg. In de lobby verdwijnt de speler; in een potje wordt hij offline. */
  disconnect(connId: string): void {
    return roomDisconnect(internals(this), connId);
  }

  /** Eén tick: geeft de volgende bundel uit aan alle verbonden spelers. Geen effect voor start of na desync. */
  advance(): FrameBundle | null {
    if (!this.scheduler || this.halted) return null;
    const bundle = this.scheduler.advance();
    this.history.push(bundle);
    if (this.history.length > RESYNC_HISTORY_FRAMES + RESYNC_HISTORY_FRAMES / 4)
      this.history = this.history.slice(-RESYNC_HISTORY_FRAMES);
    this.recording?.push(bundle);
    this.broadcast({ kind: 'bundle', bundle });
    if (this.adaptiveDelay && this.scheduler.nextFrame % DELAY_EVAL_INTERVAL_FRAMES === 0) {
      this.scheduler.delayFrames = this.delay.evaluate(this.scheduler.delayFrames);
    }
    this.checkResyncTimeouts();
    this.checkStall();
    return bundle;
  }

  // --- lobby (room.lobby.ts) ---

  private join(connId: string, name: string, clientId: string | undefined): void {
    return roomJoin(internals(this), connId, name, clientId);
  }

  private uniqueName(name: string): string {
    return roomUniqueName(internals(this), name);
  }

  private rejoin(connId: string, playerId: number): void {
    return roomRejoin(internals(this), connId, playerId);
  }

  private maybeStart(): void {
    return roomMaybeStart(internals(this));
  }

  private seed = 0;

  private startMessage(playerId: number): StartMessage {
    return roomStartMessage(internals(this), playerId);
  }

  private hostId(): number {
    return roomHostId(internals(this));
  }

  private hostCheck(connId: string, playerId: number): boolean {
    return roomHostCheck(internals(this), connId, playerId);
  }

  private freeSlot(): number {
    return roomFreeSlot(internals(this));
  }

  private unreadyHumans(): void {
    return roomUnreadyHumans(internals(this));
  }

  // --- hashes en stall (room.sync.ts) ---

  private afterHash(ev: DesyncEvent | null): void {
    return roomAfterHash(internals(this), ev);
  }

  private readonly expectedFor = (frame: number): number[] =>
    roomExpectedFor(internals(this), frame);

  private checkStall(): void {
    return roomCheckStall(internals(this));
  }

  private sampleLag(playerId: number, lagFrames: number): void {
    return roomSampleLag(internals(this), playerId, lagFrames);
  }

  // --- resync (room.sync.ts) ---

  private assignPeer(target: number, tried: Set<number>, lastFrame: number): void {
    return roomAssignPeer(internals(this), target, tried, lastFrame);
  }

  private onResyncResponse(connId: string, peerId: number, response: ResyncResponse): void {
    return roomOnResyncResponse(internals(this), connId, peerId, response);
  }

  private checkResyncTimeouts(): void {
    return roomCheckResyncTimeouts(internals(this));
  }

  private sortedPlayers(): Player[] {
    return roomSortedPlayers(internals(this));
  }

  private broadcastLobby(): void {
    return roomBroadcastLobby(internals(this));
  }

  private broadcast(msg: ServerMessage): void {
    for (const connId of this.conns.keys()) this.send(connId, msg);
  }

  private error(connId: string, message: string): void {
    this.send(connId, { kind: 'error', message });
  }
}

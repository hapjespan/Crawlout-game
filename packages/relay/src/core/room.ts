import {
  DELAY_FRAMES_DEFAULT,
  DELAY_FRAMES_MAX,
  DELAY_FRAMES_MIN,
  MAX_PLAYERS,
  STALL_TIMEOUT_MS,
  type ClientMessage,
  type DesyncEvent,
  type FrameBundle,
  type ResyncResponse,
  type ServerMessage,
} from '@crawlout/protocol';
import { DELAY_EVAL_INTERVAL_FRAMES, DelayController } from './delay.js';
import { HashComparator } from './hashCompare.js';
import { FrameScheduler } from './scheduler.js';

type StartMessage = Extract<ServerMessage, { kind: 'start' }>;
type Settings = StartMessage['settings'];
type Player = StartMessage['players'][number];

/**
 * Zoveel recente bundels houdt de relay vast voor resync (60 s bij 20 Hz). De aangewezen peer serialiseert zijn
 * state op het moment van het verzoek, dus de state is hooguit enkele seconden oud; langer terug is nooit nodig.
 * Een volledige opname voor replays staat achter `recordReplay`.
 */
export const RESYNC_HISTORY_FRAMES = 1200;
/** Antwoordt de aangewezen peer niet binnen dit aantal ms, dan wijst de relay een volgende peer aan. */
export const RESYNC_TIMEOUT_MS = 5000;
/** Na een resync negeren we de latency-metingen van die speler zo lang (de client haalt dan versneld in). */
const SAMPLE_GRACE_FRAMES = 100;
/** Zelfde maximum als `name` in het protocol (lobby.ts). */
const MAX_NAME_LENGTH = 32;

export interface RoomOptions {
  roomId: string;
  /** Levert een bericht af bij een verbinding. De schil (ws, loopback) implementeert dit. */
  send: (connId: string, msg: ServerMessage) => void;
  /** Seed voor de sim; standaard Math.random. Injecteerbaar voor tests. */
  chooseSeed?: () => number;
  dataVersion?: string;
  defaultMap?: string;
  defaultFaction?: string;
  /** Minimaal aantal spelers (mens plus AI) voordat alle-ready het potje start. */
  minPlayers?: number;
  /** Begininstellingen; de host overschrijft ze met setSettings. delayFrames is de startwaarde van de adaptieve DELAY. */
  settings?: Partial<Settings>;
  /** Klok in ms voor stall en resync-timeouts; injecteerbaar voor tests. Standaard Date.now. */
  now?: () => number;
  /** Adaptieve DELAY uit gemeten round-trip. Standaard aan; uit = DELAY blijft settings.delayFrames. */
  adaptiveDelay?: boolean;
  /** Bewaar álle bundels (voor replay-opname) in plaats van alleen de recente. Standaard uit. */
  recordReplay?: boolean;
}

interface PendingResync {
  peer: number;
  requestedAt: number;
  lastFrame: number;
  tried: Set<number>;
}

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
    if (msg.kind === 'join') return this.join(connId, msg.name, msg.clientId);
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
        this.unreadyHumans();
        return this.broadcastLobby();
      case 'setSettings': {
        if (!this.hostCheck(connId, playerId)) return;
        const { mode, delayFrames, dominanceMinutes } = msg.settings;
        this.settings = {
          mode,
          delayFrames: clampDelay(delayFrames),
          ...(dominanceMinutes === undefined ? {} : { dominanceMinutes }),
        };
        this.unreadyHumans();
        return this.broadcastLobby();
      }
      case 'addAi':
        if (!this.hostCheck(connId, playerId)) return;
        if (this.addAi(msg.faction) === null) this.error(connId, 'room is vol');
        return;
      case 'removeAi':
        if (!this.hostCheck(connId, playerId)) return;
        if (!this.removeAi(msg.playerId)) this.error(connId, 'geen AI-speler met dat playerId');
        return;
      case 'chat':
        return this.broadcast({ kind: 'chat', playerId, text: msg.text });
      case 'command': {
        if (!this.scheduler || this.halted) return this.error(connId, 'geen lopend potje');
        if (msg.command.playerId !== playerId)
          return this.error(connId, 'playerId komt niet overeen met verbinding');
        this.sampleLag(playerId, this.scheduler.nextFrame - msg.command.frame);
        if (this.scheduler.submit(msg.command) === null)
          this.error(connId, 'commando te ver vooruit');
        return;
      }
      case 'hash': {
        if (!this.started || this.halted) return;
        if (msg.report.playerId !== playerId)
          return this.error(connId, 'playerId komt niet overeen met verbinding');
        // Een hash voor frame f is gemeld na uitvoering van f: de client staat dan op frame f + 1.
        if (this.scheduler)
          this.sampleLag(playerId, this.scheduler.nextFrame - (msg.report.frame + 1));
        return this.afterHash(this.comparator.report(msg.report, this.expectedFor));
      }
      case 'resyncRequest':
        if (!this.started) return this.error(connId, 'potje is nog niet gestart');
        if (msg.request.playerId !== playerId)
          return this.error(connId, 'playerId komt niet overeen met verbinding');
        if (this.resyncs.has(playerId)) return; // loopt al (bijv. automatisch gestart bij reconnect)
        this.hashFrom.set(playerId, Infinity);
        return this.assignPeer(playerId, new Set(), msg.request.lastFrame);
      case 'resyncResponse':
        return this.onResyncResponse(connId, playerId, msg.response);
    }
  }

  /** Verbinding weg. In de lobby verdwijnt de speler; in een potje wordt hij offline. */
  disconnect(connId: string): void {
    const playerId = this.conns.get(connId);
    if (playerId === undefined) return;
    this.conns.delete(connId);
    this.connOf.delete(playerId);
    this.hashExempt.delete(playerId);
    if (this.started) {
      const p = this.players.get(playerId);
      if (p) p.online = false;
      this.lastFrameOffline.set(playerId, Math.max(0, (this.scheduler?.nextFrame ?? 0) - 1));
      this.delay.forget(playerId);
      this.resyncs.delete(playerId);
      for (const [target, r] of [...this.resyncs])
        if (r.peer === playerId)
          this.assignPeer(target, new Set([...r.tried, playerId]), r.lastFrame);
      if (!this.halted) this.afterHash(this.comparator.recheck(this.expectedFor));
      this.checkStall();
    } else {
      this.players.delete(playerId);
      this.clientIds.delete(playerId);
      if (![...this.players.values()].some((p) => !p.ai)) this.players.clear(); // geen mensen meer: AI's gaan mee
      this.broadcastLobby();
    }
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

  // --- lobby ---

  private join(connId: string, name: string, clientId: string | undefined): void {
    if (this.conns.has(connId)) return this.error(connId, 'al gejoind');
    const known =
      clientId === undefined
        ? undefined
        : [...this.clientIds].find(([, id]) => id === clientId)?.[0];
    if (known !== undefined) return this.rejoin(connId, known);
    if (this.started) return this.error(connId, 'potje is al gestart');
    const playerId = this.freeSlot();
    if (playerId < 0) return this.error(connId, 'room is vol');
    this.conns.set(connId, playerId);
    this.connOf.set(playerId, connId);
    if (clientId !== undefined) this.clientIds.set(playerId, clientId);
    this.players.set(playerId, {
      playerId,
      name: this.uniqueName(name),
      faction: this.defaultFaction,
      ready: false,
      online: true,
      ai: false,
    });
    this.unreadyHumans();
    this.broadcastLobby();
  }

  /**
   * Menselijke namen zijn uniek in een room: een tweede "Speler" wordt "Speler 2", de volgende "Speler 3". De client
   * herkent zijn eigen regel in de lobby aan de naam (de lobby-berichten dragen geen `you`), dus twee gelijke namen
   * mogen niet naast elkaar bestaan. Hoofdletterongevoelig; past binnen de 32 tekens van het protocol.
   */
  private uniqueName(name: string): string {
    const taken = new Set<string>();
    for (const p of this.players.values()) if (!p.ai) taken.add(p.name.toLowerCase());
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; ; n++) {
      const suffix = ` ${n}`;
      const candidate = `${name.slice(0, MAX_NAME_LENGTH - suffix.length)}${suffix}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  /** Bekende clientId: zelfde playerId, online weer aan. Na start volgt de resync. */
  private rejoin(connId: string, playerId: number): void {
    const old = this.connOf.get(playerId);
    if (old !== undefined) {
      this.conns.delete(old); // oude (halfdode) verbinding wordt vervangen
      this.send(old, { kind: 'error', message: 'vervangen door een nieuwe verbinding' });
    }
    this.conns.set(connId, playerId);
    this.connOf.set(playerId, connId);
    const player = this.players.get(playerId) as Player;
    player.online = true;
    if (!this.started) return this.broadcastLobby();
    this.send(connId, this.startMessage(playerId));
    this.hashFrom.set(playerId, Infinity);
    this.resyncs.delete(playerId);
    this.assignPeer(playerId, new Set(), this.lastFrameOffline.get(playerId) ?? 0);
  }

  private maybeStart(): void {
    const list = this.sortedPlayers();
    if (list.length < this.minPlayers || !list.every((p) => p.ready)) return;
    this.started = true;
    this.seed = this.chooseSeed() >>> 0;
    this.scheduler = new FrameScheduler(this.settings.delayFrames);
    for (const [connId, playerId] of this.conns) this.send(connId, this.startMessage(playerId));
  }

  private seed = 0;

  private startMessage(playerId: number): StartMessage {
    return {
      kind: 'start',
      seed: this.seed,
      map: this.map,
      players: this.sortedPlayers(),
      settings: { ...this.settings },
      dataVersion: this.dataVersion,
      you: playerId,
    };
  }

  /** De host is de laagste playerId die geen AI is. */
  private hostId(): number {
    let host = -1;
    for (const p of this.players.values())
      if (!p.ai && (host < 0 || p.playerId < host)) host = p.playerId;
    return host;
  }

  private hostCheck(connId: string, playerId: number): boolean {
    if (this.started) {
      this.error(connId, 'potje is al gestart');
      return false;
    }
    if (playerId !== this.hostId()) {
      this.error(connId, 'alleen de host mag dit');
      return false;
    }
    return true;
  }

  private freeSlot(): number {
    for (let i = 0; i < MAX_PLAYERS; i++) if (!this.players.has(i)) return i;
    return -1;
  }

  /** Een lobbywijziging die het potje raakt, vraagt om nieuwe bevestiging; AI-spelers blijven ready. */
  private unreadyHumans(): void {
    for (const p of this.players.values()) if (!p.ai) p.ready = false;
  }

  // --- hashes en stall ---

  private afterHash(ev: DesyncEvent | null): void {
    if (!ev) return;
    this.halted = true; // slice: een desync stopt het potje
    this.broadcast({ kind: 'desync', event: ev });
  }

  /** Wie meldt voor frame f: online menselijke spelers, niet vrijgesteld, en met state van voor f. AI telt niet mee. */
  private readonly expectedFor = (frame: number): number[] =>
    this.sortedPlayers()
      .filter(
        (p) =>
          p.online &&
          !p.ai &&
          !this.hashExempt.has(p.playerId) &&
          frame >= (this.hashFrom.get(p.playerId) ?? 0),
      )
      .map((p) => p.playerId);

  /**
   * StallNotice. Lockstep pauzeert op de client zelf (ontbrekende bundel); de relay blijft bundels uitgeven, dus
   * een trage speler houdt de anderen niet tegen. Wat wel blokkeert is de hash-vergelijking en daarmee desync-
   * detectie. Hashes zijn de hartslag (elke HASH_INTERVAL_FRAMES, 1 s): ontbreekt bij een online menselijke speler
   * de hash van het oudste openstaande frame langer dan STALL_TIMEOUT_MS nadat een ander al meldde, dan loopt
   * hij vast (bevroren tab, gepauzeerde sim) en sturen we `stall` met zijn playerId naar iedereen, zodat de UI
   * kan tonen wie er wacht. Alleen bij wijziging; een lege waitingFor wist de melding. Een speler die wegvalt of
   * alsnog meldt, valt weer uit de lijst.
   */
  private checkStall(): void {
    if (!this.started || this.halted) return;
    const pending = this.comparator.oldestPending(this.expectedFor);
    const waiting = pending && this.now() - pending.since > STALL_TIMEOUT_MS ? pending.missing : [];
    const key = waiting.join(',');
    if (key === this.stallKey) return;
    this.stallKey = key;
    this.broadcast({ kind: 'stall', notice: { waitingFor: waiting } });
  }

  private sampleLag(playerId: number, lagFrames: number): void {
    if (!this.adaptiveDelay || this.hashExempt.has(playerId)) return;
    if (this.resyncs.has(playerId) || (this.hashFrom.get(playerId) ?? 0) === Infinity) return;
    if ((this.scheduler?.nextFrame ?? 0) < (this.sampleAfter.get(playerId) ?? 0)) return;
    this.delay.sample(playerId, lagFrames);
  }

  // --- resync ---

  /** Peer = laagste online menselijke playerId met state (niet het doel, niet eerder geprobeerd). */
  private assignPeer(target: number, tried: Set<number>, lastFrame: number): void {
    const targetConn = this.connOf.get(target);
    if (targetConn === undefined) return void this.resyncs.delete(target);
    const peer = this.sortedPlayers().find(
      (p) =>
        p.online &&
        !p.ai &&
        p.playerId !== target &&
        !tried.has(p.playerId) &&
        (this.hashFrom.get(p.playerId) ?? 0) !== Infinity,
    );
    const peerConn = peer && this.connOf.get(peer.playerId);
    if (!peer || peerConn === undefined) {
      this.resyncs.delete(target);
      return this.error(targetConn, 'geen peer beschikbaar voor resync');
    }
    this.resyncs.set(target, {
      peer: peer.playerId,
      requestedAt: this.now(),
      lastFrame,
      tried: new Set(tried).add(peer.playerId),
    });
    this.send(peerConn, { kind: 'resyncRequest', request: { playerId: target, lastFrame } });
  }

  private onResyncResponse(connId: string, peerId: number, response: ResyncResponse): void {
    const entry = [...this.resyncs].find(([, r]) => r.peer === peerId);
    if (!entry || !this.scheduler) return this.error(connId, 'geen resync gevraagd');
    const [target, pending] = entry;
    const next = this.scheduler.nextFrame;
    const first = this.history[0]?.frame ?? next;
    // response.frame = Sim.frame van de state (eerstvolgende uit te voeren frame). Moet binnen de bewaarde bundels vallen.
    if (response.frame > next || response.frame < first) {
      this.error(connId, 'resync-state ligt buiten de bewaarde bundels');
      return this.assignPeer(target, pending.tried, pending.lastFrame);
    }
    const targetConn = this.connOf.get(target);
    this.resyncs.delete(target);
    if (targetConn === undefined) return;
    const bundles = this.history.filter((b) => b.frame >= response.frame);
    this.send(targetConn, {
      kind: 'resyncResponse',
      response: { frame: response.frame, stateBase64: response.stateBase64, bundles },
    });
    this.hashFrom.set(target, response.frame);
    this.sampleAfter.set(target, next + SAMPLE_GRACE_FRAMES);
    this.delay.forget(target);
    this.afterHash(this.comparator.recheck(this.expectedFor));
  }

  private checkResyncTimeouts(): void {
    const t = this.now();
    for (const [target, r] of [...this.resyncs])
      if (t - r.requestedAt > RESYNC_TIMEOUT_MS) this.assignPeer(target, r.tried, r.lastFrame);
  }

  private sortedPlayers(): Player[] {
    return [...this.players.values()]
      .sort((a, b) => a.playerId - b.playerId)
      .map((p) => ({ ...p }));
  }

  private broadcastLobby(): void {
    this.broadcast({
      kind: 'lobby',
      roomId: this.roomId,
      map: this.map,
      players: this.sortedPlayers(),
      settings: { ...this.settings },
    });
  }

  private broadcast(msg: ServerMessage): void {
    for (const connId of this.conns.keys()) this.send(connId, msg);
  }

  private error(connId: string, message: string): void {
    this.send(connId, { kind: 'error', message });
  }
}

function clampDelay(n: number): number {
  return Math.min(DELAY_FRAMES_MAX, Math.max(DELAY_FRAMES_MIN, n));
}

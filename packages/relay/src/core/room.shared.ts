import {
  DELAY_FRAMES_MAX,
  DELAY_FRAMES_MIN,
  type DesyncEvent,
  type FrameBundle,
  type ResyncResponse,
  type ServerMessage,
} from '@crawlout/protocol';
import type { DelayController } from './delay.js';
import type { HashComparator } from './hashCompare.js';
import type { FrameScheduler } from './scheduler.js';

export type StartMessage = Extract<ServerMessage, { kind: 'start' }>;
export type Settings = StartMessage['settings'];
export type Player = StartMessage['players'][number];

/**
 * Zoveel recente bundels houdt de relay vast voor resync (60 s bij 20 Hz). De aangewezen peer serialiseert zijn
 * state op het moment van het verzoek, dus de state is hooguit enkele seconden oud; langer terug is nooit nodig.
 * Een volledige opname voor replays staat achter `recordReplay`.
 */
export const RESYNC_HISTORY_FRAMES = 1200;
/** Antwoordt de aangewezen peer niet binnen dit aantal ms, dan wijst de relay een volgende peer aan. */
export const RESYNC_TIMEOUT_MS = 5000;
/** Na een resync negeren we de latency-metingen van die speler zo lang (de client haalt dan versneld in). */
export const SAMPLE_GRACE_FRAMES = 100;
/** Zelfde maximum als `name` in het protocol (lobby.ts). */
export const MAX_NAME_LENGTH = 32;

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

export interface PendingResync {
  peer: number;
  requestedAt: number;
  lastFrame: number;
  tried: Set<number>;
}

/**
 * Internal view of a Room instance: its private fields and helper methods, as seen by the sibling modules that
 * implement groups of Room methods (room.lobby.ts, room.sync.ts, room.handle.ts). Mirrors the private members of
 * the Room class one to one; only those modules use it.
 */
export interface RoomInternals {
  readonly roomId: string;
  readonly send: RoomOptions['send'];
  readonly chooseSeed: () => number;
  readonly dataVersion: string;
  readonly defaultFaction: string;
  readonly minPlayers: number;
  readonly now: () => number;
  readonly adaptiveDelay: boolean;
  settings: Settings;
  readonly conns: Map<string, number>;
  readonly connOf: Map<number, string>;
  readonly clientIds: Map<number, string>;
  readonly players: Map<number, Player>;
  readonly hashExempt: Set<number>;
  readonly hashFrom: Map<number, number>;
  readonly sampleAfter: Map<number, number>;
  readonly lastFrameOffline: Map<number, number>;
  readonly resyncs: Map<number, PendingResync>;
  readonly comparator: HashComparator;
  readonly delay: DelayController;
  scheduler: FrameScheduler | null;
  map: string;
  started: boolean;
  halted: boolean;
  stallKey: string;
  history: FrameBundle[];
  readonly recording: FrameBundle[] | null;
  seed: number;
  readonly expectedFor: (frame: number) => number[];
  addAi(faction: string): number | null;
  removeAi(playerId: number): boolean;
  disconnect(connId: string): void;
  join(connId: string, name: string, clientId: string | undefined): void;
  uniqueName(name: string): string;
  rejoin(connId: string, playerId: number): void;
  maybeStart(): void;
  startMessage(playerId: number): StartMessage;
  hostId(): number;
  hostCheck(connId: string, playerId: number): boolean;
  freeSlot(): number;
  unreadyHumans(): void;
  afterHash(ev: DesyncEvent | null): void;
  checkStall(): void;
  sampleLag(playerId: number, lagFrames: number): void;
  assignPeer(target: number, tried: Set<number>, lastFrame: number): void;
  onResyncResponse(connId: string, peerId: number, response: ResyncResponse): void;
  checkResyncTimeouts(): void;
  sortedPlayers(): Player[];
  broadcastLobby(): void;
  broadcast(msg: ServerMessage): void;
  error(connId: string, message: string): void;
}

export function clampDelay(n: number): number {
  return Math.min(DELAY_FRAMES_MAX, Math.max(DELAY_FRAMES_MIN, n));
}

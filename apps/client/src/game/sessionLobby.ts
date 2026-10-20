// Lobby types and the `?mode=` parameter of a session (split off session.ts).
import type {
  ClientMessage,
  DesyncEvent,
  FogMask,
  LobbyPlayer,
  PlayerStatus,
  StallNotice,
} from '@crawlout/protocol';
import type { SimWinner } from '@crawlout/sim';

/** What the relay's lobby message says, for the menu's lobby screen. */
export interface SessionLobby {
  roomId: string;
  map: string;
  players: readonly LobbyPlayer[];
  /** The game type the host set (MatchSettings.mode), when the relay says. */
  mode?: 'skirmish' | 'survival' | 'project';
  /** This connection's playerId, as the relay says it (null only for a relay without `you`). */
  you: number | null;
}

/** The lobby messages a player can send from the menu. */
export type SessionLobbyRequest =
  | Extract<ClientMessage, { kind: 'ready' | 'setFaction' | 'setHero' | 'addAi' | 'removeAi' }>
  /** The host's game type (relay setSettings; the delay is the client's default). */
  | { kind: 'setMode'; mode: 'skirmish' | 'survival' };

/** `?mode=` of the URL: project, survival or (default) skirmish. */
export const modeParam = (v: string | null): 'skirmish' | 'project' | 'survival' =>
  v === 'project' || v === 'survival' ? v : 'skirmish';

/** What a session reports to the client. */
export interface SessionEvents {
  onSnapshot(buf: ArrayBuffer): void;
  onDesync(event: DesyncEvent): void;
  onStall(notice: StallNotice | null): void;
  onError(message: string): void;
  /** Answer to requestStatus(): player status for the HUD plus the winner (null while the match runs). */
  onStatus?(
    status: PlayerStatus,
    winner: SimWinner | null,
    /** Sim frame of the status (the survival countdown runs against it). */
    frame: number,
  ): void;
  /** Answer to requestFog(): this player's fog of war on the vision grid (for a later fog overlay and minimap). */
  onFog?(mask: FogMask): void;
  /** Connection or lobby text for an overlay (Dutch, user-facing); null clears it. */
  onConnection?(text: string | null): void;
  /** Over ws: the lobby changed (every lobby message of the relay). */
  onLobby?(lobby: SessionLobby): void;
  /** Over ws: the socket is up (a join was sent) or went down; a down before the first connect means it never worked. */
  onLink?(status: 'up' | 'down'): void;
}

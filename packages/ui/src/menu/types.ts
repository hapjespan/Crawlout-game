import type { LobbyPlayer } from '@crawlout/protocol';
import type { MinimapData } from '../types.js';
import type { AiMatchConfig, MenuScreen, PvpConnectConfig, PvpForm } from './flow.js';
import type { MenuSettings } from './settings.js';

/** A playable faction as the menu shows it. Names and numbers come from the data; the blurb is menu text. */
export interface MenuFaction {
  key: string;
  /** "Dwellers". */
  name: string;
  /** "De Kluis". */
  subtitle: string;
  blurb: string;
  /** The hero of this faction ("Opziener"). */
  hero: string;
}

export interface MenuMapInfo {
  id: string;
  /** "Rustbelt XL". */
  name: string;
  /** "384 x 384 m". */
  sizeLabel: string;
  /** Spawns on the map; the lobby refuses more players than this. */
  maxPlayers: number;
  /** Terrain, water, start positions, scrap and claim points, drawn like the HUD minimap. Player 0 is "you". */
  minimap: MinimapData;
  /** The map's dominance rule (read-only in the menu). */
  dominance: { pointsRequired: number; minutes: number };
}

export interface MenuContent {
  factions: readonly MenuFaction[];
  map: MenuMapInfo;
  /** Small line on the splash and in the corner ("data 0.24.0"). */
  versionLabel?: string;
}

/** What the lobby screen can ask of the relay (the client forwards it as the relay message of the same name). */
export type LobbyRequest =
  | { kind: 'ready'; ready: boolean }
  | { kind: 'setFaction'; faction: string }
  | { kind: 'addAi'; faction: string }
  | { kind: 'removeAi'; playerId: number };

export interface MenuDeps {
  content: MenuContent;
  settings: MenuSettings;
  /** True when the dev-only bitmap skin is loaded: only then the settings offer the skin toggle. */
  skinAvailable: boolean;
  initialForm: PvpForm;
  /** No game scene behind the menu (the renderer failed to start): draw the stylised still instead. */
  stillBackground?: boolean;
  /** Start on the main menu (after a match, or `?menu=1`). */
  skipSplash?: boolean;
  /** Choose "Tegen AI" > Start: the client starts the loopback match. */
  startAi(config: AiMatchConfig): void;
  /** "Speler tegen speler" > a room: the client opens the relay connection and reports back through the handle. */
  connect(config: PvpConnectConfig): void;
  /** Leaves the lobby: the client closes the connection. */
  leave(): void;
  lobbyRequest(request: LobbyRequest): void;
  /** Called with every settings change; the client stores it and applies what can apply live (HUD size, skin). */
  onSettings(next: MenuSettings): void;
  /** Loads the page again (settings the renderer reads once). */
  reload(): void;
  random?(): number;
}

export interface MenuHandle {
  /** Splash progress, 0 to 1, with the Dutch name of the step now running. */
  setProgress(value: number, label?: string): void;
  /** Everything is loaded: the splash offers "Druk op een toets". */
  setLoaded(): void;
  setLink(status: 'up' | 'down'): void;
  setLobby(roomId: string, map: string, players: readonly LobbyPlayer[]): void;
  setError(message: string): void;
  /** Hides the menu (the match starts); `show()` brings it back. */
  hide(): void;
  show(screen?: MenuScreen): void;
  isVisible(): boolean;
  unmount(): void;
  /** Current screen, for tests and the client. */
  screen(): MenuScreen;
}

import {
  HERO_ARCHETYPES,
  type Difficulty,
  type HeroArchetype,
  type LobbyPlayer,
} from '@crawlout/protocol';
import { identifyYou, relayErrorText } from './lobbyModel.js';

/**
 * The screens before the match as a small state machine: splash, main menu, "Tegen AI" (game type and setup),
 * "Speler tegen speler" (connect form, then the relay lobby) and settings. `reduceMenu` is pure: it returns the next
 * state and, when the client has to do something (start a match, open or close the relay connection), an effect.
 * The view only dispatches actions; the client turns effects into a session. No DOM in here.
 */

export type MenuScreen = 'splash' | 'main' | 'ai' | 'pvp' | 'settings';

export type GameTypeId = 'skirmish' | 'survival' | 'build';

export interface GameTypeInfo {
  id: GameTypeId;
  name: string;
  blurb: string;
  /** All three are playable (Survival co-op since ui 0.20.0). */
  available: boolean;
}

export const GAME_TYPES: readonly GameTypeInfo[] = [
  {
    id: 'skirmish',
    name: 'Skirmish',
    blurb: 'Tegen de computer. Win door sloop of door dominantie.',
    available: true,
  },
  {
    id: 'survival',
    name: 'Survival co\u2011op',
    blurb: 'Samen golven ghouls en mutanten verslaan: 1 tot 4 spelers, zonder AI.',
    available: true,
  },
  {
    id: 'build',
    name: 'Bouwproject',
    blurb:
      'Skirmish met het oude winkelcentrum: herstel alle vier de delen en houd ze vijf minuten.',
    available: true,
  },
];

/** The hero without a choice (protocol 0.19.0): the Krijger of the faction. */
export const DEFAULT_HERO: HeroArchetype = 'krijger';

/** The AI faction choice that picks one at random when the match starts. */
export const RANDOM_FACTION = 'random';

/** The difficulty without a choice (protocol 0.21.0, besluit fase-0 sectie 26): the middle level. */
export const DEFAULT_DIFFICULTY: Difficulty = 'normal';

/** The three levels as the menu shows them, in the order of the protocol's DIFFICULTIES (easy, normal, hard). */
export interface DifficultyInfo {
  id: Difficulty;
  name: string;
  blurb: string;
}

export const DIFFICULTY_CHOICES: readonly DifficultyInfo[] = [
  { id: 'easy', name: 'Rustig', blurb: 'De AI reageert traag en bouwt langzaam op.' },
  // sim 0.38.0, besluit fase-0 sectie 27: normal is de stand zonder niveau, dus hij dobbelt niet
  { id: 'normal', name: 'Normaal', blurb: 'De AI speelt zijn script precies op tempo, elk potje gelijk.' },
  { id: 'hard', name: 'Zwaar', blurb: 'De AI reageert sneller en vordert harder.' },
];

export interface AiSetup {
  gameType: GameTypeId;
  faction: string;
  /** Hero choice (protocol 0.19.0): the archetype of the own hero; kept when the faction changes. */
  hero: HeroArchetype;
  /** A faction key, or RANDOM_FACTION. */
  aiFaction: string;
  /** Difficulty of the AI (protocol 0.21.0): the band it plays in; the sim rolls within that band per match. */
  difficulty: Difficulty;
}

export interface AiMatchConfig {
  /** build: Bouwproject, Skirmish plus win route C (MatchSettings.mode 'project'). */
  gameType: 'skirmish' | 'build' | 'survival';
  faction: string;
  /** The archetype of the own hero (LobbyPlayer.heroArchetype); krijger is the default. */
  heroArchetype: HeroArchetype;
  /** Always a real faction key here: "willekeurig" is resolved when the match starts. Unused in survival (no AI). */
  aiFaction: string;
  /** MatchSettings.difficulty of the match. Unused in survival (no AI player). */
  difficulty: Difficulty;
}

export interface PvpForm {
  name: string;
  room: string;
  relayUrl: string;
}

export interface PvpConnectConfig {
  name: string;
  roomId: string;
  relayUrl: string;
  /** True when the room code was made up just now (a new room), false when the player typed one to join. */
  created: boolean;
}

export type LinkStatus = 'connecting' | 'up' | 'down';

export type LobbyMode = 'skirmish' | 'survival' | 'project';

export interface LobbySnapshot {
  roomId: string;
  map: string;
  players: readonly LobbyPlayer[];
  /** The game type the host set (MatchSettings.mode), null while the relay does not say. */
  mode: LobbyMode | null;
  /** This client's player id, or null when it cannot be told yet. */
  youId: number | null;
}

export interface PvpState {
  phase: 'form' | 'lobby';
  form: PvpForm;
  formError: string | null;
  /** The name this client joined with (the lobby recognises "you" by it). */
  sentName: string;
  roomId: string;
  link: LinkStatus;
  /** True once the socket was open at least once: "down" before that is "kan geen verbinding maken". */
  everUp: boolean;
  lobby: LobbySnapshot | null;
  /** Latest relay error or notice (Dutch), cleared on the next lobby message. */
  notice: string | null;
}

export interface MenuState {
  screen: MenuScreen;
  loaded: boolean;
  /** Leave the splash by itself once loaded (a return from a match, `?menu=1`): the menu is not usable before its data is. */
  autoContinue: boolean;
  /** 0 to 1, tied to the real loading steps. */
  progress: number;
  progressLabel: string;
  ai: AiSetup;
  pvp: PvpState;
}

export type MenuAction =
  | { type: 'progress'; value: number; label?: string }
  | { type: 'loaded' }
  | { type: 'continue' }
  | { type: 'open'; screen: 'ai' | 'pvp' | 'settings' }
  | { type: 'back' }
  | { type: 'ai/gameType'; id: GameTypeId }
  | { type: 'ai/faction'; key: string }
  | { type: 'ai/hero'; archetype: HeroArchetype }
  | { type: 'ai/aiFaction'; key: string }
  | { type: 'ai/difficulty'; id: Difficulty }
  | { type: 'ai/start' }
  | { type: 'pvp/form'; patch: Partial<PvpForm> }
  | { type: 'pvp/connect'; create: boolean }
  | { type: 'pvp/link'; status: 'up' | 'down' }
  | {
      type: 'pvp/lobby';
      roomId: string;
      map: string;
      players: readonly LobbyPlayer[];
      /** MatchSettings.mode of the lobby message. */
      mode?: LobbyMode | undefined;
      /** The relay's `you`; the name match (identifyYou) is only the fallback without it. */
      you?: number | null | undefined;
    }
  | { type: 'pvp/error'; message: string };

export type MenuEffect =
  | { kind: 'startAi'; config: AiMatchConfig }
  | { kind: 'connect'; config: PvpConnectConfig }
  | { kind: 'leave' };

export interface MenuEnv {
  random(): number;
  /** Keys of the playable factions, in menu order. */
  factionKeys: readonly string[];
}

export interface MenuResult {
  state: MenuState;
  effect: MenuEffect | null;
}

export const MAX_NAME_LENGTH = 24;
export const MAX_ROOM_LENGTH = 24;
/** No 0, O, 1, I or L: a code read aloud or typed from a screenshot stays unambiguous. */
const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 5;

export function randomRoomCode(random: () => number): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++)
    code +=
      ROOM_ALPHABET[
        Math.min(ROOM_ALPHABET.length - 1, Math.floor(random() * ROOM_ALPHABET.length))
      ];
  return code;
}

/** Room codes are letters, digits, dash and underscore; anything else is dropped as the player types. */
export function cleanRoomCode(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, MAX_ROOM_LENGTH);
}

/** The default relay address: the same host as the page, port 8787. */
export function defaultRelayUrl(location: { protocol: string; hostname: string }): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const host = location.hostname.includes(':') ? `[${location.hostname}]` : location.hostname;
  return `${scheme}://${host || 'localhost'}:8787`;
}

/** Dutch error for a relay address that cannot work, or null. */
export function relayUrlError(raw: string): string | null {
  const url = raw.trim();
  if (url === '') return 'Vul het adres van de relay in.';
  if (!/^wss?:\/\//.test(url)) return 'Het relay-adres moet met ws:// of wss:// beginnen.';
  if (!/^wss?:\/\/[^\s/?#]+([/?#]\S*)?$/.test(url)) return 'Dit relay-adres klopt niet.';
  return null;
}

export function initialMenuState(options: {
  /** Go to the main menu as soon as loading is done (a return from a match, or `?menu=1`) instead of waiting for a key. */
  skipSplash?: boolean;
  factionKey: string;
  form: PvpForm;
}): MenuState {
  return {
    screen: 'splash',
    loaded: false,
    autoContinue: options.skipSplash === true,
    progress: 0,
    progressLabel: '',
    ai: {
      gameType: 'skirmish',
      faction: options.factionKey,
      hero: DEFAULT_HERO,
      aiFaction: RANDOM_FACTION,
      difficulty: DEFAULT_DIFFICULTY,
    },
    pvp: {
      phase: 'form',
      form: options.form,
      formError: null,
      sentName: '',
      roomId: '',
      link: 'connecting',
      everUp: false,
      lobby: null,
      notice: null,
    },
  };
}

const done = (state: MenuState, effect: MenuEffect | null = null): MenuResult => ({
  state,
  effect,
});

const withPvp = (state: MenuState, patch: Partial<PvpState>): MenuState => ({
  ...state,
  pvp: { ...state.pvp, ...patch },
});

export function reduceMenu(state: MenuState, action: MenuAction, env: MenuEnv): MenuResult {
  switch (action.type) {
    case 'progress': {
      const value = Math.max(state.progress, Math.min(1, Math.max(0, action.value)));
      return done({
        ...state,
        progress: value,
        progressLabel: action.label ?? state.progressLabel,
      });
    }
    case 'loaded':
      return done({
        ...state,
        loaded: true,
        progress: 1,
        screen: state.autoContinue && state.screen === 'splash' ? 'main' : state.screen,
      });
    case 'continue':
      return state.screen === 'splash' && state.loaded
        ? done({ ...state, screen: 'main' })
        : done(state);
    case 'open':
      return state.screen === 'main' ? done({ ...state, screen: action.screen }) : done(state);
    case 'back': {
      if (state.screen === 'pvp' && state.pvp.phase === 'lobby')
        return done(
          withPvp(state, {
            phase: 'form',
            lobby: null,
            notice: null,
            link: 'connecting',
            everUp: false,
          }),
          { kind: 'leave' },
        );
      return state.screen === 'ai' || state.screen === 'pvp' || state.screen === 'settings'
        ? done({ ...state, screen: 'main' })
        : done(state);
    }
    case 'ai/gameType': {
      const info = GAME_TYPES.find((g) => g.id === action.id);
      return info?.available
        ? done({ ...state, ai: { ...state.ai, gameType: info.id } })
        : done(state);
    }
    case 'ai/faction':
      return env.factionKeys.includes(action.key)
        ? done({ ...state, ai: { ...state.ai, faction: action.key } })
        : done(state);
    case 'ai/hero':
      return HERO_ARCHETYPES.includes(action.archetype)
        ? done({ ...state, ai: { ...state.ai, hero: action.archetype } })
        : done(state);
    case 'ai/aiFaction':
      return action.key === RANDOM_FACTION || env.factionKeys.includes(action.key)
        ? done({ ...state, ai: { ...state.ai, aiFaction: action.key } })
        : done(state);
    case 'ai/difficulty':
      return DIFFICULTY_CHOICES.some((d) => d.id === action.id)
        ? done({ ...state, ai: { ...state.ai, difficulty: action.id } })
        : done(state);
    case 'ai/start': {
      const gameType = state.ai.gameType;
      if (
        state.screen !== 'ai' ||
        (gameType !== 'skirmish' && gameType !== 'build' && gameType !== 'survival')
      )
        return done(state);
      const aiFaction =
        state.ai.aiFaction === RANDOM_FACTION
          ? (env.factionKeys[Math.floor(env.random() * env.factionKeys.length)] ?? state.ai.faction)
          : state.ai.aiFaction;
      return done(state, {
        kind: 'startAi',
        config: {
          gameType,
          faction: state.ai.faction,
          heroArchetype: state.ai.hero,
          aiFaction,
          difficulty: state.ai.difficulty,
        },
      });
    }
    case 'pvp/form':
      return done(
        withPvp(state, {
          form: {
            ...state.pvp.form,
            ...action.patch,
            ...(action.patch.room === undefined ? {} : { room: cleanRoomCode(action.patch.room) }),
            ...(action.patch.name === undefined
              ? {}
              : { name: action.patch.name.slice(0, MAX_NAME_LENGTH) }),
          },
          formError: null,
        }),
      );
    case 'pvp/connect': {
      if (state.screen !== 'pvp' || state.pvp.phase !== 'form') return done(state);
      const name = state.pvp.form.name.trim();
      const relayUrl = state.pvp.form.relayUrl.trim();
      const room = action.create ? randomRoomCode(env.random) : state.pvp.form.room.trim();
      const error =
        name === ''
          ? 'Vul een naam in.'
          : (relayUrlError(relayUrl) ??
            (room === '' ? 'Vul een kamercode in om te joinen.' : null));
      if (error) return done(withPvp(state, { formError: error }));
      return done(
        withPvp(state, {
          phase: 'lobby',
          formError: null,
          sentName: name,
          roomId: room,
          link: 'connecting',
          everUp: false,
          lobby: null,
          notice: null,
          form: { ...state.pvp.form, name, relayUrl, room },
        }),
        { kind: 'connect', config: { name, roomId: room, relayUrl, created: action.create } },
      );
    }
    case 'pvp/link':
      if (state.pvp.phase !== 'lobby') return done(state);
      return done(
        withPvp(state, {
          link: action.status,
          everUp: state.pvp.everUp || action.status === 'up',
          ...(action.status === 'up' ? { notice: null } : {}),
        }),
      );
    case 'pvp/lobby': {
      if (state.pvp.phase !== 'lobby') return done(state);
      const youId =
        action.you ??
        identifyYou(action.players, state.pvp.sentName, state.pvp.lobby?.youId ?? null);
      return done(
        withPvp(state, {
          lobby: {
            roomId: action.roomId,
            map: action.map,
            players: action.players,
            mode: action.mode ?? null,
            youId,
          },
          link: 'up',
          everUp: true,
          notice: null,
        }),
      );
    }
    case 'pvp/error':
      return state.pvp.phase === 'lobby'
        ? done(withPvp(state, { notice: relayErrorText(action.message) }))
        : done(state);
  }
}

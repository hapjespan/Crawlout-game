// URL parameters that choose the transport. No parameters = the in-memory loopback (local skirmish vs the AI).
// `?relay=ws://host:8787&room=naam&name=Speler` = the ws relay; `&ai=1` lets the host add one AI to the lobby.

export interface WsNetOptions {
  relayUrl: string;
  roomId: string;
  name: string;
  /** The host adds one AI player to the lobby before readying. */
  ai: boolean;
}

const DEFAULT_ROOM = 'crawlout';
const DEFAULT_NAME = 'Speler';
const MAX_NAME_LENGTH = 32;

/** Returns null for the loopback; throws on a relay URL that is not ws:// or wss://. */
export function netOptionsFromSearch(search: string): WsNetOptions | null {
  const params = new URLSearchParams(search);
  const relayUrl = params.get('relay');
  if (relayUrl === null || relayUrl === '') return null;
  if (!/^wss?:\/\//.test(relayUrl)) throw new Error(`relay moet met ws:// of wss:// beginnen, kreeg ${relayUrl}`);
  const name = (params.get('name') ?? '').trim().slice(0, MAX_NAME_LENGTH) || DEFAULT_NAME;
  return {
    relayUrl,
    roomId: (params.get('room') ?? '').trim() || DEFAULT_ROOM,
    name,
    ai: params.get('ai') === '1',
  };
}

/** Minimal Storage shape so tests need no DOM. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const CLIENT_ID_KEY = 'crawlout.clientId';

function randomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The clientId lives in sessionStorage: it survives a reload of this tab (reconnect) but not a second tab. */
export function getClientId(store: KeyValueStore | null, generate: () => string = randomId): string {
  try {
    const existing = store?.getItem(CLIENT_ID_KEY);
    if (existing && existing.length >= 8 && existing.length <= 64) return existing;
  } catch {
    // storage blocked: fall through to an in-memory id
  }
  const id = generate();
  try {
    store?.setItem(CLIENT_ID_KEY, id);
  } catch {
    // ignore: a reload then simply cannot reconnect
  }
  return id;
}

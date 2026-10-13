import { describe, expect, it } from 'vitest';
import { getClientId, netOptionsFromSearch, type KeyValueStore } from '../src/net/params.js';

describe('netOptionsFromSearch', () => {
  it('is the loopback without a relay parameter', () => {
    expect(netOptionsFromSearch('')).toBeNull();
    expect(netOptionsFromSearch('?webgl=1')).toBeNull();
  });

  it('reads relay, room, name and ai', () => {
    expect(netOptionsFromSearch('?relay=ws://localhost:8787&room=kamer&name=Rik&ai=1')).toEqual({
      relayUrl: 'ws://localhost:8787',
      roomId: 'kamer',
      name: 'Rik',
      ai: true,
    });
  });

  it('has defaults for room and name and ai off', () => {
    expect(netOptionsFromSearch('?relay=wss://r.example')).toEqual({ relayUrl: 'wss://r.example', roomId: 'crawlout', name: 'Speler', ai: false });
  });

  it('rejects a non-ws relay url', () => {
    expect(() => netOptionsFromSearch('?relay=http://x')).toThrow();
  });
});

describe('getClientId', () => {
  const memory = (): KeyValueStore & { map: Map<string, string> } => {
    const map = new Map<string, string>();
    return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
  };

  it('generates once and then returns the stored id (a reload reconnects)', () => {
    const store = memory();
    let n = 0;
    const first = getClientId(store, () => `generated-${n++}`);
    expect(getClientId(store, () => `generated-${n++}`)).toBe(first);
    expect(n).toBe(1);
  });

  it('survives a missing or throwing store', () => {
    expect(getClientId(null, () => 'abcdefgh')).toBe('abcdefgh');
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(getClientId(broken, () => 'abcdefgh')).toBe('abcdefgh');
  });
});

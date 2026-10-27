import { describe, expect, it } from 'vitest';
import { driftAt } from '../src/ui/ambientCamera.js';
import { menuUrl, startMode } from '../src/game/menuParams.js';
import { splitFactionName } from '../src/game/menuContent.js';
import { createSessionSlot } from '../src/game/sessionSlot.js';
import type { Session } from '../src/game/session.js';

const mode = (q: string) => startMode(new URLSearchParams(q));

describe('startMode', () => {
  it('opens the splash by default', () => {
    expect(mode('')).toBe('splash');
    expect(mode('?webgl=1&shadows=0&noskin=1')).toBe('splash');
  });

  it('?skip=1 and ?play=ai start a match at once', () => {
    expect(mode('?skip=1')).toBe('match');
    expect(mode('?play=ai')).toBe('match');
    expect(mode('?skip=0')).toBe('splash');
    expect(mode('?play=relay')).toBe('splash');
  });

  it('the old match parameters keep bypassing the menu', () => {
    expect(mode('?relay=ws://localhost:8787&room=x&name=Rik')).toBe('match');
    expect(mode('?ai=1')).toBe('match');
    expect(mode('?faction=raiders')).toBe('match');
    expect(mode('?aifaction=raiders')).toBe('match');
  });

  it('?menu=1 and ?splash=0 open the main menu without the splash, but a match parameter wins', () => {
    expect(mode('?menu=1')).toBe('menu');
    expect(mode('?splash=0')).toBe('menu');
    expect(mode('?menu=1&skip=1')).toBe('match');
  });
});

describe('menuUrl', () => {
  it('goes back to the menu and keeps only presentation options', () => {
    const url = menuUrl({
      pathname: '/',
      search: '?skip=1&faction=raiders&relay=ws://x:1&room=a&shadows=low&webgl=1&hudscale=0.8',
    });
    const q = new URLSearchParams(url.split('?')[1]);
    expect(url.startsWith('/?')).toBe(true);
    expect(q.get('menu')).toBe('1');
    expect(q.get('shadows')).toBe('low');
    expect(q.has('webgl')).toBe(true);
    expect(q.get('hudscale')).toBe('0.8');
    for (const k of ['skip', 'faction', 'relay', 'room']) expect(q.has(k)).toBe(false);
    expect(startMode(q)).toBe('menu');
  });
});

describe('menu content', () => {
  it('splits a faction name from its working title', () => {
    expect(splitFactionName('Dwellers (De Kluis)')).toEqual({
      name: 'Dwellers',
      subtitle: 'De Kluis',
    });
    expect(splitFactionName('Raiders')).toEqual({ name: 'Raiders', subtitle: '' });
  });
});

describe('ambient camera drift', () => {
  const size = { w: 384, h: 384 };

  it('stays inside the map and loops without a jump', () => {
    for (let t = 0; t < 300; t += 7) {
      const d = driftAt(t, size);
      expect(d.x).toBeGreaterThan(size.w * 0.25);
      expect(d.x).toBeLessThan(size.w * 0.75);
      expect(d.z).toBeGreaterThan(size.h * 0.25);
      expect(d.z).toBeLessThan(size.h * 0.75);
    }
    const a = driftAt(0, size);
    const b = driftAt(140, size);
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.z).toBeCloseTo(a.z, 6);
  });

  it('turns slowly: well under a quarter turn a minute', () => {
    expect(driftAt(60, size).yaw - driftAt(0, size).yaw).toBeLessThan(Math.PI / 2);
  });
});

describe('session slot', () => {
  it('is a quiet stand-in before a match and forwards after attach', async () => {
    const slot = createSessionSlot();
    expect(slot.playerId).toBe(-1);
    expect(slot.faction).toBeNull();
    expect(slot.playerName(2)).toBe('Speler 3');
    slot.sendCommand('Stop', { ids: [1] });
    slot.requestStatus();

    const sent: string[] = [];
    let started: () => void = () => undefined;
    const real = {
      playerId: 1,
      faction: 'raiders',
      frame: 5,
      started: new Promise<void>((r) => {
        started = r;
      }),
      playerName: () => 'Rik',
      sendCommand: (type: string) => sent.push(type),
      lobbyRequest: (r: { kind: string }) => sent.push(`lobby:${r.kind}`),
      requestStatus: () => sent.push('status'),
      requestFog: () => undefined,
      revealAll: () => undefined,
      dispose: () => sent.push('dispose'),
    } as unknown as Session;
    slot.attach(real);
    expect(slot.playerId).toBe(1);
    expect(slot.faction).toBe('raiders');
    slot.sendCommand('Stop', { ids: [1] });
    slot.lobbyRequest({ kind: 'ready', ready: true });
    slot.dispose();
    expect(sent).toEqual(['Stop', 'lobby:ready', 'dispose']);
    let resolved = false;
    void slot.started.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    started();
    await slot.started;
    expect(resolved).toBe(true);
  });
});

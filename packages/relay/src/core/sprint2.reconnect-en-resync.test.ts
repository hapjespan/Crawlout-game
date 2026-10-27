// Split from sprint2.test.ts to stay under the 5,000-token file limit.
import { describe, it, expect } from 'vitest';
import { HASH_INTERVAL_FRAMES, STALL_TIMEOUT_MS } from '@crawlout/protocol';
import { RESYNC_TIMEOUT_MS } from './room.js';
import { cmd, harness, startTwo } from './sprint2.helpers.js';

describe('reconnect en resync', () => {
  it('clientId geeft dezelfde playerId, online weer aan, en een nieuwe start met you', () => {
    const h = startTwo();
    h.run(5);
    h.say('b', { kind: 'leave' });
    h.say('b2', { kind: 'join', roomId: 'r', name: 'B', clientId: 'client-bbbbbbbb' });
    const start = h.of('b2', 'start')[0];
    expect(start?.you).toBe(1);
    expect(start?.seed).toBe(99);
    expect(start?.players.every((p) => p.online)).toBe(true);
    // Onbekende clientId of geen clientId na start: geweigerd.
    h.say('c', { kind: 'join', roomId: 'r', name: 'C', clientId: 'client-cccccccc' });
    h.say('d', { kind: 'join', roomId: 'r', name: 'D' });
    expect(h.of('c', 'error')[0]?.message).toMatch(/gestart/);
    expect(h.of('d', 'error')[0]?.message).toMatch(/gestart/);
  });

  it('client van 10 s weg komt terug via resync met een nep-state; bundels blijven lopen', () => {
    const h = startTwo();
    h.run(100);
    h.say('b', { kind: 'leave' });
    expect(h.room.connectionCount).toBe(1);
    // 10 s zonder B: A speelt door en meldt hashes; geen desync, geen blokkade.
    for (let i = 0; i < 10 * 20; i++) {
      h.run(1);
      const frame = h.room.bundles.at(-1)?.frame ?? 0;
      if (frame % HASH_INTERVAL_FRAMES === 0)
        h.say('a', { kind: 'hash', report: { frame, playerId: 0, hash: frame } });
    }
    expect(h.of('a', 'desync')).toHaveLength(0);
    h.say('a', { kind: 'command', command: cmd(0, 0, h.room.bundles.length - 1) }); // wordt na B's terugkeer uitgevoerd
    const frameAtReturn = h.room.bundles.length; // = Sim.frame van A's state op dat moment

    h.say('b2', { kind: 'join', roomId: 'r', name: 'B', clientId: 'client-bbbbbbbb' });
    expect(h.of('b2', 'start')[0]?.you).toBe(1);
    const req = h.of('a', 'resyncRequest');
    expect(req).toHaveLength(1);
    expect(req[0]?.request.playerId).toBe(1);
    expect([...h.room.pendingResyncs]).toEqual([[1, expect.objectContaining({ peer: 0 })]]);

    // De bundels lopen intussen gewoon door, ook naar B.
    h.run(3);
    expect(h.of('b2', 'bundle').map((m) => m.bundle.frame)).toEqual([
      frameAtReturn,
      frameAtReturn + 1,
      frameAtReturn + 2,
    ]);

    // A antwoordt met zijn (nep-)state op het moment van het verzoek; de relay vult de bundels aan.
    const fakeState = Buffer.from(JSON.stringify({ units: 3, tick: frameAtReturn })).toString(
      'base64',
    );
    h.say('a', {
      kind: 'resyncResponse',
      response: { frame: frameAtReturn, stateBase64: fakeState, bundles: [] },
    });
    const resp = h.of('b2', 'resyncResponse')[0]?.response;
    expect(resp?.stateBase64).toBe(fakeState);
    expect(resp?.frame).toBe(frameAtReturn);
    expect(resp?.bundles.map((b) => b.frame)).toEqual([
      frameAtReturn,
      frameAtReturn + 1,
      frameAtReturn + 2,
    ]);
    expect(h.room.pendingResyncs.size).toBe(0);

    // Na de resync meldt B hashes vanaf zijn state-frame; eerdere openstaande frames wachten niet op hem.
    h.run(HASH_INTERVAL_FRAMES);
    const f = Math.ceil(h.room.bundles.length / HASH_INTERVAL_FRAMES) * HASH_INTERVAL_FRAMES;
    h.run(f - h.room.bundles.length + 1);
    h.say('a', { kind: 'hash', report: { frame: f, playerId: 0, hash: 1 } });
    h.say('b2', { kind: 'hash', report: { frame: f, playerId: 1, hash: 1 } });
    expect(h.of('a', 'desync')).toHaveLength(0);
    // Een afwijkende hash van de teruggekeerde client geeft wel desync.
    h.run(HASH_INTERVAL_FRAMES);
    h.say('a', { kind: 'hash', report: { frame: f + 20, playerId: 0, hash: 1 } });
    h.say('b2', { kind: 'hash', report: { frame: f + 20, playerId: 1, hash: 2 } });
    expect(h.of('a', 'desync')).toHaveLength(1);
  });

  it('hashes van voor de resync van de teruggekeerde speler blokkeren niets', () => {
    const h = startTwo();
    h.run(30);
    h.say('b', { kind: 'leave' });
    h.say('a', { kind: 'hash', report: { frame: 20, playerId: 0, hash: 1 } }); // B was al weg: alleen A nodig
    h.say('b2', { kind: 'join', roomId: 'r', name: 'B', clientId: 'client-bbbbbbbb' });
    h.say('a', {
      kind: 'resyncResponse',
      response: { frame: 30, stateBase64: 'AA==', bundles: [] },
    });
    h.run(1);
    h.say('a', { kind: 'hash', report: { frame: 40, playerId: 0, hash: 7 } });
    h.say('b2', { kind: 'hash', report: { frame: 40, playerId: 1, hash: 7 } });
    expect(h.of('a', 'desync')).toHaveLength(0);
    expect(h.of('a', 'stall')).toHaveLength(0);
  });

  it('peer die niet antwoordt: na de timeout wijst de relay de volgende peer aan, daarna een fout', () => {
    const h = harness({ minPlayers: 3 });
    for (const [c, n] of [
      ['a', 'A'],
      ['b', 'B'],
      ['c', 'C'],
    ] as const)
      h.say(c, {
        kind: 'join',
        roomId: 'r',
        name: n,
        clientId: `client-${n}${n}${n}${n}${n}${n}${n}`,
      });
    for (const c of ['a', 'b', 'c']) h.say(c, { kind: 'ready', ready: true });
    h.run(20);
    h.say('c', { kind: 'leave' });
    h.say('c2', { kind: 'join', roomId: 'r', name: 'C', clientId: 'client-CCCCCCC' });
    expect(h.of('a', 'resyncRequest')).toHaveLength(1);
    h.tick(RESYNC_TIMEOUT_MS + 1);
    h.run(1);
    expect(h.of('b', 'resyncRequest')).toHaveLength(1);
    h.say('b', {
      kind: 'resyncResponse',
      response: { frame: 15, stateBase64: 'AA==', bundles: [] },
    });
    expect(h.of('c2', 'resyncResponse')[0]?.response.bundles[0]?.frame).toBe(15);
  });

  it('geen peer beschikbaar (enige mens plus AI): fout naar de terugkerende client', () => {
    const h = harness();
    h.say('a', { kind: 'join', roomId: 'r', name: 'A', clientId: 'client-aaaaaaaa' });
    h.say('a', { kind: 'addAi', faction: 'x' });
    h.say('a', { kind: 'ready', ready: true });
    h.say('a', { kind: 'leave' });
    h.say('a2', { kind: 'join', roomId: 'r', name: 'A', clientId: 'client-aaaaaaaa' });
    expect(h.of('a2', 'error').at(-1)?.message).toMatch(/peer/);
  });

  it('resync-state buiten de bewaarde bundels wordt afgewezen', () => {
    const h = startTwo();
    h.run(10);
    h.say('b', { kind: 'leave' });
    h.say('b2', { kind: 'join', roomId: 'r', name: 'B', clientId: 'client-bbbbbbbb' });
    h.say('a', {
      kind: 'resyncResponse',
      response: { frame: 500, stateBase64: 'AA==', bundles: [] },
    });
    expect(h.of('a', 'error').at(-1)?.message).toMatch(/bewaarde/);
    expect(h.of('b2', 'resyncResponse')).toHaveLength(0);
  });

  it('een nieuwe verbinding met dezelfde clientId vervangt een halfdode verbinding', () => {
    const h = startTwo();
    h.say('b2', { kind: 'join', roomId: 'r', name: 'B', clientId: 'client-bbbbbbbb' });
    expect(h.of('b', 'error').at(-1)?.message).toMatch(/vervangen/);
    expect(h.of('b2', 'start')[0]?.you).toBe(1);
    h.run(1);
    expect(h.of('b', 'bundle')).toHaveLength(0);
    expect(h.of('b2', 'bundle')).toHaveLength(1);
  });
});

describe('stall', () => {
  it('meldt wie ontbreekt na STALL_TIMEOUT_MS, alleen bij wijziging, en wist de melding', () => {
    const h = startTwo();
    h.run(21);
    h.say('a', { kind: 'hash', report: { frame: 20, playerId: 0, hash: 1 } });
    h.tick(STALL_TIMEOUT_MS - 100);
    h.run(1);
    expect(h.of('a', 'stall')).toHaveLength(0);
    h.tick(200);
    h.run(1);
    h.run(5);
    expect(h.of('a', 'stall').map((m) => m.notice.waitingFor)).toEqual([[1]]);
    expect(h.of('b', 'stall')).toHaveLength(1);
    h.say('b', { kind: 'hash', report: { frame: 20, playerId: 1, hash: 1 } });
    h.run(1);
    expect(h.of('a', 'stall').map((m) => m.notice.waitingFor)).toEqual([[1], []]);
    expect(h.room.isHalted).toBe(false);
    expect(h.room.bundles.length).toBeGreaterThan(26); // de relay gaf de hele tijd bundels uit
  });

  it('een speler die wegvalt blokkeert niet meer; er komt geen stall voor offline spelers', () => {
    const h = startTwo();
    h.run(20);
    h.say('a', { kind: 'hash', report: { frame: 20, playerId: 0, hash: 1 } });
    h.say('b', { kind: 'leave' });
    h.tick(STALL_TIMEOUT_MS * 3);
    h.run(1);
    expect(h.of('a', 'stall')).toHaveLength(0);
  });
});

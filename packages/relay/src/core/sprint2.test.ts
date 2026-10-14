import { describe, expect, it } from 'vitest';
import {
  DELAY_FRAMES_MAX,
  DELAY_FRAMES_MIN,
  HASH_INTERVAL_FRAMES,
  STALL_TIMEOUT_MS,
  TICK_MS,
  type ClientMessage,
  type CommandEnvelope,
  type ServerMessage,
} from '@crawlout/protocol';
import { DelayController } from './delay.js';
import { RESYNC_HISTORY_FRAMES, RESYNC_TIMEOUT_MS, Room, type RoomOptions } from './room.js';

const cmd = (playerId: number, seq: number, frame: number): CommandEnvelope => ({
  frame,
  playerId,
  seq,
  type: 'Stop',
  payload: { ids: [1] },
});

function harness(options: Partial<RoomOptions> = {}) {
  const inbox = new Map<string, ServerMessage[]>();
  let clock = 0;
  const room = new Room({
    roomId: 'r',
    chooseSeed: () => 99,
    now: () => clock,
    send: (id, m) => inbox.get(id)?.push(m),
    ...options,
  });
  const box = (id: string) => {
    let b = inbox.get(id);
    if (!b) inbox.set(id, (b = []));
    return b;
  };
  const say = (id: string, m: ClientMessage) => {
    box(id);
    room.handle(id, m);
  };
  const of = <K extends ServerMessage['kind']>(id: string, kind: K) =>
    box(id).filter((m): m is Extract<ServerMessage, { kind: K }> => m.kind === kind);
  /** n ticks van TICK_MS. */
  const run = (n: number) => {
    for (let i = 0; i < n; i++) {
      clock += TICK_MS;
      room.advance();
    }
  };
  const tick = (ms: number) => {
    clock += ms;
  };
  return { room, say, of, box, run, tick, now: () => clock };
}

function startTwo(options: Partial<RoomOptions> = {}) {
  const h = harness(options);
  h.say('a', { kind: 'join', roomId: 'r', name: 'A', clientId: 'client-aaaaaaaa' });
  h.say('b', { kind: 'join', roomId: 'r', name: 'B', clientId: 'client-bbbbbbbb' });
  h.say('a', { kind: 'ready', ready: true });
  h.say('b', { kind: 'ready', ready: true });
  return h;
}

describe('instellingen en AI', () => {
  it('alleen de host zet settings; ze gaan mee in lobby en start, zonder defaultgetal voor dominanceMinutes', () => {
    const h = harness();
    h.say('a', { kind: 'join', roomId: 'r', name: 'A' });
    h.say('b', { kind: 'join', roomId: 'r', name: 'B' });
    h.say('b', { kind: 'setSettings', settings: { mode: 'survival', delayFrames: 5 } });
    expect(h.of('b', 'error').at(-1)?.message).toMatch(/host/);
    h.say('a', {
      kind: 'setSettings',
      settings: { mode: 'survival', delayFrames: 5, dominanceMinutes: 7 },
    });
    const lobby = h.of('b', 'lobby').at(-1);
    expect(lobby?.settings).toEqual({ mode: 'survival', delayFrames: 5, dominanceMinutes: 7 });
    h.say('a', { kind: 'ready', ready: true });
    h.say('b', { kind: 'ready', ready: true });
    expect(h.of('a', 'start')[0]?.settings).toEqual({
      mode: 'survival',
      delayFrames: 5,
      dominanceMinutes: 7,
    });
    // Zonder dominanceMinutes blijft het veld weg: de waarde komt uit de map.
    const h2 = startTwo();
    expect(h2.of('a', 'start')[0]?.settings).not.toHaveProperty('dominanceMinutes');
  });

  it('klemt delayFrames binnen MIN en MAX en vraagt opnieuw om ready', () => {
    const h = harness();
    h.say('a', { kind: 'join', roomId: 'r', name: 'A' });
    h.say('a', { kind: 'ready', ready: true });
    h.say('a', { kind: 'setSettings', settings: { mode: 'skirmish', delayFrames: 99 } });
    expect(h.of('a', 'lobby').at(-1)?.settings?.delayFrames).toBe(DELAY_FRAMES_MAX);
    expect(h.of('a', 'lobby').at(-1)?.players[0]?.ready).toBe(false);
    h.say('a', { kind: 'setSettings', settings: { mode: 'skirmish', delayFrames: 0 } });
    expect(h.of('a', 'lobby').at(-1)?.settings?.delayFrames).toBe(DELAY_FRAMES_MIN);
  });

  it('AI telt mee voor minPlayers, is ready, heeft geen verbinding en hashes tellen niet', () => {
    const h = harness();
    h.say('a', { kind: 'join', roomId: 'r', name: 'A' });
    h.say('a', { kind: 'addAi', faction: 'wanderers' });
    const ai = h.of('a', 'lobby').at(-1)?.players[1];
    expect(ai).toMatchObject({
      playerId: 1,
      ai: true,
      ready: true,
      online: true,
      faction: 'wanderers',
    });
    h.say('a', { kind: 'ready', ready: true });
    expect(h.room.isStarted).toBe(true);
    expect(h.of('a', 'start')[0]?.players.map((p) => p.ai)).toEqual([false, true]);
    expect(h.room.connectionCount).toBe(1);
    // Alleen de mens hoeft te hashen.
    h.say('a', { kind: 'hash', report: { frame: 0, playerId: 0, hash: 5 } });
    expect(h.of('a', 'desync')).toHaveLength(0);
  });

  it('addAi en removeAi alleen door de host, niet na start, en removeAi alleen op AI', () => {
    const h = harness();
    h.say('a', { kind: 'join', roomId: 'r', name: 'A' });
    h.say('b', { kind: 'join', roomId: 'r', name: 'B' });
    h.say('b', { kind: 'addAi', faction: 'x' });
    expect(h.of('b', 'error')).toHaveLength(1);
    h.say('a', { kind: 'addAi', faction: 'x' });
    h.say('a', { kind: 'removeAi', playerId: 1 }); // een mens
    expect(h.of('a', 'error').at(-1)?.message).toMatch(/AI/);
    h.say('b', { kind: 'removeAi', playerId: 2 });
    expect(h.of('b', 'error')).toHaveLength(2);
    h.say('a', { kind: 'removeAi', playerId: 2 });
    expect(h.of('a', 'lobby').at(-1)?.players).toHaveLength(2);
    h.say('a', { kind: 'ready', ready: true });
    h.say('b', { kind: 'ready', ready: true });
    h.say('a', { kind: 'addAi', faction: 'x' });
    expect(h.of('a', 'error').at(-1)?.message).toMatch(/gestart/);
  });

  it('de host verschuift naar de laagste menselijke speler; AI-spelers gaan weg als de laatste mens vertrekt', () => {
    const h = harness();
    h.say('a', { kind: 'join', roomId: 'r', name: 'A' });
    h.say('b', { kind: 'join', roomId: 'r', name: 'B' });
    h.say('a', { kind: 'addAi', faction: 'x' }); // playerId 2
    h.say('a', { kind: 'leave' });
    h.say('b', { kind: 'setSettings', settings: { mode: 'skirmish', delayFrames: 3 } });
    expect(h.of('b', 'lobby').at(-1)?.settings?.delayFrames).toBe(3);
    h.say('b', { kind: 'leave' });
    h.say('c', { kind: 'join', roomId: 'r', name: 'C' });
    expect(
      h
        .of('c', 'lobby')
        .at(-1)
        ?.players.map((p) => p.ai),
    ).toEqual([false]);
  });
});

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
    h.run(20);
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

describe('adaptieve DELAY', () => {
  it('DelayController: omhoog direct, omlaag langzaam, binnen MIN en MAX', () => {
    const c = new DelayController();
    expect(c.evaluate(4)).toBe(4); // geen metingen
    for (let i = 0; i < 20; i++) c.sample(0, 6);
    expect(c.evaluate(4)).toBe(7);
    for (let i = 0; i < 20; i++) c.sample(0, 50);
    expect(c.evaluate(7)).toBe(DELAY_FRAMES_MAX);
    for (let i = 0; i < 40; i++) c.sample(0, 0);
    let d: number = DELAY_FRAMES_MAX;
    const seen: number[] = [];
    for (let i = 0; i < 30; i++) seen.push((d = c.evaluate(d)));
    expect(d).toBe(DELAY_FRAMES_MIN);
    expect(seen.every((v, i) => i === 0 || (seen[i - 1] as number) - v <= 1)).toBe(true);
  });

  it('commando-volgorde per speler blijft bewaard als DELAY tussendoor daalt', () => {
    const h = startTwo({ adaptiveDelay: false, settings: { delayFrames: 8 } });
    h.say('a', { kind: 'command', command: cmd(0, 0, 0) }); // exec 8
    // Interne daling simuleren: een tweede commando met eerder uitvoerframe mag niet voor seq 0 komen.
    (h.room as unknown as { scheduler: { delayFrames: number } }).scheduler.delayFrames = 2;
    h.say('a', { kind: 'command', command: cmd(0, 1, 1) }); // zou frame 3 zijn, wordt 8
    h.run(10);
    const out = h.room.bundles.flatMap((b) => b.commands.map((c) => [b.frame, c.seq]));
    expect(out).toEqual([
      [8, 0],
      [8, 1],
    ]);
  });

  /**
   * Latency-simulatie in virtuele tijd: 150 ms per kant (300 ms round-trip), clients voeren frame c pas uit
   * als de bundel er is en geven elke 5 frames een commando. De relay meet de lag uit frame-verschillen.
   */
  function simulate(opts: { adaptive: boolean; oneWayMs: number; steps: number }) {
    const delaySteps = opts.oneWayMs / TICK_MS;
    const toRelay: { at: number; conn: string; msg: ClientMessage }[] = [];
    const toClient: { at: number; conn: string; frame: number }[] = [];
    const clients = ['a', 'b'].map((conn, playerId) => ({
      conn,
      playerId,
      frame: 0,
      have: new Set<number>(),
      seq: 0,
      stalls: 0,
    }));
    let step = 0;
    let late = 0;
    let lateAfterWarmup = 0;
    const h = harness({
      adaptiveDelay: opts.adaptive,
      send: (id, m) => {
        if (m.kind === 'bundle')
          toClient.push({ at: step + delaySteps, conn: id, frame: m.bundle.frame });
      },
    });
    h.say('a', { kind: 'join', roomId: 'r', name: 'A' });
    h.say('b', { kind: 'join', roomId: 'r', name: 'B' });
    h.say('a', { kind: 'ready', ready: true });
    h.say('b', { kind: 'ready', ready: true });
    const warmup = 200;
    for (; step < opts.steps; step++) {
      for (const m of toClient.filter((x) => x.at <= step))
        clients.find((c) => c.conn === m.conn)?.have.add(m.frame);
      for (const m of toRelay.filter((x) => x.at <= step)) {
        if (m.msg.kind === 'command') {
          const isLate = m.msg.command.frame + h.room.delayFrames < h.room.bundles.length;
          if (isLate) late++;
          if (isLate && step >= warmup) lateAfterWarmup++;
        }
        h.say(m.conn, m.msg);
      }
      toClient.splice(0, toClient.length, ...toClient.filter((x) => x.at > step));
      toRelay.splice(0, toRelay.length, ...toRelay.filter((x) => x.at > step));
      h.run(1); // relay: één bundel per stap
      for (const c of clients) {
        if (c.have.has(c.frame)) {
          if (c.frame % 5 === 0)
            toRelay.push({
              at: step + delaySteps,
              conn: c.conn,
              msg: { kind: 'command', command: cmd(c.playerId, c.seq++, c.frame) },
            });
          if (c.frame % HASH_INTERVAL_FRAMES === 0)
            toRelay.push({
              at: step + delaySteps,
              conn: c.conn,
              msg: { kind: 'hash', report: { frame: c.frame, playerId: c.playerId, hash: 1 } },
            });
          c.frame++;
        } else c.stalls++;
      }
    }
    return { room: h.room, late, lateAfterWarmup, clients, of: h.of };
  }

  it("300 ms round-trip: DELAY past zich aan en commando's komen op tijd; zonder adaptatie zijn ze te laat", () => {
    const fixed = simulate({ adaptive: false, oneWayMs: 150, steps: 600 });
    expect(fixed.lateAfterWarmup).toBeGreaterThan(50);

    const adaptive = simulate({ adaptive: true, oneWayMs: 150, steps: 600 });
    expect(adaptive.room.delayFrames).toBeGreaterThanOrEqual(6);
    expect(adaptive.room.delayFrames).toBeLessThanOrEqual(DELAY_FRAMES_MAX);
    expect(adaptive.lateAfterWarmup).toBe(0);
    expect(adaptive.late).toBeGreaterThan(0); // vóór de aanpassing waren er wel late commando's
    // Speelbaar: clients lopen mee met de relay (alleen de eerste 150 ms wachten ze) en er is geen desync of stall.
    expect(adaptive.clients.every((c) => c.stalls <= 4)).toBe(true);
    expect(adaptive.clients.every((c) => c.frame >= 600 - 4)).toBe(true);
    expect(adaptive.of('a', 'desync')).toHaveLength(0);
    expect(adaptive.of('a', 'stall')).toHaveLength(0);
  });

  it('lage latency: DELAY zakt naar het minimum', () => {
    const r = simulate({ adaptive: true, oneWayMs: 50, steps: 600 });
    expect(r.room.delayFrames).toBeLessThanOrEqual(4);
    expect(r.room.delayFrames).toBeGreaterThanOrEqual(DELAY_FRAMES_MIN);
    expect(r.lateAfterWarmup).toBe(0);
  });
});

describe('history', () => {
  it('is begrensd, met volledige opname alleen op verzoek', () => {
    const h = startTwo();
    const full = startTwo({ recordReplay: true });
    const total = RESYNC_HISTORY_FRAMES * 2;
    h.run(total);
    full.run(total);
    expect(h.room.bundles.length).toBeLessThan(total);
    expect(h.room.bundles.length).toBeGreaterThanOrEqual(RESYNC_HISTORY_FRAMES);
    expect(h.room.bundles.at(-1)?.frame).toBe(total - 1);
    expect(h.room.bundles.map((b) => b.frame)).toEqual(
      Array.from({ length: h.room.bundles.length }, (_, i) => total - h.room.bundles.length + i),
    );
    expect(full.room.recordedBundles).toHaveLength(total);
    expect(full.room.bundles.length).toBeLessThan(total);
  });
});

// Split from sprint2.test.ts to stay under the 5,000-token file limit.
import { describe, it, expect } from 'vitest';
import { DelayController } from './delay.js';
import {
  DELAY_FRAMES_MAX,
  DELAY_FRAMES_MIN,
  TICK_MS,
  type ClientMessage,
  HASH_INTERVAL_FRAMES,
} from '@crawlout/protocol';
import { RESYNC_HISTORY_FRAMES } from './room.js';
import { cmd, harness, startTwo } from './sprint2.helpers.js';

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

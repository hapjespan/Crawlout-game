import { describe, expect, it } from 'vitest';
import { TICK_MS } from '@crawlout/protocol';
import { TestNet, commonFrames, hashMismatches } from './support/lockstepNet.js';

// Brief-eindcriterium relay: een client die 10 seconden wegvalt komt terug via resync.
// Twee echte sims, de echte Room en BundleFeed; de teruggekeerde client laadt de state van de peer en speelt versneld in.

const DROP_MS = 10_000;
const ONE_WAY_MS = 50;

describe('10 s wegval en resync', () => {
  const net = new TestNet(ONE_WAY_MS);
  const [a, b] = net.addClients(2) as [(typeof net.clients)[number], (typeof net.clients)[number]];
  net.run(100);
  const droppedAt = b.frame;
  net.drop(b);
  net.run(DROP_MS / TICK_MS);
  const relayWhenBack = net.relayNext;
  net.reconnect(b);
  net.run(10);
  const resyncedAt = b.resyncedAtFrame;
  net.run(200);

  it('de relay wijst A aan als peer en B laadt een state die bij de relay aansluit', () => {
    expect(b.received.filter((m) => m.kind === 'start')).toHaveLength(2);
    expect(a.received.some((m) => m.kind === 'resyncRequest')).toBe(true);
    expect(b.received.some((m) => m.kind === 'resyncResponse')).toBe(true);
    expect(resyncedAt).not.toBeNull();
    // De state van A is van na de wegval van B en niet nieuwer dan wat de relay toen had uitgegeven.
    expect(resyncedAt as number).toBeGreaterThan(droppedAt + DROP_MS / TICK_MS - 5);
    expect(resyncedAt as number).toBeLessThanOrEqual(net.relayNext);
    expect(relayWhenBack).toBeGreaterThan(droppedAt + DROP_MS / TICK_MS);
  });

  it('B haalt de achterstand in en staat weer bij de relay', () => {
    expect(b.awaitingResync).toBe(false);
    expect(net.relayNext - b.frame).toBeLessThanOrEqual(4);
    expect(net.relayNext - a.frame).toBeLessThanOrEqual(4);
  });

  it('de hashes van A en B zijn gelijk vanaf het geladen frame, in de re-simulatie en daarna', () => {
    const from = resyncedAt as number;
    expect(commonFrames(a, b, from)).toBeGreaterThan(200);
    expect(hashMismatches(a, b, from)).toEqual([]);
    expect(net.room.isHalted).toBe(false);
    for (const c of [a, b]) expect(c.received.some((m) => m.kind === 'desync')).toBe(false);
  });

  it('commando\'s van B na de terugkeer worden uitgevoerd', () => {
    const afterBack = net.room.recordedBundles.filter((bundle) => bundle.frame >= relayWhenBack).flatMap((bundle) => bundle.commands);
    expect(afterBack.some((c) => c.playerId === b.playerId)).toBe(true);
  });
});

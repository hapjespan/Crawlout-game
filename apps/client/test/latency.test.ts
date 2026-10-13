import { describe, expect, it } from 'vitest';
import { DELAY_FRAMES_DEFAULT, DELAY_FRAMES_MAX, TICK_MS } from '@crawlout/protocol';
import { TestNet, commonFrames, hashMismatches } from './support/lockstepNet.js';

// Brief-eindcriterium relay: 300 ms gesimuleerde latency blijft speelbaar met adaptieve DELAY.
// Twee clients met een round-trip van 300 ms (150 ms per kant), echte Room, echte sim, echte data (Rustbelt).

const ROUND_TRIP_MS = 300;
const WARMUP_FRAMES = 60;
const MATCH_STEPS = 400;

describe('300 ms round-trip met adaptieve DELAY', () => {
  const net = new TestNet(ROUND_TRIP_MS / 2);
  const [a, b] = net.addClients(2) as [(typeof net.clients)[number], (typeof net.clients)[number]];
  net.run(MATCH_STEPS);

  it('de relay verhoogt DELAY boven de startwaarde, binnen MIN..MAX', () => {
    expect(net.room.delayFrames).toBeGreaterThan(DELAY_FRAMES_DEFAULT);
    expect(net.room.delayFrames).toBeLessThanOrEqual(DELAY_FRAMES_MAX);
    // De gemeten round-trip is ongeveer ROUND_TRIP_MS / TICK_MS = 6 frames.
    expect(net.room.measuredLagFrames).toBeGreaterThan(ROUND_TRIP_MS / TICK_MS - 2);
    expect(net.room.measuredLagFrames).toBeLessThan(ROUND_TRIP_MS / TICK_MS + 2);
  });

  it('na de opwarming komt geen enkel commando te laat bij de relay', () => {
    const afterWarmup = net.commandLog.filter((c) => c.frame >= WARMUP_FRAMES);
    expect(afterWarmup.length).toBeGreaterThan(40);
    const late = afterWarmup.filter((c) => c.relayNext > c.frame + c.delay);
    expect(late).toEqual([]);
    // Vóór de opwarming (DELAY 4 tegen 6 frames round-trip) zijn er wel te late commando's: de test meet dus echt iets.
    expect(net.commandLog.filter((c) => c.frame < WARMUP_FRAMES).some((c) => c.relayNext > c.frame + c.delay)).toBe(true);
  });

  it('beide clients houden het tempo bij en de commando\'s worden uitgevoerd', () => {
    // Een client loopt de relay hooguit round-trip + 1 frame achter; hij staat niet stil te wachten.
    for (const c of [a, b]) expect(net.relayNext - c.frame).toBeLessThanOrEqual(ROUND_TRIP_MS / TICK_MS / 2 + 2);
    const executed = net.room.recordedBundles.reduce((n, bundle) => n + bundle.commands.length, 0);
    expect(executed).toBeGreaterThan(80);
  });

  it('de hashes van beide clients zijn gelijk op elk gedeeld frame en de relay meldt geen desync', () => {
    expect(net.room.isHalted).toBe(false);
    for (const c of [a, b]) expect(c.received.some((m) => m.kind === 'desync')).toBe(false);
    expect(commonFrames(a, b)).toBeGreaterThan(MATCH_STEPS - 20);
    expect(hashMismatches(a, b)).toEqual([]);
    // En de sim bewoog echt: de hash verandert over de tijd.
    expect(new Set(a.hashes.values()).size).toBeGreaterThan(100);
  });
});

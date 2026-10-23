import { describe, expect, it } from 'vitest';
import { CONFIG, REAL_CONFIG, testInit } from './helpers.js';
import { createSim, deserialize } from '../src/index.js';
import {
  DIFFICULTY_COUNT,
  DIFFICULTY_EASY,
  DIFFICULTY_HARD,
  DIFFICULTY_NORMAL,
  difficultyBand,
  envHash,
  scaleAiScripts,
  simDifficulty,
} from '../src/index.js';
import type { SimEnv, SimInit } from '../src/index.js';

// Moeilijkheidsgraad (sim 0.37.0, data 0.45.0, protocol 0.21.0; voorstel, besluit fase-0 sectie 26).
// De belangrijkste regressietest staat onderaan: een potje zonder niveau rekent exact zoals voorheen.
// Sim 0.38.0, data 0.46.0 (besluit fase-0 sectie 27): `normal` is precies diezelfde stand — geen trekking,
// vermenigvuldiger 1,0, dezelfde envHash. Alleen easy en hard loten.

const initWith = (difficulty?: number, seed = 1): SimInit => ({
  ...testInit(seed),
  ...(difficulty === undefined ? {} : { difficulty }),
});

/** envOf uit helpers.ts laat `difficulty` vallen; hier hoort hij er juist in (hij zit in de envHash). */
const envWith = (init: SimInit): SimEnv => ({
  players: init.players,
  map: init.map,
  config: init.config,
  ...(init.difficulty === undefined ? {} : { difficulty: init.difficulty }),
});

describe('moeilijkheidsgraad (sim 0.37.0)', () => {
  it('simDifficulty vertaalt MatchSettings.difficulty, en niets anders', () => {
    expect(simDifficulty('easy')).toBe(DIFFICULTY_EASY);
    expect(simDifficulty('normal')).toBe(DIFFICULTY_NORMAL);
    expect(simDifficulty('hard')).toBe(DIFFICULTY_HARD);
    expect(simDifficulty(undefined)).toBeUndefined();
    expect(simDifficulty('brutal')).toBeUndefined();
  });

  it('de banden komen uit de data: hard onder 1000, normal exact 1000, easy erboven', () => {
    const bands = [DIFFICULTY_EASY, DIFFICULTY_NORMAL, DIFFICULTY_HARD].map(
      (l) => difficultyBand(CONFIG, l)!,
    );
    const [easy, normal, hard] = bands;
    expect(bands).toHaveLength(DIFFICULTY_COUNT);
    for (const b of bands) expect(b.lo).toBeLessThanOrEqual(b.hi);
    expect(hard!.hi).toBeLessThan(1000);
    expect(easy!.lo).toBeGreaterThan(1000);
    // data 0.45.0: hard 0,75 en easy 1,5 met hun spreiding; data 0.46.0: normal exact 1,0 zonder spreiding
    expect([hard!.lo, hard!.hi]).toEqual([690, 810]);
    expect([normal!.lo, normal!.hi]).toEqual([1000, 1000]);
    expect([easy!.lo, easy!.hi]).toEqual([1350, 1650]);
  });

  it('de drie knoppengroepen schuiven: klok en legers maal m, economie gedeeld door m', () => {
    const base = REAL_CONFIG.aiScripts[0]!;
    const slow = scaleAiScripts(REAL_CONFIG, 1500)[0]!; // easy
    const fast = scaleAiScripts(REAL_CONFIG, 750)[0]!; // hard
    // 1. de klok
    expect(slow.buildOrder[0]!.atTick).toBe(Math.round(base.buildOrder[0]!.atTick * 1.5));
    expect(fast.pushFromTicks).toBe(Math.round(base.pushFromTicks * 0.75));
    for (const k of [
      'researchFromTicks',
      'claimFromTicks',
      'waveIntervalTicks',
      'pushFromTicks',
    ] as const) {
      expect(slow[k]).toBeGreaterThan(base[k]);
      expect(fast[k]).toBeLessThan(base[k]);
    }
    expect(slow.attackTimersTicks[0]).toBeGreaterThan(base.attackTimersTicks[0]!);
    expect(fast.attackTimersTicks[0]).toBeLessThan(base.attackTimersTicks[0]!);
    // 2. de legergroottes
    expect(slow.waveMinArmy).toBeGreaterThan(base.waveMinArmy);
    expect(fast.pushMinArmy).toBeLessThan(base.pushMinArmy);
    // 3. de economie, andersom
    expect(slow.scavengersPerNode).toBeLessThan(base.scavengersPerNode);
    expect(fast.scavengersPerNode).toBeGreaterThan(base.scavengersPerNode);
    expect(fast.builders).toBeGreaterThan(base.builders);
    // en verder blijft alles staan zoals het in data/ai staat
    expect(slow.research).toEqual(base.research);
    expect(slow.waveJitterTicks).toBe(base.waveJitterTicks);
    expect(slow.defendRadius).toBe(base.defendRadius);
    expect(slow.raidPlan).toEqual(base.raidPlan);
    expect(slow.creeps).toEqual(base.creeps);
  });

  it('de ondergrenzen uit de data houden easy speelbaar', () => {
    const d = REAL_CONFIG.difficulty!;
    for (const s of scaleAiScripts(REAL_CONFIG, 1650)) {
      expect(s.builders).toBeGreaterThanOrEqual(d.minBuilders);
      expect(s.scavengersPerNode).toBeGreaterThanOrEqual(d.minScavengersPerNode);
      expect(s.waveMinArmy).toBeGreaterThanOrEqual(d.minArmy);
      expect(s.pushMinArmy).toBeGreaterThanOrEqual(d.minArmy);
    }
  });

  it('de loting is één trekking uit sim.rng in start(), vóór frame 0', () => {
    const sim = createSim(initWith(DIFFICULTY_HARD, 4242));
    const band = difficultyBand(CONFIG, DIFFICULTY_HARD)!;
    const m = sim.difficulty.roll[0]!;
    expect(m).toBeGreaterThanOrEqual(band.lo);
    expect(m).toBeLessThanOrEqual(band.hi);
    expect(sim.frame).toBe(0);
    expect(sim.aiScripts[0]!.pushFromTicks).toBe(scaleAiScripts(CONFIG, m)[0]!.pushFromTicks);
  });

  it('dezelfde seed plus settings geeft dezelfde tegenstander (geen Math.random, geen klok)', () => {
    const a = createSim(initWith(DIFFICULTY_EASY, 99));
    const b = createSim(initWith(DIFFICULTY_EASY, 99));
    expect(b.difficulty.roll[0]).toBe(a.difficulty.roll[0]);
    expect(b.hash()).toBe(a.hash());
    for (let f = 0; f < 60; f++) {
      a.applyBundle({ frame: f, commands: [] });
      b.applyBundle({ frame: f, commands: [] });
      expect(b.tick()).toBe(a.tick());
    }
  });

  it('een andere seed loot (meestal) een andere tegenstand binnen hetzelfde niveau', () => {
    const rolls = new Set<number>();
    for (let seed = 1; seed <= 24; seed++)
      rolls.add(createSim(initWith(DIFFICULTY_EASY, seed)).difficulty.roll[0]!);
    expect(rolls.size).toBeGreaterThan(1);
  });

  it('het niveau gaat de envHash in: twee clients met een ander niveau vallen op tick 0 uit elkaar', () => {
    const none = envHash(envWith(initWith()));
    const easy = envHash(envWith(initWith(DIFFICULTY_EASY)));
    const normal = envHash(envWith(initWith(DIFFICULTY_NORMAL)));
    const hard = envHash(envWith(initWith(DIFFICULTY_HARD)));
    // sim 0.38.0: normal is de stand zonder niveau, dus drie verschillende hashes, niet vier
    expect(normal).toBe(none);
    expect(new Set([none, easy, hard]).size).toBe(3);
  });

  // Besluit fase-0 sectie 27 (Martien, 22 oktober): `normal` is géén vierde stand meer.
  it('normal is identiek aan afwezig: geen trekking, factor 1,0, dezelfde scripts, state en hash', () => {
    const plain = createSim(initWith(undefined, 5));
    const normal = createSim(initWith(DIFFICULTY_NORMAL, 5));
    expect(normal.difficulty.active).toBe(false);
    expect(normal.difficulty.roll[0]).toBe(0);
    expect(normal.aiScripts).toBe(CONFIG.aiScripts); // dezelfde objecten, geen kopie
    expect(normal.rng.state).toBe(plain.rng.state); // geen rng-stap
    expect(normal.serialize().byteLength).toBe(plain.serialize().byteLength);
    expect(normal.hash()).toBe(plain.hash());
    for (let f = 0; f < 60; f++) {
      plain.applyBundle({ frame: f, commands: [] });
      normal.applyBundle({ frame: f, commands: [] });
      expect(normal.tick()).toBe(plain.tick());
    }
  });

  it('de trekking zit in de state: een resync krijgt dezelfde tegenstander', () => {
    const sim = createSim(initWith(DIFFICULTY_HARD, 7));
    for (let f = 0; f < 30; f++) {
      sim.applyBundle({ frame: f, commands: [] });
      sim.tick();
    }
    const loaded = deserialize(sim.serialize(), envWith(initWith(DIFFICULTY_HARD, 7)));
    expect(loaded.difficulty.roll[0]).toBe(sim.difficulty.roll[0]);
    expect(loaded.aiScripts[0]!.pushFromTicks).toBe(sim.aiScripts[0]!.pushFromTicks);
    expect(loaded.hash()).toBe(sim.hash());
  });

  it('een niveau zonder band in de data is een fout, geen stil genegeerde instelling', () => {
    const bare = { ...CONFIG };
    delete (bare as { difficulty?: unknown }).difficulty;
    expect(() => createSim({ ...initWith(DIFFICULTY_HARD), config: bare })).toThrow();
    expect(() => createSim(initWith(DIFFICULTY_COUNT))).toThrow();
  });

  // DE REGRESSIETEST: zonder niveau is er geen trekking, geen envHash-wijziging en geen gedragswijziging.
  it('zonder niveau raakt niets: dezelfde envHash, dezelfde rng en dezelfde scripts als voorheen', () => {
    const plain = createSim(initWith());
    expect(plain.difficulty.active).toBe(false);
    expect(plain.difficulty.roll[0]).toBe(0);
    expect(plain.aiScripts).toBe(CONFIG.aiScripts);
    // de trekking van een niveau kost een rng-stap; zonder niveau staat de rng nog op zijn startwaarde
    const rolled = createSim(initWith(DIFFICULTY_HARD));
    expect(rolled.rng.state).not.toBe(plain.rng.state);
    // en de state van een potje zonder niveau is korter dan die met (de trekking is de enige extra chunk)
    expect(plain.serialize().byteLength + 4).toBe(rolled.serialize().byteLength);
  });
});

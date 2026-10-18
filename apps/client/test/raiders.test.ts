import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { ANIM, type PlayerStatus } from '@crawlout/protocol';
import { buildingTypeId, heroTypeId, unitTypeId } from '@crawlout/data';
import { loadGameDataFromDir } from '@crawlout/data/node';
import { buildingCards, raiderTechEffects } from '../src/game/cards.js';
import { raiderKindOf, raiderLines, raiderStats, seesEnemySlaves } from '../src/game/raiders.js';
import { buildRoster, LOADOUT_NAMES } from '../src/game/roster.js';
import type { EntityRow } from '../src/game/snapshot.js';

const data = loadGameDataFromDir(fileURLToPath(new URL('../../../data', import.meta.url)));
const raiders = data.factions.find((f) => f.key === 'raiders')!;
const loadout = (key: string) => data.loadouts.find((l) => l.key === key)!;
const building = (key: string) => data.buildings.find((b) => b.key === key)!;
const unit = (key: string) => unitTypeId(loadout(key).id);
const house = (key: string) => buildingTypeId(building(key).id);
const row = (id: number, typeId: number, over: Partial<EntityRow> = {}): EntityRow => ({
  id,
  typeId,
  owner: 0,
  x: 0,
  y: 0,
  hpPct: 100,
  anim: ANIM.idle,
  flags: 0,
  animT: 0,
  ...over,
});
const status = (over: Partial<PlayerStatus> = {}): PlayerStatus => ({
  playerId: 0,
  scrap: 1000,
  settlers: 5,
  pop: 5,
  popCap: 10,
  beds: 10,
  hero: null,
  techs: [],
  queue: [],
  dominance: { pointsHeld: 0, pointsRequired: 2, ticksHeld: 0, ticksRequired: 9600, leader: null },
  robotPop: 0,
  trained: [0, 0, 0, 0, 0, 0, 0],
  claimPoints: [],
  ...over,
});

describe('Raider roster', () => {
  it('has a Dutch name for every Raider loadout and never shows the hero body as a tile', () => {
    const bodies = new Set(data.heroes.map((h) => h.baseLoadoutId));
    for (const l of data.loadouts.filter((x) => x.factionId === raiders.id && !bodies.has(x.id)))
      expect(LOADOUT_NAMES[l.key], l.key).toBeDefined();
    expect(LOADOUT_NAMES.chemdealer).toBe('Chem-dealer');
    expect(LOADOUT_NAMES.slaaf_bouwer).toBe('Slaaf-bouwer');
    const groups = buildRoster(data, raiders.id, 0, [
      row(1, unit('slaaf')),
      row(2, heroTypeId(data.heroes.find((h) => h.factionId === raiders.id)!.id)),
    ]);
    expect(groups.map((g) => g.key)).not.toContain('warlord_basis');
    expect(groups.map((g) => g.key)).toEqual(['hero', 'slaaf', 'slaaf_bouwer']);
    // names that are too wide for a tile carry a short label; the full name stays in `naam`
    const slaaf = buildRoster(data, raiders.id, 0, [row(3, unit('slaaf_bouwer'))]).find(
      (g) => g.key === 'slaaf_bouwer',
    )!;
    expect(slaaf).toMatchObject({ naam: 'Slaaf-bouwer', short: 'Sl-bouw' });
  });

  it('shows Slaver and Chem-dealer once they exist', () => {
    const groups = buildRoster(data, raiders.id, 0, [
      row(1, unit('slaver')),
      row(2, unit('chemdealer')),
    ]);
    expect(groups.find((g) => g.key === 'slaver')!.units).toHaveLength(1);
    expect(groups.find((g) => g.key === 'chemdealer')!.naam).toBe('Chem-dealer');
  });
});

describe('Raider kinds and selection lines', () => {
  it('tells slaves, slavers and chem-dealers apart and leaves Dwellers alone', () => {
    expect(raiderKindOf(data, loadout('slaaf'))).toBe('slave');
    expect(raiderKindOf(data, loadout('slaver'))).toBe('slaver');
    expect(raiderKindOf(data, loadout('chemdealer'))).toBe('chemDealer');
    expect(raiderKindOf(data, loadout('plunderaar'))).toBe('fighter');
    expect(raiderKindOf(data, loadout('scavenger'))).toBeUndefined();
  });

  const camp = row(100, house('raiderkamp'), { x: 0, y: 0 });
  const slave = row(1, unit('slaaf'), { x: 256 * 5, y: 0 });
  const lines = (e: EntityRow, own: EntityRow[], techs: number[] = []) =>
    raiderLines(data, raiders.id, 0, e, own, 20, techs);

  it('names the Kooi a slave is bound to with the work radius', () => {
    expect(lines(slave, [camp, slave])).toEqual(['Kooi: Raiderkamp, werkstraal 45 m']);
    expect(lines(slave, [slave])[0]).toContain('Geen Kooi');
  });

  it('explains the Slaver and the Chem-dealer, with the chem state from the researched techs', () => {
    expect(lines(row(2, unit('slaver')), [])[0]).toMatch(/Vangt een bewoner onder 40% leven/);
    const dealer = row(3, unit('chemdealer'));
    const none = lines(dealer, []);
    expect(none.join('|')).toContain('Psycho: eerst psycho onderzoeken');
    const psycho = data.tech.find((t) => t.key === 'psycho')!.id;
    expect(lines(dealer, [], [psycho]).join('|')).toContain(
      'Psycho: klaar, 20 scrap per dosis, cooldown 40 s',
    );
  });

  it('gives a finished Kooi capacity, transition time and guard count', () => {
    const own = [camp, slave, row(4, unit('plunderaar'), { x: 256 * 3 })];
    const out = lines(camp, own);
    expect(out[0]).toBe('Kooi: 1 van 8 slaven, werkstraal 45 m');
    expect(out[1]).toContain('na 20 s slaaf');
    expect(out[2]).toBe('Bewakers: 1 van 1');
  });
});

describe('raiderStats', () => {
  const camp = row(100, house('raiderkamp'));
  it('counts slaves, fighters and prisoners and flags an unguarded Kooi', () => {
    const own = [
      camp,
      row(1, unit('slaaf'), { anim: ANIM.gather }),
      row(2, unit('slaaf')),
      row(3, unit('slaaf')),
      row(4, unit('slaaf')),
      row(5, unit('scavenger')), // a captured Dweller on the way to the cage
      row(6, unit('knuppelaar'), { x: 256 * 200 }), // far from the Kooi: no guard
    ];
    const stats = raiderStats(data, raiders.id, 0, own)!;
    expect(stats).toMatchObject({
      slaves: 4,
      slavesWorking: 1,
      prisoners: 1,
      fighters: 1,
      safetyThreshold: 5,
      tentReady: false,
    });
    // 4 slaves need ceil(4 / 3) = 2 guards, the only fighter is out of range
    expect(stats.cages[0]).toMatchObject({ slaves: 4, capacity: 8, guards: 0, guardsNeeded: 2 });
  });

  it('is null for the Dwellers', () => {
    const dwellers = data.factions.find((f) => f.key !== 'raiders' && f.slaves === null)!;
    expect(raiderStats(data, dwellers.id, 0, [])).toBeNull();
  });

  it('sees an enemy slave', () => {
    expect(seesEnemySlaves(data, 0, 255, [row(1, unit('slaaf'), { owner: 1 })])).toBe(true);
    expect(seesEnemySlaves(data, 0, 255, [row(1, unit('slaaf'), { owner: 0 })])).toBe(false);
    expect(seesEnemySlaves(data, 0, 255, [row(1, unit('scavenger'), { owner: 1 })])).toBe(false);
  });
});

describe('Raider cards', () => {
  const ctx = (selected: EntityRow[], own: EntityRow[], s = status()) => ({
    data,
    factionId: raiders.id,
    playerId: 0,
    status: s,
    selected,
    own,
    heroDead: false,
  });
  const tent = row(10, house('tent'));
  const yard = row(11, house('autosloperij'));

  it('a tent offers Produce cards for its fighters, a locked one names what it needs', () => {
    const cards = buildingCards(ctx([tent], [tent]));
    const names = cards.filter((c) => c.kind === 'produce').map((c) => c.naam);
    expect(names).toEqual(
      expect.arrayContaining(['Rover', 'Knuppelaar', 'Slaver', 'Hond', 'Chem-dealer']),
    );
    const dog = cards.find((c) => c.naam === 'Hond')!;
    expect(dog.state).toBe('locked');
    expect(dog.reason).toContain('Honden africhten');
    expect(cards.find((c) => c.naam === 'Slaver')!.state).toBe('available');
  });

  it('a Raider fighter needs a free bed', () => {
    const full = buildingCards(ctx([tent], [tent], status({ pop: 10, popCap: 10 })));
    const knuppel = full.find((c) => c.naam === 'Knuppelaar')!;
    expect(knuppel).toMatchObject({ state: 'locked', reason: 'Geen vrij bed: bouw een tent' });
  });

  it('the autosloperij produces the Buggy once its chassis is researched', () => {
    const chassis = data.tech.find((t) => t.key === 'buggy_chassis')!.id;
    const buggy = buildingCards(ctx([yard], [yard], status({ techs: [chassis] }))).find(
      (c) => c.naam === 'Buggy',
    )!;
    expect(buggy).toMatchObject({ kind: 'produce', state: 'available' });
    expect(buggy.effects[0]).toContain('telt voor 2 pop');
  });

  it('chemlab techs say what the chem does, its crash and its cooldown in plain Dutch', () => {
    const lab = row(12, house('chemlab'));
    const chemie = data.tech.find((t) => t.key === 'chemie')!.id;
    const cards = buildingCards(ctx([lab], [lab], status({ techs: [chemie] })));
    const psycho = cards.find((c) => c.naam === 'Psycho')!;
    expect(psycho.state).toBe('available');
    expect(psycho.effects).toEqual([
      'Dosis van 20 scrap, 12 s: +35% schade voor eigen eenheden in de aura, +2 Kracht voor de held',
      'Daarna 10 s crash: -25% schade voor eigen eenheden in de aura, -20% snelheid voor eigen eenheden in de aura',
      'Cooldown 40 s per eenheid',
    ]);
    expect(cards.find((c) => c.naam === 'Jet')!.effects[0]).toContain('+40% snelheid');
    expect(cards.find((c) => c.naam === 'Zuivere stoffen')!.effects[0]).toContain('30% langer');
    expect(cards.find((c) => c.naam === 'Chemie')!.unlocks).toContain('Chem-dealer');
  });

  it('afpersing says what it adds to the loot and the tribute', () => {
    expect(raiderTechEffects(data, raiders.id, 'afpersing')).toEqual([
      '+25% buit uit gesloopte gebouwen en gedode verzamelaars',
      '+50% tribuut van bezette nederzettingen',
    ]);
  });
});

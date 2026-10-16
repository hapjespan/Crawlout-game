import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { ANIM, type PlayerStatus } from '@crawlout/protocol';
import { buildingTypeId, unitTypeId } from '@crawlout/data';
import { loadGameDataFromDir } from '@crawlout/data/node';
import {
  buildingButtons,
  buildingCards,
  effectText,
  effectTexts,
  hasFinishedWorkshop,
  humanize,
} from '../src/game/cards.js';
import type { EntityRow } from '../src/game/snapshot.js';

const data = loadGameDataFromDir(fileURLToPath(new URL('../../../data', import.meta.url)));
const tech = (key: string) => data.tech.find((t) => t.key === key)!;
const building = (key: string) => data.buildings.find((b) => b.key === key)!;
const row = (id: number, typeId: number, anim: number = ANIM.idle): EntityRow => ({
  id,
  typeId,
  owner: 0,
  x: 0,
  y: 0,
  hpPct: 100,
  anim,
  flags: 0,
  animT: 0,
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
  ...over,
});

describe('effectText', () => {
  it('writes effects in plain language with the human unit', () => {
    expect(effectText({ stat: 'damagePct', target: 'turret', delta: 200 })).toBe(
      '+20% schade voor turrets',
    );
    expect(effectText({ stat: 'rangeM', target: 'turret', delta: 256 })).toBe(
      '+1 m bereik voor turrets',
    );
    expect(effectText({ stat: 'buildTimePct', target: 'bouwer', delta: -200 })).toBe(
      '-20% bouwtijd voor bouwer',
    );
    expect(humanize('composiet_pantser')).toBe('Composiet pantser');
  });
});

describe('buildingCards', () => {
  const lab = building('lab');
  const factionId = lab.factionId;
  const labRow = row(50, buildingTypeId(lab.id));
  const base = { data, factionId, playerId: 0, own: [labRow], heroDead: false };

  it('shows the research of the selected building with its state', () => {
    const cards = buildingCards({ ...base, status: status({ scrap: 120 }), selected: [labRow] });
    const byKey = (key: string) =>
      cards.find((c) => c.kind === 'research' && c.id === tech(key).id)!;
    const raffinage = byKey('raffinage');
    expect(raffinage.state).toBe(raffinage.scrapCost <= 120 ? 'available' : 'tooExpensive');
    expect(byKey('lasergeleiding')).toMatchObject({ state: 'locked', requires: ['Raffinage'] });
    expect(cards.map((c) => c.hotkey)).toEqual(cards.map((_, i) => String(i + 1)));
  });

  it('marks running and done research from the status', () => {
    const t = tech('raffinage');
    const running = buildingCards({
      ...base,
      status: status({
        queue: [{ kind: 'research', buildingId: 50, id: t.id, progressPermille: 450 }],
      }),
      selected: [labRow],
    });
    expect(running.find((c) => c.id === t.id)).toMatchObject({ state: 'running', progressPct: 45 });
    const done = buildingCards({ ...base, status: status({ techs: [t.id] }), selected: [labRow] });
    expect(done.find((c) => c.id === t.id)?.state).toBe('done');
  });

  it('offers craft cards for selected settlers only when a finished workshop exists', () => {
    const workshop = building('werkplaats');
    const settler = row(7, unitTypeId(data.loadouts[0]!.id));
    const none = buildingCards({ ...base, own: [settler], status: status(), selected: [settler] });
    expect(none).toEqual([]);
    const site = buildingCards({
      ...base,
      own: [settler, row(60, buildingTypeId(workshop.id), ANIM.build)],
      status: status(),
      selected: [settler],
    });
    expect(site).toEqual([]);
    const cards = buildingCards({
      ...base,
      own: [settler, row(60, buildingTypeId(workshop.id))],
      status: status(),
      selected: [settler],
    });
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => c.kind === 'craft')).toBe(true);
  });
});

describe('busy, locked and under construction', () => {
  const lab = building('lab');
  const factionId = lab.factionId;
  const labRow = row(50, buildingTypeId(lab.id));
  const base = { data, factionId, playerId: 0, heroDead: false };

  it('marks the other research of a busy lab as busy with a reason, not as available', () => {
    const raffinage = tech('raffinage');
    const cards = buildingCards({
      ...base,
      own: [labRow],
      selected: [labRow],
      status: status({
        scrap: 1000,
        techs: [raffinage.id],
        queue: [
          {
            kind: 'research',
            buildingId: 50,
            unitId: 0,
            id: tech('lasergeleiding').id,
            progressPermille: 100,
          },
        ],
      }),
    });
    const bouwrobots = cards.find((c) => c.id === tech('bouwrobots').id)!;
    expect(bouwrobots).toMatchObject({ state: 'busy' });
    expect(bouwrobots.reason).toMatch(/Lab is bezig/);
    expect(cards.find((c) => c.id === tech('lasergeleiding').id)?.state).toBe('running');
  });

  it('stays available while a second lab is idle', () => {
    const second = row(51, buildingTypeId(lab.id));
    const cards = buildingCards({
      ...base,
      own: [labRow, second],
      selected: [labRow],
      status: status({
        scrap: 1000,
        queue: [
          {
            kind: 'research',
            buildingId: 50,
            unitId: 0,
            id: tech('raffinage').id,
            progressPermille: 100,
          },
        ],
      }),
    });
    expect(cards.find((c) => c.id === tech('raffinage').id)?.state).toBe('running');
    // a lab research that is not running: the second lab can take it
    const raffinageDone = buildingCards({
      ...base,
      own: [labRow, second],
      selected: [labRow],
      status: status({
        scrap: 1000,
        techs: [tech('raffinage').id],
        queue: [
          {
            kind: 'research',
            buildingId: 50,
            unitId: 0,
            id: tech('lasergeleiding').id,
            progressPermille: 100,
          },
        ],
      }),
    });
    expect(raffinageDone.find((c) => c.id === tech('bouwrobots').id)?.state).toBe('available');
  });

  it('gives a locked card its reason and a too expensive card the missing scrap', () => {
    const cards = buildingCards({
      ...base,
      own: [labRow],
      selected: [labRow],
      status: status({ scrap: 20 }),
    });
    const laser = cards.find((c) => c.id === tech('lasergeleiding').id)!;
    expect(laser.reason).toBe('Vergrendeld: vereist Raffinage');
    const raf = cards.find((c) => c.id === tech('raffinage').id)!;
    expect(raf.state).toBe('tooExpensive');
    expect(raf.reason).toBe(`Te duur: nog ${raf.scrapCost - 20} scrap nodig`);
  });

  it('shows no cards for a building site', () => {
    const site = row(52, buildingTypeId(lab.id), ANIM.build);
    expect(buildingCards({ ...base, own: [site], selected: [site], status: status() })).toEqual([]);
  });

  it('does not offer craft cards for a hero-only selection', () => {
    const hero = row(9, 1000);
    const workshop = row(60, buildingTypeId(building('werkplaats').id));
    expect(
      buildingCards({ ...base, own: [hero, workshop], selected: [hero], status: status() }),
    ).toEqual([]);
  });
});

describe('robot production and training cards', () => {
  const factory = building('robotfabriek');
  const training = building('trainingsfaciliteit');
  const factionId = factory.factionId;
  const factoryRow = row(70, buildingTypeId(factory.id));
  const trainingRow = row(71, buildingTypeId(training.id));
  const base = { data, factionId, playerId: 0, heroDead: false };
  const robotica = tech('robotica');
  const loadout = (key: string) => data.loadouts.find((l) => l.key === key)!;

  it('lists the robots of the factory, locked until robotica, then available with Dutch effects', () => {
    const locked = buildingCards({
      ...base,
      own: [factoryRow],
      selected: [factoryRow],
      status: status({ scrap: 1000 }),
    });
    const produce = locked.filter((c) => c.kind === 'produce');
    expect(produce.map((c) => c.id).sort()).toEqual(
      data.loadouts
        .filter((l) => l.producedAt === factory.id)
        .map((l) => l.id)
        .sort(),
    );
    expect(produce.every((c) => c.state === 'locked' && c.buildingId === 70)).toBe(true);
    const open = buildingCards({
      ...base,
      own: [factoryRow],
      selected: [factoryRow],
      status: status({ scrap: 1000, techs: [robotica.id] }),
    });
    const guard = open.find((c) => c.id === loadout('beveiligingsrobot').id)!;
    expect(guard).toMatchObject({ kind: 'produce', state: 'available', icon: 'robot' });
    expect(guard.effects[0]).toMatch(/leven/);
  });

  it('runs one robot at a time per factory and shows its progress', () => {
    const l = loadout('beveiligingsrobot');
    const cards = buildingCards({
      ...base,
      own: [factoryRow],
      selected: [factoryRow],
      status: status({
        scrap: 1000,
        techs: [robotica.id],
        queue: [{ kind: 'produce', buildingId: 70, unitId: 0, id: l.id, progressPermille: 300 }],
      }),
    });
    expect(cards.find((c) => c.id === l.id)).toMatchObject({ state: 'running', progressPct: 30 });
    expect(cards.find((c) => c.id === loadout('reparatiedrone').id)?.state).toBe('busy');
  });

  it('blocks a robot that does not fit under the pop limit', () => {
    const l = loadout('sentinel');
    const cards = buildingCards({
      ...base,
      own: [factoryRow],
      selected: [factoryRow],
      status: status({
        scrap: 5000,
        techs: [tech('sentinel_protocol').id, robotica.id],
        pop: 30,
        robotPop: data.sim.popCapMax - 30 - l.popCost + 1,
      }),
    });
    const c = cards.find((x) => x.id === l.id)!;
    expect(c.state).toBe('locked');
    expect(c.reason).toMatch(/Pop-limiet/);
  });

  it('prices a training run by the points already trained and fills up at the maximum', () => {
    const tr = data.training[0]!;
    const cardOf = (trained: number) =>
      buildingCards({
        ...base,
        own: [trainingRow],
        selected: [trainingRow],
        status: status({
          scrap: 1000,
          trained: Array.from({ length: 7 }, (_, i) =>
            i === tr.special ? trained : 0,
          ) as PlayerStatus['trained'],
        }),
      }).find((c) => c.kind === 'train' && c.id === tr.id)!;
    const fresh = cardOf(0);
    expect(fresh).toMatchObject({ state: 'available', buildingId: 71, scrapCost: tr.scrapCost });
    const two = cardOf(2);
    expect(two.scrapCost).toBe(tr.scrapCost + 2 * tr.scrapCostStep);
    expect(two.seconds).toBeGreaterThan(fresh.seconds);
    expect(cardOf(tr.maxPoints).state).toBe('done');
  });
});

describe('buildingButtons', () => {
  const workshop = building('werkplaats');
  const house = building('woning');
  const hq = building('hoofdgebouw');
  const factionId = workshop.factionId;
  const own = [
    row(1, buildingTypeId(hq.id)),
    row(2, buildingTypeId(workshop.id)),
    row(3, buildingTypeId(house.id)),
    row(4, buildingTypeId(house.id)),
    row(5, buildingTypeId(house.id)),
    row(6, buildingTypeId(workshop.id), ANIM.build),
  ];
  const ctx = (st: PlayerStatus) => ({
    data,
    factionId,
    playerId: 0,
    status: st,
    selected: [],
    own,
    heroDead: false,
  });

  it('lists only finished buildings that have an action: no Basis, no Woning, sites under construction left out', () => {
    const buttons = buildingButtons(ctx(status()));
    expect(buttons.map((b) => [b.naam, b.sites.length])).toEqual([['Werkplaats', 1]]);
    expect(buttons[0]!.sites.map((s) => s.id)).toEqual([2]);
  });

  it('never lists buildings without an action (woning, claimpaal, turret, radiobaken)', () => {
    const quiet = ['woning', 'claimpaal', 'turret', 'radiobaken', 'hoofdgebouw'].map((k, i) =>
      row(20 + i, buildingTypeId(building(k).id)),
    );
    const buttons = buildingButtons({ ...ctx(status()), own: quiet });
    expect(buttons).toEqual([]);
  });

  it('lists lab, training and robot factory next to the workshop, in bar order', () => {
    const acting = ['robotfabriek', 'trainingsfaciliteit', 'lab', 'werkplaats'].map((k, i) =>
      row(30 + i, buildingTypeId(building(k).id)),
    );
    const buttons = buildingButtons({ ...ctx(status({ scrap: 1000 })), own: acting });
    expect(buttons.map((b) => b.key)).toEqual([
      'werkplaats',
      'lab',
      'trainingsfaciliteit',
      'robotfabriek',
    ]);
  });

  it('keeps a lab that is short of scrap listed, and drops a workshop with every tech researched', () => {
    const lab = row(40, buildingTypeId(building('lab').id));
    const poor = buildingButtons({ ...ctx(status({ scrap: 0 })), own: [lab] });
    expect(poor.map((b) => b.key)).toEqual(['lab']);
    const allTechs = data.tech.map((t) => t.id);
    const finished = buildingButtons({
      ...ctx(status({ scrap: 1000, techs: allTechs })),
      own: [row(41, buildingTypeId(workshop.id))],
    });
    expect(finished).toEqual([]);
  });

  it('counts the research a workshop can start and shows progress while it runs', () => {
    const shop = buildingButtons(ctx(status({ scrap: 1000 }))).find((b) => b.key === 'werkplaats')!;
    expect(shop.available).toBeGreaterThan(0);
    expect(shop.running).toBe(0);
    const busy = buildingButtons(
      ctx(
        status({
          scrap: 1000,
          queue: [
            {
              kind: 'research',
              buildingId: 2,
              unitId: 0,
              id: tech('geweerrek').id,
              progressPermille: 400,
            },
          ],
        }),
      ),
    ).find((b) => b.key === 'werkplaats')!;
    expect(busy).toMatchObject({ running: 1, progressPct: 40, available: 0 });
  });

  it('puts a revive on the Basis when the hero is dead, and lists the Basis only then', () => {
    expect(buildingButtons(ctx(status())).some((b) => b.key === 'hoofdgebouw')).toBe(false);
    const dead = buildingButtons({ ...ctx(status({ scrap: 1000 })), heroDead: true }).find(
      (b) => b.key === 'hoofdgebouw',
    )!;
    expect(dead.available).toBe(1);
  });
});

describe('hasFinishedWorkshop', () => {
  const workshop = building('werkplaats');
  it('needs a finished workshop of the player: none, a site and a finished one', () => {
    const hq = row(1, buildingTypeId(building('hoofdgebouw').id));
    expect(hasFinishedWorkshop(data, [hq])).toBe(false);
    expect(hasFinishedWorkshop(data, [hq, row(2, buildingTypeId(workshop.id), ANIM.build)])).toBe(
      false,
    );
    expect(hasFinishedWorkshop(data, [hq, row(3, buildingTypeId(workshop.id))])).toBe(true);
  });
});

describe('effectTexts', () => {
  it('writes player-wide time stats without a target and names the hero and the scavengers', () => {
    expect(effectTexts([{ stat: 'researchTimePct', target: 'alle', delta: -100 }])).toEqual([
      '-10% onderzoekstijd',
    ]);
    expect(effectTexts([{ stat: 'hpPct', target: 'held', delta: 100 }])).toEqual([
      '+10% leven voor de held',
    ]);
    expect(effectTexts([{ stat: 'gatherRatePct', target: 'scavenger', delta: 50 }])).toEqual([
      '+5% verzameltempo voor plunderaars',
    ]);
  });

  it('merges equal effects on several targets into one line', () => {
    const lines = effectTexts([
      { stat: 'hpPct', target: 'militie', delta: 150 },
      { stat: 'hpPct', target: 'patrol', delta: 150 },
      { stat: 'damagePct', target: 'turret', delta: 200 },
    ]);
    expect(lines).toEqual(['+15% leven voor militie, patrouille', '+20% schade voor turrets']);
  });
});

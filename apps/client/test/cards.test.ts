import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { ANIM, type PlayerStatus } from '@crawlout/protocol';
import { buildingTypeId, unitTypeId } from '@crawlout/data';
import { loadGameDataFromDir } from '@crawlout/data/node';
import { buildingCards, effectText, humanize } from '../src/game/cards.js';
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

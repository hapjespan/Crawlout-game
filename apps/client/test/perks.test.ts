import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { COMMAND_PAYLOADS, type HeroStatus } from '@crawlout/protocol';
import { loadGameDataFromDir } from '@crawlout/data/node';
import { perkOptions } from '../src/game/perks.js';

const data = loadGameDataFromDir(fileURLToPath(new URL('../../../data', import.meta.url)));
const hero = (over: Partial<HeroStatus> = {}): HeroStatus => ({
  heroId: 0,
  level: 2,
  xp: 80,
  xpNext: 200,
  special: [6, 5, 6, 4, 4, 6, 3],
  perks: [],
  pendingPerks: 1,
  revivesLeft: 4,
  state: 'alive',
  reviveTicksLeft: 0,
  entityId: 1,
  abilityCooldownTicks: [0],
  ...over,
});

describe('perkOptions', () => {
  it('lists the hero perk pool with Dutch names, effects and requirements', () => {
    const opts = perkOptions(data, hero());
    expect(opts.map((o) => o.perkId)).toEqual(data.heroes[0]!.perkPool);
    const laarzen = opts.find((o) => o.naam === 'Zware Laarzen')!;
    expect(laarzen.effects).toEqual(['+10% leven voor de held']);
    expect(laarzen.requirement).toBe('Uithoudingsvermogen 5');
    expect(laarzen.available).toBe(true);
    expect(opts.find((o) => o.naam === 'Papierwerk')!.effects).toEqual(['-10% onderzoekstijd']);
    expect(opts.find((o) => o.naam === 'Opzichterblik')!.effects).toEqual([
      '+5% verzameltempo voor plunderaars',
    ]);
  });

  it('marks a perk whose SPECIAL requirement the hero does not meet as unavailable', () => {
    const opts = perkOptions(data, hero({ special: [6, 5, 4, 4, 4, 6, 3] }));
    expect(opts.find((o) => o.naam === 'Zware Laarzen')!.available).toBe(false);
    expect(opts.find((o) => o.naam === 'Kluisvet')!.available).toBe(false);
    expect(opts.find((o) => o.naam === 'Opzichterblik')!.available).toBe(true);
  });

  it('leaves out perks that are already picked, and gives nothing without a hero', () => {
    const picked = data.heroes[0]!.perkPool[0]!;
    expect(perkOptions(data, hero({ perks: [picked] })).map((o) => o.perkId)).not.toContain(picked);
    expect(perkOptions(data, null)).toEqual([]);
  });

  it('every option id is a valid PickPerk payload', () => {
    for (const o of perkOptions(data, hero()))
      expect(COMMAND_PAYLOADS.PickPerk.safeParse({ heroId: 0, perkId: o.perkId }).success).toBe(
        true,
      );
  });
});

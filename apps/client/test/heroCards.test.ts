import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadGameDataFromDir } from '@crawlout/data/node';
import { heroCards } from '../src/game/heroCards.js';
import { menuFactions } from '../src/game/menuContent.js';

// Hero choice (protocol 0.19.0): three Dutch hero cards per faction for the menu.
const data = loadGameDataFromDir(fileURLToPath(new URL('../../../data', import.meta.url)));
const fid = (key: string) => data.factions.find((f) => f.key === key)!.id;

describe('hero cards', () => {
  it('three cards per faction, Bouwer, Krijger, Tacticus; the faction hero stays the Krijger', () => {
    for (const f of menuFactions(data)) {
      expect(f.heroes!.map((h) => h.archetype)).toEqual(['bouwer', 'krijger', 'tacticus']);
      expect(f.heroes![1]!.name).toBe(f.hero);
    }
    expect(menuFactions(data).find((f) => f.key === 'dwellers')!.hero).toBe('Opziener');
  });

  it('passive and ability in plain Dutch, with the numbers from the data', () => {
    const [voorman, , controleur] = heroCards(data, fid('dwellers'));
    expect(voorman).toMatchObject({ name: 'Voorman', role: 'Bouwer · economie' });
    expect(voorman!.passive).toContain('+8% verzameltempo voor plunderaars');
    expect(voorman!.passive).toContain('-10% bouwtijd');
    expect(voorman!.ability).toBe(
      'Haastklus: eigen units +25% snelheid, -10% schade ontvangen (rond de held, 14 m, 10 s, cd 60 s)',
    );
    expect(controleur!.passive).toContain('aura 8 m: vijanden -10% snelheid');
    expect(controleur!.ability).toContain('vijanden -40% snelheid, -25% schade');
    expect(controleur!.ability).toContain('tot 12 m, straal 7 m');
    const keten = heroCards(data, fid('raiders'))[2]!;
    expect(keten.name).toBe('Ketenmeester');
    expect(keten.passive).toBe('aura 8 m: vijanden -10% snelheid');
  });
});

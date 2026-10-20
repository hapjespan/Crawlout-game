// Split from raiders.test.ts to stay under the 5,000-token file limit.
import { describe, it, expect } from 'vitest';
import { type RawGameData, loadGameData } from './loader.js';
import { raw, records } from './raiders.helpers.js';
import type { Rec } from './raiders.helpers.js';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('Raiders: schema weigert ongeldige data', () => {
  const rec = (r: RawGameData, key: 'loadouts' | 'buildings' | 'factions' | 'heroes', id: string) =>
    records(r, key).find((x) => x.id === id)!;

  it('ai (data 0.24.0): hoogstens één script per factie en tegenstander, versus is een bestaande factie', () => {
    const vs = (r: RawGameData): Rec =>
      (r.ai as Rec[]).find((a) => a.id === 'dwellers-vs-raiders')!;
    const twice = clone(raw());
    twice.ai.push({ ...vs(twice), id: 'dwellers-vs-raiders-2' });
    expect(() => loadGameData(twice)).toThrow(/one script per faction and versus/);
    const unknown = clone(raw());
    vs(unknown).versus = 'nomaden';
    expect(() => loadGameData(unknown)).toThrow(/onbekende factie 'nomaden'/);
    const bad = clone(raw());
    vs(bad).liberate = { minFree: 0, units: 3, radiusM: 70 };
    expect(() => loadGameData(bad)).toThrow(/minFree/);
  });

  it('slaaf: vecht niet, is een arbeider en wordt niet gebouwd', () => {
    const fights = clone(raw());
    rec(fights, 'loadouts', 'slaaf').damage = 3;
    expect(() => loadGameData(fights)).toThrow(/damage/);
    const militia = clone(raw());
    rec(militia, 'loadouts', 'slaaf').role = 'militia';
    expect(() => loadGameData(militia)).toThrow(/role/);
    const built = clone(raw());
    rec(built, 'loadouts', 'slaaf').producedAt = 'tent';
    expect(() => loadGameData(built)).toThrow(/producedAt/);
    const slaverSlave = clone(raw());
    rec(slaverSlave, 'loadouts', 'slaaf').capture = {
      rangeM: 1,
      captureS: 1,
      targets: ['wanderer'],
      maxHpPct: 10,
    };
    expect(() => loadGameData(slaverSlave)).toThrow(/slave|capture/);
  });

  it('Kooi: cage hoort bij provides kooi en andersom; placement heeft min onder max', () => {
    const noCage = clone(raw());
    delete rec(noCage, 'buildings', 'kooi').cage;
    expect(() => loadGameData(noCage)).toThrow(/cage/);
    const strayCage = clone(raw());
    rec(strayCage, 'buildings', 'tent').cage = { capacity: 1, transitionS: 1, workRadiusM: 1 };
    expect(() => loadGameData(strayCage)).toThrow(/cage/);
    const badPlacement = clone(raw());
    rec(badPlacement, 'buildings', 'kooi').placement = { minFromHqM: 30, maxFromHqM: 10 };
    expect(() => loadGameData(badPlacement)).toThrow(/maxFromHqM/);
  });

  it('chems: verplicht bij het kanaal chems, onbekende tech, chem of doel worden geweigerd', () => {
    const none = clone(raw());
    delete rec(none, 'factions', 'raiders').chems;
    expect(() => loadGameData(none)).toThrow(/chems/);
    const stray = clone(raw());
    rec(stray, 'factions', 'dwellers').chems = (
      rec(raw(), 'factions', 'raiders').chems as unknown[]
    ).slice();
    expect(() => loadGameData(stray)).toThrow(/chems/);
    const badTech = clone(raw());
    ((rec(badTech, 'factions', 'raiders').chems as Rec[])[0] as Rec).requiresTech = 'bestaat_niet';
    expect(() => loadGameData(badTech)).toThrow(/bestaat_niet/);
    const badDealer = clone(raw());
    (rec(badDealer, 'loadouts', 'chemdealer').aura as Rec).chems = ['heroine'];
    expect(() => loadGameData(badDealer)).toThrow(/heroine/);
    const noCrash = clone(raw());
    ((rec(noCrash, 'factions', 'raiders').chems as Rec[])[0] as Rec).crash = [];
    expect(() => loadGameData(noCrash)).toThrow(/crash/);
  });

  it('vangnet, buit, tribute en slavenregels: verplichte velden en bonus-paren', () => {
    for (const field of ['intervalS', 'maxArrivals', 'loadoutId']) {
      const r = clone(raw());
      delete (rec(r, 'factions', 'raiders').safetyNet as Rec)[field];
      expect(() => loadGameData(r), field).toThrow(field);
    }
    const lonelyBonus = clone(raw());
    delete (rec(lonelyBonus, 'factions', 'raiders').plunder as Rec).bonusPct;
    expect(() => loadGameData(lonelyBonus)).toThrow(/bonusPct/);
    const lonelyTribute = clone(raw());
    delete (rec(lonelyTribute, 'factions', 'raiders').tribute as Rec).bonusTech;
    expect(() => loadGameData(lonelyTribute)).toThrow(/bonusPct|bonusTech/);
    const unknownCaptured = clone(raw());
    (rec(unknownCaptured, 'factions', 'raiders').slaves as Rec).capturedLoadoutId = 'spook';
    expect(() => loadGameData(unknownCaptured)).toThrow(/spook/);
    const overPct = clone(raw());
    ((rec(overPct, 'factions', 'raiders').slaves as Rec).revolt as Rec as Rec).escapePct = 150;
    expect(() => loadGameData(overPct)).toThrow(/escapePct/);
    const unknownField = clone(raw());
    (rec(unknownField, 'factions', 'raiders').slaves as Rec).onbekend = 1;
    expect(() => loadGameData(unknownField)).toThrow(/slaves|onbekend|Unrecognized/i);
  });

  it('held en AI: onbekend basis-loadout of roof-loadout wordt geweigerd', () => {
    const badBase = clone(raw());
    rec(badBase, 'heroes', 'warlord').baseLoadoutId = 'bestaat_niet';
    expect(() => loadGameData(badBase)).toThrow(/bestaat_niet/);
    const emptyAura = clone(raw());
    (rec(emptyAura, 'heroes', 'warlord').aura as Rec).effects = [];
    expect(() => loadGameData(emptyAura)).toThrow(/effects/);
    const badPlan = clone(raw());
    const ai = (badPlan.ai as Rec[]).find((a) => a.id === 'raiders-basic')!;
    ((ai.raidPlan as Rec).harass as Rec).loadoutId = 'raketman';
    expect(() => loadGameData(badPlan)).toThrow(/raketman/);
    const noSlaverPlan = clone(raw());
    const ai2 = (noSlaverPlan.ai as Rec[]).find((a) => a.id === 'raiders-basic')!;
    delete (ai2.raidPlan as Rec).garrison;
    expect(() => loadGameData(noSlaverPlan)).toThrow(/garrison/);
  });

  it('de loader blijft deterministisch en omgekeerde invoervolgorde geeft gelijke uitvoer', () => {
    const a = loadGameData(raw());
    const r = raw();
    const b = loadGameData({
      ...r,
      factions: [...(r.factions as unknown[])].reverse(),
      loadouts: [...(r.loadouts as unknown[])].reverse(),
      buildings: [...(r.buildings as unknown[])].reverse(),
      tech: [...(r.tech as unknown[])].reverse(),
      heroes: [...(r.heroes as unknown[])].reverse(),
      perks: [...(r.perks as unknown[])].reverse(),
      ai: [...r.ai].reverse(),
    });
    expect(b).toEqual(a);
  });
});

import { ARCHETYPES, STATS } from './loader.types.js';
import type { HeroData, PerkData, TechData, TrainingProgramData } from './loader.types.game.js';
import { metersToUnits, pctToPermille, secondsToTicks } from './units.js';
import type { LoadContext } from './loader.parse.js';
import { convertDelta, convertEffects, cumulate, idx, ref } from './loader.util.js';

// Part of the pure loader (see loader.ts): no IO, no clock; falls under the determinism lint.

/** Stage 7: tech. */
export function convertTech(ctx: LoadContext): TechData[] {
  const { techRaw, factionIx, buildingIx, techIx } = ctx;
  const tech: TechData[] = techRaw.map((t, id) => {
    const where = `data/tech.json '${t.id}'`;
    return {
      id,
      key: t.id,
      factionId: ref(factionIx, 'factie', where, t.faction),
      scrapCost: Math.trunc(t.scrapCost),
      researchTicks: secondsToTicks(t.researchS),
      buildingId: ref(buildingIx, 'gebouw', where, t.building),
      prereqTech: t.prereqTech.map((p) => ref(techIx, 'tech', where, p)),
      effects: convertEffects(t.effects),
    };
  });
  return tech;
}

/** Stage 8: heroes. */
export function convertHeroes(ctx: LoadContext): HeroData[] {
  const { heroesRaw, factionIx, loadoutIx, perkIx, simRaw } = ctx;
  const heroes: HeroData[] = heroesRaw.map((h, id) => {
    const where = `data/heroes.json '${h.id}'`;
    return {
      id,
      key: h.id,
      factionId: ref(factionIx, 'factie', where, h.faction),
      archetype: idx(ARCHETYPES, h.archetype),
      special: [
        h.special.S,
        h.special.P,
        h.special.E,
        h.special.C,
        h.special.I,
        h.special.A,
        h.special.L,
      ],
      naam: h.naam,
      xpThresholds: cumulate(h.xpPerLevel),
      xpPerKill: h.xpPerKill,
      xpPerDiscovery: h.xpPerDiscovery,
      xpPerAssist: h.xpPerAssist,
      xpAssistRadiusU: metersToUnits(h.xpAssistRadiusM),
      abilities: h.abilities.map((a) => ({
        id: a.id,
        naam: a.naam,
        cooldownTicks: secondsToTicks(a.cooldownS),
        rangeU: metersToUnits(a.rangeM),
        radiusU: metersToUnits(a.radiusM),
        durationTicks: secondsToTicks(a.durationS),
        effects: a.effects.map((e) => ({
          stat: e.stat,
          side: e.side,
          target: e.target,
          delta: convertDelta(e.stat, e.delta),
        })),
      })),
      passives: convertEffects(h.passives),
      aura:
        h.aura === undefined
          ? null
          : {
              radiusU: metersToUnits(h.aura.radiusM),
              effects: h.aura.effects.map((e) => ({
                stat: e.stat,
                side: e.side,
                target: e.target,
                delta: convertDelta(e.stat, e.delta),
              })),
            },
      xpPerCapture: h.xpPerCapture ?? 0,
      baseLoadoutId:
        h.baseLoadoutId === undefined
          ? -1
          : ref(loadoutIx, 'loadout', `${where} baseLoadoutId`, h.baseLoadoutId),
      perkPool: h.perkPool.map((p) => ref(perkIx, 'perk', where, p)),
      reviveScrap: Math.trunc(h.reviveScrap),
      reviveTicks: secondsToTicks(h.reviveS),
      revivePenaltyPermille: pctToPermille(h.revivePenaltyPct),
      maxRevives: h.maxRevives,
      sightU: metersToUnits(h.sightM ?? simRaw.vision.heroSightM),
    };
  });
  return heroes;
}

/** Stage 9: perks. */
export function convertPerks(ctx: LoadContext): PerkData[] {
  const { perksRaw } = ctx;
  const perks: PerkData[] = perksRaw.map((p, id) => ({
    id,
    key: p.id,
    naam: p.naam,
    flavourText: p.flavourText,
    requires: { stat: idx(STATS, p.requires.stat), min: p.requires.min },
    effects: convertEffects(p.effects),
  }));
  return perks;
}

/** Stage 10: SPECIAL training programs. */
export function convertTraining(ctx: LoadContext): TrainingProgramData[] {
  const { trainingRaw, factionIx, buildingIx, techIx } = ctx;
  const training: TrainingProgramData[] = trainingRaw.map((t, id) => {
    const where = `data/training.json '${t.id}'`;
    return {
      id,
      key: t.id,
      factionId: ref(factionIx, 'factie', where, t.faction),
      special: idx(STATS, t.special),
      buildingId: ref(buildingIx, 'gebouw', where, t.building),
      scrapCost: Math.trunc(t.scrapCost),
      scrapCostStep: Math.trunc(t.scrapCostStep),
      trainTicks: secondsToTicks(t.trainS),
      trainTicksStep: secondsToTicks(t.trainSStep),
      pointsPerRun: t.pointsPerRun,
      maxPoints: t.maxPoints,
      prereqTech: t.prereqTech.map((p) => ref(techIx, 'tech', where, p)),
    };
  });
  return training;
}

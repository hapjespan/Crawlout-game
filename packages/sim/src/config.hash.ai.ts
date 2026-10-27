import { fnv1aInt } from './math/fnv.js';
import { AI_SITE_HQ } from './config.faction.js';
import type { SimConfig } from './config.env.js';
import type { SimAiScript } from './config.faction.js';
import type { SimHero } from './config.types.js';
import { gatedFactions, gatedHeroes, gatedScripts } from './config.hash.garde.js';
import { legacyTechCount } from './config.hash.gardeB.js';
import { choiceHeroes, choicePerks } from './config.heroes.js';
import { hashEffects, hashInts } from './config.hash.config.js';

/**
 * Scripted AI. Sim 0.32.0: the scripts of a gated faction (the Garde, config.hash.garde.ts) are left out here and hashed
 * by hashGarde only when it plays, so every env without the Garde keeps its hash.
 */
export function hashAiScripts(h: number, c: SimConfig): number {
  const gated = gatedScripts(c);
  h = fnv1aInt(h, c.aiScripts.length - gated.size);
  c.aiScripts.forEach((s, k) => {
    if (!gated.has(k)) h = hashAiScript(h, s);
  });
  return h;
}

/** One script, in fixed field order. */
export function hashAiScript(h: number, s: SimAiScript): number {
  {
    h = fnv1aInt(h, s.buildOrder.length);
    for (const o of s.buildOrder) h = hashInts(h, [o.atTick, o.typeId, o.site ?? AI_SITE_HQ]);
    h = hashInts(h, s.attackTimersTicks);
    h = hashInts(h, [
      s.militiaPermille,
      s.militiaPermilleMax,
      s.militiaPermillePerMin,
      s.threatMilitiaPermille,
      s.builders,
    ]);
    h = hashInts(h, [
      s.housingTypeId,
      s.housingFreeBeds,
      s.researchFromTicks,
      s.richScrap,
      s.scavengersPerNode,
      s.claimFromTicks,
    ]);
    h = fnv1aInt(h, s.richBuilds.length);
    for (const o of s.richBuilds) h = hashInts(h, [o.typeId, o.site]);
    h = hashInts(h, s.research);
    h = hashInts(h, s.armyTypeIds);
    h = hashInts(h, [
      s.claimSafeRadius,
      s.claimFarFromTicks,
      s.heroClaimRadius,
      s.pushMinArmy,
      s.pushFromTicks,
      s.allInWithoutNodes ? 1 : 0,
    ]);
    h = hashInts(h, [
      s.defendRadius,
      s.rallySite,
      s.rallyRadius,
      s.waveIntervalTicks,
      s.waveJitterTicks,
      s.waveMinArmy,
      s.waveArmyGrowth,
      s.waveMaxWaitTicks,
    ]);
    h = hashInts(
      h,
      s.robots === null
        ? [0]
        : [1, s.robots.fromTicks, s.robots.max, s.robots.countAsArmy ? 1 : 0, s.robots.reservePop],
    );
    if (s.robots !== null) h = hashInts(h, s.robots.typeIds);
    // data 0.26.0: only when set, so a script without builder robots keeps its hash
    const hb = s.robots === null ? null : s.robots.builders;
    if (hb !== null) h = hashInts(h, [hb.typeId, hb.max, hb.fromTicks]);
    h = hashInts(
      h,
      s.reserve === null
        ? [0]
        : [1, s.reserve.fromTicks, s.reserve.minArmy, s.reserve.robotsFirstFromTicks],
    );
    h = hashInts(h, s.training === null ? [0] : [1, s.training.fromTicks]);
    if (s.training !== null) h = hashInts(h, s.training.programIds);
    const rp = s.raidPlan;
    h = fnv1aInt(h, rp === null ? 0 : 1);
    if (rp !== null) {
      h = fnv1aInt(h, rp.fighterMix.length);
      for (const m of rp.fighterMix) h = hashInts(h, [m.typeId, m.weight]);
      // data 0.38.0: harass and slave raids may be absent (only a gated script has that, see hashGarde)
      const hr = rp.harass;
      h = hashInts(h, hr === null ? [0] : [hr.typeId, hr.fromTicks, hr.max, hr.retreatHpPermille]);
      const sr = rp.slaveRaids;
      h = hashInts(
        h,
        sr === null
          ? [0]
          : [sr.slaverTypeId, sr.fromTicks, sr.slavers, sr.escort, sr.maxRaidTicks, sr.retryTicks],
      );
      h = hashInts(h, [
        rp.garrisonMinFighters,
        rp.dominancePush.fromTicks,
        rp.dominancePush.minArmy,
      ]);
      if (rp.workers !== null) h = hashInts(h, [rp.workers.scavengers]);
      if (rp.mixInOrder) h = hashInts(h, [1]); // data 0.38.0: only when set
      // data 0.43.0 (the Garde AI): only when set, so a script without them keeps its hash
      const sp = rp.support;
      if (sp !== null) h = hashInts(h, [sp.typeId, sp.fromTicks, sp.max, sp.perArmy, sp.withWave]);
      const al = rp.airlift;
      if (al !== null)
        h = hashInts(h, [
          al.typeId,
          al.fromTicks,
          al.max,
          al.minArmy,
          al.minPath,
          al.gather,
          al.minLoad,
          al.minHpPermille,
        ]);
    }
    const lb = s.liberate;
    h = hashInts(h, lb === null ? [0] : [1, lb.minFree, lb.units, lb.radius]);
    h = fnv1aInt(h, s.defendHqFirst ? 1 : 0);
  }
  return h;
}

/** Techs, perks, training programs, heroes, SPECIAL tuning and the damage matrix. */
export function hashProgression(h: number, c: SimConfig): number {
  // sim 0.33.0: the trailing techs of gated factions (the Garde's idGroup 1) are in hashGarde
  const nt = legacyTechCount(c, gatedFactions(c));
  h = fnv1aInt(h, nt);
  for (const t of c.techs.slice(0, nt)) h = hashTech(h, t);
  // sim 0.33.0: the perks and heroes of the hero choice only in hashHeroChoice (config.hash.heroes.ts)
  const choiceP = choicePerks(c);
  h = fnv1aInt(h, c.perks.length - choiceP.size);
  for (const pk of c.perks) {
    if (choiceP.has(pk.perkId)) continue;
    h = hashInts(h, [pk.perkId, pk.requiresStat, pk.requiresMin]);
    h = hashEffects(h, pk.effects);
  }
  h = fnv1aInt(h, c.training.length);
  for (const tr of c.training) {
    h = hashInts(h, [
      tr.programId,
      tr.factionId,
      tr.special,
      tr.buildingTypeId,
      tr.scrapCost,
      tr.scrapCostStep,
      tr.trainTicks,
      tr.trainTicksStep,
      tr.pointsPerRun,
      tr.maxPoints,
    ]);
    h = hashInts(h, tr.prereqTech);
  }
  // sim 0.32.0: the heroes of a gated faction only in hashGarde (config.hash.garde.ts)
  const gatedH = gatedHeroes(c);
  const choiceH = choiceHeroes(c);
  h = fnv1aInt(h, c.heroes.length - gatedH.size - choiceH.size);
  for (const hr of c.heroes)
    if (!gatedH.has(hr.heroId) && !choiceH.has(hr.heroId)) h = hashHero(h, hr);
  const sp = c.special;
  h = hashInts(h, [
    sp.strengthDamagePermille,
    sp.perceptionRangeU,
    sp.enduranceHpPermille,
    sp.charismaGrowthPermille,
    sp.intelligenceResearchPermille,
    sp.agilitySpeedPermille,
    sp.luckCritPermille,
    sp.critDamagePermille,
  ]);
  h = fnv1aInt(h, c.damageMatrix.length);
  for (const row of c.damageMatrix) h = hashInts(h, row);
  return h;
}

/** One tech, in fixed field order. */
export function hashTech(h: number, t: SimConfig['techs'][number]): number {
  h = hashInts(h, [t.techId, t.factionId, t.scrapCost, t.researchTicks, t.buildingTypeId]);
  h = hashInts(h, t.prereqTech);
  return hashEffects(h, t.effects);
}

/** One hero, in fixed field order. */
export function hashHero(h: number, hr: SimHero): number {
  h = hashInts(h, [
    hr.heroId,
    hr.typeId,
    hr.factionId,
    hr.baseTypeId,
    hr.xpPerKill,
    hr.xpPerDiscovery,
    hr.xpPerAssist,
    hr.xpAssistRadius,
  ]);
  h = hashInts(h, [hr.reviveScrap, hr.reviveTicks, hr.revivePenaltyPermille, hr.maxRevives]);
  h = hashInts(h, [hr.sight, hr.xpPerCapture]);
  h = hashInts(h, hr.aura === null ? [0] : [1, hr.aura.radius]);
  if (hr.aura !== null) {
    h = fnv1aInt(h, hr.aura.effects.length);
    for (const e of hr.aura.effects) h = hashInts(h, [e.stat, e.side, e.target, e.delta]);
  }
  h = hashInts(h, hr.special);
  h = hashInts(h, hr.xpThresholds);
  h = hashInts(h, hr.perkPool);
  h = hashEffects(h, hr.passives);
  h = fnv1aInt(h, hr.abilities.length);
  for (const a of hr.abilities) {
    h = hashInts(h, [a.cooldownTicks, a.rangeU, a.radiusU, a.durationTicks]);
    h = fnv1aInt(h, a.effects.length);
    for (const e of a.effects) h = hashInts(h, [e.stat, e.side, e.target, e.delta]);
  }
  return h;
}

import {
  AURA_SIDE_ALLY,
  AURA_SIDE_ENEMY,
  AURA_TARGET_ALL,
  AURA_TARGET_UNITS,
  EFFECT_TARGET_ALL,
  EFFECT_TARGET_TYPE,
  type SimEffect,
} from './config.types.js';
import {
  EFFECT_STAT_COUNT,
  I31,
  MAX_ABILITIES,
  MAX_MAP_CELLS_SIDE,
  MAX_PERKS,
  MAX_SIGHT,
  MAX_TECHS,
  MAX_TRAINED_POINTS,
  MAX_WORK_TICKS,
  SPECIAL_COUNT,
  U16,
  intIn,
  req,
} from './config.limits.js';
import type { SimConfig } from './config.env.js';

function checkEffects(
  effects: readonly SimEffect[],
  at: string,
  unitIds: ReadonlySet<number>,
  buildingIds: ReadonlySet<number>,
): void {
  for (const e of effects) {
    req(
      intIn(e.stat, 0, EFFECT_STAT_COUNT - 1) && intIn(e.delta, -I31, I31),
      `${at}: effect stat of delta`,
    );
    req(intIn(e.target, EFFECT_TARGET_ALL, EFFECT_TARGET_TYPE), `${at}: effect-doel`);
    req(
      e.target === EFFECT_TARGET_TYPE
        ? unitIds.has(e.typeId) || buildingIds.has(e.typeId)
        : e.typeId === 0,
      `${at}: effect-typeId`,
    );
  }
}

/** Techs, the tech prerequisites of unit and building types, training programs and perks. */
export function validateTechs(
  config: SimConfig,
  unitIds: ReadonlySet<number>,
  buildingIds: ReadonlySet<number>,
): void {
  req(config.techs.length <= MAX_TECHS, `meer dan ${MAX_TECHS} techs`);
  config.techs.forEach((t, k) => {
    const at = `tech ${k}`;
    req(
      t.techId === k && intIn(t.factionId, 0, config.factions.length - 1),
      `${at}: techId of factionId`,
    );
    req(
      intIn(t.scrapCost, 0, I31) &&
        intIn(t.researchTicks, 0, MAX_WORK_TICKS) &&
        buildingIds.has(t.buildingTypeId),
      `${at}: kosten, tijd of gebouw`,
    );
    for (const q of t.prereqTech) req(intIn(q, 0, config.techs.length - 1), `${at}: prereqTech`);
    checkEffects(t.effects, at, unitIds, buildingIds);
  });
  for (const u of config.unitTypes)
    for (const t of u.prereqTech)
      req(intIn(t, 0, config.techs.length - 1), `unittype ${u.typeId}: prereqTech`);
  for (const b of config.buildingTypes) {
    for (const t of b.prereqTech)
      req(intIn(t, 0, config.techs.length - 1), `gebouwtype ${b.typeId}: prereqTech`);
    if (b.network !== null)
      req(
        intIn(b.network.requiresTech, 0, config.techs.length - 1),
        `gebouwtype ${b.typeId}: network.requiresTech`,
      );
  }
  config.training.forEach((tr, k) => {
    const at = `training ${k}`;
    req(
      tr.programId === k &&
        intIn(tr.factionId, 0, config.factions.length - 1) &&
        intIn(tr.special, 0, SPECIAL_COUNT - 1) &&
        buildingIds.has(tr.buildingTypeId),
      `${at}: id, factie, letter of gebouw`,
    );
    req(
      intIn(tr.scrapCost, 0, I31) &&
        intIn(tr.scrapCostStep, 0, I31) &&
        intIn(tr.trainTicks, 1, MAX_WORK_TICKS) &&
        intIn(tr.trainTicksStep, 0, MAX_WORK_TICKS) &&
        intIn(tr.pointsPerRun, 1, MAX_TRAINED_POINTS) &&
        intIn(tr.maxPoints, 0, MAX_TRAINED_POINTS),
      `${at}: kosten, tijd of punten`,
    );
    for (const q of tr.prereqTech) req(intIn(q, 0, config.techs.length - 1), `${at}: prereqTech`);
  });
  req(config.perks.length <= MAX_PERKS, `meer dan ${MAX_PERKS} perks`);
  config.perks.forEach((pk, k) => {
    req(
      pk.perkId === k &&
        intIn(pk.requiresStat, 0, SPECIAL_COUNT - 1) &&
        intIn(pk.requiresMin, -I31, I31),
      `perk ${k}: id of requires`,
    );
    checkEffects(pk.effects, `perk ${k}`, unitIds, buildingIds);
  });
}

/** SPECIAL tuning, heroes and the hero of every faction. */
export function validateHeroes(
  config: SimConfig,
  unitIds: ReadonlySet<number>,
  buildingIds: ReadonlySet<number>,
): void {
  const sp = config.special;
  for (const v of [
    sp.strengthDamagePermille,
    sp.perceptionRangeU,
    sp.enduranceHpPermille,
    sp.charismaGrowthPermille,
    sp.intelligenceResearchPermille,
    sp.agilitySpeedPermille,
  ]) {
    req(intIn(v, -100000, 100000), 'special-tuning');
  }
  req(
    intIn(sp.luckCritPermille, 0, 1000) && intIn(sp.critDamagePermille, 0, 100000),
    'special-tuning: luckCritPermille of critDamagePermille',
  );
  config.heroes.forEach((hr, k) => {
    const at = `held ${k}`;
    req(intIn(hr.sight, 0, MAX_SIGHT), `${at}: sight`);
    req(
      hr.heroId === k &&
        intIn(hr.typeId, 1, U16) &&
        !unitIds.has(hr.typeId) &&
        !buildingIds.has(hr.typeId),
      `${at}: heroId of typeId`,
    );
    req(
      intIn(hr.factionId, 0, config.factions.length - 1) && unitIds.has(hr.baseTypeId),
      `${at}: factionId of baseTypeId`,
    );
    req(
      hr.special.length === SPECIAL_COUNT && hr.special.every((v) => intIn(v, 0, 100)),
      `${at}: special`,
    );
    req(
      hr.xpThresholds.every((v, j) => intIn(v, 1, I31) && (j === 0 || v > hr.xpThresholds[j - 1]!)),
      `${at}: xpThresholds`,
    );
    req(
      intIn(hr.xpPerKill, 0, I31) &&
        intIn(hr.xpPerDiscovery, 0, I31) &&
        intIn(hr.xpPerAssist, 0, I31),
      `${at}: xp`,
    );
    req(intIn(hr.xpAssistRadius, 0, MAX_MAP_CELLS_SIDE << 8), `${at}: xpAssistRadius`);
    req(hr.abilities.length <= MAX_ABILITIES, `${at}: meer dan ${MAX_ABILITIES} abilities`);
    for (const a of hr.abilities) {
      req(
        intIn(a.cooldownTicks, 0, I31) && intIn(a.durationTicks, 0, I31),
        `${at}: ability-tijden`,
      );
      req(
        intIn(a.rangeU, 0, MAX_MAP_CELLS_SIDE << 8) && intIn(a.radiusU, 0, MAX_MAP_CELLS_SIDE << 8),
        `${at}: ability-afstanden`,
      );
      for (const e of a.effects) {
        req(
          intIn(e.stat, 0, EFFECT_STAT_COUNT - 1) && intIn(e.delta, -100000, 100000),
          `${at}: ability-effect`,
        );
        req(
          intIn(e.side, AURA_SIDE_ENEMY, AURA_SIDE_ALLY) &&
            intIn(e.target, AURA_TARGET_UNITS, AURA_TARGET_ALL),
          `${at}: ability-effect kant of doel`,
        );
      }
    }
    for (const q of hr.perkPool) req(intIn(q, 0, config.perks.length - 1), `${at}: perkPool`);
    checkEffects(hr.passives, `${at}: passives`, unitIds, buildingIds);
    req(intIn(hr.xpPerCapture, 0, I31), `${at}: xpPerCapture`);
    if (hr.aura !== null) {
      req(intIn(hr.aura.radius, 0, MAX_MAP_CELLS_SIDE << 8), `${at}: aura`);
      for (const e of hr.aura.effects)
        req(
          intIn(e.stat, 0, EFFECT_STAT_COUNT - 1) &&
            intIn(e.delta, -100000, 100000) &&
            intIn(e.side, AURA_SIDE_ENEMY, AURA_SIDE_ALLY) &&
            intIn(e.target, AURA_TARGET_UNITS, AURA_TARGET_ALL),
          `${at}: aura-effect`,
        );
    }
    req(
      intIn(hr.reviveScrap, 0, I31) &&
        intIn(hr.reviveTicks, 0, I31) &&
        intIn(hr.revivePenaltyPermille, 0, 1000) &&
        intIn(hr.maxRevives, 0, 1000),
      `${at}: oplappen`,
    );
  });
  config.factions.forEach((f, k) =>
    req(intIn(f.heroId, -1, config.heroes.length - 1), `factie ${k}: heroId`),
  );
}

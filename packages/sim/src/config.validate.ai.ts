import { AI_SITE_FRONT, AI_SITE_HQ } from './config.faction.js';
import { I31, MAX_MAP_CELLS_SIDE, intIn, req } from './config.limits.js';
import type { SimConfig } from './config.env.js';

/** Scripted AI: build order, militia, research, army, waves, robots, reserve, training, raid plan and liberation. */
export function validateAiScripts(
  config: SimConfig,
  unitIds: ReadonlySet<number>,
  buildingIds: ReadonlySet<number>,
): void {
  for (const s of config.aiScripts) {
    for (const o of s.buildOrder)
      req(
        intIn(o.atTick, 0, I31) &&
          buildingIds.has(o.typeId) &&
          intIn(o.site ?? 0, AI_SITE_HQ, AI_SITE_FRONT),
        'aiScript buildOrder',
      );
    for (const t of s.attackTimersTicks) req(intIn(t, 0, I31), 'aiScript attackTimersTicks');
    for (const v of [
      s.militiaPermille,
      s.militiaPermilleMax,
      s.militiaPermillePerMin,
      s.threatMilitiaPermille,
    ])
      req(intIn(v, 0, 1000), 'aiScript militie-aandeel');
    req(s.housingTypeId === 0 || buildingIds.has(s.housingTypeId), 'aiScript housingTypeId');
    for (const t of s.research) req(intIn(t, 0, config.techs.length - 1), 'aiScript research');
    req(
      s.armyTypeIds.length > 0 && s.armyTypeIds.every((t) => unitIds.has(t)),
      'aiScript armyTypeIds',
    );
    req(
      intIn(s.builders, 0, 1024) &&
        intIn(s.housingFreeBeds, 0, 4096) &&
        intIn(s.scavengersPerNode, 1, 4096),
      'aiScript aantallen',
    );
    req(
      intIn(s.waveMinArmy, 0, 4096) &&
        intIn(s.waveArmyGrowth, 0, 4096) &&
        intIn(s.richScrap, 0, I31),
      'aiScript golven',
    );
    for (const o of s.richBuilds)
      req(
        buildingIds.has(o.typeId) && intIn(o.site, AI_SITE_HQ, AI_SITE_FRONT),
        'aiScript richBuilds',
      );
    for (const t of [s.researchFromTicks, s.claimFromTicks, s.waveJitterTicks, s.waveMaxWaitTicks])
      req(intIn(t, 0, I31), 'aiScript tijden');
    req(intIn(s.waveIntervalTicks, 1, I31), 'aiScript waveIntervalTicks');
    req(
      intIn(s.defendRadius, 0, MAX_MAP_CELLS_SIDE << 8) &&
        intIn(s.rallyRadius, 0, MAX_MAP_CELLS_SIDE << 8),
      'aiScript afstanden',
    );
    req(intIn(s.rallySite, AI_SITE_HQ, AI_SITE_FRONT), 'aiScript rallySite');
    req(intIn(s.pushFromTicks, 0, I31), 'aiScript pushFromTicks');
    req(
      intIn(s.pushMinArmy, 0, 4096) && typeof s.allInWithoutNodes === 'boolean',
      'aiScript pushMinArmy of allInWithoutNodes',
    );
    req(
      intIn(s.claimSafeRadius, 0, MAX_MAP_CELLS_SIDE << 8) &&
        intIn(s.claimFarFromTicks, 0, I31) &&
        intIn(s.heroClaimRadius, 0, MAX_MAP_CELLS_SIDE << 8),
      'aiScript claim-escorte',
    );
    if (s.robots !== null)
      req(
        s.robots.typeIds.length > 0 &&
          s.robots.typeIds.every((t) => unitIds.has(t)) &&
          intIn(s.robots.fromTicks, 0, I31) &&
          intIn(s.robots.max, 0, 4096) &&
          typeof s.robots.countAsArmy === 'boolean' &&
          intIn(s.robots.reservePop, 0, 4096),
        'aiScript robots',
      );
    const rb = s.robots === null ? null : s.robots.builders;
    if (rb !== null) {
      const t = config.unitTypes.find((u) => u.typeId === rb.typeId);
      req(
        t !== undefined &&
          t.canBuild &&
          t.producedAtTypeId !== 0 &&
          intIn(rb.max, 1, 4096) &&
          intIn(rb.fromTicks, 0, I31),
        'aiScript robots.builders',
      );
    }
    if (s.reserve !== null)
      req(
        intIn(s.reserve.fromTicks, 0, I31) &&
          intIn(s.reserve.minArmy, 0, 4096) &&
          intIn(s.reserve.robotsFirstFromTicks, 0, I31),
        'aiScript reserve',
      );
    if (s.training !== null)
      req(
        s.training.programIds.length > 0 &&
          s.training.programIds.every((t) => intIn(t, 0, config.training.length - 1)) &&
          intIn(s.training.fromTicks, 0, I31),
        'aiScript training',
      );
    const rp = s.raidPlan;
    if (rp !== null) {
      req(
        rp.fighterMix.length > 0 &&
          rp.fighterMix.every((m) => unitIds.has(m.typeId) && intIn(m.weight, 1, 1000)),
        'aiScript raidPlan.fighterMix',
      );
      req(
        unitIds.has(rp.harass.typeId) &&
          intIn(rp.harass.fromTicks, 0, I31) &&
          intIn(rp.harass.max, 0, 4096) &&
          intIn(rp.harass.retreatHpPermille, 0, 1000),
        'aiScript raidPlan.harass',
      );
      const sr = rp.slaveRaids;
      req(
        unitIds.has(sr.slaverTypeId) &&
          intIn(sr.fromTicks, 0, I31) &&
          intIn(sr.slavers, 0, 4096) &&
          intIn(sr.escort, 0, 4096) &&
          intIn(sr.maxRaidTicks, 1, I31) &&
          intIn(sr.retryTicks, 0, I31),
        'aiScript raidPlan.slaveRaids',
      );
      req(
        intIn(rp.garrisonMinFighters, 0, 4096) &&
          intIn(rp.dominancePush.fromTicks, 0, I31) &&
          intIn(rp.dominancePush.minArmy, 0, 4096),
        'aiScript raidPlan',
      );
    }
    const lb = s.liberate;
    if (lb !== null)
      req(
        intIn(lb.minFree, 1, 4096) &&
          intIn(lb.units, 1, 4096) &&
          intIn(lb.radius, 0, MAX_MAP_CELLS_SIDE << 8),
        'aiScript liberate',
      );
  }
}

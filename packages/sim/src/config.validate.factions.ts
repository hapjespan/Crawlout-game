import { EFFECT_TARGET_ALL, EFFECT_TARGET_HERO, NEUTRAL_FACTION } from './config.types.js';
import { SAFETY_NET_BEACON, SAFETY_NET_TENTS } from './config.faction.js';
import {
  EFFECT_STAT_COUNT,
  I31,
  MAX_CREEPS_PER_CAMP,
  MAX_MAP_CELLS_SIDE,
  MAX_PROJECT_KINDS,
  MAX_PROJECT_SITES,
  checkPoint,
  intIn,
  req,
} from './config.limits.js';
import type { SimConfig, SimEnv } from './config.env.js';

/**
 * Win route C (data 0.31.0): with project sites on the map, every kind of part is a pair of neutral building types with
 * the same odd footprint, every site has a kind and lies with its whole footprint inside the map, and sites do not
 * overlap.
 */
export function validateProject(env: SimEnv): void {
  const { map, config } = env;
  const pr = config.project;
  const sites = map.projectSites ?? [];
  req(sites.length <= MAX_PROJECT_SITES, `meer dan ${MAX_PROJECT_SITES} projectdelen`);
  // the parts only matter with sites on the map (the game type Bouwproject), like the hash
  if (pr !== undefined && sites.length > 0) {
    req(pr.parts.length <= MAX_PROJECT_KINDS, `meer dan ${MAX_PROJECT_KINDS} soorten projectdeel`);
    req(intIn(pr.countdownTicks, 1, I31) && intIn(pr.pauseTicks, 0, I31), 'project countdown');
    pr.parts.forEach((k, n) => {
      const r = config.buildingTypes.find((b) => b.typeId === k.restoredTypeId);
      const u = config.buildingTypes.find((b) => b.typeId === k.ruinTypeId);
      req(
        r !== undefined &&
          u !== undefined &&
          r !== u &&
          r.factionId === NEUTRAL_FACTION &&
          u.factionId === NEUTRAL_FACTION &&
          r.footprintW === u.footprintW &&
          r.footprintH === u.footprintH &&
          (r.footprintW & 1) === 1 &&
          (r.footprintH & 1) === 1 &&
          r.provides === 0 &&
          u.provides === 0 &&
          r.damage === 0 &&
          u.damage === 0,
        `projectdeel ${n}: gebouwtypes`,
      );
      for (const e of k.effects)
        req(
          intIn(e.stat, 0, EFFECT_STAT_COUNT - 1) && intIn(e.delta, -100000, 100000),
          `projectdeel ${n}: effect`,
        );
    });
  }
  for (const s of config.aiScripts) {
    const a = s.project;
    if (a === undefined || a === null) continue;
    req(
      intIn(a.restoreFromTicks, -1, I31) &&
        intIn(a.restoreMinArmy, 0, 4096) &&
        intIn(a.builders, 1, 64) &&
        intIn(a.sabotageKinds, 1, MAX_PROJECT_KINDS) &&
        intIn(a.sabotageMinArmy, 0, 4096) &&
        typeof a.rallyAtParts === 'boolean',
      'ai project',
    );
  }
  const taken: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const s of sites) {
    checkPoint(map, s, 'projectdeel');
    const part = pr?.parts[s.kind];
    req(
      pr !== undefined && intIn(s.kind, 0, pr.parts.length - 1) && part !== undefined,
      `projectdeel (${s.x},${s.y}): soort ${s.kind} staat niet in de data`,
    );
    const bt = config.buildingTypes.find((b) => b.typeId === part!.ruinTypeId)!;
    const x0 = (s.x >> 8) - (bt.footprintW >> 1);
    const y0 = (s.y >> 8) - (bt.footprintH >> 1);
    const x1 = x0 + bt.footprintW;
    const y1 = y0 + bt.footprintH;
    req(
      (s.x & 0xff) === 128 &&
        (s.y & 0xff) === 128 &&
        x0 >= 0 &&
        y0 >= 0 &&
        x1 <= map.w &&
        y1 <= map.h,
      `projectdeel (${s.x},${s.y}): footprint buiten de map of niet op een celmidden`,
    );
    for (const t of taken)
      req(
        x1 <= t.x0 || t.x1 <= x0 || y1 <= t.y0 || t.y1 <= y0,
        `projectdeel (${s.x},${s.y}) overlapt een ander deel`,
      );
    taken.push({ x0, y0, x1, y1 });
  }
}

/** Factions: start units, roles, AI scripts, safety net, robots, slaves, plunder, tribute and chems. */
export function validateFactions(
  config: SimConfig,
  unitIds: ReadonlySet<number>,
  buildingIds: ReadonlySet<number>,
): void {
  config.factions.forEach((f, k) => {
    const at = `factie ${k}`;
    req(f.factionId === k, `${at}: factionId moet de index zijn`);
    for (const s of f.startUnits)
      req(unitIds.has(s.typeId) && intIn(s.count, 1, 1024), `${at}: startUnits`);
    req(
      intIn(f.startScrap, 0, I31) && intIn(f.housingGrowthPerMin, 0, I31),
      `${at}: startScrap of housingGrowthPerMin`,
    );
    req(buildingIds.has(f.hqTypeId), `${at}: hqTypeId`);
    req(f.settlerTypeId === 0 || unitIds.has(f.settlerTypeId), `${at}: settlerTypeId`);
    for (const t of f.roleTypeIds) req(t === 0 || unitIds.has(t), `${at}: roleTypeIds`);
    req(intIn(f.aiScript, -1, config.aiScripts.length - 1), `${at}: aiScript`);
    req(
      f.aiScriptVersus.length === config.factions.length &&
        f.aiScriptVersus.every((v) => intIn(v, -1, config.aiScripts.length - 1)),
      `${at}: aiScriptVersus`,
    );
    req(f.claimTypeId === 0 || buildingIds.has(f.claimTypeId), `${at}: claimTypeId`);
    if (f.safetyNet !== null)
      req(
        intIn(f.safetyNet.action, SAFETY_NET_BEACON, SAFETY_NET_TENTS) &&
          intIn(f.safetyNet.threshold, 0, 4096) &&
          intIn(f.safetyNet.intervalTicks, 1, I31) &&
          intIn(f.safetyNet.maxArrivals, 0, I31) &&
          unitIds.has(f.safetyNet.typeId),
        `${at}: safetyNet`,
      );
    if (f.robotRules !== null)
      req(
        intIn(f.robotRules.robotsPerTechnician, 0, 4096) &&
          intIn(f.robotRules.penaltyPermille, 0, 1000) &&
          f.robotRules.technicianRoles.every((r) => intIn(r, 0, 0xff)),
        `${at}: robotRules`,
      );
    const sl = f.slaves;
    if (sl !== null) {
      req(unitIds.has(sl.capturedTypeId), `${at}: slaves.capturedTypeId`);
      for (const v of [
        sl.minDistanceFromOwnerBase,
        sl.touchRange,
        sl.guardRadius,
        sl.cageNear,
        sl.revoltGuardRadius,
        sl.escapeDist,
      ])
        req(intIn(v, 0, MAX_MAP_CELLS_SIDE << 8), `${at}: slaves afstand`);
      for (const v of [sl.touchTicks, sl.graceTicks, sl.emptyGraceTicks, sl.repeatTicks])
        req(intIn(v, 0, I31), `${at}: slaves tijd`);
      req(
        intIn(sl.freedSpeedPermille, 0, 10000) &&
          intIn(sl.cageGuards, 0, 4096) &&
          intIn(sl.guardModeSlavesPerGuard, 1, 4096) &&
          intIn(sl.noCageGuards, 1, 4096) &&
          intIn(sl.noCageSlaves, 1, 4096) &&
          intIn(sl.escapePermille, 0, 1000),
        `${at}: slaves`,
      );
    }
    const pl = f.plunder;
    if (pl !== null)
      req(
        intIn(pl.buildingLootPermille, 0, 100000) &&
          intIn(pl.depotLootMultiplierPermille, 0, 100000) &&
          intIn(pl.carryLootPermille, 0, 100000) &&
          intIn(pl.bonusTech, -1, config.techs.length - 1) &&
          intIn(pl.bonusPermille, 0, 100000),
        `${at}: plunder`,
      );
    const tr = f.tribute;
    if (tr !== null)
      req(
        intIn(tr.claimKind, 0, 0xff) &&
          intIn(tr.scrapPerMin, 0, 1_000_000) &&
          intIn(tr.bonusTech, -1, config.techs.length - 1) &&
          intIn(tr.bonusPermille, 0, 100000),
        `${at}: tribute`,
      );
    req(f.chems.length <= 0xfe, `${at}: te veel chems`);
    for (const c of f.chems) {
      req(
        intIn(c.requiresTech, -1, config.techs.length - 1) &&
          intIn(c.doseScrap, 0, I31) &&
          intIn(c.activeTicks, 0, I31) &&
          intIn(c.crashTicks, 0, I31) &&
          intIn(c.cooldownTicks, 0, I31),
        `${at}: chem`,
      );
      for (const e of [...c.effects, ...c.crash])
        req(
          intIn(e.stat, 0, EFFECT_STAT_COUNT - 1) &&
            intIn(e.delta, -100000, 100000) &&
            (e.target === EFFECT_TARGET_ALL || e.target === EFFECT_TARGET_HERO),
          `${at}: chem-effect`,
        );
      if (c.refined !== null)
        req(
          intIn(c.refined.requiresTech, 0, config.techs.length - 1) &&
            intIn(c.refined.activePermille, -1000, 100000) &&
            intIn(c.refined.crashPermille, -1000, 100000),
          `${at}: chem refined`,
        );
    }
  });
}

/** Creep tiers, camp takeover, the creep plans of the AI scripts and the chems of unit auras. */
export function validateCreeps(config: SimConfig): void {
  let prevTier = 0;
  for (const t of config.creepTiers ?? []) {
    const at = `creep-tier ${t.tier}`;
    req(intIn(t.tier, prevTier + 1, 0xff), `${at}: tier oplopend en uniek`);
    prevTier = t.tier;
    req(t.typeIds.length >= 1 && t.typeIds.length <= MAX_CREEPS_PER_CAMP, `${at}: aantal`);
    for (const id of t.typeIds)
      req(
        config.unitTypes.some((u) => u.typeId === id && u.factionId === NEUTRAL_FACTION),
        `${at}: ${id} is geen neutraal unittype`,
      );
    req(
      intIn(t.aggroRadius, 1, MAX_MAP_CELLS_SIDE << 8) &&
        intIn(t.leashRadius, t.aggroRadius, MAX_MAP_CELLS_SIDE << 8) &&
        intIn(t.respawnTicks, 0, I31) &&
        intIn(t.lootScrap, 0, I31) &&
        intIn(t.heroXp, 0, I31) &&
        intIn(t.heroXpRadius, 0, MAX_MAP_CELLS_SIDE << 8),
      `${at}: stralen, respawn of buit`,
    );
  }
  let prevFaction = -1;
  for (const r of config.creepTakeover ?? []) {
    const at = `creep-takeover factie ${r.factionId}`;
    req(intIn(r.factionId, prevFaction + 1, config.factions.length - 1), `${at}: factie`);
    prevFaction = r.factionId;
    let prev = 0;
    for (const t of r.tiers) {
      req(intIn(t.tier, prev + 1, 0xff), `${at}: tier oplopend en uniek`);
      prev = t.tier;
      req(
        (config.creepTiers ?? []).some((c) => c.tier === t.tier),
        `${at}: tier ${t.tier} staat niet in de data`,
      );
      req(
        intIn(t.surrenderPermille, 0, 1000) &&
          intIn(t.minUnits, 1, 0xffff) &&
          intIn(t.yieldTicks, 0, I31) &&
          intIn(t.yieldMax, 0, 0xff),
        `${at}: tier ${t.tier}`,
      );
    }
  }
  for (const s of config.aiScripts) {
    const cr = s.creeps;
    if (cr === undefined || cr === null) continue;
    req(
      intIn(cr.fromTicks, 0, I31) &&
        intIn(cr.maxPath, 1, I31) &&
        cr.tiers.every((t) => intIn(t.tier, 1, 0xff) && intIn(t.minArmy, 1, 0xffff)),
      'ai creeps',
    );
  }
  for (const u of config.unitTypes)
    if (u.aura !== null) {
      const f = config.factions[u.factionId]!;
      req(
        u.aura.chems.every((c) => c < f.chems.length),
        `unittype ${u.typeId}: aura.chems buiten de chems van de factie`,
      );
    }
}

import { gatedFactions, gatedHeroes, gatedScripts, rankOf } from './config.hash.garde.js';
import { fnv1aInt } from './math/fnv.js';
import type { SimEffect } from './config.types.js';
import type { SimConfig } from './config.env.js';

export const hashInts = (h: number, vs: readonly number[]): number => {
  let x = fnv1aInt(h, vs.length);
  for (const v of vs) x = fnv1aInt(x, v);
  return x;
};

export const hashEffects = (h: number, effects: readonly SimEffect[]): number => {
  let x = fnv1aInt(h, effects.length);
  for (const e of effects) x = hashInts(x, [e.stat, e.target, e.typeId, e.delta]);
  return x;
};

/** Global tuning, in fixed field order. */
export function hashTuning(h: number, c: SimConfig): number {
  return hashInts(h, [
    c.ticksPerMinute,
    c.arriveRadius,
    c.separationPermille,
    c.pathSectorCells,
    c.pathEntranceMaxCells,
    c.walkAnimStep,
    c.aggroRange,
    c.interactRange,
    c.claimRadius,
    c.popCapMax,
    c.corpseTicks,
    c.cancelRefundPermille,
    c.builderAutoHelpRadius,
    c.formation.gap,
    c.formation.widthPermille,
    c.formation.slack,
    c.formation.directRange,
    c.formation.gatherRing,
    c.placement.clearance,
    c.placement.depotClearance,
    c.placement.buildRange,
    c.placement.claimBuildRange,
    c.autoGatherRadius,
    c.exclusiveRadius,
    c.heroClaimTicks,
    c.contestFlipTicks,
    c.visionCell,
    c.guard.stand,
    c.guard.leash,
  ]);
}

/** Unit types. */
export function hashUnitTypes(h: number, c: SimConfig): number {
  h = fnv1aInt(h, c.unitTypes.length);
  for (const u of c.unitTypes) {
    h = hashInts(h, [
      u.typeId,
      u.loadoutId,
      u.factionId,
      u.bodyType,
      u.role,
      u.armorType,
      u.maxHp,
      u.speed,
      u.radius,
      u.damage,
      u.damageType,
    ]);
    h = hashInts(h, [
      u.range,
      u.cooldown,
      u.gatherAmount,
      u.gatherTicks,
      u.scrapCost,
      u.craftTicks,
      u.popCost,
    ]);
    h = hashInts(h, u.prereqTech);
    h = hashInts(h, [u.producedAtTypeId]);
    h = hashInts(
      h,
      u.repair === null
        ? [0]
        : [
            1,
            u.repair.milliHpPerTick,
            u.repair.range,
            u.repair.seekRange,
            u.repair.buildings ? 1 : 0,
            u.repair.robots ? 1 : 0,
          ],
    );
    h = hashInts(
      h,
      u.siege === null ? [0] : [1, u.siege.vsBuildingsPermille, u.siege.buildingsFirst ? 1 : 0],
    );
    h = hashInts(h, [u.sight, u.slave ? 1 : 0]);
    if (u.canBuild) h = hashInts(h, [1]); // data 0.26.0: only when set, like the creep camps
    const cp = u.capture;
    h = hashInts(
      h,
      cp === null
        ? [0]
        : [
            1,
            cp.range,
            cp.captureTicks,
            cp.wanderers ? 1 : 0,
            cp.residents ? 1 : 0,
            cp.maxHpPermille,
          ],
    );
    h = hashInts(h, u.aura === null ? [0] : [1, u.aura.radius]);
    if (u.aura !== null) h = hashInts(h, u.aura.chems);
  }
  return h;
}

/** Building types. */
export function hashBuildingTypes(h: number, c: SimConfig): number {
  h = fnv1aInt(h, c.buildingTypes.length);
  for (const b of c.buildingTypes) {
    h = hashInts(h, [
      b.typeId,
      b.buildingId,
      b.factionId,
      b.maxHp,
      b.armorType,
      b.scrapCost,
      b.buildTicks,
      b.footprintW,
      b.footprintH,
      b.beds,
      b.provides,
    ]);
    h = hashInts(h, b.prereqTech);
    h = hashInts(h, [b.damage, b.damageType, b.range, b.cooldown]);
    const n = b.network;
    h = hashInts(
      h,
      n === null
        ? [0]
        : [1, n.requiresTech, n.radius, n.damagePermillePerTurret, n.maxDamagePermille],
    );
    h = hashInts(h, [b.sight]);
    const cg = b.cage;
    h = hashInts(h, cg === null ? [0] : [1, cg.capacity, cg.transitionTicks, cg.workRadius]);
    h = hashInts(h, b.hqRange === null ? [0] : [1, b.hqRange.min, b.hqRange.max]);
  }
  return h;
}

/** Factions. */
export function hashFactions(h: number, c: SimConfig): number {
  h = fnv1aInt(h, c.factions.length);
  // sim 0.32.0: a gated faction (the Garde) shows its data 0.37.0 view here (no script or hero); its real
  // values are in hashGarde, only when it plays. Script and hero indices skip the gated ones (config.hash.garde.ts).
  const gated = gatedFactions(c);
  const scripts = gatedScripts(c);
  const heroes = gatedHeroes(c);
  for (const f of c.factions) {
    const g = gated[f.factionId] === true;
    h = hashInts(h, [
      f.factionId,
      f.startScrap,
      f.housingGrowthPerMin,
      f.hqTypeId,
      f.settlerTypeId,
      g ? -1 : rankOf(f.aiScript, scripts),
      f.claimTypeId,
      g ? -1 : rankOf(f.heroId, heroes),
    ]);
    h = hashInts(
      h,
      f.aiScriptVersus.map((v) => (g ? -1 : rankOf(v, scripts))),
    );
    h = fnv1aInt(h, f.startUnits.length);
    for (const s of f.startUnits) h = hashInts(h, [s.typeId, s.count]);
    h = hashInts(h, f.roleTypeIds);
    const sn = f.safetyNet;
    h = hashInts(
      h,
      sn === null ? [0] : [1, sn.action, sn.threshold, sn.intervalTicks, sn.maxArrivals, sn.typeId],
    );
    const rr = f.robotRules;
    h = hashInts(h, rr === null ? [0] : [1, rr.robotsPerTechnician, rr.penaltyPermille]);
    if (rr !== null) h = hashInts(h, rr.technicianRoles);
    const sl = f.slaves;
    h = hashInts(
      h,
      sl === null
        ? [0]
        : [
            1,
            sl.capturedTypeId,
            sl.minDistanceFromOwnerBase,
            sl.touchTicks,
            sl.touchRange,
            sl.guardRadius,
            sl.freedSpeedPermille,
            sl.cageNear,
            sl.revoltGuardRadius,
            sl.cageGuards,
            sl.guardModeSlavesPerGuard,
            sl.noCageGuards,
            sl.noCageSlaves,
            sl.escapeDist,
            sl.graceTicks,
            sl.emptyGraceTicks,
            sl.escapePermille,
            sl.repeatTicks,
          ],
    );
    const pl = f.plunder;
    h = hashInts(
      h,
      pl === null
        ? [0]
        : [
            1,
            pl.buildingLootPermille,
            pl.depotLootMultiplierPermille,
            pl.carryLootPermille,
            pl.bonusTech,
            pl.bonusPermille,
          ],
    );
    const tr = f.tribute;
    h = hashInts(
      h,
      tr === null ? [0] : [1, tr.claimKind, tr.scrapPerMin, tr.bonusTech, tr.bonusPermille],
    );
    h = fnv1aInt(h, f.chems.length);
    for (const c of f.chems) {
      h = hashInts(h, [c.requiresTech, c.doseScrap, c.activeTicks, c.crashTicks, c.cooldownTicks]);
      h = hashEffects(h, c.effects);
      h = hashEffects(h, c.crash);
      const rf = c.refined;
      h = hashInts(
        h,
        rf === null ? [0] : [1, rf.requiresTech, rf.activePermille, rf.crashPermille],
      );
    }
  }
  return h;
}

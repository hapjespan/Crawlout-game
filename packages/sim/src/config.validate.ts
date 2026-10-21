import { MAX_PLAYERS } from '@crawlout/protocol';
import { validateGarde } from './config.validate.garde.js';
import { NEUTRAL_FACTION } from './config.types.js';
import type { SimConfig, SimEnv } from './config.env.js';
import {
  I31,
  MAX_FOOTPRINT,
  MAX_MAP_CELLS_SIDE,
  MAX_RADIUS,
  MAX_SIGHT,
  MAX_SPEED,
  MAX_WORK_TICKS,
  MAX_CREEP_CAMPS,
  U16,
  checkPoint,
  intIn,
  req,
} from './config.limits.js';
import { validateCreeps, validateFactions, validateProject } from './config.validate.factions.js';
import { validateHeroes, validateTechs } from './config.validate.progress.js';
import { validateAiScripts } from './config.validate.ai.js';
import { validateSurvival } from './config.survival.env.js';

/** Valideert de invoer eenmalig voor de eerste tick. Gooit bij ongeldige invoer. */
export function validateEnv(env: SimEnv): void {
  const { config, players } = env;
  validateMapEnv(env);
  validateTuning(config);
  const armorCount = validateDamageMatrix(config);
  const unitIds = validateUnitTypes(config, armorCount);
  const buildingIds = validateBuildingTypes(config, armorCount, unitIds);
  validateProject(env);
  validateFactions(config, unitIds, buildingIds);
  validateCreeps(config);
  validateTechs(config, unitIds, buildingIds);
  validateHeroes(config, unitIds, buildingIds);
  validateAiScripts(config, unitIds, buildingIds);
  validateGarde(config, unitIds, buildingIds); // sim 0.32.0
  validateSurvival(env, unitIds);
  for (const p of players) {
    req(
      intIn(p.factionId, 0, config.factions.length - 1),
      `speler met onbekende factie ${p.factionId}`,
    );
    req(typeof p.ai === 'boolean', 'speler zonder ai-vlag');
    // sim 0.33.0: a chosen hero is a hero of the player's own faction
    if (p.heroId !== undefined)
      req(
        intIn(p.heroId, 0, config.heroes.length - 1) &&
          config.heroes[p.heroId]!.factionId === p.factionId,
        `speler met een held ${p.heroId} buiten zijn factie`,
      );
  }
}

/** Players, map geometry, spawns, scrap nodes, claim points, dominance and creep camps. */
function validateMapEnv(env: SimEnv): void {
  const { map, players } = env;
  req(intIn(players.length, 1, MAX_PLAYERS), `aantal spelers ${players.length}`);
  req(
    intIn(map.w, 1, MAX_MAP_CELLS_SIDE) && intIn(map.h, 1, MAX_MAP_CELLS_SIDE),
    `mapmaat ${map.w}x${map.h}`,
  );
  req(map.passable.length === map.w * map.h, 'passable heeft niet w*h cellen');
  for (let i = 0; i < map.passable.length; i++)
    req(map.passable[i]! <= 1, `passable[${i}] is geen 0 of 1`);
  req(
    map.spawns.length >= players.length,
    `map heeft ${map.spawns.length} spawns voor ${players.length} spelers`,
  );
  for (const s of map.spawns) checkPoint(map, s, 'spawn');
  for (const n of map.scrapNodes) {
    checkPoint(map, n, 'scrap-node');
    req(intIn(n.amount, 0, I31), 'scrap-node amount');
  }
  for (const c of map.claimPoints) {
    checkPoint(map, c, 'claimpunt');
    req(intIn(c.kind, 0, 0xff), 'claimpunt kind');
  }
  req(
    intIn(map.dominance.pointsRequired, 1, 0xff) && intIn(map.dominance.ticks, 1, I31),
    'dominance',
  );
  // creep camps (data 0.25.0): every camp of the map has a tier of the data
  const camps = map.creepCamps ?? [];
  req(camps.length <= MAX_CREEP_CAMPS, `meer dan ${MAX_CREEP_CAMPS} creep-kampen`);
  for (const c of camps) {
    checkPoint(map, c, 'creep-kamp');
    req(
      (env.config.creepTiers ?? []).some((t) => t.tier === c.tier),
      `creep-kamp (${c.x},${c.y}): tier ${c.tier} staat niet in de data`,
    );
  }
}

/** Global tuning: movement, pathing, ranges, formation, placement, guard and vision. */
function validateTuning(config: SimConfig): void {
  req(
    typeof config.dataVersion === 'string' && config.dataVersion.length > 0,
    'dataVersion ontbreekt',
  );
  req(intIn(config.arriveRadius, 0, MAX_RADIUS * 4), 'arriveRadius');
  req(intIn(config.separationPermille, 0, 1000), 'separationPermille');
  req(
    intIn(config.pathSectorCells, 4, 64) &&
      (config.pathSectorCells & (config.pathSectorCells - 1)) === 0,
    'pathSectorCells (macht van 2, 4..64)',
  );
  req(intIn(config.pathEntranceMaxCells, 1, config.pathSectorCells), 'pathEntranceMaxCells');
  req(intIn(config.pathCacheCells, 1, 1 << 26), 'pathCacheCells');
  req(intIn(config.walkAnimStep, 0, U16), 'walkAnimStep');
  req(intIn(config.ticksPerMinute, 1, I31), 'ticksPerMinute');
  req(intIn(config.aggroRange, 0, MAX_MAP_CELLS_SIDE << 8), 'aggroRange');
  req(intIn(config.interactRange, 0, MAX_MAP_CELLS_SIDE << 8), 'interactRange');
  req(intIn(config.claimRadius, 0, MAX_MAP_CELLS_SIDE << 8), 'claimRadius');
  req(intIn(config.popCapMax, 0, 4096), 'popCapMax');
  req(intIn(config.corpseTicks, 0, U16), 'corpseTicks');
  req(intIn(config.cancelRefundPermille, 0, 1000), 'cancelRefundPermille');
  req(intIn(config.builderAutoHelpRadius, 0, MAX_MAP_CELLS_SIDE << 8), 'builderAutoHelpRadius');
  const f = config.formation;
  req(intIn(f.gap, 0, MAX_RADIUS * 8), 'formation.gap');
  req(intIn(f.widthPermille, 1, 100000), 'formation.widthPermille');
  req(intIn(f.slack, 0, MAX_RADIUS * 16), 'formation.slack');
  req(intIn(f.directRange, 0, MAX_MAP_CELLS_SIDE << 8), 'formation.directRange');
  req(intIn(f.gatherRing, 0, MAX_RADIUS * 16), 'formation.gatherRing');
  const pl = config.placement;
  // at least one cell: then the ring around a new building is a closed walkable path and no route is ever cut
  req(intIn(pl.clearance, 256, MAX_FOOTPRINT << 8), 'placement.clearance');
  req(intIn(pl.depotClearance, pl.clearance, MAX_FOOTPRINT << 8), 'placement.depotClearance');
  req(intIn(pl.buildRange, 0, 100 << 8), 'placement.buildRange');
  req(intIn(pl.claimBuildRange, 0, 100 << 8), 'placement.claimBuildRange');
  req(intIn(config.autoGatherRadius, 0, MAX_MAP_CELLS_SIDE << 8), 'autoGatherRadius');
  req(
    intIn(config.exclusiveRadius, config.claimRadius, MAX_MAP_CELLS_SIDE << 8),
    'exclusiveRadius',
  );
  req(intIn(config.heroClaimTicks, 0, I31), 'heroClaimTicks');
  req(intIn(config.contestFlipTicks, 0, I31), 'contestFlipTicks');
  req(
    intIn(config.guard.stand, 0, MAX_MAP_CELLS_SIDE << 8) &&
      intIn(config.guard.leash, config.guard.stand, MAX_MAP_CELLS_SIDE << 8),
    'guard (stand, leash >= stand)',
  );
  req(
    config.visionCell === 256 || config.visionCell === 512 || config.visionCell === 1024,
    'visionCell (256, 512 of 1024)',
  );
}

/** The damage matrix must be a non-empty rectangle; returns the number of armor types. */
function validateDamageMatrix(config: SimConfig): number {
  const armorCount = config.damageMatrix[0]?.length ?? 0;
  req(config.damageMatrix.length > 0 && armorCount > 0, 'damageMatrix leeg');
  for (const row of config.damageMatrix) {
    req(row.length === armorCount, 'damageMatrix niet rechthoekig');
    for (const v of row) req(intIn(v, 0, 100000), 'damageMatrix-waarde');
  }
  return armorCount;
}

/** Unit types; returns the set of unit type ids. */
function validateUnitTypes(config: SimConfig, armorCount: number): Set<number> {
  const unitIds = new Set<number>();
  for (const u of config.unitTypes) {
    const at = `unittype ${u.typeId}`;
    req(intIn(u.typeId, 1, U16) && !unitIds.has(u.typeId), `${at}: typeId ongeldig of dubbel`);
    unitIds.add(u.typeId);
    req(intIn(u.maxHp, 1, I31), `${at}: maxHp`);
    req(intIn(u.speed, 0, MAX_SPEED), `${at}: speed (max ${MAX_SPEED})`);
    req(intIn(u.radius, 0, MAX_RADIUS), `${at}: radius (max ${MAX_RADIUS})`);
    req(
      intIn(u.armorType, 0, armorCount - 1) &&
        intIn(u.damageType, 0, config.damageMatrix.length - 1),
      `${at}: armor- of damageType`,
    );
    req(
      intIn(u.bodyType, 0, 0xff) && intIn(u.role, 0, 0xff) && intIn(u.loadoutId, 0, U16),
      `${at}: bodyType, role of loadoutId`,
    );
    // the bandits of the creep camps (data 0.25.0) have no faction
    req(
      u.factionId === NEUTRAL_FACTION || intIn(u.factionId, 0, config.factions.length - 1),
      `${at}: factionId`,
    );
    req(
      intIn(u.damage, 0, I31) &&
        intIn(u.range, 0, MAX_MAP_CELLS_SIDE << 8) &&
        intIn(u.cooldown, 0, I31),
      `${at}: gevecht`,
    );
    req(intIn(u.gatherAmount, 0, I31) && intIn(u.gatherTicks, 0, I31), `${at}: verzamelen`);
    req(u.gatherAmount === 0 || u.gatherTicks > 0, `${at}: gatherAmount zonder gatherTicks`);
    req(
      intIn(u.scrapCost, 0, I31) && intIn(u.craftTicks, 0, I31) && intIn(u.popCost, 0, 0xff),
      `${at}: kosten`,
    );
    for (const t of u.prereqTech) req(intIn(t, 0, U16), `${at}: prereqTech`);
    if (u.repair !== null)
      req(
        intIn(u.repair.milliHpPerTick, 0, I31) &&
          intIn(u.repair.range, 0, MAX_MAP_CELLS_SIDE << 8) &&
          intIn(u.repair.seekRange, 0, MAX_MAP_CELLS_SIDE << 8),
        `${at}: repair`,
      );
    if (u.siege !== null) req(intIn(u.siege.vsBuildingsPermille, 0, 100000), `${at}: siege`);
    req(intIn(u.sight, 0, MAX_SIGHT), `${at}: sight`);
    req(typeof u.slave === 'boolean', `${at}: slave`);
    req(typeof u.canBuild === 'boolean', `${at}: canBuild`);
    if (u.capture !== null)
      req(
        intIn(u.capture.range, 0, MAX_MAP_CELLS_SIDE << 8) &&
          intIn(u.capture.captureTicks, 1, I31) &&
          intIn(u.capture.maxHpPermille, 0, 1000) &&
          typeof u.capture.wanderers === 'boolean' &&
          typeof u.capture.residents === 'boolean',
        `${at}: capture`,
      );
    if (u.aura !== null)
      req(
        intIn(u.aura.radius, 0, MAX_MAP_CELLS_SIDE << 8) &&
          u.aura.chems.length > 0 &&
          u.aura.chems.every((c) => intIn(c, 0, 0xfe)),
        `${at}: aura`,
      );
  }
  return unitIds;
}

/** Building types and the production building of every unit type; returns the set of building type ids. */
function validateBuildingTypes(
  config: SimConfig,
  armorCount: number,
  unitIds: ReadonlySet<number>,
): Set<number> {
  const buildingIds = new Set<number>();
  for (const b of config.buildingTypes) {
    const at = `gebouwtype ${b.typeId}`;
    req(
      intIn(b.typeId, 1, U16) && !buildingIds.has(b.typeId) && !unitIds.has(b.typeId),
      `${at}: typeId ongeldig of dubbel`,
    );
    buildingIds.add(b.typeId);
    req(intIn(b.maxHp, 1, I31) && intIn(b.armorType, 0, armorCount - 1), `${at}: hp of armorType`);
    req(
      intIn(b.scrapCost, 0, I31) &&
        intIn(b.buildTicks, 0, MAX_WORK_TICKS) &&
        intIn(b.beds, 0, 0xffff),
      `${at}: kosten, bouwtijd of bedden`,
    );
    req(
      intIn(b.footprintW, 1, MAX_FOOTPRINT) && intIn(b.footprintH, 1, MAX_FOOTPRINT),
      `${at}: footprint`,
    );
    // the parts of the Bouwproject (data 0.31.0) have no faction, like the bandits
    req(
      intIn(b.provides, 0, 0xffff) &&
        (b.factionId === NEUTRAL_FACTION || intIn(b.factionId, 0, config.factions.length - 1)),
      `${at}: provides of factionId`,
    );
    for (const t of b.prereqTech) req(intIn(t, 0, U16), `${at}: prereqTech`);
    req(
      intIn(b.damage, 0, I31) && intIn(b.damageType, 0, config.damageMatrix.length - 1),
      `${at}: damage of damageType`,
    );
    req(
      intIn(b.range, 0, MAX_MAP_CELLS_SIDE << 8) && intIn(b.cooldown, 0, I31),
      `${at}: range of cooldown`,
    );
    if (b.network !== null)
      req(
        intIn(b.network.requiresTech, 0, U16) &&
          intIn(b.network.radius, 0, MAX_MAP_CELLS_SIDE << 8) &&
          intIn(b.network.damagePermillePerTurret, 0, 100000) &&
          intIn(b.network.maxDamagePermille, 0, 100000),
        `${at}: network`,
      );
    req(intIn(b.sight, 0, MAX_SIGHT), `${at}: sight`);
    if (b.cage !== null)
      req(
        intIn(b.cage.capacity, 0, 4096) &&
          intIn(b.cage.transitionTicks, 0, I31) &&
          intIn(b.cage.workRadius, 0, MAX_MAP_CELLS_SIDE << 8),
        `${at}: cage`,
      );
    if (b.hqRange !== null)
      req(
        intIn(b.hqRange.min, 0, MAX_MAP_CELLS_SIDE << 8) &&
          intIn(b.hqRange.max, b.hqRange.min, MAX_MAP_CELLS_SIDE << 8),
        `${at}: hqRange`,
      );
  }
  for (const u of config.unitTypes)
    req(
      u.producedAtTypeId === 0 || buildingIds.has(u.producedAtTypeId),
      `unittype ${u.typeId}: producedAtTypeId`,
    );
  return buildingIds;
}

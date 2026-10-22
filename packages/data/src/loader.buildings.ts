import {
  ARMOR_TYPES,
  DAMAGE_TYPES,
  PROVIDES,
  type BuildingData,
  type RawGameData,
} from './loader.types.js';
import { NEUTRAL_FACTION_ID, type ProjectData, type ProjectPartData } from './loader.types.game.js';
import { Project } from './schemas.js';
import { metersToUnits, pctToPermille, secondsToTicks } from './units.js';
import type { LoadContext } from './loader.parse.js';
import { convertEffects, idx, parseWith, ref } from './loader.util.js';

// Part of the pure loader (see loader.ts): no IO, no clock; falls under the determinism lint.

/** Stage 5: the faction buildings in id order. */
export function convertBuildings(ctx: LoadContext): BuildingData[] {
  const { buildingsRaw, factionIx, techIx, simRaw } = ctx;
  const buildings: BuildingData[] = buildingsRaw.map((b, id) => {
    const where = `data/buildings.json '${b.id}'`;
    return {
      id,
      key: b.id,
      factionId: ref(factionIx, 'factie', where, b.faction),
      hpI: Math.trunc(b.hp),
      armorType: idx(ARMOR_TYPES, b.armorType),
      scrapCost: Math.trunc(b.scrapCost),
      buildTicks: secondsToTicks(b.buildS),
      footprint: { w: b.footprint.w, h: b.footprint.h },
      beds: b.beds,
      provides: b.provides.map((p) => idx(PROVIDES, p)),
      prereqTech: b.prereqTech.map((t) => ref(techIx, 'tech', where, t)),
      visuals: { mesh: b.visuals.mesh },
      damage: Math.trunc(b.damage ?? 0),
      damageType: b.damageType === undefined ? 0 : idx(DAMAGE_TYPES, b.damageType),
      rangeU: metersToUnits(b.rangeM ?? 0),
      cooldownTicks: secondsToTicks(b.cooldownS ?? 0),
      network:
        b.network === undefined
          ? null
          : {
              requiresTech: ref(techIx, 'tech', `${where} network`, b.network.requiresTech),
              radiusU: metersToUnits(b.network.radiusM),
              damagePermillePerTurret: pctToPermille(b.network.damagePctPerTurret),
              maxDamagePermille: pctToPermille(b.network.maxDamagePct),
            },
      cage:
        b.cage === undefined
          ? null
          : {
              capacity: b.cage.capacity,
              transitionTicks: secondsToTicks(b.cage.transitionS),
              workRadiusU: metersToUnits(b.cage.workRadiusM),
            },
      placement:
        b.placement === undefined
          ? null
          : {
              minFromHqU: metersToUnits(b.placement.minFromHqM),
              maxFromHqU: metersToUnits(b.placement.maxFromHqM),
            },
      sightU: metersToUnits(
        b.sightM ??
          (b.provides.includes('turret')
            ? (b.rangeM ?? 0) + simRaw.vision.turretSightExtraM
            : simRaw.vision.buildingSightM),
      ),
    };
  });
  return buildings;
}

/** Stage 6: win route C; appends two neutral building types per part to `buildings`. */
export function convertProject(
  ctx: LoadContext,
  raw: RawGameData,
  buildings: BuildingData[],
): ProjectData {
  const { buildingIx, simRaw } = ctx;
  // Win route C (data 0.31.0): two neutral building types per part after the faction buildings (restored, then ruin),
  // so no faction building changes id.
  const projectRaw: Project | null =
    raw.project === undefined ? null : parseWith('project.json', Project, raw.project);
  const projectParts: ProjectPartData[] = [];
  for (const part of projectRaw?.parts ?? []) {
    const where = `data/project.json '${part.id}'`;
    for (const key of [part.id, `${part.id}_ruin`])
      if (buildingIx.has(key) || buildings.some((b) => b.key === key))
        throw new Error(`${where}: dubbele gebouw-id '${key}'`);
    const restoredId = buildings.length;
    for (const ruin of [false, true])
      buildings.push({
        id: buildings.length,
        key: ruin ? `${part.id}_ruin` : part.id,
        factionId: NEUTRAL_FACTION_ID,
        hpI: Math.trunc(part.hp),
        armorType: idx(ARMOR_TYPES, part.armorType),
        scrapCost: Math.trunc(part.restoreScrap),
        buildTicks: secondsToTicks(part.restoreS),
        footprint: { w: part.footprint.w, h: part.footprint.h },
        beds: ruin ? 0 : part.beds,
        provides: [],
        prereqTech: [],
        visuals: { mesh: ruin ? part.visuals.ruin : part.visuals.restored },
        damage: 0,
        damageType: 0,
        rangeU: 0,
        cooldownTicks: 0,
        network: null,
        cage: null,
        placement: null,
        sightU: metersToUnits(ruin ? 0 : (part.sightM ?? simRaw.vision.buildingSightM)),
      });
    if ((part.footprint.w & 1) === 0 || (part.footprint.h & 1) === 0)
      throw new Error(`${where}: footprint moet oneven zijn (het midden is een cel)`);
    projectParts.push({
      key: part.id,
      naam: part.naam,
      buildingId: restoredId,
      ruinBuildingId: restoredId + 1,
      effects: convertEffects(part.effects),
    });
  }
  const project: ProjectData = {
    countdownTicks: projectRaw === null ? 0 : secondsToTicks(projectRaw.countdownS),
    pauseTicks: projectRaw === null ? 0 : secondsToTicks(projectRaw.pauseAfterHitS),
    parts: projectParts,
  };
  return project;
}

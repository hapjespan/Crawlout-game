import { C, NO_ENTITY, NO_FIELD } from './ecs/world.js';
import { MAX_FLOW_FIELDS } from './flowfield.js';
import { createBuilding, createUnit, footprintFree } from './entities.js';
import { isInt } from './math/int.js';
import type { Sim } from './sim.js';
import type { SpawnUnitSpec } from './sim.types.js';
import { inMap, setFlowField, walkableAt } from './systems/common.js';
import { indexProjectParts } from './systems/project.js';

// Test and tool helpers of Sim outside the lockstep, and the rebuild of derived data. The Sim methods delegate here
// and mark the hash dirty themselves.

/**
 * Spawn-helper voor tests en tools (buiten de lockstep om). Geeft de entity-id, of NO_ENTITY (0) als het type
 * onbekend is, de eigenaar ongeldig, de positie buiten de map of geblokkeerd, of de wereld vol.
 */
export function spawnUnitIn(sim: Sim, spec: SpawnUnitSpec): number {
  const t = isInt(spec.typeId) ? sim.unitType(spec.typeId) : undefined;
  if (t === undefined) return NO_ENTITY;
  if (!isInt(spec.owner) || spec.owner < 0 || spec.owner >= sim.playerCount) return NO_ENTITY;
  if (
    !isInt(spec.x) ||
    !isInt(spec.y) ||
    !inMap(sim.map, spec.x, spec.y) ||
    !walkableAt(sim, spec.x, spec.y)
  )
    return NO_ENTITY;
  const i = createUnit(sim, t, spec.owner, spec.x, spec.y, spec.yaw ?? 0);
  if (i < 0) return NO_ENTITY;
  sim.vision.update(sim.world);
  return sim.world.idOf(i);
}

/** Gebouw-helper voor tests en tools: footprint met oorsprong (fx, fy) in cellen. NO_ENTITY als het niet past. */
export function spawnBuildingIn(
  sim: Sim,
  typeId: number,
  owner: number,
  fx: number,
  fy: number,
  done: boolean,
): number {
  const bt = sim.buildingType(typeId);
  if (bt === undefined || !isInt(owner) || owner < 0 || owner >= sim.playerCount) return NO_ENTITY;
  if (!footprintFree(sim, fx, fy, bt.footprintW, bt.footprintH)) return NO_ENTITY;
  const i = createBuilding(sim, bt, owner, fx, fy, done);
  if (i < 0) return NO_ENTITY;
  sim.vision.update(sim.world);
  return sim.world.idOf(i);
}

/** Verwijdert een unit direct (tests). False bij een ongeldige id of een gebouw. */
export function destroyEntityIn(sim: Sim, id: number): boolean {
  const i = sim.world.resolve(id);
  if (i < 0 || sim.world.has(i, C.building)) return false;
  setFlowField(sim, i, NO_FIELD);
  sim.world.free(i);
  sim.vision.update(sim.world);
  return true;
}

/** Indices of the claim points (derived), rebuilt in start() and after deserialize. */
export function indexClaimPoints(sim: Sim): void {
  const w = sim.world;
  sim.claimPoints.length = 0;
  for (let i = 0; i < w.highWater; i++) if (w.has(i, C.claim)) sim.claimPoints.push(i);
}

/** After loading a state: rebuild the derived data (passability, refcounts, flow fields, indices, vision). */
export function rebuildDerived(sim: Sim): void {
  sim.world.structVersion++;
  // afgeleide data opnieuw opbouwen: begaanbaarheid, refcounts, flow fields
  const w = sim.world;
  sim.terrain.rebuild(w);
  sim.flow.refcount.fill(0);
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] !== 1) continue;
    const f = w.flowField[i]!;
    if (f === NO_FIELD) continue;
    if (f >= MAX_FLOW_FIELDS) throw new Error(`state: entity ${i} wijst naar flow field ${f}`);
    sim.flow.refcount[f] = sim.flow.refcount[f]! + 1;
  }
  sim.flow.rebuild();
  indexClaimPoints(sim);
  indexProjectParts(sim, sim.projectParts);
  sim.vision.rebuild(w);
  // difficulty (sim 0.37.0): de trekking kwam met de state mee; de geschaalde scripts volgen eruit (afgeleid, nooit
  // opnieuw geloot — een resync moet precies de tegenstander krijgen waar het potje mee begon)
  sim.applyDifficultyRoll();
}

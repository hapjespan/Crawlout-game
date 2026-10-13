// Adapter from the data loader (GameData, already in sim units) to the sim's boundary type.
import type { GameData } from '@crawlout/data';
import type { SimConfig, SimUnitType } from '@crawlout/sim';

/** Unit type ids in the sim are loadout ids plus one; 0 stays free as "no type". */
export const typeIdOfLoadout = (loadoutId: number): number => loadoutId + 1;

export function toSimConfig(data: GameData): SimConfig {
  const unitTypes: SimUnitType[] = data.loadouts.map((l) => ({
    typeId: typeIdOfLoadout(l.id),
    maxHp: l.hpI,
    speed: l.speedUPT,
    radius: data.sim.unitRadiusU,
    armorType: l.armorType,
    bodyType: l.bodyType,
    loadoutId: l.id,
    role: l.role,
  }));
  return {
    dataVersion: data.dataVersion,
    unitTypes,
    arriveRadius: data.sim.arriveRadiusU,
    separationPermille: data.sim.separationPermille,
    flowFieldBudget: data.sim.flowFieldBudget,
    walkAnimStep: data.sim.walkAnimStep,
  };
}

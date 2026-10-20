// Split from fromData.ts to stay under the 5,000-token file limit; fromData.ts re-exports the public surface.
// Holds: EFFECT_STATS, EffectStatName, statIndex, TARGET_ALL, TARGET_HERO, AURA_STATS, +22 more.
import {
  EffectStat,
  type AbilityEffectData,
  type GameData,
  type EffectData,
  unitTypeId,
  buildingTypeId,
  PROVIDES,
  BODY_TYPES,
  ROLES,
  type LoadoutData,
} from '@crawlout/data';
import {
  type SimAuraEffect,
  AURA_TARGET_UNITS,
  AURA_TARGET_TURRETS,
  AURA_TARGET_ALL,
  AURA_SIDE_ENEMY,
  AURA_SIDE_ALLY,
  type SimEffect,
  EFFECT_TARGET_ALL,
  EFFECT_TARGET_HERO,
  EFFECT_TARGET_TYPE,
} from './config.js';

/** Volgorde van de effect-stats (EffectStat in packages/data); de index gaat de sim in (SimEffect.stat). */
export const EFFECT_STATS = EffectStat.options;

export type EffectStatName = (typeof EFFECT_STATS)[number];

export const statIndex = (name: EffectStatName): number => EFFECT_STATS.indexOf(name);

/** Vrije doelen in effects[].target (contract 3); anders is het doel een loadout- of gebouw-id. */
export const TARGET_ALL = 'alle';

export const TARGET_HERO = 'held';

/** Stats die een ability-zone kan zetten (de sim past ze per tick toe op units in de straal). */
const AURA_STATS: readonly EffectStatName[] = ['speedPct', 'damagePct', 'damageTakenPct'];

export function simAuraEffect(e: AbilityEffectData, where: string): SimAuraEffect {
  if (!AURA_STATS.includes(e.stat))
    throw new Error(
      `${where}: ability-effect '${e.stat}' kan de sim (nog) niet toepassen; alleen ${AURA_STATS.join(', ')}`,
    );
  const target =
    e.target === 'units'
      ? AURA_TARGET_UNITS
      : e.target === 'turrets'
        ? AURA_TARGET_TURRETS
        : AURA_TARGET_ALL;
  return {
    stat: statIndex(e.stat),
    side: e.side === 'enemy' ? AURA_SIDE_ENEMY : AURA_SIDE_ALLY,
    target,
    delta: e.delta,
  };
}

/** Effect uit GameData naar SimEffect: het doel wordt alles, de held, of één unit- of gebouwtype. Gooit bij een onbekend doel. */
export function simEffect(data: GameData, e: EffectData, where: string): SimEffect {
  const stat = statIndex(e.stat);
  if (e.target === TARGET_ALL)
    return { stat, target: EFFECT_TARGET_ALL, typeId: 0, delta: e.delta };
  if (e.target === TARGET_HERO)
    return { stat, target: EFFECT_TARGET_HERO, typeId: 0, delta: e.delta };
  const l = data.loadouts.find((x) => x.key === e.target);
  if (l !== undefined)
    return { stat, target: EFFECT_TARGET_TYPE, typeId: unitTypeId(l.id), delta: e.delta };
  const b = data.buildings.find((x) => x.key === e.target);
  if (b !== undefined)
    return { stat, target: EFFECT_TARGET_TYPE, typeId: buildingTypeId(b.id), delta: e.delta };
  throw new Error(`${where}: onbekend effect-doel '${e.target}'`);
}

// De enige adapter van de data-loader (GameData, al in sim-eenheden) en de map-loader (MapGrid) naar de grens van de sim.
// Client en replay gebruiken allebei deze functies, zodat er één afspraak is over typeIds, rollen en startopstelling.

/** Volgorde van MapDef.claimPoints[].kind; de index gaat de sim in. */
export const CLAIM_KINDS = ['scrap', 'settlement', 'powerArmor'] as const;

export type ClaimKind = (typeof CLAIM_KINDS)[number];

export function claimKindIndex(kind: string): number {
  const k = CLAIM_KINDS.indexOf(kind as ClaimKind);
  if (k < 0) throw new Error(`onbekend claimpunt-soort ${kind}`);
  return k;
}

const providesBit = (name: (typeof PROVIDES)[number]): number => 1 << PROVIDES.indexOf(name);

/** Bits in SimBuildingType.provides. */
export const PROVIDES_HQ = providesBit('hq');

export const PROVIDES_WORKSHOP = providesBit('werkplaats');

export const PROVIDES_CLAIM = providesBit('claim');

export const PROVIDES_TURRET = providesBit('turret');

export const PROVIDES_BEACON = providesBit('beacon');

/** Raiders (data 0.21.0, sim 0.18.0): tents (fighters, safety net), cages (slaves), depots (drop-off) and chem labs. */
export const PROVIDES_TENT = providesBit('tent');

export const PROVIDES_KOOI = providesBit('kooi');

export const PROVIDES_DEPOT = providesBit('depot');

export const PROVIDES_CHEMLAB = providesBit('chemlab');

/** Index of the robot body (BODY_TYPES): a robot needs no bed and never retrains (census.ts isRobot). */
export const BODY_ROBOT = BODY_TYPES.indexOf('robot');

/** Index of the human body: only humans are caught by a Slaver. */
export const BODY_HUMAN = BODY_TYPES.indexOf('human');

/** Index of the vehicle body (sim 0.33.0): what a Klerk repairs (loadouts repair target vehicle). */
export const BODY_VEHICLE = BODY_TYPES.indexOf('vehicle');

/** Stats a chem can change: damage and speed of every dosed unit, Strength and Agility of a dosed hero. */
const CHEM_STATS: readonly EffectStatName[] = ['damagePct', 'speedPct'];

const CHEM_HERO_STATS: readonly EffectStatName[] = ['S', 'A'];

export function simChemEffect(data: GameData, e: EffectData, where: string): SimEffect {
  const ok =
    (e.target === TARGET_ALL && CHEM_STATS.includes(e.stat)) ||
    (e.target === TARGET_HERO && (CHEM_STATS.includes(e.stat) || CHEM_HERO_STATS.includes(e.stat)));
  if (!ok)
    throw new Error(
      `${where}: chem-effect '${e.stat}' op '${e.target}' kan de sim niet toepassen; alleen ${CHEM_STATS.join(', ')} op alle of held, ${CHEM_HERO_STATS.join(', ')} op held`,
    );
  return simEffect(data, e, where);
}

export const ROLE_SCAVENGER = ROLES.indexOf('scavenger');

/** Het loadout waar SetRole naartoe omschoolt: binnen de factie, zonder prereqTech, goedkoopste, dan laagste id. */
export function defaultLoadoutForRole(
  data: GameData,
  factionId: number,
  role: number,
): LoadoutData | undefined {
  let best: LoadoutData | undefined;
  for (const l of data.loadouts) {
    if (
      l.factionId !== factionId ||
      l.role !== role ||
      l.prereqTech.length > 0 ||
      l.producedAt >= 0
    )
      continue;
    if (best === undefined || l.scrapCost < best.scrapCost) best = l;
  }
  return best;
}

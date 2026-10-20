import { I31, intIn, req } from './config.limits.js';
import type { SimConfig } from './config.env.js';
import { EffectStat } from '@crawlout/data';

// Straight from the data enum, not from effects.ts: effects.ts -> fromData -> config.validate would be an import cycle.
const STAT_DAMAGE_TAKEN = EffectStat.options.indexOf('damageTakenPct');

/**
 * The Garde, round A (sim 0.32.0): veteran ranks (ascending kills within a Uint8 counter), fusion cores (a known
 * building, a stock within a Uint8) and the fusion cores of unit types (only a faction with fusion cores). The new stat
 * damageTakenPct works only in ability and aura effects (systems/hero.ts applyZone): a tech, perk, passive or chem with
 * it would do nothing, so it is refused.
 */
export function validateGarde(
  config: SimConfig,
  unitIds: ReadonlySet<number>,
  buildingIds: ReadonlySet<number>,
): void {
  config.factions.forEach((f, k) => {
    const at = `factie ${k}`;
    const v = f.veterancy;
    if (v !== null) {
      req(v.typeIds.length > 0 && v.typeIds.every((t) => unitIds.has(t)), `${at}: veterancy`);
      req(v.ranks.length > 0 && v.ranks.length < 255, `${at}: veterancy ranks`);
      let prev = 0;
      for (const r of v.ranks) {
        req(
          intIn(r.kills, prev + 1, 255) &&
            intIn(r.hpPermille, -1000, 100000) &&
            intIn(r.damagePermille, -1000, 100000),
          `${at}: veterancy rank`,
        );
        prev = r.kills;
      }
    }
    const c = f.fusionCores;
    if (c !== null)
      req(
        buildingIds.has(c.buildingTypeId) &&
          intIn(c.scrapCost, 0, I31) &&
          intIn(c.craftTicks, 1, I31) &&
          intIn(c.maxStock, 1, 255) &&
          c.prereqTech.every((t) => intIn(t, 0, config.techs.length - 1)),
        `${at}: fusionCores`,
      );
  });
  for (const u of config.unitTypes)
    req(
      intIn(u.fusionCores, 0, 255) &&
        (u.fusionCores === 0 || config.factions[u.factionId]?.fusionCores != null),
      `unittype ${u.typeId}: fusionCores`,
    );
  const noTaken = (effects: readonly { stat: number }[], at: string): void => {
    for (const e of effects)
      req(e.stat !== STAT_DAMAGE_TAKEN, `${at}: damageTakenPct alleen in een aura`);
  };
  for (const t of config.techs) noTaken(t.effects, `tech ${t.techId}`);
  for (const p of config.perks) noTaken(p.effects, `perk ${p.perkId}`);
  for (const h of config.heroes) noTaken(h.passives, `held ${h.heroId} passives`);
  for (const f of config.factions)
    for (const ch of f.chems) noTaken([...ch.effects, ...ch.crash], `factie ${f.factionId} chem`);
}

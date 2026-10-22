// Hero choice (sim 0.33.0, data 0.39.0; proposal for the architect, docs/held-keuze.md): a player plays the hero of
// SimPlayer.heroId, a hero of his own faction; absent = the hero of his faction (SimFaction.heroId, the Krijger).
import type { SimConfig, SimPlayer } from './config.env.js';

/** The hero id player p plays (index in SimConfig.heroes), -1 = none. */
export function playerHeroId(c: SimConfig, p: SimPlayer): number {
  return p.heroId ?? c.factions[p.factionId]!.heroId;
}

/** Choice heroes: every hero that is not the hero of a faction (the Bouwer and the Tacticus). */
export function choiceHeroes(c: SimConfig): Set<number> {
  const defaults = new Set(c.factions.map((f) => f.heroId));
  const out = new Set<number>();
  for (const h of c.heroes) if (!defaults.has(h.heroId)) out.add(h.heroId);
  return out;
}

/** Choice perks: perks that only a choice hero has in his pool. */
export function choicePerks(c: SimConfig): Set<number> {
  const choice = choiceHeroes(c);
  const used = new Set<number>();
  for (const h of c.heroes) if (!choice.has(h.heroId)) for (const k of h.perkPool) used.add(k);
  const out = new Set<number>();
  for (const pk of c.perks) if (!used.has(pk.perkId)) out.add(pk.perkId);
  return out;
}

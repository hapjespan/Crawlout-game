import { fnv1aInt } from './math/fnv.js';
import type { SimEnv } from './config.env.js';
import { hashEffects, hashInts } from './config.hash.config.js';
import { hashHero } from './config.hash.ai.js';
import { choiceHeroes, choicePerks, playerHeroId } from './config.heroes.js';

// Sim 0.33.0 (hero choice; proposal for the architect, like the Garde scoping in config.hash.garde.ts): the choice
// heroes and the perks only they use go into the envHash only when a player plays a choice hero. Without one the
// envHash sees the heroes and perks as data 0.38.0 did, so every match without a choice keeps its hash.

/** The hero choice of the players and the choice content, only when a player plays a choice hero. */
export function hashHeroChoice(h: number, env: SimEnv): number {
  const c = env.config;
  const choice = choiceHeroes(c);
  const played: number[] = [];
  env.players.forEach((p, k) => {
    const id = playerHeroId(c, p);
    if (choice.has(id)) played.push(k);
  });
  if (played.length === 0) return h;
  h = fnv1aInt(h, 0x4e1d);
  for (const k of played) h = hashInts(h, [k, playerHeroId(c, env.players[k]!)]);
  for (const hr of c.heroes) if (choice.has(hr.heroId)) h = hashHero(h, hr);
  const perks = choicePerks(c);
  h = fnv1aInt(h, perks.size);
  for (const pk of c.perks) {
    if (!perks.has(pk.perkId)) continue;
    h = hashInts(h, [pk.perkId, pk.requiresStat, pk.requiresMin]);
    h = hashEffects(h, pk.effects);
  }
  return h;
}

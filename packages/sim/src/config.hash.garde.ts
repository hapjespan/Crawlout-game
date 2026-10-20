import { fnv1aInt } from './math/fnv.js';
import type { SimConfig, SimEnv } from './config.env.js';
import { hashInts } from './config.hash.config.js';
import { hashAiScript, hashHero } from './config.hash.ai.js';
import { choiceHeroes } from './config.heroes.js';

// Sim 0.32.0 (the Garde, round A; proposal for the architect): faction-scoped hashing of what this round adds. A
// gated faction is one with Garde rules (veterancy or fusion cores). Its new content (its AI script, its
// hero, the rules and the fusion cores of its unit types) goes into the envHash only when a player plays it; without
// one the envHash sees it as data 0.37.0 did, and the script and hero indices of the other factions are counted
// without the gated ones. So every Dwellers and Raiders env keeps its hash (the replay set proves it), and a Garde env
// hashes all of it. The architect may prefer to scope all faction content to the factions in the match (one more
// re-recording); this keeps the existing fixtures.

/** Per factionId: true for a faction with Garde rules. */
export function gatedFactions(c: SimConfig): boolean[] {
  return c.factions.map((f) => f.veterancy !== null || f.fusionCores !== null);
}

/** Script indices (SimConfig.aiScripts) of the gated factions, default and versus. */
export function gatedScripts(c: SimConfig): Set<number> {
  const out = new Set<number>();
  const g = gatedFactions(c);
  for (const f of c.factions) {
    if (!g[f.factionId]) continue;
    if (f.aiScript >= 0) out.add(f.aiScript);
    for (const v of f.aiScriptVersus) if (v >= 0) out.add(v);
  }
  return out;
}

/** Hero ids of the gated factions (sim 0.33.0: without the choice heroes, config.hash.heroes.ts hashes those). */
export function gatedHeroes(c: SimConfig): Set<number> {
  const g = gatedFactions(c);
  const choice = choiceHeroes(c);
  const out = new Set<number>();
  for (const h of c.heroes) if (g[h.factionId] === true && !choice.has(h.heroId)) out.add(h.heroId);
  return out;
}

/** Index ix counted without the gated ones (-1 stays -1, a gated index is -1). */
export function rankOf(ix: number, gated: ReadonlySet<number>): number {
  if (ix < 0 || gated.has(ix)) return -1;
  let r = ix;
  for (const k of gated) if (k < ix) r--;
  return r;
}

/** Whether a player of the match plays a gated faction. */
export function gardeOn(env: SimEnv): boolean {
  const g = gatedFactions(env.config);
  return env.players.some((p) => g[p.factionId] === true);
}

/** The Garde content, only when a player plays a gated faction. */
export function hashGarde(h: number, env: SimEnv): number {
  if (!gardeOn(env)) return h;
  const c = env.config;
  const g = gatedFactions(c);
  h = fnv1aInt(h, 0x6a5d);
  for (const f of c.factions) {
    if (!g[f.factionId]) continue;
    h = hashInts(h, [f.factionId, f.settlerTypeId, f.aiScript, f.heroId]);
    h = hashInts(h, f.aiScriptVersus);
    const v = f.veterancy;
    h = hashInts(h, v === null ? [0] : [1, v.ranks.length]);
    if (v !== null) {
      h = hashInts(h, v.typeIds);
      for (const r of v.ranks) h = hashInts(h, [r.kills, r.hpPermille, r.damagePermille]);
    }
    const fc = f.fusionCores;
    h = hashInts(
      h,
      fc === null ? [0] : [1, fc.buildingTypeId, fc.scrapCost, fc.craftTicks, fc.maxStock],
    );
    if (fc !== null) h = hashInts(h, fc.prereqTech);
  }
  for (const u of c.unitTypes) if (u.fusionCores > 0) h = hashInts(h, [u.typeId, u.fusionCores]);
  const scripts = gatedScripts(c);
  c.aiScripts.forEach((s, k) => {
    if (!scripts.has(k)) return;
    h = hashInts(hashAiScript(h, s), [k]);
    // the parts that hashCreeps and the project hash leave out for a gated script
    const cr = s.creeps;
    h = hashInts(h, cr == null ? [0] : [1, cr.fromTicks, cr.maxPath, cr.tiers.length]);
    if (cr != null) for (const t of cr.tiers) h = hashInts(h, [t.tier, t.minArmy]);
    const pr = s.project;
    h = hashInts(
      h,
      pr == null
        ? [0]
        : [
            1,
            pr.restoreFromTicks,
            pr.restoreMinArmy,
            pr.builders,
            pr.sabotageKinds,
            pr.sabotageMinArmy,
          ],
    );
    if (pr != null) h = hashInts(h, [pr.rallyAtParts ? 1 : 0]);
  });
  const heroes = gatedHeroes(c);
  for (const hr of c.heroes) if (heroes.has(hr.heroId)) h = hashHero(h, hr);
  return h;
}

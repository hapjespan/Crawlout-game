import { FNV_OFFSET, fnv1a, fnv1aInt } from './math/fnv.js';
import { type SimEnv, defenseOn } from './config.env.js';
import {
  hashBuildingTypes,
  hashFactions,
  hashInts,
  hashTuning,
  hashUnitTypes,
} from './config.hash.config.js';
import { hashAiScripts, hashProgression } from './config.hash.ai.js';
import { hashSurvival } from './config.survival.env.js';
import { gatedScripts, hashGarde } from './config.hash.garde.js';

/**
 * Hash van de omgeving (config, map, spelers) in vaste veldvolgorde. Gaat de state-header in,
 * zodat twee clients met andere data, een andere map of andere spelers op tick 0 al verschillen.
 * Sim 0.31.0 (fase-0 sectie 24 besluit 4): de versiestring `dataVersion` hoort er niet meer in; de envHash dekt wat
 * de sim leest veld voor veld, dus een data-bump die daar niets aan verandert houdt elke hash. `dataVersion` blijft
 * de lobby-check in start en Replay.
 */
export function envHash(env: SimEnv): number {
  const { config: c } = env;
  let h = FNV_OFFSET;
  h = hashTuning(h, c);
  h = hashUnitTypes(h, c);
  h = hashBuildingTypes(h, c);
  h = hashFactions(h, c);
  h = hashAiScripts(h, c);
  h = hashProgression(h, c);
  h = hashMapEnv(h, env);
  h = hashCreeps(h, env);
  // survival co-op (sim 0.27.0): only with SimMap.survival, so every other env keeps its hash
  h = hashSurvival(h, env);
  // the Garde (sim 0.32.0): its rules, script and hero only when a player plays it, so every other env keeps its hash
  h = hashGarde(h, env);
  // base defence (sim 0.29.0): only where it is on, so every other env keeps its hash
  if (defenseOn(env)) {
    const d = c.baseDefense;
    h = hashInts(h, [d.survival ? 1 : 0, d.skirmish ? 1 : 0, d.radius, d.calmTicks]);
  }
  return h;
}

/** Players, the map and (only with project sites) win route C. */
function hashMapEnv(h: number, env: SimEnv): number {
  const { map, config: c, players } = env;
  h = fnv1aInt(h, players.length);
  for (const p of players) h = hashInts(h, [p.factionId, p.ai ? 1 : 0]);

  h = hashInts(h, [map.w, map.h]);
  h = fnv1a(h, map.passable);
  h = fnv1aInt(h, map.spawns.length);
  for (const s of map.spawns) h = hashInts(h, [s.x, s.y]);
  h = fnv1aInt(h, map.scrapNodes.length);
  for (const n of map.scrapNodes) h = hashInts(h, [n.x, n.y, n.amount]);
  h = fnv1aInt(h, map.claimPoints.length);
  for (const p of map.claimPoints) h = hashInts(h, [p.x, p.y, p.kind]);
  h = hashInts(h, [map.dominance.pointsRequired, map.dominance.ticks]);
  // win route C (data 0.31.0): only when the map has project sites (the game type Bouwproject), so an env without them
  // keeps its hash
  const sites = map.projectSites ?? [];
  if (sites.length > 0) {
    h = fnv1aInt(h, sites.length);
    for (const s of sites) h = hashInts(h, [s.x, s.y, s.kind]);
    const pr = c.project!;
    h = hashInts(h, [pr.countdownTicks, pr.pauseTicks, pr.parts.length]);
    for (const k of pr.parts) {
      h = hashInts(h, [k.restoredTypeId, k.ruinTypeId, k.effects.length]);
      for (const e of k.effects) h = hashInts(h, [e.stat, e.target, e.typeId, e.delta]);
    }
    const gated = gatedScripts(c);
    for (const s of c.aiScripts.filter((_, k) => !gated.has(k))) {
      const a = s.project;
      h = hashInts(
        h,
        a === undefined || a === null
          ? [0]
          : [
              1,
              a.restoreFromTicks,
              a.restoreMinArmy,
              a.builders,
              a.sabotageKinds,
              a.sabotageMinArmy,
              a.rallyAtParts ? 1 : 0,
            ],
      );
    }
  }
  return h;
}

/** Creep camps, tiers, camp takeover and the creep plans of the AI scripts. */
function hashCreeps(h: number, env: SimEnv): number {
  const { map, config: c } = env;
  // creep camps (data 0.25.0): only when there are any, so an env without them keeps its hash
  const camps = map.creepCamps ?? [];
  const tiers = c.creepTiers ?? [];
  // sim 0.32.0: the scripts of a gated faction (the Garde) are in hashGarde
  const gated = gatedScripts(c);
  const scripts = c.aiScripts.filter((_, k) => !gated.has(k));
  const aiCreeps = scripts.some((s) => s.creeps !== undefined && s.creeps !== null);
  if (camps.length === 0 && tiers.length === 0 && !aiCreeps) return h;
  h = fnv1aInt(h, camps.length);
  for (const cc of camps) h = hashInts(h, [cc.x, cc.y, cc.tier]);
  h = fnv1aInt(h, tiers.length);
  for (const t of tiers) {
    h = hashInts(h, [
      t.tier,
      t.aggroRadius,
      t.leashRadius,
      t.respawnTicks,
      t.lootScrap,
      t.heroXp,
      t.heroXpRadius,
    ]);
    h = fnv1aInt(h, t.typeIds.length);
    h = hashInts(h, t.typeIds);
  }
  // camp takeover (data 0.27.0): only when there is any, so an env without it keeps its hash
  const takeover = c.creepTakeover ?? [];
  if (takeover.length > 0) {
    h = fnv1aInt(h, takeover.length);
    for (const r of takeover) {
      h = hashInts(h, [r.factionId, r.tiers.length]);
      for (const t of r.tiers)
        h = hashInts(h, [t.tier, t.surrenderPermille, t.minUnits, t.yieldTicks, t.yieldMax]);
    }
  }
  for (const s of scripts) {
    const cr = s.creeps;
    if (cr === undefined || cr === null) {
      h = fnv1aInt(h, 0);
      continue;
    }
    h = hashInts(h, [1, cr.fromTicks, cr.maxPath, cr.tiers.length]);
    for (const t of cr.tiers) h = hashInts(h, [t.tier, t.minArmy]);
  }
  return h;
}

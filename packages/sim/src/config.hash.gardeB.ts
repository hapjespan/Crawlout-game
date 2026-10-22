import type { SimConfig, SimEnv } from './config.env.js';
import type { SimUnitType } from './config.types.js';
import { hashInts } from './config.hash.config.js';
import { hashTech } from './config.hash.ai.js';

// Sim 0.33.0 (the Garde, round B; proposal for the architect): what this round adds to the envHash, faction-scoped as in
// round A (config.hash.garde.ts). The repair, overload, transport and flying of a gated faction's unit types, its power
// armour of the map and the trailing techs of gated factions (data 0.39.0 idGroup 1) go in only when a player plays a
// gated faction; of another faction the new unit fields go in only when set. So every existing env keeps its hash.

/** The techs before the trailing run of gated-faction techs (the rest is hashed in hashGarde). */
export function legacyTechCount(c: SimConfig, gated: readonly boolean[]): number {
  let n = c.techs.length;
  while (n > 0 && gated[c.techs[n - 1]!.factionId] === true) n--;
  return n;
}

/** The round-B fields of unit type u; `all` hashes them in full (a gated faction), else only what is set. */
export function hashGardeUnit(h: number, u: SimUnitType, all: boolean): number {
  const r = u.repair;
  if (all)
    h = hashInts(
      h,
      r === null
        ? [0]
        : [1, r.milliHpPerTick, r.range, r.seekRange, r.buildings ? 1 : 0, r.robots ? 1 : 0],
    );
  const repairsVehicles = r !== null && r.vehicles;
  if (all || repairsVehicles) h = hashInts(h, [repairsVehicles ? 1 : 0]);
  const o = u.overload;
  if (all || o !== null) {
    h = hashInts(h, o === null ? [0] : [1, o.stunTicks, o.cooldownTicks]);
    if (o !== null) h = hashInts(h, o.typeIds);
  }
  const t = u.transport;
  if (all || t !== null) h = hashInts(h, t === null ? [0] : [1, t.capacity, t.loadRange]);
  if (all || u.flying) h = hashInts(h, [u.flying ? 1 : 0]);
  return h;
}

/** Round B of a Garde env (hashGarde calls it only when a player plays a gated faction). */
export function hashGardeB(h: number, env: SimEnv, gated: readonly boolean[]): number {
  const c = env.config;
  for (const u of c.unitTypes) if (gated[u.factionId] === true) h = hashGardeUnit(h, u, true);
  for (const f of c.factions) {
    if (gated[f.factionId] !== true) continue;
    const m = f.mapPowerArmor;
    h = hashInts(h, m === null ? [0] : [1, m.typeId, m.respawnTicks, m.otherQualityPermille]);
  }
  const n = legacyTechCount(c, gated);
  h = hashInts(h, [c.techs.length - n]);
  for (const t of c.techs.slice(n)) h = hashTech(h, t);
  return h;
}

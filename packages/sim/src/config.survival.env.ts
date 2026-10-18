// Survival co-op (sim 0.27.0): validation and env hash of SimMap.survival plus SimConfig.survival. Both only when the
// map has survival geometry (the game type Survival), so every other env keeps its hash.
import { MAX_PLAYERS } from '@crawlout/protocol';
import type { SimEnv } from './config.env.js';
import { RANK_BOSS, RANK_NORMAL } from './config.survival.js';
import { I31, MAX_SURVIVAL_WAVES, checkPoint, intIn, req } from './config.limits.js';
import { hashInts } from './config.hash.config.js';
import { fnv1aInt } from './math/fnv.js';

export function validateSurvival(env: SimEnv, unitIds: ReadonlySet<number>): void {
  const { map, config, players } = env;
  const sm = map.survival;
  if (sm === undefined) return;
  const s = config.survival;
  req(s !== undefined, 'survival op de map zonder survival-data');
  if (s === undefined) return;
  req(
    intIn(players.length, s.playersMin, s.playersMax) && players.length <= MAX_PLAYERS,
    `survival: ${players.length} spelers`,
  );
  req(sm.edges.length >= 1 && sm.zones.length >= players.length, 'survival: randen of zones');
  for (const e of sm.edges) {
    checkPoint(map, e, 'survival-rand');
    req(intIn(e.spread, 0, I31), 'survival-rand: spreiding');
  }
  for (const z of sm.zones) {
    checkPoint(map, z, 'survival-zone');
    req(intIn(z.radius, 1, I31) && intIn(z.nearEdge, 0, sm.edges.length - 1), 'survival-zone');
  }
  req(s.scaling.length >= players.length, 'survival: schaling per speleraantal');
  for (const c of s.scaling)
    req(
      intIn(c.countPermille, 1, I31) &&
        intIn(c.hpPermille, 1, I31) &&
        intIn(c.damagePermille, 1, I31),
      'survival: schaling',
    );
  const n = s.typeIds.length;
  req(
    s.ranks.length === n && s.lootScrap.length === n && s.heroXp.length === n,
    'survival: eenheden niet parallel',
  );
  for (let k = 0; k < n; k++) {
    req(unitIds.has(s.typeIds[k]!), `survival: onbekend unittype ${s.typeIds[k]}`);
    req(intIn(s.ranks[k], RANK_NORMAL, RANK_BOSS), 'survival: rang');
    req(intIn(s.lootScrap[k], 0, I31) && intIn(s.heroXp[k], 0, I31), 'survival: beloning');
  }
  req(intIn(s.waves.length, 1, MAX_SURVIVAL_WAVES), `survival: ${s.waves.length} golven`);
  req(intIn(s.winWave, 1, s.waves.length), 'survival: winWave');
  for (const w of s.waves) {
    req(intIn(w.atTicks, 0, I31) && intIn(w.batchIntervalTicks, 0, I31), 'survival: golftijd');
    req(intIn(w.batches, 1, 255) && intIn(w.edges, 1, sm.edges.length), 'survival: golf');
    for (const e of w.spawns)
      req(s.typeIds.includes(e.typeId) && intIn(e.count, 1, 1000), 'survival: golfeenheid');
  }
  req(
    intIn(s.unitScrapPermille, 0, I31) &&
      intIn(s.turretScrapPermille, 0, I31) &&
      intIn(s.heroScrap, 0, I31),
    'survival: doelregel',
  );
}

export function hashSurvival(h: number, env: SimEnv): number {
  const sm = env.map.survival;
  const s = env.config.survival;
  if (sm === undefined || s === undefined) return h;
  h = fnv1aInt(h, sm.edges.length);
  for (const e of sm.edges) h = hashInts(h, [e.x, e.y, e.spread]);
  h = fnv1aInt(h, sm.zones.length);
  for (const z of sm.zones) h = hashInts(h, [z.x, z.y, z.radius, z.nearEdge]);
  h = hashInts(h, [s.playersMin, s.playersMax, s.typeIds.length]);
  h = hashInts(h, s.typeIds);
  h = hashInts(h, s.ranks);
  h = hashInts(h, s.lootScrap);
  h = hashInts(h, s.heroXp);
  h = fnv1aInt(h, s.scaling.length);
  for (const c of s.scaling) h = hashInts(h, [c.countPermille, c.hpPermille, c.damagePermille]);
  h = hashInts(h, [s.unitScrapPermille, s.turretScrapPermille, s.heroScrap]);
  h = hashInts(h, [s.winWave, s.requireAllWaveUnitsDead ? 1 : 0, s.waves.length]);
  for (const w of s.waves) {
    h = hashInts(h, [w.atTicks, w.edges, w.batches, w.batchIntervalTicks, w.spawns.length]);
    for (const e of w.spawns) h = hashInts(h, [e.typeId, e.count]);
  }
  return h;
}

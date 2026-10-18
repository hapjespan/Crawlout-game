// Survival co-op (sim 0.27.0, data 0.33.0; voorstel, ter bevestiging door de architect): GameData.survival to
// SimConfig.survival, and the survival geometry of a map (SimMap.survival) from its percentages.
// Holds: simSurvivalFromData, survivalMapOf.
import { type GameData, unitTypeId } from '@crawlout/data';
import type { SimSurvival, SimSurvivalMap } from './config.survival.js';
import { idiv } from './math/int.js';

export type SurvivalSource = NonNullable<GameData['survival']>;

/** SimConfig.survival from GameData.survival (null: none). */
export function simSurvivalFromData(s: SurvivalSource | null): SimSurvival | undefined {
  if (s === null) return undefined;
  return {
    typeIds: s.units.map((l) => unitTypeId(l)),
    ranks: [...s.ranks],
    lootScrap: [...s.lootScrap],
    heroXp: [...s.heroXp],
    playersMin: s.playersMin,
    playersMax: s.playersMax,
    scaling: s.scaling.map((c) => ({ ...c })),
    unitScrapPermille: s.targetRule.unitScrapPermille,
    turretScrapPermille: s.targetRule.turretScrapPermille,
    heroScrap: s.targetRule.heroScrap,
    winWave: s.winWave,
    requireAllWaveUnitsDead: s.requireAllWaveUnitsDead,
    waves: s.waves.map((w) => ({
      atTicks: w.atTicks,
      spawns: w.spawns.map((e) => ({ typeId: unitTypeId(e.unit), count: e.count })),
      edges: w.edges,
      batches: w.batches,
      batchIntervalTicks: w.batchIntervalTicks,
    })),
  };
}

/** What survivalMapOf needs of the grid (structural, like SimMapSource). */
interface SurvivalGrid {
  readonly w: number;
  readonly h: number;
  readonly passable: Uint8Array;
}

/**
 * The 4-connected walkable component with the most cells (tiebreak: the one holding the lowest cell index), as a mask.
 * The edge points of the data lie at 3 percent of the map, often on the border wall; they and the zone centres snap to
 * this component, so every wave can walk to every zone.
 */
function mainComponent(g: SurvivalGrid): Uint8Array {
  const n = g.w * g.h;
  const comp = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let best = -1;
  let bestSize = 0;
  let id = 0;
  for (let c0 = 0; c0 < n; c0++) {
    if (g.passable[c0] !== 1 || comp[c0] !== -1) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = c0;
    comp[c0] = id;
    while (head < tail) {
      const c = queue[head++]!;
      const y = idiv(c, g.w);
      const x = c - y * g.w;
      const near = [
        x > 0 ? c - 1 : -1,
        x + 1 < g.w ? c + 1 : -1,
        y > 0 ? c - g.w : -1,
        y + 1 < g.h ? c + g.w : -1,
      ];
      for (const d of near) {
        if (d < 0 || g.passable[d] !== 1 || comp[d] !== -1) continue;
        comp[d] = id;
        queue[tail++] = d;
      }
    }
    if (tail > bestSize) {
      best = id;
      bestSize = tail;
    }
    id++;
  }
  const mask = new Uint8Array(n);
  for (let c = 0; c < n; c++) if (comp[c] === best) mask[c] = 1;
  return mask;
}

/** The centre (sim units) of the cell in `mask` nearest to (x, y) in sim units; tiebreak lowest cell index. */
function snap(g: SurvivalGrid, mask: Uint8Array, x: number, y: number): { x: number; y: number } {
  let best = -1;
  let bestD = 0;
  for (let c = 0; c < g.w * g.h; c++) {
    if (mask[c] !== 1) continue;
    const cy = idiv(c, g.w);
    const px = ((c - cy * g.w) << 8) + 128;
    const py = (cy << 8) + 128;
    const d = (px - x) * (px - x) + (py - y) * (py - y);
    if (best < 0 || d < bestD) {
      best = c;
      bestD = d;
    }
  }
  if (best < 0) throw new Error('survival: de map heeft geen begaanbare cel');
  const cy = idiv(best, g.w);
  return { x: ((best - cy * g.w) << 8) + 128, y: (cy << 8) + 128 };
}

/** The survival geometry of a map: edges and zones from permille of the map size, snapped to the main component. */
export function survivalMapOf(g: SurvivalGrid, s: SurvivalSource): SimSurvivalMap {
  const mask = mainComponent(g);
  const at = (xp: number, yp: number) =>
    snap(g, mask, idiv((g.w << 8) * xp, 1000), idiv((g.h << 8) * yp, 1000));
  return {
    edges: s.edges.map((e) => ({ ...at(e.xPermille, e.yPermille), spread: e.spreadU })),
    zones: s.buildZones.map((z) => ({
      ...at(z.hqXPermille, z.hqYPermille),
      radius: z.radiusU,
      nearEdge: z.nearEdge,
    })),
  };
}

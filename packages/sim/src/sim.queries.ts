import type { ChemStatus, FogMask, PlayerStatus, QueueItem } from '@crawlout/protocol';
import { ENTITY_NONE } from '@crawlout/protocol';
import {
  C,
  CHEM_ACTIVE,
  CHEM_CRASH,
  CHEM_NONE,
  JOB_PRODUCE,
  JOB_TRAIN,
  ORDER_CRAFT,
  PHASE_CRAFT,
  PHASE_WORK,
} from './ecs/world.js';
import { PROGRESS_ONE } from './entities.js';
import { clampI, idiv, isInt } from './math/int.js';
import type { Sim } from './sim.js';
import type { EntityKind, SimWinner, UnitView, WinReason } from './sim.types.js';
import { claimPointStatus } from './systems/claims.js';
import { type Census, takeCensus } from './systems/census.js';
import { campStatus } from './systems/creeps.js';
import {
  NO_WINNER,
  WIN_DOMINANCE,
  WIN_PROJECT,
  WIN_SURRENDER,
  nearestOwnBuilding,
} from './systems/common.js';
import { heroStatus } from './systems/hero.js';
import { trainTicks, trainedOf } from './systems/training.js';
import { ROLE_MILITIA, craftSiteMask } from './systems/orders.js';
import { slaveGroupStatus } from './systems/slaves.js';
import { projectStatus } from './systems/project.js';

// The read-only query API of Sim (fog, HUD status, debug views). The Sim methods delegate here.

/**
 * The fog of a player on the vision grid (protocol FogMask, 0.11.0; bevestigd in fase-0 sectie 23 besluit 1): explored and visible as bitsets, copies.
 * For the HUD and the render (minimap, fog overlay), on request like the player status.
 */
export function fogMaskOf(sim: Sim, playerId: number): FogMask {
  if (!isInt(playerId) || playerId < 0 || playerId >= sim.playerCount)
    throw new Error(`onbekende speler ${playerId}`);
  const v = sim.vision;
  const explored = v.explored.slice(playerId * v.bytes, (playerId + 1) * v.bytes);
  const visible = new Uint8Array(v.bytes);
  const base = playerId * v.cells;
  for (let c = 0; c < v.cells; c++)
    if (v.count[base + c]! > 0) visible[c >> 3] = visible[c >> 3]! | (1 << (c & 7));
  return {
    frame: sim.frame > 0 ? sim.frame - 1 : 0,
    playerId,
    cellsW: v.gw,
    cellsH: v.gh,
    cellUnits: 1 << v.shift,
    explored,
    visible,
  };
}

/** Spelerstatus voor de HUD (queryMessage, contract 1). hero is null als de factie geen held heeft. */
export function playerStatusOf(sim: Sim, census: Census, playerId: number): PlayerStatus {
  if (!isInt(playerId) || playerId < 0 || playerId >= sim.playerCount)
    throw new Error(`onbekende speler ${playerId}`);
  takeCensus(sim, census);
  return {
    playerId,
    scrap: sim.ps.scrap[playerId]!,
    settlers: census.settlers[playerId]!,
    pop: census.pop[playerId]!,
    popCap: census.popCap(sim, playerId),
    beds: census.beds[playerId]!,
    hero: heroStatus(sim, playerId),
    techs: sim.researched(playerId), // besluit sprint 3 (architect): de HUD filtert bouwmenu en craft-opties op prereqTech
    queue: sim.queue(playerId),
    dominance: sim.dominance(playerId), // protocol 0.6.0: winroute B voor de HUD
    robotPop: census.robotPop[playerId]!, // protocol 0.8.0: robots tellen niet voor bedden
    trained: trainedOf(sim, playerId) as NonNullable<PlayerStatus['trained']>, // protocol 0.8.0
    chems: sim.chems(playerId), // protocol 0.13.0 (voorstel): chem-dosis per eenheid voor de Chem-dealer in de HUD
    claimPoints: claimPointStatus(sim), // protocol 0.10.0 (bevestigd in fase-0 sectie 22 besluit 3): claimstand voor de ring in de HUD
    camps: campStatus(sim, playerId), // protocol 0.14.0 (voorstel): creep-kampen, overgenomen in de kleur van de eigenaar
    slaveGroups: slaveGroupStatus(sim, playerId, ROLE_MILITIA), // protocol 0.15.0 (voorstel): slavengroepen en bewakers
    project: projectStatus(sim), // protocol 0.16.0 (voorstel): winroute C, de delen en de countdowns
  };
}

/**
 * Chem per eenheid van een speler (PlayerStatus.chems, protocol 0.13.0, voorstel): elke eigen eenheid met een chem in
 * een fase, oplopend op entity-id (= op index). Leest alleen state; geen wijziging in de hash.
 */
export function chemsOf(sim: Sim, playerId: number): ChemStatus[] {
  const w = sim.world;
  const out: ChemStatus[] = [];
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] !== 1 || w.owner[i] !== playerId || w.chemPhase[i] === CHEM_NONE) continue;
    const ph = w.chemPhase[i]!;
    out.push({
      unitId: w.idOf(i),
      chem: w.chem[i]! - 1,
      phase: ph === CHEM_ACTIVE ? 'active' : ph === CHEM_CRASH ? 'crash' : 'cooldown',
      ticksLeft: w.chemTicks[i]!,
    });
  }
  return out;
}

/**
 * Lopend werk van een speler voor het gebouwpaneel van de HUD (PlayerStatus.queue, speltest 14 oktober, architect-
 * besluit sectie 16): onderzoek per gebouw (unitId ENTITY_NONE) en omscholing per bewoner (unitId = de bewoner,
 * buildingId = de werkplaats waar hij staat, ENTITY_NONE zolang hij onderweg is; 0 promille onderweg en zolang hij op
 * scrap wacht). Oplopend op buildingId, dan unitId.
 */
export function queueOf(sim: Sim, playerId: number): QueueItem[] {
  const w = sim.world;
  const out: QueueItem[] = [];
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] !== 1 || w.owner[i] !== playerId || w.research[i] === 0 || !w.has(i, C.building))
      continue;
    const t = sim.config.techs[w.research[i]! - 1];
    if (t === undefined) continue;
    const total = t.researchTicks * PROGRESS_ONE;
    out.push({
      kind: 'research',
      buildingId: w.idOf(i),
      unitId: ENTITY_NONE,
      id: t.techId,
      progressPermille: permille(w.work[i]!, total),
    });
  }
  for (let i = 0; i < w.highWater; i++) {
    if (
      w.alive[i] !== 1 ||
      w.owner[i] !== playerId ||
      !w.has(i, C.unit | C.orders) ||
      w.orderType(i) !== ORDER_CRAFT
    )
      continue;
    const phase = w.phase[i]!;
    const t = sim.unitType(w.ordX[w.currentOrder(i)]!);
    if (t === undefined) continue;
    // bij de werkplaats (systeem 2 zet PHASE_WORK pas binnen interactRange): de werkplaats waar hij staat
    const at =
      phase === PHASE_WORK || phase === PHASE_CRAFT
        ? nearestOwnBuilding(sim, playerId, w.x[i]!, w.y[i]!, craftSiteMask(sim, t.typeId))
        : -1;
    const progress = phase === PHASE_CRAFT ? permille(w.work[i]!, t.craftTicks) : 0;
    out.push({
      kind: 'craft',
      buildingId: at < 0 ? ENTITY_NONE : w.idOf(at),
      unitId: w.idOf(i),
      id: t.loadoutId,
      progressPermille: progress,
    });
  }
  // data 0.16.0 (protocol 0.8.0): robotproductie en training per gebouw
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] !== 1 || w.owner[i] !== playerId || w.job[i] === 0 || !w.has(i, C.building))
      continue;
    if (w.jobKind[i] === JOB_PRODUCE) {
      const t = sim.unitType(w.job[i]!);
      if (t === undefined) continue;
      out.push({
        kind: 'produce',
        buildingId: w.idOf(i),
        unitId: ENTITY_NONE,
        id: t.loadoutId,
        progressPermille: permille(w.jobWork[i]!, t.craftTicks),
      });
    } else if (w.jobKind[i] === JOB_TRAIN) {
      const tr = sim.config.training[w.job[i]! - 1];
      if (tr === undefined) continue;
      out.push({
        kind: 'train',
        buildingId: w.idOf(i),
        unitId: ENTITY_NONE,
        id: tr.programId,
        progressPermille: permille(w.jobWork[i]!, trainTicks(sim, playerId, tr)),
      });
    }
  }
  // oplopend op buildingId, dan unitId (contract 1); bij research is unitId ENTITY_NONE en een gebouw heeft één onderzoek
  out.sort((a, b) => a.buildingId - b.buildingId || a.unitId! - b.unitId!);
  return out;
}

/** De winnaar, of null zolang het potje loopt. */
export function winnerOf(sim: Sim): SimWinner | null {
  const g = sim.globals;
  if (g.winner === NO_WINNER) return null;
  const reason: WinReason =
    g.reason === WIN_DOMINANCE
      ? 'dominance'
      : g.reason === WIN_SURRENDER
        ? 'surrender'
        : g.reason === WIN_PROJECT
          ? 'project'
          : 'destruction';
  return { playerId: g.winner, reason, frame: g.frame };
}

export function unitViewOf(sim: Sim, id: number): UnitView | null {
  const w = sim.world;
  const i = w.resolve(id);
  if (i < 0) return null;
  const m = w.mask[i]!;
  const kind: EntityKind =
    (m & C.corpse) !== 0
      ? 'corpse'
      : (m & C.building) !== 0
        ? 'building'
        : (m & C.resource) !== 0
          ? 'scrapNode'
          : (m & C.claim) !== 0
            ? 'claimPoint'
            : (m & C.hero) !== 0
              ? 'hero'
              : 'unit';
  const o = w.currentOrder(i);
  return {
    id,
    kind,
    typeId: w.typeId[i]!,
    owner: w.owner[i]!,
    x: w.x[i]!,
    y: w.y[i]!,
    yaw: w.yaw[i]!,
    hp: w.hp[i]!,
    maxHp: w.maxHp[i]!,
    moving: w.mvOn[i] === 1,
    flowField: w.flowField[i]!,
    role: w.role[i]!,
    loadoutId: w.loadoutId[i]!,
    order: o < 0 ? 0 : w.ordType[o]!,
    phase: w.phase[i]!,
    target: w.target[i]!,
    orderTarget: o < 0 ? 0 : w.ordT[o]!,
    resumeSite: w.resumeSite[i]!,
    carry: w.carry[i]!,
    buildState: w.bstate[i]!,
    progress: w.progress[i]!,
    amount: w.amount[i]!,
    claimBy: w.claimBy[i]!,
    claimProgress: w.claimProgress[i]!,
  };
}

/** a van b in promille, 0..1000 (b <= 0 telt als klaar). */
const permille = (a: number, b: number): number =>
  b <= 0 ? 1000 : clampI(idiv(a * 1000, b), 0, 1000);

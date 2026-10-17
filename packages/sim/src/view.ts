import {
  ENTITY_FLAG,
  EVENT_TYPE,
  MAX_ENTITIES,
  snapshotLayout,
  writeSnapshotHeader,
} from '@crawlout/protocol';
import type { FogMask } from '@crawlout/protocol';
import { C, indexOf } from './ecs/world.js';
import type { Sim } from './sim.js';
import { hpPctOf } from './snapshot.js';

// The snapshot of one player (fog of war, protocol 0.11.0; bevestigd in fase-0 sectie 23 besluit 1). Every client
// still simulates everything and reports the hash of the whole shared state; only what it SHOWS is filtered here, for
// the local player (the viewer), outside the sim state and the hash.
//
// Rows, in ascending id:
//  - own entities, always;
//  - map features (scrap nodes, claim points), always: their place is map knowledge, like the terrain, and who holds a
//    claim point is public through the dominance on the HUD (PlayerStatus.claimPoints);
//  - entities of others (units, buildings, corpses, later creeps) that the viewer sees now (World.visTo);
//  - ghosts: an enemy building the viewer saw before but does not see now, as he last saw it, with ENTITY_FLAG.ghost.
//    The memory is per viewer and lives here, not in the sim: it is presentation, not lockstep state. A ghost goes when
//    the viewer sees a cell of its footprint again and the building is gone. After a load (resync, reload) the memory is
//    seeded from World.spotted (state): every enemy building the viewer ever saw comes back as a ghost, in its current
//    state (the only time a ghost can be newer than the last sighting; a building destroyed unseen before the reload
//    is not remembered).
// Events: kept when they concern an own entity, are public (claimTaken, resourceDepleted) or happen in a cell the
// viewer sees now. Shots from the fog show only their hit.
// The worker calls observe() after every tick (also when catching up, when it posts no snapshot) and write() for each
// snapshot it posts. Only reads the sim.

export class PlayerView {
  readonly viewer: number;
  // ghost memory per entity index (one ghost per index; a newer building at the same index replaces it once seen)
  private readonly gId = new Uint32Array(MAX_ENTITIES);
  private readonly gType = new Uint16Array(MAX_ENTITIES);
  private readonly gOwner = new Uint8Array(MAX_ENTITIES);
  private readonly gX = new Int32Array(MAX_ENTITIES);
  private readonly gY = new Int32Array(MAX_ENTITIES);
  private readonly gYaw = new Uint16Array(MAX_ENTITIES);
  private readonly gAnim = new Uint8Array(MAX_ENTITIES);
  private readonly gAnimT = new Uint16Array(MAX_ENTITIES);
  private readonly gHp = new Uint8Array(MAX_ENTITIES);
  private readonly gFx = new Int32Array(MAX_ENTITIES);
  private readonly gFy = new Int32Array(MAX_ENTITIES);
  private readonly gFw = new Uint8Array(MAX_ENTITIES);
  private readonly gFh = new Uint8Array(MAX_ENTITIES);
  // the entities at the last observe(), to keep events of an own entity that is gone by now
  private readonly prevId = new Uint32Array(MAX_ENTITIES);
  private readonly prevOwner = new Uint8Array(MAX_ENTITIES);

  constructor(viewer: number) {
    this.viewer = viewer;
  }

  /**
   * After a load: every live building of another player that the viewer ever saw (World.spotted) and does not see now
   * becomes a ghost in its current state.
   */
  seed(sim: Sim): void {
    const w = sim.world;
    const p = this.viewer;
    for (let i = 0; i < w.highWater; i++) {
      if (!this.ghostable(sim, i)) continue;
      if (((w.spotted[i]! >>> p) & 1) !== 0) this.remember(sim, i);
    }
    this.observe(sim);
  }

  /** Updates the ghost memory from the current state (after every tick). */
  observe(sim: Sim): void {
    const w = sim.world;
    const v = sim.vision;
    const p = this.viewer;
    for (let i = 0; i < w.highWater; i++) {
      const live = w.alive[i] === 1;
      if (live) {
        this.prevId[i] = w.idOf(i);
        this.prevOwner[i] = w.owner[i]!;
      }
      if (live && this.ghostable(sim, i) && ((w.visTo[i]! >>> p) & 1) !== 0) {
        this.remember(sim, i);
        continue;
      }
      const g = this.gId[i]!;
      if (g === 0) continue;
      // the remembered building still stands (unseen): keep the ghost
      if (live && w.idOf(i) === g) continue;
      // gone or replaced: forget it once the viewer sees its spot again
      if (v.visibleRect(p, this.gFx[i]!, this.gFy[i]!, this.gFw[i]!, this.gFh[i]!)) this.gId[i] = 0;
    }
  }

  /** The snapshot for the viewer (contract 1 layout) as a new transferable buffer; observe() first. */
  write(sim: Sim): ArrayBuffer {
    this.observe(sim);
    const w = sim.world;
    // rows: per index the live entity and/or a ghost, ascending id (a ghost of an older generation has a smaller id
    // than a newer entity at the same index, unless the generation wrapped)
    const rowIndex: number[] = [];
    const rowGhost: boolean[] = [];
    for (let i = 0; i < w.highWater; i++) {
      const live = w.alive[i] === 1 && this.shows(sim, i);
      const g = this.gId[i]!;
      const ghost = g !== 0 && !(w.alive[i] === 1 && w.idOf(i) === g && live);
      if (live && ghost && g > w.idOf(i)) {
        rowIndex.push(i);
        rowGhost.push(false);
        rowIndex.push(i);
        rowGhost.push(true);
        continue;
      }
      if (ghost) {
        rowIndex.push(i);
        rowGhost.push(true);
      }
      if (live) {
        rowIndex.push(i);
        rowGhost.push(false);
      }
    }
    // events
    const ev = sim.events;
    const keep: number[] = [];
    for (let k = 0; k < ev.count; k++) if (this.eventShown(sim, k)) keep.push(k);

    const count = rowIndex.length;
    const evCount = keep.length;
    const layout = snapshotLayout(count, evCount);
    const buf = new ArrayBuffer(layout.totalBytes);
    const tick = sim.frame > 0 ? sim.frame - 1 : 0;
    writeSnapshotHeader(buf, { tick, hash: sim.hash(), entityCount: count, eventCount: evCount });
    const e = layout.entity;
    const id = new Uint32Array(buf, e.id, count);
    const x = new Int32Array(buf, e.x, count);
    const y = new Int32Array(buf, e.y, count);
    const typeId = new Uint16Array(buf, e.typeId, count);
    const yaw = new Uint16Array(buf, e.yaw, count);
    const animT = new Uint16Array(buf, e.animT, count);
    const owner = new Uint8Array(buf, e.owner, count);
    const anim = new Uint8Array(buf, e.anim, count);
    const hpPct = new Uint8Array(buf, e.hpPct, count);
    const flags = new Uint8Array(buf, e.flags, count);
    for (let k = 0; k < count; k++) {
      const i = rowIndex[k]!;
      if (rowGhost[k]) {
        id[k] = this.gId[i]!;
        x[k] = this.gX[i]!;
        y[k] = this.gY[i]!;
        typeId[k] = this.gType[i]!;
        yaw[k] = this.gYaw[i]!;
        animT[k] = this.gAnimT[i]!;
        owner[k] = this.gOwner[i]!;
        anim[k] = this.gAnim[i]!;
        hpPct[k] = this.gHp[i]!;
        flags[k] = ENTITY_FLAG.ghost;
        continue;
      }
      id[k] = w.idOf(i);
      x[k] = w.x[i]!;
      y[k] = w.y[i]!;
      typeId[k] = w.typeId[i]!;
      yaw[k] = w.yaw[i]!;
      animT[k] = w.animT[i]!;
      owner[k] = w.owner[i]!;
      anim[k] = w.anim[i]!;
      hpPct[k] = hpPctOf(w, i);
      flags[k] = w.flags[i]!;
    }
    const v = layout.event;
    const type = new Uint8Array(buf, v.type, evCount);
    const a = new Uint32Array(buf, v.a, evCount);
    const b = new Uint32Array(buf, v.b, evCount);
    const ex = new Int32Array(buf, v.x, evCount);
    const ey = new Int32Array(buf, v.y, evCount);
    for (let n = 0; n < evCount; n++) {
      const k = keep[n]!;
      type[n] = ev.type[k]!;
      a[n] = ev.a[k]!;
      b[n] = ev.b[k]!;
      ex[n] = ev.x[k]!;
      ey[n] = ev.y[k]!;
    }
    return buf;
  }

  /** The fog of the viewer on the vision grid (protocol FogMask), as new buffers. */
  fogMask(sim: Sim): FogMask {
    return sim.fogMask(this.viewer);
  }

  /** Whether the live entity at i is shown to the viewer now. */
  private shows(sim: Sim, i: number): boolean {
    const w = sim.world;
    const m = w.mask[i]!;
    if ((m & (C.resource | C.claim)) !== 0) return true;
    return ((w.visTo[i]! >>> this.viewer) & 1) !== 0;
  }

  /** A building of another player (a ghost when out of sight). */
  private ghostable(sim: Sim, i: number): boolean {
    const w = sim.world;
    return w.alive[i] === 1 && (w.mask[i]! & C.building) !== 0 && w.owner[i] !== this.viewer;
  }

  private remember(sim: Sim, i: number): void {
    const w = sim.world;
    this.gId[i] = w.idOf(i);
    this.gType[i] = w.typeId[i]!;
    this.gOwner[i] = w.owner[i]!;
    this.gX[i] = w.x[i]!;
    this.gY[i] = w.y[i]!;
    this.gYaw[i] = w.yaw[i]!;
    this.gAnim[i] = w.anim[i]!;
    this.gAnimT[i] = w.animT[i]!;
    this.gHp[i] = hpPctOf(w, i);
    this.gFx[i] = w.fx[i]!;
    this.gFy[i] = w.fy[i]!;
    this.gFw[i] = w.fw[i]!;
    this.gFh[i] = w.fh[i]!;
  }

  private eventShown(sim: Sim, k: number): boolean {
    const ev = sim.events;
    const t = ev.type[k]!;
    if (t === EVENT_TYPE.claimTaken || t === EVENT_TYPE.resourceDepleted) return true;
    const w = sim.world;
    const a = ev.a[k]!;
    const i = indexOf(a);
    if (i < MAX_ENTITIES) {
      if (w.resolve(a) === i && w.owner[i] === this.viewer) return true;
      if (this.prevId[i] === a && this.prevOwner[i] === this.viewer) return true;
    }
    return sim.vision.visibleAt(this.viewer, ev.x[k]!, ev.y[k]!);
  }
}

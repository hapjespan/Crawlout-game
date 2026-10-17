// Fake snapshot source for the render demo and tests: units wandering over the map, no sim involved.
// Output follows contract 1 exactly (snapshotLayout); positions in sim units, yaw 0..65535, animT 0..65535.
// Yaw convention (protocol, YAW_PLUS_X / YAW_PLUS_Y): 0 faces sim +x, increasing towards sim +y,
// so a direction (dx, dy) has yaw atan2(dy, dx).
// Optionally adds buildings, scrap nodes and claim points (typeIds per entities/typeIds.ts), and with `combat`
// the events the VFX read: shots with targets and hits, deaths and respawns, buildings being (re)built, claims flipping.
// With `heroes` the first unit of every player is a hero (typeId 1000 + heroId) that casts an ability zone now and
// then; with `turrets` the finished buildings of those typeIds shoot at enemy units in range.
import { heroTypeId } from '@crawlout/data';
import {
  ANGLE_FULL,
  ANIM,
  ENTITY_FLAG,
  EVENT_TYPE,
  TICK_MS,
  UNITS_PER_METER,
} from '@crawlout/protocol';
import type { Footprint } from '../entities/footprint.js';
import { buildingTypeId, TYPE_ID_CLAIM, TYPE_ID_SCRAP_NODE } from '../entities/typeIds.js';
import { CLIPS } from '../units/rig.js';
import { allocSnapshot, type EventRecord } from './snapshotWriter.js';

export interface FakeSnapshotOptions {
  /** Number of units. Default 200. */
  count?: number;
  /** Owners 0..players-1. Default 4. */
  players?: number;
  /** World edge length in meters. Default 128 (slice map Rustbelt). */
  worldSize?: number;
  seed?: number;
  /** Buildings spread over the team quadrants. Default 0. */
  buildings?: number;
  /** Building ids to cycle through (typeId 1024 + id). Default 8. */
  buildingTypes?: number;
  /** Footprint per building typeId. Default 3x3. */
  footprint?: (typeId: number) => Footprint | null;
  /** Neutral scrap nodes. Default 0. */
  scrapNodes?: number;
  /** Claim points; some start neutral. Default 0. */
  claims?: number;
  /** Targeted shots with hits, deaths and respawns, building and claim events. Default false: only shotFired. */
  combat?: boolean;
  /** The first unit of each player is this hero (typeId 1000 + heroId); with combat it casts abilityZone (ability 0). */
  heroId?: number;
  /**
   * Unit typeIds the regular units (not the heroes) cycle through, in index order, instead of all being
   * FAKE_UNIT_TYPE_ID: a mix of robots for the rigid-unit demo, say.
   */
  unitTypes?: readonly number[];
  /**
   * Keeps every unit in this clip, walking or running between random points, or standing still in an action clip
   * (screenshots and measurements of one animation). Default: the usual mix of walking, working and fighting.
   */
  hold?: 'walk' | 'run' | 'idle' | 'attack1' | 'attack2';
  /** Building typeIds that shoot (turrets), with combat: shotFired a = building, b = target, then a hit. */
  turrets?: readonly number[];
}

export const FAKE_UNIT_TYPE_ID = 1;
/** Owner of unowned scrap nodes and claim points in the fake source (anything at or above MAX_PLAYERS is neutral). */
export const FAKE_NEUTRAL_OWNER = 255;
const WALK_UNITS_PER_TICK = Math.round((1.5 * UNITS_PER_METER * TICK_MS) / 1000);
const RUN_UNITS_PER_TICK = Math.round((4.2 * UNITS_PER_METER * TICK_MS) / 1000);
const TICKS_PER_SECOND = 1000 / TICK_MS;
const SHOT_RANGE = 25 * UNITS_PER_METER;
/** Fake turret range and rate: generous, so the demo shows turret fire across the team quadrants. */
const TURRET_RANGE = 40 * UNITS_PER_METER;
export const FAKE_TURRET_TICKS = 24;
/** Ticks between two ability zones (the heroes take turns), and how far ahead of the hero the zone lands. */
export const FAKE_ZONE_TICKS = 140;
const ZONE_AHEAD = 6 * UNITS_PER_METER;

type Mode = 'walk' | 'run' | 'idle' | 'gather' | 'build' | 'attack1' | 'attack2' | 'dead';

/** What a unit does on arrival: cumulative probability thresholds, the remainder is attack2. */
const ARRIVAL_ACTIVITIES: readonly { upTo: number; mode: Mode }[] = [
  { upTo: 0.5, mode: 'walk' },
  { upTo: 0.65, mode: 'idle' },
  { upTo: 0.77, mode: 'gather' },
  { upTo: 0.87, mode: 'build' },
  { upTo: 0.94, mode: 'attack1' },
];

/** A static entity: building, scrap node or claim point. */
export interface FakeStructure {
  id: number;
  typeId: number;
  owner: number;
  x: number;
  y: number;
  footprint: Footprint;
  /** Building site: tick construction started and ticks it takes (anim build, animT = progress, contract 1). */
  site?: { start: number; ticks: number } | undefined;
  /** Scrap node: remaining stock in percent (hpPct, contract 1). */
  stock?: number;
}

/** Ticks a fake building site takes, long enough to watch it grow. */
export const FAKE_BUILD_TICKS = 8 * (1000 / TICK_MS);

export class FakeSnapshotSource {
  tick = 0;
  readonly count: number;
  readonly ids: Uint32Array;
  readonly structures: FakeStructure[] = [];
  private readonly x: Int32Array;
  private readonly y: Int32Array;
  private readonly tx: Int32Array;
  private readonly ty: Int32Array;
  private readonly yaw: Uint16Array;
  private readonly owner: Uint8Array;
  private readonly anim: Uint8Array;
  private readonly animT: Float64Array; // fraction 0..1, float so slow clips don't stall on rounding
  private readonly timer: Int32Array; // ticks left in a stationary activity
  private readonly mode: Mode[];
  private readonly selected = new Set<number>();
  private readonly size: number;
  private readonly players: number;
  private readonly combat: boolean;
  private readonly typeIds: Uint16Array;
  private readonly turrets: ReadonlySet<number>;
  private nextZoneHero = 0;
  private readonly pending: { atTick: number; event: EventRecord }[] = [];
  private readonly demolished: { atTick: number; structure: FakeStructure }[] = [];
  private nextStructureId = 0;
  private rng: number;
  private readonly hold: Mode | null;

  constructor(opts: FakeSnapshotOptions = {}) {
    const n = (this.count = opts.count ?? 200);
    const players = (this.players = opts.players ?? 4);
    this.combat = opts.combat ?? false;
    this.hold = opts.hold ?? null;
    this.turrets = new Set(opts.turrets ?? []);
    const heroType = opts.heroId === undefined ? FAKE_UNIT_TYPE_ID : heroTypeId(opts.heroId);
    const unitTypes = opts.unitTypes?.length ? opts.unitTypes : [FAKE_UNIT_TYPE_ID];
    this.typeIds = new Uint16Array(n).map((_, i) =>
      i < players ? heroType : unitTypes[(i - players) % unitTypes.length]!,
    );
    this.size = Math.round((opts.worldSize ?? 128) * UNITS_PER_METER);
    this.rng = (opts.seed ?? 0x2f6b3a1d) >>> 0 || 1;
    this.ids = new Uint32Array(n);
    this.x = new Int32Array(n);
    this.y = new Int32Array(n);
    this.tx = new Int32Array(n);
    this.ty = new Int32Array(n);
    this.yaw = new Uint16Array(n);
    this.owner = new Uint8Array(n);
    this.anim = new Uint8Array(n);
    this.animT = new Float64Array(n);
    this.timer = new Int32Array(n);
    this.mode = new Array<Mode>(n).fill('walk');
    for (let i = 0; i < n; i++) {
      this.ids[i] = i + 1;
      this.owner[i] = i % players;
      this.placeInQuadrant(i);
      this.startLeg(i);
      this.animT[i] = this.rand(); // desync the gaits
    }
    this.nextStructureId = n + 1;
    this.placeStructures(opts);
  }

  private rand(): number {
    let s = this.rng;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.rng = s >>> 0;
    return this.rng / 4294967296;
  }

  private randInt(min: number, max: number): number {
    return min + Math.floor(this.rand() * (max - min));
  }

  /** Each team lives in its own quadrant so team colors read as groups. */
  private placeInQuadrant(i: number): void {
    const team = this.owner[i]! % 4;
    const half = this.size >> 1;
    this.x[i] = (team & 1) * half + this.randInt(half >> 3, half - (half >> 3));
    this.y[i] = ((team >> 1) & 1) * half + this.randInt(half >> 3, half - (half >> 3));
  }

  private placeStructures(opts: FakeSnapshotOptions): void {
    const M = UNITS_PER_METER;
    const half = this.size >> 1;
    const fits = (x: number, y: number, f: Footprint): boolean => this.fits(x, y, f, 2);
    const place = (
      typeId: number,
      owner: number,
      f: Footprint,
      x0: number,
      y0: number,
      span: number,
    ): void => {
      for (let attempt = 0; attempt < 80; attempt++) {
        // Odd footprints center on a cell, even ones on a cell corner.
        const cx = Math.floor((x0 + this.rand() * span) / M) * M + (f.w % 2) * (M / 2);
        const cy = Math.floor((y0 + this.rand() * span) / M) * M + (f.h % 2) * (M / 2);
        if (!fits(cx, cy, f)) continue;
        const s: FakeStructure = {
          id: this.nextStructureId++,
          typeId,
          owner,
          x: cx,
          y: cy,
          footprint: f,
        };
        if (typeId === TYPE_ID_SCRAP_NODE) s.stock = 40 + this.randInt(0, 61);
        this.structures.push(s);
        return;
      }
    };
    const types = Math.max(1, opts.buildingTypes ?? 8);
    for (let k = 0; k < (opts.buildings ?? 0); k++) {
      const typeId = buildingTypeId(k % types);
      const found = opts.footprint?.(typeId);
      const f = found && found.w > 0 && found.h > 0 ? found : { w: 3, h: 3 };
      const team = k % this.players;
      place(typeId, team, f, (team & 1) * half, ((team >> 1) & 1) * half, half);
    }
    for (let k = 0; k < (opts.scrapNodes ?? 0); k++)
      place(TYPE_ID_SCRAP_NODE, FAKE_NEUTRAL_OWNER, { w: 3, h: 3 }, 0, 0, this.size);
    for (let k = 0; k < (opts.claims ?? 0); k++) {
      place(
        TYPE_ID_CLAIM,
        k % 2 === 0 ? FAKE_NEUTRAL_OWNER : k % this.players,
        { w: 5, h: 5 },
        0,
        0,
        this.size,
      );
    }
  }

  /** True when footprint f centered at (x, y) stays inside the world and `gap` meters away from every structure. */
  fits(x: number, y: number, f: Footprint, gap = 0): boolean {
    const M = UNITS_PER_METER;
    const hx = (f.w * M) / 2 + gap * M;
    const hy = (f.h * M) / 2 + gap * M;
    if (x - hx < 0 || y - hy < 0 || x + hx > this.size || y + hy > this.size) return false;
    const g2 = 2 * gap * M;
    return this.structures.every(
      (s) =>
        Math.abs(s.x - x) * 2 >= (f.w + s.footprint.w) * M + g2 ||
        Math.abs(s.y - y) * 2 >= (f.h + s.footprint.h) * M + g2,
    );
  }

  /** Turns a building into a site: buildingPlaced next tick, anim build while it grows, buildingDone when finished. */
  private startSite(s: FakeStructure): void {
    s.site = { start: this.tick + 1, ticks: FAKE_BUILD_TICKS };
    this.pending.push({
      atTick: this.tick + 1,
      event: { type: EVENT_TYPE.buildingPlaced, a: s.id, b: s.typeId, x: s.x, y: s.y },
    });
  }

  /** Mirrors a Build command: adds a building site and reports buildingPlaced, later buildingDone. */
  placeBuilding(typeId: number, owner: number, x: number, y: number, f: Footprint): boolean {
    if (!this.fits(x, y, f)) return false;
    const id = this.nextStructureId++;
    const s: FakeStructure = { id, typeId, owner, x, y, footprint: { w: f.w, h: f.h } };
    this.structures.push(s);
    this.startSite(s);
    return true;
  }

  private startLeg(i: number, tx?: number, ty?: number): void {
    const margin = 4 * UNITS_PER_METER;
    const r = 24 * UNITS_PER_METER;
    this.tx[i] =
      tx ?? Math.min(this.size - margin, Math.max(margin, this.x[i]! + this.randInt(-r, r)));
    this.ty[i] =
      ty ?? Math.min(this.size - margin, Math.max(margin, this.y[i]! + this.randInt(-r, r)));
    this.mode[i] = this.rand() < 0.2 ? 'run' : 'walk';
    this.setAnim(i, this.mode[i] === 'run' ? ANIM.run : ANIM.walk);
    if (this.hold) this.applyHold(i);
  }

  /** The `hold` option: the unit keeps the clip; an action clip stands still for good. */
  private applyHold(i: number): void {
    const hold = this.hold!;
    this.mode[i] = hold;
    this.setAnim(i, ANIM[hold as Exclude<Mode, 'dead'>]);
    if (hold !== 'walk' && hold !== 'run') this.timer[i] = 0x3fffffff;
  }

  private setAnim(i: number, clip: number): void {
    if (this.anim[i] !== clip) this.animT[i] = 0;
    this.anim[i] = clip;
  }

  private arrive(i: number): void {
    const r = this.rand();
    const pick = ARRIVAL_ACTIVITIES.find((a) => r < a.upTo)?.mode ?? 'attack2';
    if (pick === 'walk') {
      this.startLeg(i);
      return;
    }
    this.mode[i] = pick;
    this.timer[i] = this.randInt(1 * TICKS_PER_SECOND, 4 * TICKS_PER_SECOND);
    this.setAnim(i, ANIM[pick as Exclude<Mode, 'dead'>]);
  }

  /** Mirrors a selection command: the sim would set the selected flag on these ids. */
  setSelected(ids: Iterable<number>): void {
    this.selected.clear();
    for (const id of ids) this.selected.add(id);
  }

  /** Mirrors a move command: send the given ids towards (x, y) in sim units. */
  moveTo(ids: Iterable<number>, x: number, y: number): void {
    const want = new Set(ids);
    let k = 0;
    for (let i = 0; i < this.count; i++) {
      if (!want.has(this.ids[i]!) || this.mode[i] === 'dead') continue;
      // Spread the group on a small spiral so they don't stack on one point.
      const a = k * 2.4;
      const rr = Math.sqrt(k) * 0.9 * UNITS_PER_METER;
      this.startLeg(i, Math.round(x + Math.cos(a) * rr), Math.round(y + Math.sin(a) * rr));
      this.mode[i] = 'run';
      this.setAnim(i, ANIM.run);
      k++;
    }
  }

  private face(i: number, dx: number, dy: number): void {
    const a = Math.round((Math.atan2(dy, dx) / (Math.PI * 2)) * ANGLE_FULL);
    this.yaw[i] = ((a % ANGLE_FULL) + ANGLE_FULL) % ANGLE_FULL;
  }

  /** Unit typeId of unit index i: the hero typeId for the first unit of each player when heroes are on. */
  typeIdOf(i: number): number {
    return this.typeIds[i] ?? FAKE_UNIT_TYPE_ID;
  }

  /** Nearest living unit of another owner within shot range, or -1. */
  private targetFor(i: number): number {
    return this.nearestEnemy(this.x[i]!, this.y[i]!, this.owner[i]!, SHOT_RANGE);
  }

  /** Nearest living unit not owned by `owner` within `range` (sim units) of (x, y), or -1. */
  private nearestEnemy(x: number, y: number, owner: number, range: number): number {
    let best = -1;
    let bestD = range * range;
    for (let j = 0; j < this.count; j++) {
      if (this.owner[j] === owner || this.mode[j] === 'dead') continue;
      const dx = this.x[j]! - x;
      const dy = this.y[j]! - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    return best;
  }

  private shoot(i: number, events: EventRecord[]): void {
    const id = this.ids[i]!;
    if (!this.combat) {
      events.push({ type: EVENT_TYPE.shotFired, a: id, b: 0, x: this.x[i]!, y: this.y[i]! });
      return;
    }
    const j = this.targetFor(i);
    if (j < 0) {
      events.push({ type: EVENT_TYPE.shotFired, a: id, b: 0, x: this.x[i]!, y: this.y[i]! });
      return;
    }
    this.face(i, this.x[j]! - this.x[i]!, this.y[j]! - this.y[i]!);
    events.push({
      type: EVENT_TYPE.shotFired,
      a: id,
      b: this.ids[j]!,
      x: this.x[i]!,
      y: this.y[i]!,
    });
    // The hit lands two ticks later, the way a sim with travel time would report it.
    if (this.rand() < 0.75)
      this.pending.push({
        atTick: this.tick + 2,
        event: { type: EVENT_TYPE.hit, a: this.ids[j]!, b: id, x: this.x[j]!, y: this.y[j]! },
      });
  }

  private kill(i: number, events: EventRecord[]): void {
    this.mode[i] = 'dead';
    this.setAnim(i, ANIM.death);
    this.timer[i] = 4 * TICKS_PER_SECOND;
    events.push({
      type: EVENT_TYPE.death,
      a: this.ids[i]!,
      b: this.typeIdOf(i),
      x: this.x[i]!,
      y: this.y[i]!,
    });
  }

  private respawn(i: number, events: EventRecord[]): void {
    this.placeInQuadrant(i);
    this.startLeg(i);
    events.push({
      type: EVENT_TYPE.spawn,
      a: this.ids[i]!,
      b: this.typeIdOf(i),
      x: this.x[i]!,
      y: this.y[i]!,
    });
  }

  /** Finished turrets fire at the nearest enemy unit in range; the hit follows a tick later. */
  private turretFire(events: EventRecord[]): void {
    if (this.turrets.size === 0) return;
    for (const s of this.structures) {
      if (!this.turrets.has(s.typeId) || s.site || (this.tick + s.id) % FAKE_TURRET_TICKS !== 0)
        continue;
      const j = this.nearestEnemy(s.x, s.y, s.owner, TURRET_RANGE);
      if (j < 0) continue;
      const target = this.ids[j]!;
      events.push({ type: EVENT_TYPE.shotFired, a: s.id, b: target, x: s.x, y: s.y });
      if (this.rand() < 0.8)
        this.pending.push({
          atTick: this.tick + 1,
          event: { type: EVENT_TYPE.hit, a: target, b: s.id, x: this.x[j]!, y: this.y[j]! },
        });
    }
  }

  /** Every FAKE_ZONE_TICKS the next living hero casts ability 0 a few meters ahead of itself (x, y = zone center). */
  private heroZones(events: EventRecord[]): void {
    if (this.tick % FAKE_ZONE_TICKS !== 0) return;
    const heroes = Math.min(this.players, this.count);
    for (let k = 0; k < heroes; k++) {
      const i = (this.nextZoneHero + k) % heroes;
      if (this.typeIds[i] === FAKE_UNIT_TYPE_ID || this.mode[i] === 'dead') continue;
      this.nextZoneHero = i + 1;
      const a = (this.yaw[i]! / ANGLE_FULL) * Math.PI * 2;
      const margin = 2 * UNITS_PER_METER;
      const clamp = (v: number): number =>
        Math.min(this.size - margin, Math.max(margin, Math.round(v)));
      const x = clamp(this.x[i]! + Math.cos(a) * ZONE_AHEAD);
      const y = clamp(this.y[i]! + Math.sin(a) * ZONE_AHEAD);
      events.push({ type: EVENT_TYPE.abilityZone, a: this.ids[i]!, b: 0, x, y });
      return;
    }
  }

  /** Building and claim events at a slow cadence, so every effect shows up within a few seconds. */
  private worldEvents(events: EventRecord[]): void {
    if (this.tick % 20 === 0 && this.count > 0) {
      const i = this.randInt(0, this.count);
      if (this.mode[i] !== 'dead') this.kill(i, events);
    }
    const buildings = this.structures.filter((s) => s.typeId < TYPE_ID_SCRAP_NODE);
    if (this.tick % 50 === 0 && buildings.length > 0) {
      // Every other time a building is demolished (death with b = typeId, gone from the snapshot) and rebuilt from
      // scratch on the same spot two seconds later; otherwise it is rebuilt in place.
      const s = buildings[this.randInt(0, buildings.length)]!;
      if (s.site) {
        // already a site: leave it be
      } else if (this.rand() < 0.5) {
        events.push({ type: EVENT_TYPE.death, a: s.id, b: s.typeId, x: s.x, y: s.y });
        this.structures.splice(this.structures.indexOf(s), 1);
        this.demolished.push({ atTick: this.tick + 40, structure: s });
      } else {
        this.startSite(s);
      }
    }
    for (let k = this.demolished.length - 1; k >= 0; k--) {
      const d = this.demolished[k]!;
      if (d.atTick > this.tick) continue;
      this.demolished.splice(k, 1);
      if (!this.fits(d.structure.x, d.structure.y, d.structure.footprint)) continue;
      // The sim hands out a fresh id for a new building.
      const s = { ...d.structure, id: this.nextStructureId++ };
      this.structures.push(s);
      this.startSite(s);
    }
    const claims = this.structures.filter((s) => s.typeId === TYPE_ID_CLAIM);
    if (this.tick % 200 === 0 && claims.length > 0) {
      const s = claims[this.randInt(0, claims.length)]!;
      s.owner = s.owner >= this.players ? this.randInt(0, this.players) : FAKE_NEUTRAL_OWNER;
      events.push({ type: EVENT_TYPE.claimTaken, a: s.id, b: s.owner, x: s.x, y: s.y });
    }
  }

  /** Finishes building sites and lets gatherers pick scrap nodes clean (they refill after resourceDepleted). */
  private advanceStructures(events: EventRecord[]): void {
    for (const s of this.structures) {
      if (s.site && this.tick >= s.site.start + s.site.ticks) {
        s.site = undefined;
        events.push({ type: EVENT_TYPE.buildingDone, a: s.id, b: s.typeId, x: s.x, y: s.y });
      }
      if (s.stock !== undefined && this.tick % 10 === s.id % 10) {
        s.stock -= 1;
        if (s.stock <= 0) {
          events.push({ type: EVENT_TYPE.resourceDepleted, a: s.id, b: 0, x: s.x, y: s.y });
          s.stock = 100;
        }
      }
    }
  }

  /** Advances one tick and returns the snapshot for it. */
  next(): ArrayBuffer {
    this.tick++;
    const n = this.count;
    const events: EventRecord[] = [];
    for (let i = 0; i < n; i++) {
      const mode = this.mode[i]!;
      const clip = CLIPS[this.anim[i]!]!;
      const before = this.animT[i]!;
      let t = before + 1 / (clip.duration * TICKS_PER_SECOND);
      if (t >= 1) t = clip.loop ? t - 1 : 1;
      this.animT[i] = t;
      if (mode === 'attack2' && t < before) this.shoot(i, events);

      if (mode === 'walk' || mode === 'run') {
        const dx = this.tx[i]! - this.x[i]!;
        const dy = this.ty[i]! - this.y[i]!;
        const dist = Math.hypot(dx, dy);
        const speed = mode === 'run' ? RUN_UNITS_PER_TICK : WALK_UNITS_PER_TICK;
        if (dist <= speed) {
          this.x[i] = this.tx[i]!;
          this.y[i] = this.ty[i]!;
          this.arrive(i);
        } else {
          this.x[i] = this.x[i]! + Math.round((dx / dist) * speed);
          this.y[i] = this.y[i]! + Math.round((dy / dist) * speed);
          this.face(i, dx, dy);
        }
      } else {
        this.timer[i] = this.timer[i]! - 1;
        if (this.timer[i]! <= 0) {
          if (mode === 'dead') this.respawn(i, events);
          else this.startLeg(i);
        }
      }
    }
    if (this.combat) {
      this.worldEvents(events);
      this.turretFire(events);
      this.heroZones(events);
    }
    this.advanceStructures(events);
    for (let k = this.pending.length - 1; k >= 0; k--) {
      if (this.pending[k]!.atTick > this.tick) continue;
      events.push(this.pending[k]!.event);
      this.pending.splice(k, 1);
    }

    const structures = this.structures;
    const total = n + structures.length;
    const snap = allocSnapshot(
      this.tick,
      Math.imul(this.tick, 2654435761) >>> 0,
      total,
      events.length,
    );
    const e = snap.entities;
    for (let i = 0; i < n; i++) {
      const id = this.ids[i]!;
      e.id[i] = id;
      e.x[i] = this.x[i]!;
      e.y[i] = this.y[i]!;
      e.typeId[i] = this.typeIdOf(i);
      e.yaw[i] = this.yaw[i]!;
      e.animT[i] = Math.min(ANGLE_FULL - 1, Math.floor(this.animT[i]! * ANGLE_FULL));
      e.owner[i] = this.owner[i]!;
      e.anim[i] = this.anim[i]!;
      const dead = this.mode[i] === 'dead';
      e.hpPct[i] = dead ? 0 : 100;
      const isFighting = this.mode[i] === 'attack1' || this.mode[i] === 'attack2';
      e.flags[i] =
        (this.selected.has(id) ? ENTITY_FLAG.selected : 0) |
        (isFighting ? ENTITY_FLAG.inCombat : 0) |
        (dead ? ENTITY_FLAG.dead : 0);
    }
    structures.forEach((s, k) => {
      const i = n + k;
      e.id[i] = s.id;
      e.x[i] = s.x;
      e.y[i] = s.y;
      e.typeId[i] = s.typeId;
      e.owner[i] = s.owner;
      const site = s.site;
      const progress = site ? Math.max(0, this.tick - site.start) / site.ticks : 0;
      e.anim[i] = site ? ANIM.build : ANIM.idle;
      e.animT[i] = site ? Math.min(ANGLE_FULL - 1, Math.floor(progress * ANGLE_FULL)) : 0;
      e.hpPct[i] = s.stock ?? 100;
      e.flags[i] = this.selected.has(s.id) ? ENTITY_FLAG.selected : 0;
    });
    events.forEach((r, k) => {
      snap.events.type[k] = r.type;
      snap.events.a[k] = r.a ?? 0;
      snap.events.b[k] = r.b ?? 0;
      snap.events.x[k] = r.x ?? 0;
      snap.events.y[k] = r.y ?? 0;
    });
    return snap.buffer;
  }
}

// Fake snapshot source for the render demo and tests: units wandering over the map, no sim involved.
// Output follows contract 1 exactly (snapshotLayout); positions in sim units, yaw 0..65535, animT 0..65535.
// Yaw convention (protocol, YAW_PLUS_X / YAW_PLUS_Y): 0 faces sim +x, increasing towards sim +y,
// so a direction (dx, dy) has yaw atan2(dy, dx).
// Optionally adds buildings, scrap nodes and claim points (typeIds per entities/typeIds.ts), and with `combat`
// the events the VFX read: shots with targets and hits, deaths and respawns, buildings being (re)built, claims flipping.
// With `heroes` the first unit of every player is a hero (typeId 1000 + heroId) that casts an ability zone now and
// then; with `turrets` the finished buildings of those typeIds shoot at enemy units in range.
import { heroTypeId } from '@crawlout/data';
import { ANGLE_FULL, ANIM, EVENT_TYPE, UNITS_PER_METER } from '@crawlout/protocol';
import type { Footprint } from '../entities/footprint.js';
import { fakeNext } from './fakeSnapshots.next.js';
import {
  ARRIVAL_ACTIVITIES,
  FAKE_BUILD_TICKS,
  FAKE_UNIT_TYPE_ID,
  SHOT_RANGE,
  TICKS_PER_SECOND,
  type FakeSnapshotOptions,
  type FakeSourceInternals,
  type FakeStructure,
  type Mode,
} from './fakeSnapshots.shared.js';
import {
  fakeAdvanceStructures,
  fakeHeroZones,
  fakePlaceStructures,
  fakeTurretFire,
  fakeWorldEvents,
} from './fakeSnapshots.world.js';
import type { EventRecord } from './snapshotWriter.js';

export {
  FAKE_BUILD_TICKS,
  FAKE_NEUTRAL_OWNER,
  FAKE_TURRET_TICKS,
  FAKE_UNIT_TYPE_ID,
  FAKE_ZONE_TICKS,
  type FakeSnapshotOptions,
  type FakeStructure,
} from './fakeSnapshots.shared.js';

/** The sibling modules see the source through its internal view (fields and private helpers). */
const internals = (src: FakeSnapshotSource): FakeSourceInternals =>
  src as unknown as FakeSourceInternals;

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
    fakePlaceStructures(internals(this), opts);
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
    fakeTurretFire(internals(this), events);
  }

  /** Every FAKE_ZONE_TICKS the next living hero casts ability 0 a few meters ahead of itself (x, y = zone center). */
  private heroZones(events: EventRecord[]): void {
    fakeHeroZones(internals(this), events);
  }

  /** Building and claim events at a slow cadence, so every effect shows up within a few seconds. */
  private worldEvents(events: EventRecord[]): void {
    fakeWorldEvents(internals(this), events);
  }

  /** Finishes building sites and lets gatherers pick scrap nodes clean (they refill after resourceDepleted). */
  private advanceStructures(events: EventRecord[]): void {
    fakeAdvanceStructures(internals(this), events);
  }

  /** Advances one tick and returns the snapshot for it. */
  next(): ArrayBuffer {
    return fakeNext(internals(this));
  }
}

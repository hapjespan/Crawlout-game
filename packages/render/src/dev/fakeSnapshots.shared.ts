// Options, constants and the internal view shared by FakeSnapshotSource and its sibling modules.
import { TICK_MS, UNITS_PER_METER } from '@crawlout/protocol';
import type { Footprint } from '../entities/footprint.js';
import type { EventRecord } from './snapshotWriter.js';

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
export const WALK_UNITS_PER_TICK = Math.round((1.5 * UNITS_PER_METER * TICK_MS) / 1000);
export const RUN_UNITS_PER_TICK = Math.round((4.2 * UNITS_PER_METER * TICK_MS) / 1000);
export const TICKS_PER_SECOND = 1000 / TICK_MS;
export const SHOT_RANGE = 25 * UNITS_PER_METER;
/** Fake turret range and rate: generous, so the demo shows turret fire across the team quadrants. */
export const TURRET_RANGE = 40 * UNITS_PER_METER;
export const FAKE_TURRET_TICKS = 24;
/** Ticks between two ability zones (the heroes take turns), and how far ahead of the hero the zone lands. */
export const FAKE_ZONE_TICKS = 140;
export const ZONE_AHEAD = 6 * UNITS_PER_METER;

export type Mode = 'walk' | 'run' | 'idle' | 'gather' | 'build' | 'attack1' | 'attack2' | 'dead';

/** What a unit does on arrival: cumulative probability thresholds, the remainder is attack2. */
export const ARRIVAL_ACTIVITIES: readonly { upTo: number; mode: Mode }[] = [
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

/**
 * Internal view of a FakeSnapshotSource instance: its fields and helper methods (including the private ones), as
 * seen by the sibling modules that implement groups of its methods (fakeSnapshots.world.ts, fakeSnapshots.next.ts).
 * Mirrors the members of the class one to one; only those modules use it.
 */
export interface FakeSourceInternals {
  tick: number;
  readonly count: number;
  readonly ids: Uint32Array;
  readonly structures: FakeStructure[];
  readonly x: Int32Array;
  readonly y: Int32Array;
  readonly tx: Int32Array;
  readonly ty: Int32Array;
  readonly yaw: Uint16Array;
  readonly owner: Uint8Array;
  readonly anim: Uint8Array;
  readonly animT: Float64Array;
  readonly timer: Int32Array;
  readonly mode: Mode[];
  readonly selected: Set<number>;
  readonly size: number;
  readonly players: number;
  readonly combat: boolean;
  readonly typeIds: Uint16Array;
  readonly turrets: ReadonlySet<number>;
  nextZoneHero: number;
  readonly pending: { atTick: number; event: EventRecord }[];
  readonly demolished: { atTick: number; structure: FakeStructure }[];
  nextStructureId: number;
  readonly hold: Mode | null;
  rand(): number;
  randInt(min: number, max: number): number;
  fits(x: number, y: number, f: Footprint, gap?: number): boolean;
  startSite(s: FakeStructure): void;
  startLeg(i: number, tx?: number, ty?: number): void;
  arrive(i: number): void;
  face(i: number, dx: number, dy: number): void;
  typeIdOf(i: number): number;
  nearestEnemy(x: number, y: number, owner: number, range: number): number;
  shoot(i: number, events: EventRecord[]): void;
  kill(i: number, events: EventRecord[]): void;
  respawn(i: number, events: EventRecord[]): void;
  turretFire(events: EventRecord[]): void;
  heroZones(events: EventRecord[]): void;
  worldEvents(events: EventRecord[]): void;
  advanceStructures(events: EventRecord[]): void;
}

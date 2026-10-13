// The snapshot-driven effects (render brief): muzzle flash (shotFired), impact (hit), death (death), building dust
// (buildingPlaced, buildingDone) and ability zones (abilityZone). Own GPU particles instead of NixieFX, which is not on
// npm; zones are ground decals (abilityZones.ts).
// Event fields (contract 1, decision sprint 2): type, a, b, x, y. a is always the entity the event is about, x/y its
// position in sim units at that moment. b per type: death, spawn, buildingPlaced and buildingDone b = typeId (a
// demolished building is no longer in the snapshot that carries its death); shotFired a = shooter, b = target;
// hit a = target, b = shooter. Missing positions (0, 0) fall back to the entity in the latest snapshot.
// Decision sprint 3: abilityZone a = hero, b = abilityId, x/y = the zone center (not the hero's position). A shooter
// can be a building (turrets, decision 8): its muzzle flash and tracer start on the roof.
import { heroIdOfTypeId } from '@crawlout/data';
import { EVENT_TYPE, UNITS_PER_METER } from '@crawlout/protocol';
import { buildingRoofHeight, DEFAULT_FOOTPRINT, type Footprint } from '../entities/footprint.js';
import { classifyTypeId, ENTITY_KIND } from '../entities/typeIds.js';
import { teamIndex, teamPalette } from '../palette.js';
import type { AbilityShape, ZoneSink } from './abilityZones.js';
import { createParticleSpec, PARTICLE_SHAPE, type ParticleSink, type ParticleSpec } from './particles.js';

/** An entity from the latest snapshot, in world units. */
export interface EntityRef {
  x: number;
  z: number;
  /** Render yaw, radians: forward is (sin yaw, cos yaw) in world (x, z). */
  yaw: number;
  typeId: number;
  owner: number;
}

export interface EffectContext {
  /** Fills `out` with entity `id` from the latest snapshot; false when it is not there. */
  entity(id: number, out: EntityRef): boolean;
  heightAt(x: number, z: number): number;
  footprint(typeId: number): Footprint;
  /** Zone radius and duration for (heroId, abilityId) from GameData; null or absent: no zone is drawn. */
  ability?(heroId: number, abilityId: number): AbilityShape | null;
}

const INV_UNITS = 1 / UNITS_PER_METER;
const MUZZLE_HEIGHT = 1.35;
const MUZZLE_FORWARD = 0.6; // meters in front of a unit
const ROOF_MUZZLE_LIFT = 0.15; // meters above a building's roof ridge
const ROOF_MUZZLE_FORWARD = 0.3; // meters from the roof's center towards the target
const HIT_HEIGHT = 1.0;
const BUILDING_HIT_HEIGHT = 1.6;
const UNTARGETED_RANGE = 12; // meters a tracer flies when the target is unknown
const UNTARGETED_DROP = 0.3; // meters a tracer without a target sinks over its flight

/** Linear rgb per team palette slot (teamIndex), for effects in the team color. */
const TEAM_RGB = teamPalette();

export class EffectSpawner {
  private readonly p: ParticleSpec = createParticleSpec();
  private readonly e1: EntityRef = { x: 0, z: 0, yaw: 0, typeId: 0, owner: 0 };
  private readonly e2: EntityRef = { x: 0, z: 0, yaw: 0, typeId: 0, owner: 0 };

  constructor(
    private readonly additive: ParticleSink,
    private readonly alpha: ParticleSink,
    private readonly rng: () => number = Math.random,
    private readonly zones: ZoneSink | null = null,
  ) {}

  /** Spawns the effect for one snapshot event at time t0 (seconds, renderer clock). Unhandled types are ignored. */
  handle(type: number, a: number, b: number, xUnits: number, yUnits: number, t0: number, ctx: EffectContext): void {
    const hasPos = xUnits !== 0 || yUnits !== 0;
    let x = xUnits * INV_UNITS;
    let z = yUnits * INV_UNITS;
    switch (type) {
      case EVENT_TYPE.shotFired: {
        const shooter = ctx.entity(a, this.e1);
        if (shooter) {
          x = this.e1.x;
          z = this.e1.z;
        } else if (!hasPos) return;
        let dx = Math.sin(this.e1.yaw);
        let dz = Math.cos(this.e1.yaw);
        let dist = UNTARGETED_RANGE;
        let targetY = Number.NaN;
        if (b !== 0 && ctx.entity(b, this.e2)) {
          const tx = this.e2.x - x;
          const tz = this.e2.z - z;
          const d = Math.hypot(tx, tz);
          if (d > 0.01) {
            dx = tx / d;
            dz = tz / d;
            dist = d;
          }
          const targetIsBuilding = classifyTypeId(this.e2.typeId) === ENTITY_KIND.building;
          targetY = ctx.heightAt(this.e2.x, this.e2.z) + (targetIsBuilding ? BUILDING_HIT_HEIGHT : HIT_HEIGHT);
        } else if (!shooter) {
          dx = 0;
          dz = 1;
        }
        // A building (turret) fires from its roof, a unit from its hands.
        const fromBuilding = shooter && classifyTypeId(this.e1.typeId) === ENTITY_KIND.building;
        let my: number;
        let forward: number;
        if (fromBuilding) {
          const f = ctx.footprint(this.e1.typeId);
          my = groundUnder(ctx, x, z, f) + buildingRoofHeight(f) + ROOF_MUZZLE_LIFT;
          forward = ROOF_MUZZLE_FORWARD;
        } else {
          my = ctx.heightAt(x, z) + MUZZLE_HEIGHT;
          forward = MUZZLE_FORWARD;
        }
        const drop = Number.isNaN(targetY) ? -UNTARGETED_DROP : targetY - my;
        this.muzzleFlash(x + dx * forward, my, z + dz * forward, dx, dz, Math.max(0, dist - forward), drop, t0);
        return;
      }
      case EVENT_TYPE.hit: {
        // a = target, b = shooter: the target is where the shot lands, the shooter only when the target is gone.
        const target = ctx.entity(a, this.e1);
        const found = target || (b !== 0 && ctx.entity(b, this.e1));
        if (!hasPos) {
          if (!found) return;
          x = this.e1.x;
          z = this.e1.z;
        }
        const height = target && classifyTypeId(this.e1.typeId) === ENTITY_KIND.building ? BUILDING_HIT_HEIGHT : HIT_HEIGHT;
        this.impact(x, ctx.heightAt(x, z) + height, z, t0);
        return;
      }
      case EVENT_TYPE.death: {
        const found = ctx.entity(a, this.e1);
        if (!hasPos) {
          if (!found) return;
          x = this.e1.x;
          z = this.e1.z;
        }
        // The typeId comes from b: a demolished building has already left the snapshot carrying this event.
        const typeId = b !== 0 ? b : found ? this.e1.typeId : 0;
        const footprint = classifyTypeId(typeId) === ENTITY_KIND.building ? ctx.footprint(typeId) : null;
        const size = footprint ? Math.max(footprint.w, footprint.h) : 1;
        this.death(x, ctx.heightAt(x, z), z, size, t0);
        return;
      }
      case EVENT_TYPE.buildingPlaced:
      case EVENT_TYPE.buildingDone: {
        const found = ctx.entity(a, this.e1);
        if (!hasPos) {
          if (!found) return;
          x = this.e1.x;
          z = this.e1.z;
        }
        const typeId = b !== 0 ? b : found ? this.e1.typeId : 0;
        const f = typeId !== 0 ? ctx.footprint(typeId) : DEFAULT_FOOTPRINT;
        this.buildDust(x, ctx.heightAt(x, z), z, f, t0, type === EVENT_TYPE.buildingDone);
        return;
      }
      case EVENT_TYPE.abilityZone: {
        // x, y is the zone center; radius and duration come from the hero's ability in GameData.
        if (!this.zones || !ctx.ability || !hasPos || !ctx.entity(a, this.e1)) return;
        const heroId = heroIdOfTypeId(this.e1.typeId);
        const shape = heroId >= 0 ? ctx.ability(heroId, b) : null;
        if (!shape) return;
        const team = teamIndex(this.e1.owner);
        this.zones.addZone(x, z, shape.radius, team, t0, shape.duration);
        this.zoneBurst(x, ctx.heightAt(x, z), z, shape.radius, team, t0);
        return;
      }
      default:
        return;
    }
  }

  private jitter(amount: number): number {
    return (this.rng() * 2 - 1) * amount;
  }

  /**
   * Flash at the muzzle (mx, my, mz), a few sparks, a tracer flying `dist` meters along (dx, dz) and `drop` meters
   * up or down to the target, and a wisp of smoke.
   */
  muzzleFlash(mx: number, my: number, mz: number, dx: number, dz: number, dist: number, drop: number, t0: number): void {
    const p = this.p;
    set(p, mx, my, mz, t0, 0, 0, 0, 0.08, 0.95, 0.35, 0, PARTICLE_SHAPE.disc, 1.7, 1.1, 0.45, 1);
    this.additive.emit(p);
    for (let i = 0; i < 3; i++) {
      const s = 5 + this.rng() * 4;
      set(p, mx, my, mz, t0, dx * s + this.jitter(1.5), 0.8 + this.jitter(1), dz * s + this.jitter(1.5), 0.1 + this.rng() * 0.1, 0.07, 0.04, 9.8, PARTICLE_SHAPE.streak, 1.4, 0.9, 0.35, 1);
      this.additive.emit(p);
    }
    const flight = 0.09;
    const travel = dist / flight;
    set(p, mx, my, mz, t0, dx * travel, drop / flight, dz * travel, flight, 0.07, 0.07, 0, PARTICLE_SHAPE.streak, 1.3, 1.0, 0.6, 0.9);
    this.additive.emit(p);
    set(p, mx, my, mz, t0 + 0.03, dx * 0.4, 0.7, dz * 0.4, 0.55, 0.2, 0.7, 0, PARTICLE_SHAPE.disc, 0.55, 0.53, 0.5, 0.3);
    this.alpha.emit(p);
  }

  /** Team-colored sparks rising from the rim of a fresh ability zone. */
  zoneBurst(x: number, ground: number, z: number, radius: number, team: number, t0: number): void {
    const p = this.p;
    const c = TEAM_RGB[Math.min(team, TEAM_RGB.length - 1)]!;
    const [r, g, b] = [c.x * 1.6 + 0.2, c.y * 1.6 + 0.2, c.z * 1.6 + 0.2];
    const count = Math.min(48, Math.max(12, Math.round(radius * 5)));
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + this.jitter(0.08);
      const ex = x + Math.cos(a) * radius;
      const ez = z + Math.sin(a) * radius;
      set(p, ex, ground + 0.15, ez, t0 + this.rng() * 0.15, Math.cos(a) * 0.4, 1.6 + this.rng() * 1.2, Math.sin(a) * 0.4, 0.6 + this.rng() * 0.4, 0.22, 0.06, 1.5, PARTICLE_SHAPE.streak, r, g, b, 0.9);
      this.additive.emit(p);
    }
  }

  /** Sparks and a small dust puff where a shot lands. */
  impact(x: number, y: number, z: number, t0: number): void {
    const p = this.p;
    set(p, x, y, z, t0, 0, 0, 0, 0.07, 0.7, 0.3, 0, PARTICLE_SHAPE.disc, 1.5, 0.95, 0.5, 1);
    this.additive.emit(p);
    for (let i = 0; i < 6; i++) {
      const a = this.rng() * Math.PI * 2;
      const s = 2.5 + this.rng() * 3.5;
      set(p, x, y, z, t0, Math.cos(a) * s, 1.5 + this.rng() * 3, Math.sin(a) * s, 0.22 + this.rng() * 0.2, 0.07, 0.04, 9.8, PARTICLE_SHAPE.streak, 1.3, 0.75, 0.3, 1);
      this.additive.emit(p);
    }
    for (let i = 0; i < 2; i++) {
      set(p, x + this.jitter(0.2), y - 0.2, z + this.jitter(0.2), t0, this.jitter(0.5), 0.5, this.jitter(0.5), 0.6 + this.rng() * 0.3, 0.3, 0.9, 0, PARTICLE_SHAPE.disc, 0.5, 0.44, 0.36, 0.45);
      this.alpha.emit(p);
    }
  }

  /** Dust burst and rising dark smoke; `size` in meters scales it up for buildings. */
  death(x: number, ground: number, z: number, size: number, t0: number): void {
    const p = this.p;
    const big = size > 1.5;
    const dust = big ? 18 : 7;
    for (let i = 0; i < dust; i++) {
      const a = (i / dust) * Math.PI * 2 + this.jitter(0.3);
      const r = size * 0.3 * this.rng();
      const s = (big ? 1.6 : 1.1) + this.rng();
      set(p, x + Math.cos(a) * r, ground + 0.25, z + Math.sin(a) * r, t0 + this.rng() * 0.1, Math.cos(a) * s, 0.25 + this.rng() * 0.4, Math.sin(a) * s, 0.8 + this.rng() * 0.6, 0.45 * Math.sqrt(size), 1.5 * Math.sqrt(size), 0, PARTICLE_SHAPE.disc, 0.52, 0.46, 0.37, 0.55);
      this.alpha.emit(p);
    }
    const smoke = big ? 10 : 4;
    for (let i = 0; i < smoke; i++) {
      set(p, x + this.jitter(size * 0.3), ground + 0.6, z + this.jitter(size * 0.3), t0 + 0.05 + this.rng() * 0.25, this.jitter(0.3), 1.0 + this.rng() * 0.8, this.jitter(0.3), 1.2 + this.rng() * 0.8, 0.4 * Math.sqrt(size), 1.6 * Math.sqrt(size), -0.4, PARTICLE_SHAPE.disc, 0.12, 0.11, 0.1, 0.5);
      this.alpha.emit(p);
    }
    if (big) {
      set(p, x, ground + 1.2, z, t0, 0, 0.4, 0, 0.25, size * 0.8, size * 1.4, 0, PARTICLE_SHAPE.disc, 1.5, 0.8, 0.35, 1);
      this.additive.emit(p);
    }
  }

  /** Dust rolling out from the footprint edge; a finished building also throws a few sparks up. */
  buildDust(x: number, ground: number, z: number, f: Footprint, t0: number, done: boolean): void {
    const p = this.p;
    const hx = f.w * 0.5;
    const hz = f.h * 0.5;
    const count = Math.min(40, Math.round((f.w + f.h) * 3) + 4);
    for (let i = 0; i < count; i++) {
      // A point on the footprint perimeter, pushed outwards.
      const u = this.rng() * 2 * (f.w + f.h);
      let ex: number;
      let ez: number;
      let nx = 0;
      let nz = 0;
      if (u < f.w) [ex, ez, nz] = [-hx + u, hz, 1];
      else if (u < f.w + f.h) [ex, ez, nx] = [hx, hz - (u - f.w), 1];
      else if (u < 2 * f.w + f.h) [ex, ez, nz] = [hx - (u - f.w - f.h), -hz, -1];
      else [ex, ez, nx] = [-hx, -hz + (u - 2 * f.w - f.h), -1];
      const s = 0.8 + this.rng() * 0.9;
      set(p, x + ex, ground + 0.3, z + ez, t0 + this.rng() * 0.25, nx * s + this.jitter(0.3), 0.35 + this.rng() * 0.4, nz * s + this.jitter(0.3), 1.1 + this.rng() * 0.6, 0.6, 1.8, 0, PARTICLE_SHAPE.disc, 0.62, 0.55, 0.42, 0.5);
      this.alpha.emit(p);
    }
    if (done) {
      for (let i = 0; i < 8; i++) {
        set(p, x + this.jitter(hx), ground + 1.5, z + this.jitter(hz), t0 + this.rng() * 0.2, this.jitter(1.5), 3 + this.rng() * 2, this.jitter(1.5), 0.5 + this.rng() * 0.3, 0.08, 0.04, 6, PARTICLE_SHAPE.streak, 1.3, 1.1, 0.6, 1);
        this.additive.emit(p);
      }
    }
  }
}

/** Lowest terrain point under a footprint, the way the structure layer seats a building's foundation. */
function groundUnder(ctx: EffectContext, x: number, z: number, f: Footprint): number {
  const hx = f.w * 0.5;
  const hz = f.h * 0.5;
  const h = (px: number, pz: number): number => ctx.heightAt(px, pz);
  return Math.min(h(x, z), h(x - hx, z - hz), h(x + hx, z - hz), h(x - hx, z + hz), h(x + hx, z + hz));
}

function set(
  p: ParticleSpec,
  x: number,
  y: number,
  z: number,
  t0: number,
  vx: number,
  vy: number,
  vz: number,
  life: number,
  size0: number,
  size1: number,
  gravity: number,
  shape: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  p.x = x;
  p.y = y;
  p.z = z;
  p.t0 = t0;
  p.vx = vx;
  p.vy = vy;
  p.vz = vz;
  p.life = life;
  p.size0 = size0;
  p.size1 = size1;
  p.gravity = gravity;
  p.shape = shape;
  p.r = r;
  p.g = g;
  p.b = b;
  p.a = a;
}

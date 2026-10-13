// Ability zones (event abilityZone, contract 1 decision sprint 3): a = hero, b = abilityId (index in the hero's
// abilities), x and y = the zone center. Radius and duration come from GameData on the hero (heroIdOfTypeId of a's
// typeId); there is no end event, so the renderer fades the zone out itself after durationTicks.
// Drawn as a ground decal (ring plus soft fill in the hero's team color) in the shared decal batch: no extra draw call.
import type { GameData } from '@crawlout/data';
import { TICK_MS, UNITS_PER_METER } from '@crawlout/protocol';
import { DECAL_SHAPE, type DecalStyle } from '../decals/decalLayer.js';

/** Zone size and lifetime in render units. */
export interface AbilityShape {
  /** Meters. */
  radius: number;
  /** Seconds. */
  duration: number;
}

/** Zone shape for (heroId, abilityId), or null when the data has no such ability. */
export type AbilityLookup = (heroId: number, abilityId: number) => AbilityShape | null;

/** Ability lookup over GameData.heroes[heroId].abilities[abilityId] (radiusU, durationTicks). */
export function abilitiesFromGameData(data: Pick<GameData, 'heroes'>): AbilityLookup {
  return (heroId, abilityId) => {
    const a = data.heroes[heroId]?.abilities[abilityId];
    if (!a || a.radiusU <= 0 || a.durationTicks <= 0) return null;
    return { radius: a.radiusU / UNITS_PER_METER, duration: (a.durationTicks * TICK_MS) / 1000 };
  };
}

export interface ZoneSink {
  /** A zone at (x, z) meters, team palette slot, from t0 for `duration` seconds (renderer clock). */
  addZone(x: number, z: number, radius: number, team: number, t0: number, duration: number): void;
}

export interface DecalSink {
  push(x: number, z: number, halfX: number, halfZ: number, s: DecalStyle): void;
}

interface Zone {
  x: number;
  z: number;
  radius: number;
  team: number;
  t0: number;
  t1: number;
}

/** Seconds the zone takes to open (ring grows from OPEN_SCALE to full size) and to fade out at its end. */
export const ZONE_OPEN_S = 0.25;
export const ZONE_FADE_S = 1.0;
const OPEN_SCALE = 0.7;
const RING = 0.9;
const RING_WIDTH = 0.28; // meters
const FILL = 0.3;
const PULSE_HZ = 0.8;
/** More zones than this at once drops the oldest; Lockdown has a 45 s cooldown, so this is generous. */
const MAX_ZONES = 32;

/** Visibility of a zone at `age` seconds of `duration`: 0 before it starts and after it ends, 1 while it holds. */
export function zoneFade(age: number, duration: number): number {
  if (age < 0 || age >= duration) return 0;
  const fadeIn = Math.min(1, age / ZONE_OPEN_S);
  const fadeOut = Math.min(1, (duration - age) / Math.min(ZONE_FADE_S, duration));
  return Math.min(fadeIn, fadeOut);
}

/** Active ability zones; draw() pushes one decal per zone and forgets the ones that ended. */
export class AbilityZones implements ZoneSink {
  private readonly zones: Zone[] = [];
  private readonly style: DecalStyle = { shape: DECAL_SHAPE.circle, shadow: 0, ring: 0, ringWidth: RING_WIDTH, fill: 0, grid: 0, color: 0, fillEdge: 1 };

  get count(): number {
    return this.zones.length;
  }

  addZone(x: number, z: number, radius: number, team: number, t0: number, duration: number): void {
    if (!(radius > 0) || !(duration > 0)) return;
    if (this.zones.length >= MAX_ZONES) this.zones.shift();
    this.zones.push({ x, z, radius, team, t0, t1: t0 + duration });
  }

  /** Pushes the zones visible at time t (seconds, renderer clock) into `decals`. */
  draw(t: number, decals: DecalSink): void {
    const s = this.style;
    let keep = 0;
    for (const zone of this.zones) {
      if (t >= zone.t1) continue; // ended: dropped
      this.zones[keep++] = zone;
      const age = t - zone.t0;
      const fade = zoneFade(age, zone.t1 - zone.t0);
      if (fade <= 0) continue;
      const open = Math.min(1, age / ZONE_OPEN_S);
      const ease = 1 - (1 - open) * (1 - open);
      const r = zone.radius * (OPEN_SCALE + (1 - OPEN_SCALE) * ease);
      const pulse = 0.85 + 0.15 * Math.cos(age * PULSE_HZ * Math.PI * 2);
      s.ring = RING * fade * pulse;
      s.fill = FILL * fade;
      s.color = zone.team;
      decals.push(zone.x, zone.z, r, r, s);
    }
    this.zones.length = keep;
  }

  clear(): void {
    this.zones.length = 0;
  }
}

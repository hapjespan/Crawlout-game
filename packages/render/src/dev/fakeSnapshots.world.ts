// Structure placement and world events of FakeSnapshotSource, as functions taking the source instance.
import { ANGLE_FULL, EVENT_TYPE, UNITS_PER_METER } from '@crawlout/protocol';
import type { Footprint } from '../entities/footprint.js';
import { buildingTypeId, TYPE_ID_CLAIM, TYPE_ID_SCRAP_NODE } from '../entities/typeIds.js';
import {
  FAKE_NEUTRAL_OWNER,
  FAKE_TURRET_TICKS,
  FAKE_UNIT_TYPE_ID,
  FAKE_ZONE_TICKS,
  TURRET_RANGE,
  ZONE_AHEAD,
  type FakeSnapshotOptions,
  type FakeSourceInternals,
  type FakeStructure,
} from './fakeSnapshots.shared.js';
import type { EventRecord } from './snapshotWriter.js';

export function fakePlaceStructures(src: FakeSourceInternals, opts: FakeSnapshotOptions): void {
  const M = UNITS_PER_METER;
  const half = src.size >> 1;
  const fits = (x: number, y: number, f: Footprint): boolean => src.fits(x, y, f, 2);
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
      const cx = Math.floor((x0 + src.rand() * span) / M) * M + (f.w % 2) * (M / 2);
      const cy = Math.floor((y0 + src.rand() * span) / M) * M + (f.h % 2) * (M / 2);
      if (!fits(cx, cy, f)) continue;
      const s: FakeStructure = {
        id: src.nextStructureId++,
        typeId,
        owner,
        x: cx,
        y: cy,
        footprint: f,
      };
      if (typeId === TYPE_ID_SCRAP_NODE) s.stock = 40 + src.randInt(0, 61);
      src.structures.push(s);
      return;
    }
  };
  const types = Math.max(1, opts.buildingTypes ?? 8);
  for (let k = 0; k < (opts.buildings ?? 0); k++) {
    const typeId = buildingTypeId(k % types);
    const found = opts.footprint?.(typeId);
    const f = found && found.w > 0 && found.h > 0 ? found : { w: 3, h: 3 };
    const team = k % src.players;
    place(typeId, team, f, (team & 1) * half, ((team >> 1) & 1) * half, half);
  }
  for (let k = 0; k < (opts.scrapNodes ?? 0); k++)
    place(TYPE_ID_SCRAP_NODE, FAKE_NEUTRAL_OWNER, { w: 3, h: 3 }, 0, 0, src.size);
  for (let k = 0; k < (opts.claims ?? 0); k++) {
    place(
      TYPE_ID_CLAIM,
      k % 2 === 0 ? FAKE_NEUTRAL_OWNER : k % src.players,
      { w: 5, h: 5 },
      0,
      0,
      src.size,
    );
  }
}

/** Finished turrets fire at the nearest enemy unit in range; the hit follows a tick later. */
export function fakeTurretFire(src: FakeSourceInternals, events: EventRecord[]): void {
  if (src.turrets.size === 0) return;
  for (const s of src.structures) {
    if (!src.turrets.has(s.typeId) || s.site || (src.tick + s.id) % FAKE_TURRET_TICKS !== 0)
      continue;
    const j = src.nearestEnemy(s.x, s.y, s.owner, TURRET_RANGE);
    if (j < 0) continue;
    const target = src.ids[j]!;
    events.push({ type: EVENT_TYPE.shotFired, a: s.id, b: target, x: s.x, y: s.y });
    if (src.rand() < 0.8)
      src.pending.push({
        atTick: src.tick + 1,
        event: { type: EVENT_TYPE.hit, a: target, b: s.id, x: src.x[j]!, y: src.y[j]! },
      });
  }
}

/** Every FAKE_ZONE_TICKS the next living hero casts ability 0 a few meters ahead of itself (x, y = zone center). */
export function fakeHeroZones(src: FakeSourceInternals, events: EventRecord[]): void {
  if (src.tick % FAKE_ZONE_TICKS !== 0) return;
  const heroes = Math.min(src.players, src.count);
  for (let k = 0; k < heroes; k++) {
    const i = (src.nextZoneHero + k) % heroes;
    if (src.typeIds[i] === FAKE_UNIT_TYPE_ID || src.mode[i] === 'dead') continue;
    src.nextZoneHero = i + 1;
    const a = (src.yaw[i]! / ANGLE_FULL) * Math.PI * 2;
    const margin = 2 * UNITS_PER_METER;
    const clamp = (v: number): number =>
      Math.min(src.size - margin, Math.max(margin, Math.round(v)));
    const x = clamp(src.x[i]! + Math.cos(a) * ZONE_AHEAD);
    const y = clamp(src.y[i]! + Math.sin(a) * ZONE_AHEAD);
    events.push({ type: EVENT_TYPE.abilityZone, a: src.ids[i]!, b: 0, x, y });
    return;
  }
}

/** Building and claim events at a slow cadence, so every effect shows up within a few seconds. */
export function fakeWorldEvents(src: FakeSourceInternals, events: EventRecord[]): void {
  if (src.tick % 20 === 0 && src.count > 0) {
    const i = src.randInt(0, src.count);
    if (src.mode[i] !== 'dead') src.kill(i, events);
  }
  const buildings = src.structures.filter((s) => s.typeId < TYPE_ID_SCRAP_NODE);
  if (src.tick % 50 === 0 && buildings.length > 0) {
    // Every other time a building is demolished (death with b = typeId, gone from the snapshot) and rebuilt from
    // scratch on the same spot two seconds later; otherwise it is rebuilt in place.
    const s = buildings[src.randInt(0, buildings.length)]!;
    if (s.site) {
      // already a site: leave it be
    } else if (src.rand() < 0.5) {
      events.push({ type: EVENT_TYPE.death, a: s.id, b: s.typeId, x: s.x, y: s.y });
      src.structures.splice(src.structures.indexOf(s), 1);
      src.demolished.push({ atTick: src.tick + 40, structure: s });
    } else {
      src.startSite(s);
    }
  }
  for (let k = src.demolished.length - 1; k >= 0; k--) {
    const d = src.demolished[k]!;
    if (d.atTick > src.tick) continue;
    src.demolished.splice(k, 1);
    if (!src.fits(d.structure.x, d.structure.y, d.structure.footprint)) continue;
    // The sim hands out a fresh id for a new building.
    const s = { ...d.structure, id: src.nextStructureId++ };
    src.structures.push(s);
    src.startSite(s);
  }
  const claims = src.structures.filter((s) => s.typeId === TYPE_ID_CLAIM);
  if (src.tick % 200 === 0 && claims.length > 0) {
    const s = claims[src.randInt(0, claims.length)]!;
    s.owner = s.owner >= src.players ? src.randInt(0, src.players) : FAKE_NEUTRAL_OWNER;
    events.push({ type: EVENT_TYPE.claimTaken, a: s.id, b: s.owner, x: s.x, y: s.y });
  }
}

/** Finishes building sites and lets gatherers pick scrap nodes clean (they refill after resourceDepleted). */
export function fakeAdvanceStructures(src: FakeSourceInternals, events: EventRecord[]): void {
  for (const s of src.structures) {
    if (s.site && src.tick >= s.site.start + s.site.ticks) {
      s.site = undefined;
      events.push({ type: EVENT_TYPE.buildingDone, a: s.id, b: s.typeId, x: s.x, y: s.y });
    }
    if (s.stock !== undefined && src.tick % 10 === s.id % 10) {
      s.stock -= 1;
      if (s.stock <= 0) {
        events.push({ type: EVENT_TYPE.resourceDepleted, a: s.id, b: 0, x: s.x, y: s.y });
        s.stock = 100;
      }
    }
  }
}

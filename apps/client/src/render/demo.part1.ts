// Constants and small helpers of the render demo (terrain shape and colour, loadout mix, url parsing).
// The demo itself is demo.ts.
import { unitTypeId } from '@crawlout/data';
import { FAKE_UNIT_TYPE_ID, SYNTHETIC_ROBOT_TYPE_IDS } from '@crawlout/render/dev';

export const WORLD = 128;
export const PLAYER = 0;
/** Greybox color of a river bed cell in the XL demo (sRGB bytes), darker and wetter than the sand. */
export const MUD = [104, 94, 76] as const;

export function wastelandHeight(x: number, z: number): number {
  return (
    1.4 * Math.sin(x * 0.05) * Math.cos(z * 0.043) +
    0.6 * Math.sin(x * 0.13 + 1.7) * Math.sin(z * 0.11 + 0.4) +
    0.25 * Math.sin((x + z) * 0.31)
  );
}

export function wastelandColor(x: number, z: number, y: number): readonly [number, number, number] {
  const n =
    0.5 + 0.5 * Math.sin(x * 0.21 + Math.sin(z * 0.17) * 2.1) * Math.cos(z * 0.19 - x * 0.07);
  const low = Math.max(0, Math.min(1, (y + 2) / 4));
  const r = 0.46 + 0.16 * n + 0.08 * low;
  const g = 0.4 + 0.12 * n + 0.06 * low;
  const b = 0.3 + 0.06 * n;
  return [r, g, b];
}

/**
 * Unit typeIds for ?loadouts=: a faction ('raiders', 'dwellers'), 'mix' (both) or comma-separated loadout keys.
 * A faction or 'mix' keeps the plain human bodies (the crowd the demo is meant to show); a key names one loadout and
 * is taken as given, so `?loadouts=klerk` fills the field with that body and an asset can be judged on its own.
 */
export function loadoutTypes(
  loadouts: readonly { id: number; key: string; visuals: { meshSlots: Record<string, string> } }[],
  factionOf: (id: number) => string,
  spec: string,
): number[] {
  const human = (l: (typeof loadouts)[number]): boolean =>
    /_body_(human|slave)$/.test(l.visuals.meshSlots.body ?? '');
  const keys = spec.split(',');
  const byKey = loadouts.filter((l) => keys.includes(l.key));
  if (byKey.length > 0) return byKey.map((l) => unitTypeId(l.id));
  const pick = loadouts.filter(
    (l) => human(l) && (spec === 'mix' || keys.includes(factionOf(l.id))),
  );
  return pick.map((l) => unitTypeId(l.id));
}

/** Ten unit types in a row with `drones` repair drones, one sentinel and the rest security robots. */
export function robotMix(drones: number): number[] {
  const { guard, drone, sentinel } = SYNTHETIC_ROBOT_TYPE_IDS;
  const d = Math.min(9, Math.max(0, drones));
  return [sentinel, ...Array.from({ length: 9 }, (_, i) => (i < d ? drone : guard))];
}

/** ?vertibird: `base` (the plain unit when empty) padded to nine types plus the Vertibird, so one unit in ten flies. */
export function withVertibird(
  base: readonly number[],
  loadouts: readonly { id: number; key: string }[],
): number[] {
  const vertibird = loadouts.find((l) => l.key === 'vertibird');
  const mix = base.length > 0 ? base : [FAKE_UNIT_TYPE_ID];
  const padded = Array.from({ length: Math.max(9, mix.length) }, (_, i) => mix[i % mix.length]!);
  return vertibird ? [...padded, unitTypeId(vertibird.id)] : padded;
}

export function showError(message: string): void {
  const el = document.getElementById('error');
  if (!el) return;
  el.textContent = message;
  el.style.display = 'grid';
}

export function intParam(
  params: URLSearchParams,
  name: string,
  fallback: number,
  max: number,
): number {
  const raw = params.get(name);
  const v = raw === null ? fallback : Number(raw);
  return Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : fallback;
}

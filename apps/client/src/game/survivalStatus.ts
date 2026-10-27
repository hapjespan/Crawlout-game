// Survival co-op (client 0.13.0): PlayerStatus.survival to the HUD's survival view, the build zones for the
// minimap, and the placement reason outside the own zone. Wave names come from GameData.survival, seconds from ticks.
import { TICK_HZ } from '@crawlout/protocol';
import type { SurvivalStatus } from '@crawlout/protocol';
import type { MinimapZone, SurvivalView } from '@crawlout/ui';

let last: { key: string; view: SurvivalView | null } = { key: '', view: null };

/**
 * The survival panel, or null outside Survival. Same object while nothing changed (the HUD reads it on every refresh).
 * `frame` is the sim frame of the status (the countdown runs against it); `waveNames` the data's `naam` per wave.
 */
export function survivalView(
  s: SurvivalStatus | null,
  frame: number,
  waveNames: readonly string[],
  playerName: (id: number) => string,
  you: number,
): SurvivalView | null {
  let view: SurvivalView | null = null;
  if (s) {
    const cur = s.active[s.active.length - 1];
    view = {
      wave: s.wavesStarted,
      waves: s.waves,
      next: s.next && {
        wave: s.next.wave,
        naam: waveNames[s.next.wave - 1] ?? `Golf ${s.next.wave}`,
        rank: s.next.rank,
        inSeconds: Math.max(0, Math.ceil((s.next.atFrame - frame) / TICK_HZ)),
      },
      target:
        cur && cur.target >= 0
          ? { name: playerName(cur.target), isYou: cur.target === you, alive: cur.alive }
          : null,
      alive: s.active.reduce((n, w) => n + w.alive, 0),
    };
  }
  const key = JSON.stringify(view);
  if (key === last.key) return last.view;
  last = { key, view };
  return view;
}

/** The build zones in sim units for the minimap; empty outside Survival. */
export function survivalZones(
  zones: readonly { x: number; y: number; radius: number }[] | undefined,
  you: number,
): MinimapZone[] {
  return (zones ?? []).map((z, slot) => ({ x: z.x, y: z.y, radius: z.radius, own: slot === you }));
}

/** Dutch reason of a red preview outside the own build zone, or null (claim buildings may stand anywhere). */
export function zoneReason(
  zone: { x: number; y: number; radius: number } | null,
  fx: number,
  fy: number,
  w: number,
  h: number,
  isClaim: boolean,
): string | null {
  if (zone === null || isClaim) return null;
  // the sim's rule (survivalZoneReason): the footprint centre within the zone radius
  const dx = (fx << 8) + (w << 7) - zone.x;
  const dy = (fy << 8) + (h << 7) - zone.y;
  return dx * dx + dy * dy <= zone.radius * zone.radius
    ? null
    : `Buiten je bouwzone (bouw binnen ${Math.round(zone.radius / 256)} m van je hoofdkwartier)`;
}

// PlayerStatus.dominance (sim ticks) to the HUD's dominance view (seconds, names). Returns the same object while
// nothing changed, because the HUD reads it on every refresh.
import { TICK_HZ, type PlayerStatus } from '@crawlout/protocol';
import type { DominanceView } from '@crawlout/ui';

let last: { key: string; view: DominanceView | null } = { key: '', view: null };

export function dominanceView(
  status: PlayerStatus | null,
  playerName: (id: number) => string,
  you: number,
): DominanceView | null {
  const d = status?.dominance;
  const key = d ? JSON.stringify(d) : '';
  if (key === last.key) return last.view;
  const seconds = (ticks: number): number => Math.floor(ticks / TICK_HZ);
  const view: DominanceView | null = d
    ? {
        pointsHeld: d.pointsHeld,
        pointsRequired: d.pointsRequired,
        secondsHeld: seconds(d.ticksHeld),
        secondsRequired: seconds(d.ticksRequired),
        leader: d.leader
          ? {
              name: playerName(d.leader.playerId),
              pointsHeld: d.leader.pointsHeld,
              secondsHeld: seconds(d.leader.ticksHeld),
              isYou: d.leader.playerId === you,
            }
          : null,
      }
    : null;
  last = { key, view };
  return view;
}

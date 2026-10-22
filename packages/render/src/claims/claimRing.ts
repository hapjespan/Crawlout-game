// Pure mapping from the sim's per-claim-point status (PlayerStatus.claimPoints, protocol 0.10.0) to what the claim
// ring decal draws: a progress arc in the colour of the player who is claiming, plus a solid, pulsing or frozen look.
import type { ClaimPointStatus } from '@crawlout/protocol';
import { ARC_MODE, type DecalArc } from '../decals/decalLayer.js';
import { teamIndex } from '../palette.js';

/**
 * The arc of one claim point, or null when the ring is plain.
 * - hero (a hero standing in a free point, heroClaimS) and post (a claim building going up): the arc fills in the
 *   claimer's colour; with units of several players in the circle (frozen) the count stands still and it is striped.
 * - contest (units of another player taking over a beacon while the owner is away, contestFlipS): the arc fills in the
 *   attacker's colour and pulses; striped when the owner is back (frozen).
 */
export function claimRingArc(status: ClaimPointStatus): DecalArc | null {
  if (status.activity === 'none') return null;
  const fraction = Math.min(1, Math.max(0, status.progressPermille / 1000));
  const color = teamIndex(status.by);
  if (status.frozen && status.activity !== 'post')
    return { fraction, color, mode: ARC_MODE.frozen };
  if (status.activity === 'contest') return { fraction, color, mode: ARC_MODE.pulse };
  return fraction > 0 ? { fraction, color, mode: ARC_MODE.solid } : null;
}

/** Arcs by claim point id (the entity id of the claim in the snapshot), rebuilt on every status. */
export function claimRingArcs(statuses: readonly ClaimPointStatus[]): Map<number, DecalArc> {
  const out = new Map<number, DecalArc>();
  for (const s of statuses) {
    const arc = claimRingArc(s);
    if (arc) out.set(s.pointId, arc);
  }
  return out;
}

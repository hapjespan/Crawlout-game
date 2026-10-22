import { STALL_TIMEOUT_MS, type DesyncEvent, type ResyncResponse } from '@crawlout/protocol';
import { RESYNC_TIMEOUT_MS, SAMPLE_GRACE_FRAMES, type RoomInternals } from './room.shared.js';

// Hash, stall and resync methods of Room, as functions taking the room instance.

// --- hashes en stall ---

export function roomAfterHash(room: RoomInternals, ev: DesyncEvent | null): void {
  if (!ev) return;
  room.halted = true; // slice: een desync stopt het potje
  room.broadcast({ kind: 'desync', event: ev });
}

/** Wie meldt voor frame f: online menselijke spelers, niet vrijgesteld, en met state van voor f. AI telt niet mee. */
export function roomExpectedFor(room: RoomInternals, frame: number): number[] {
  return room
    .sortedPlayers()
    .filter(
      (p) =>
        p.online &&
        !p.ai &&
        !room.hashExempt.has(p.playerId) &&
        frame >= (room.hashFrom.get(p.playerId) ?? 0),
    )
    .map((p) => p.playerId);
}

/**
 * StallNotice. Lockstep pauzeert op de client zelf (ontbrekende bundel); de relay blijft bundels uitgeven, dus
 * een trage speler houdt de anderen niet tegen. Wat wel blokkeert is de hash-vergelijking en daarmee desync-
 * detectie. Hashes zijn de hartslag (elke HASH_INTERVAL_FRAMES, 1 s): ontbreekt bij een online menselijke speler
 * de hash van het oudste openstaande frame langer dan STALL_TIMEOUT_MS nadat een ander al meldde, dan loopt
 * hij vast (bevroren tab, gepauzeerde sim) en sturen we `stall` met zijn playerId naar iedereen, zodat de UI
 * kan tonen wie er wacht. Alleen bij wijziging; een lege waitingFor wist de melding. Een speler die wegvalt of
 * alsnog meldt, valt weer uit de lijst.
 */
export function roomCheckStall(room: RoomInternals): void {
  if (!room.started || room.halted) return;
  const pending = room.comparator.oldestPending(room.expectedFor);
  const waiting = pending && room.now() - pending.since > STALL_TIMEOUT_MS ? pending.missing : [];
  const key = waiting.join(',');
  if (key === room.stallKey) return;
  room.stallKey = key;
  room.broadcast({ kind: 'stall', notice: { waitingFor: waiting } });
}

export function roomSampleLag(room: RoomInternals, playerId: number, lagFrames: number): void {
  if (!room.adaptiveDelay || room.hashExempt.has(playerId)) return;
  if (room.resyncs.has(playerId) || (room.hashFrom.get(playerId) ?? 0) === Infinity) return;
  if ((room.scheduler?.nextFrame ?? 0) < (room.sampleAfter.get(playerId) ?? 0)) return;
  room.delay.sample(playerId, lagFrames);
}

// --- resync ---

/** Peer = laagste online menselijke playerId met state (niet het doel, niet eerder geprobeerd). */
export function roomAssignPeer(
  room: RoomInternals,
  target: number,
  tried: Set<number>,
  lastFrame: number,
): void {
  const targetConn = room.connOf.get(target);
  if (targetConn === undefined) return void room.resyncs.delete(target);
  const peer = room
    .sortedPlayers()
    .find(
      (p) =>
        p.online &&
        !p.ai &&
        p.playerId !== target &&
        !tried.has(p.playerId) &&
        (room.hashFrom.get(p.playerId) ?? 0) !== Infinity,
    );
  const peerConn = peer && room.connOf.get(peer.playerId);
  if (!peer || peerConn === undefined) {
    room.resyncs.delete(target);
    return room.error(targetConn, 'geen peer beschikbaar voor resync');
  }
  room.resyncs.set(target, {
    peer: peer.playerId,
    requestedAt: room.now(),
    lastFrame,
    tried: new Set(tried).add(peer.playerId),
  });
  room.send(peerConn, { kind: 'resyncRequest', request: { playerId: target, lastFrame } });
}

export function roomOnResyncResponse(
  room: RoomInternals,
  connId: string,
  peerId: number,
  response: ResyncResponse,
): void {
  const entry = [...room.resyncs].find(([, r]) => r.peer === peerId);
  if (!entry || !room.scheduler) return room.error(connId, 'geen resync gevraagd');
  const [target, pending] = entry;
  const next = room.scheduler.nextFrame;
  const first = room.history[0]?.frame ?? next;
  // response.frame = Sim.frame van de state (eerstvolgende uit te voeren frame). Moet binnen de bewaarde bundels vallen.
  if (response.frame > next || response.frame < first) {
    room.error(connId, 'resync-state ligt buiten de bewaarde bundels');
    return room.assignPeer(target, pending.tried, pending.lastFrame);
  }
  const targetConn = room.connOf.get(target);
  room.resyncs.delete(target);
  if (targetConn === undefined) return;
  const bundles = room.history.filter((b) => b.frame >= response.frame);
  room.send(targetConn, {
    kind: 'resyncResponse',
    response: { frame: response.frame, stateBase64: response.stateBase64, bundles },
  });
  room.hashFrom.set(target, response.frame);
  room.sampleAfter.set(target, next + SAMPLE_GRACE_FRAMES);
  room.delay.forget(target);
  room.afterHash(room.comparator.recheck(room.expectedFor));
}

export function roomCheckResyncTimeouts(room: RoomInternals): void {
  const t = room.now();
  for (const [target, r] of [...room.resyncs])
    if (t - r.requestedAt > RESYNC_TIMEOUT_MS) room.assignPeer(target, r.tried, r.lastFrame);
}

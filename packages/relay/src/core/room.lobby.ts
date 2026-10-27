import { MAX_PLAYERS } from '@crawlout/protocol';
import { FrameScheduler } from './scheduler.js';
import {
  MAX_NAME_LENGTH,
  type Player,
  type RoomInternals,
  type StartMessage,
} from './room.shared.js';

// Lobby methods of Room (join, rejoin, start, host checks), as functions taking the room instance.

export function roomJoin(
  room: RoomInternals,
  connId: string,
  name: string,
  clientId: string | undefined,
): void {
  if (room.conns.has(connId)) return room.error(connId, 'al gejoind');
  const known =
    clientId === undefined ? undefined : [...room.clientIds].find(([, id]) => id === clientId)?.[0];
  if (known !== undefined) return room.rejoin(connId, known);
  if (room.started) return room.error(connId, 'potje is al gestart');
  const playerId = room.freeSlot();
  if (playerId < 0) return room.error(connId, 'room is vol');
  room.conns.set(connId, playerId);
  room.connOf.set(playerId, connId);
  if (clientId !== undefined) room.clientIds.set(playerId, clientId);
  room.players.set(playerId, {
    playerId,
    name: room.uniqueName(name),
    faction: room.defaultFaction,
    ready: false,
    online: true,
    ai: false,
  });
  room.unreadyHumans();
  room.broadcastLobby();
}

/**
 * Menselijke namen zijn uniek in een room: een tweede "Speler" wordt "Speler 2", de volgende "Speler 3". De client
 * herkent zijn eigen regel in de lobby aan de naam (de lobby-berichten dragen geen `you`), dus twee gelijke namen
 * mogen niet naast elkaar bestaan. Hoofdletterongevoelig; past binnen de 32 tekens van het protocol.
 */
export function roomUniqueName(room: RoomInternals, name: string): string {
  const taken = new Set<string>();
  for (const p of room.players.values()) if (!p.ai) taken.add(p.name.toLowerCase());
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = `${name.slice(0, MAX_NAME_LENGTH - suffix.length)}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Bekende clientId: zelfde playerId, online weer aan. Na start volgt de resync. */
export function roomRejoin(room: RoomInternals, connId: string, playerId: number): void {
  const old = room.connOf.get(playerId);
  if (old !== undefined) {
    room.conns.delete(old); // oude (halfdode) verbinding wordt vervangen
    room.send(old, { kind: 'error', message: 'vervangen door een nieuwe verbinding' });
  }
  room.conns.set(connId, playerId);
  room.connOf.set(playerId, connId);
  const player = room.players.get(playerId) as Player;
  player.online = true;
  if (!room.started) return room.broadcastLobby();
  room.send(connId, room.startMessage(playerId));
  room.hashFrom.set(playerId, Infinity);
  room.resyncs.delete(playerId);
  room.assignPeer(playerId, new Set(), room.lastFrameOffline.get(playerId) ?? 0);
}

export function roomMaybeStart(room: RoomInternals): void {
  const list = room.sortedPlayers();
  if (list.length < room.minPlayers || !list.every((p) => p.ready)) return;
  room.started = true;
  room.seed = room.chooseSeed() >>> 0;
  room.scheduler = new FrameScheduler(room.settings.delayFrames);
  for (const [connId, playerId] of room.conns) room.send(connId, room.startMessage(playerId));
}

export function roomStartMessage(room: RoomInternals, playerId: number): StartMessage {
  return {
    kind: 'start',
    seed: room.seed,
    map: room.map,
    players: room.sortedPlayers(),
    settings: { ...room.settings },
    dataVersion: room.dataVersion,
    you: playerId,
  };
}

/** De host is de laagste playerId die geen AI is. */
export function roomHostId(room: RoomInternals): number {
  let host = -1;
  for (const p of room.players.values())
    if (!p.ai && (host < 0 || p.playerId < host)) host = p.playerId;
  return host;
}

export function roomHostCheck(room: RoomInternals, connId: string, playerId: number): boolean {
  if (room.started) {
    room.error(connId, 'potje is al gestart');
    return false;
  }
  if (playerId !== room.hostId()) {
    room.error(connId, 'alleen de host mag dit');
    return false;
  }
  return true;
}

export function roomFreeSlot(room: RoomInternals): number {
  for (let i = 0; i < MAX_PLAYERS; i++) if (!room.players.has(i)) return i;
  return -1;
}

/** Een lobbywijziging die het potje raakt, vraagt om nieuwe bevestiging; AI-spelers blijven ready. */
export function roomUnreadyHumans(room: RoomInternals): void {
  for (const p of room.players.values()) if (!p.ai) p.ready = false;
}

export function roomSortedPlayers(room: RoomInternals): Player[] {
  return [...room.players.values()].sort((a, b) => a.playerId - b.playerId).map((p) => ({ ...p }));
}

export function roomBroadcastLobby(room: RoomInternals): void {
  // Same content for everyone, but each connection gets its own playerId as `you` (fase-0 section 23 decision 7).
  for (const [connId, playerId] of room.conns)
    room.send(connId, {
      kind: 'lobby',
      roomId: room.roomId,
      map: room.map,
      players: room.sortedPlayers(),
      settings: { ...room.settings },
      you: playerId,
    });
}

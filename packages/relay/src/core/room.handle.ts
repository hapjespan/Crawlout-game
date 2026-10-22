import type { ClientMessage } from '@crawlout/protocol';
import { clampDelay, type Player, type RoomInternals } from './room.shared.js';

// Message dispatch and disconnect of Room, as functions taking the room instance.

export function roomHandle(room: RoomInternals, connId: string, msg: ClientMessage): void {
  if (msg.kind === 'join') return room.join(connId, msg.name, msg.clientId);
  const playerId = room.conns.get(connId);
  if (playerId === undefined) return room.error(connId, 'eerst joinen');
  const player = room.players.get(playerId) as Player;
  switch (msg.kind) {
    case 'leave':
      return room.disconnect(connId);
    case 'ready':
      if (room.started) return room.error(connId, 'potje is al gestart');
      player.ready = msg.ready;
      room.broadcastLobby();
      return room.maybeStart();
    case 'setFaction':
      if (room.started) return room.error(connId, 'potje is al gestart');
      player.faction = msg.faction;
      player.ready = false;
      return room.broadcastLobby();
    case 'setHero':
      // protocol 0.19.0 (voorstel): the archetype of the own hero; the sim resolves the hero of the faction
      if (room.started) return room.error(connId, 'potje is al gestart');
      player.heroArchetype = msg.heroArchetype;
      player.ready = false;
      return room.broadcastLobby();
    case 'setMap':
      if (room.started) return room.error(connId, 'potje is al gestart');
      room.map = msg.map;
      room.unreadyHumans();
      return room.broadcastLobby();
    case 'setSettings': {
      if (!room.hostCheck(connId, playerId)) return;
      const { mode, delayFrames, dominanceMinutes } = msg.settings;
      room.settings = {
        mode,
        delayFrames: clampDelay(delayFrames),
        ...(dominanceMinutes === undefined ? {} : { dominanceMinutes }),
      };
      room.unreadyHumans();
      return room.broadcastLobby();
    }
    case 'addAi':
      if (!room.hostCheck(connId, playerId)) return;
      if (room.addAi(msg.faction) === null) room.error(connId, 'room is vol');
      return;
    case 'removeAi':
      if (!room.hostCheck(connId, playerId)) return;
      if (!room.removeAi(msg.playerId)) room.error(connId, 'geen AI-speler met dat playerId');
      return;
    case 'chat':
      return room.broadcast({ kind: 'chat', playerId, text: msg.text });
    case 'command': {
      if (!room.scheduler || room.halted) return room.error(connId, 'geen lopend potje');
      if (msg.command.playerId !== playerId)
        return room.error(connId, 'playerId komt niet overeen met verbinding');
      room.sampleLag(playerId, room.scheduler.nextFrame - msg.command.frame);
      if (room.scheduler.submit(msg.command) === null)
        room.error(connId, 'commando te ver vooruit');
      return;
    }
    case 'hash': {
      if (!room.started || room.halted) return;
      if (msg.report.playerId !== playerId)
        return room.error(connId, 'playerId komt niet overeen met verbinding');
      // Een hash voor frame f is gemeld na uitvoering van f: de client staat dan op frame f + 1.
      if (room.scheduler)
        room.sampleLag(playerId, room.scheduler.nextFrame - (msg.report.frame + 1));
      return room.afterHash(room.comparator.report(msg.report, room.expectedFor));
    }
    case 'resyncRequest':
      if (!room.started) return room.error(connId, 'potje is nog niet gestart');
      if (msg.request.playerId !== playerId)
        return room.error(connId, 'playerId komt niet overeen met verbinding');
      if (room.resyncs.has(playerId)) return; // loopt al (bijv. automatisch gestart bij reconnect)
      room.hashFrom.set(playerId, Infinity);
      return room.assignPeer(playerId, new Set(), msg.request.lastFrame);
    case 'resyncResponse':
      return room.onResyncResponse(connId, playerId, msg.response);
  }
}

/** Verbinding weg. In de lobby verdwijnt de speler; in een potje wordt hij offline. */
export function roomDisconnect(room: RoomInternals, connId: string): void {
  const playerId = room.conns.get(connId);
  if (playerId === undefined) return;
  room.conns.delete(connId);
  room.connOf.delete(playerId);
  room.hashExempt.delete(playerId);
  if (room.started) {
    const p = room.players.get(playerId);
    if (p) p.online = false;
    room.lastFrameOffline.set(playerId, Math.max(0, (room.scheduler?.nextFrame ?? 0) - 1));
    room.delay.forget(playerId);
    room.resyncs.delete(playerId);
    for (const [target, r] of [...room.resyncs])
      if (r.peer === playerId)
        room.assignPeer(target, new Set([...r.tried, playerId]), r.lastFrame);
    if (!room.halted) room.afterHash(room.comparator.recheck(room.expectedFor));
    room.checkStall();
  } else {
    room.players.delete(playerId);
    room.clientIds.delete(playerId);
    if (![...room.players.values()].some((p) => !p.ai)) room.players.clear(); // geen mensen meer: AI's gaan mee
    room.broadcastLobby();
  }
}

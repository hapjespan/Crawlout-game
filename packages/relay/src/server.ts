import { ClientMessage, TICK_MS, type ServerMessage } from '@crawlout/protocol';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { Room, type RoomOptions } from './core/room.js';

export interface RelayServerOptions extends Partial<Omit<RoomOptions, 'send' | 'roomId'>> {
  /** 0 = vrije poort. Standaard env RELAY_PORT of 8787. */
  port?: number;
  host?: string;
  /** Tickinterval in ms; 0 schakelt de timer uit (tests roepen tick() zelf aan). */
  tickMs?: number;
}

export interface RelayServer {
  readonly port: number;
  /** Eén tick voor alle rooms. */
  tick(): void;
  rooms(): ReadonlyMap<string, Room>;
  close(): Promise<void>;
}

const MAX_PAYLOAD = 16 * 1024 * 1024;

export async function startRelayServer(options: RelayServerOptions = {}): Promise<RelayServer> {
  const { port, host, tickMs = TICK_MS, ...roomDefaults } = options;
  const rooms = new Map<string, Room>();
  const sockets = new Map<string, WebSocket>();
  const connRoom = new Map<string, Room>();
  let nextConn = 0;

  const deliver = (connId: string, msg: ServerMessage): void => {
    const s = sockets.get(connId);
    if (s && s.readyState === s.OPEN) s.send(JSON.stringify(msg));
  };
  const reject = (ws: WebSocket, message: string): void => {
    ws.send(JSON.stringify({ kind: 'error', message } satisfies ServerMessage));
  };

  const wss = new WebSocketServer({ port: port ?? Number(process.env['RELAY_PORT'] ?? 8787), host: host ?? '0.0.0.0', maxPayload: MAX_PAYLOAD });
  await new Promise<void>((resolve, reject2) => {
    wss.once('listening', resolve);
    wss.once('error', reject2);
  });

  wss.on('connection', (ws) => {
    const connId = `ws-${nextConn++}`;
    sockets.set(connId, ws);
    ws.on('message', (data) => {
      let json: unknown;
      try {
        json = JSON.parse(data.toString());
      } catch {
        return reject(ws, 'ongeldige JSON');
      }
      const parsed = ClientMessage.safeParse(json);
      if (!parsed.success) return reject(ws, 'ongeldig bericht');
      const msg = parsed.data;
      if (msg.kind === 'join') {
        if (connRoom.has(connId)) return reject(ws, 'al gejoind');
        let room = rooms.get(msg.roomId);
        if (!room) {
          room = new Room({ ...roomDefaults, roomId: msg.roomId, send: deliver });
          rooms.set(msg.roomId, room);
        }
        connRoom.set(connId, room);
        room.handle(connId, msg);
        return;
      }
      const room = connRoom.get(connId);
      if (!room) return reject(ws, 'eerst joinen');
      room.handle(connId, msg);
      if (msg.kind === 'leave') connRoom.delete(connId);
    });
    ws.on('close', () => {
      connRoom.get(connId)?.disconnect(connId);
      connRoom.delete(connId);
      sockets.delete(connId);
      pruneRooms();
    });
  });

  const pruneRooms = (): void => {
    for (const [id, room] of rooms) if (room.connectionCount === 0) rooms.delete(id);
  };

  const tick = (): void => {
    for (const room of rooms.values()) room.advance();
  };
  const timer = tickMs > 0 ? setInterval(tick, tickMs) : null;

  const address = wss.address();
  const boundPort = typeof address === 'object' && address ? address.port : 0;

  return {
    port: boundPort,
    tick,
    rooms: () => rooms,
    close: async () => {
      if (timer) clearInterval(timer);
      for (const s of sockets.values()) s.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}

// Direct gestart (`pnpm relay`): luister op RELAY_PORT.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const server = await startRelayServer();
  console.log(`relay luistert op poort ${server.port}`);
  const stop = (): void => {
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

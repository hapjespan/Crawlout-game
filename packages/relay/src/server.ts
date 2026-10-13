import { ClientMessage, TICK_MS, type ServerMessage } from '@crawlout/protocol';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { Room, type RoomOptions } from './core/room.js';

export interface RelayServerOptions extends Partial<Omit<RoomOptions, 'send' | 'roomId'>> {
  /** 0 = vrije poort. Standaard env RELAY_PORT of 8787. */
  port?: number;
  host?: string;
  /** Tickinterval in ms; 0 schakelt de timer uit (tests roepen tick() zelf aan). */
  tickMs?: number;
  /** Een gestarte room zonder verbindingen blijft zo lang bestaan voor reconnect (ms). Standaard 60 s. */
  emptyRoomGraceMs?: number;
}

export interface RelayServer {
  readonly port: number;
  /** dataVersion the rooms report in `start`. */
  readonly dataVersion: string;
  /** Eén tick voor alle rooms. */
  tick(): void;
  rooms(): ReadonlyMap<string, Room>;
  close(): Promise<void>;
}

/** data/VERSION of this checkout; `pnpm relay` hands it to the rooms as dataVersion so clients can verify it. */
export function readDataVersion(path: string = fileURLToPath(new URL('../../../data/VERSION', import.meta.url))): string {
  const version = readFileSync(path, 'utf8').trim();
  if (version === '') throw new Error(`${path} is leeg`);
  return version;
}

const MAX_PAYLOAD = 16 * 1024 * 1024;

export async function startRelayServer(options: RelayServerOptions = {}): Promise<RelayServer> {
  const { port, host, tickMs = TICK_MS, emptyRoomGraceMs = 60_000, ...roomDefaults } = options;
  const now = roomDefaults.now ?? Date.now;
  const emptySince = new Map<string, number>();
  const rooms = new Map<string, Room>();
  const sockets = new Map<string, WebSocket>();
  const connRoom = new Map<string, Room>();
  let nextConn = 0;

  const deliver = (connId: string, msg: ServerMessage): void => {
    const s = sockets.get(connId);
    if (s && s.readyState === s.OPEN) s.send(JSON.stringify(msg));
  };
  const reject = (ws: WebSocket, message: string): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ kind: 'error', message } satisfies ServerMessage));
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

  // Een room in de lobby verdwijnt zodra hij leeg is; een gestarte room blijft emptyRoomGraceMs bestaan,
  // zodat een speler die wegvalt (ook de enige) via clientId kan terugkomen.
  const pruneRooms = (): void => {
    for (const [id, room] of rooms) {
      if (room.connectionCount > 0) emptySince.delete(id);
      else if (!room.isStarted || now() - (emptySince.get(id) ?? now()) > emptyRoomGraceMs) {
        rooms.delete(id);
        emptySince.delete(id);
      } else if (!emptySince.has(id)) emptySince.set(id, now());
    }
  };

  const tick = (): void => {
    for (const room of rooms.values()) room.advance();
    pruneRooms();
  };
  const timer = tickMs > 0 ? setInterval(tick, tickMs) : null;

  const address = wss.address();
  const boundPort = typeof address === 'object' && address ? address.port : 0;

  return {
    port: boundPort,
    dataVersion: roomDefaults.dataVersion ?? '0',
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
  const server = await startRelayServer({ dataVersion: readDataVersion() });
  console.log(`relay luistert op poort ${server.port} (dataVersion ${server.dataVersion})`);
  const stop = (): void => {
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

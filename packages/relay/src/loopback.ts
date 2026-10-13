import type { ClientMessage, FrameBundle, ServerMessage } from '@crawlout/protocol';
import { Room, type RoomOptions } from './core/room.js';
import type { RelayTransport } from './transport.js';

export type LoopbackOptions = Partial<Omit<RoomOptions, 'send'>>;

export interface LoopbackConnectOptions {
  /** false voor een AI-speler die zelf geen hashes meldt; hij telt dan niet mee in de hash-vergelijking. Standaard true. */
  reportsHashes?: boolean;
}

/**
 * Relay in het geheugen met exact dezelfde berichten als de ws-relay. Eén room.
 * Berichten worden synchroon afgeleverd. De eigenaar roept advance() aan per tick (geen timers hier).
 */
export class LoopbackRelay {
  readonly room: Room;
  private readonly listeners = new Map<string, (msg: ServerMessage) => void>();
  private nextConn = 0;

  constructor(options: LoopbackOptions = {}) {
    this.room = new Room({
      roomId: 'loopback',
      ...options,
      send: (connId, msg) => this.listeners.get(connId)?.(msg),
    });
  }

  /** Nieuwe verbinding, bijvoorbeeld één voor de menselijke speler en één voor de AI. */
  connect(options: LoopbackConnectOptions = {}): RelayTransport {
    const connId = `loop-${this.nextConn++}`;
    const exempt = options.reportsHashes === false;
    let closed = false;
    return {
      send: (msg: ClientMessage) => {
        if (closed) return;
        this.room.handle(connId, msg);
        if (msg.kind === 'join' && exempt) this.room.setHashExempt(connId, true);
      },
      onMessage: (cb) => {
        this.listeners.set(connId, cb);
      },
      close: () => {
        if (closed) return;
        closed = true;
        this.room.disconnect(connId);
        this.listeners.delete(connId);
      },
    };
  }

  /** Eén tick: geeft de volgende bundel uit (null voor start of na desync). */
  advance(): FrameBundle | null {
    return this.room.advance();
  }
}

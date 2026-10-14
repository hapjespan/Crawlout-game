import { ServerMessage, type ClientMessage } from '@crawlout/protocol';
import type { RelayTransport } from './transport.js';

/** Minimale WebSocket-vorm; browsers en Node 22 voldoen eraan. */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface WsRelayClientOptions {
  /** Voor tests of exotische omgevingen; standaard de globale WebSocket. */
  createSocket?: (url: string) => WebSocketLike;
  onClose?: () => void;
}

const OPEN = 1;

/** RelayTransport over WebSocket. Berichten voor de verbinding open is worden gebufferd. */
export class WsRelayClient implements RelayTransport {
  private readonly socket: WebSocketLike;
  private readonly queue: string[] = [];
  private listener: ((msg: ServerMessage) => void) | null = null;
  private readonly early: ServerMessage[] = [];

  constructor(url: string, options: WsRelayClientOptions = {}) {
    const create =
      options.createSocket ??
      ((u: string) =>
        new (globalThis as unknown as { WebSocket: new (u: string) => WebSocketLike }).WebSocket(
          u,
        ));
    this.socket = create(url);
    this.socket.onopen = () => {
      for (const data of this.queue.splice(0)) this.socket.send(data);
    };
    this.socket.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let json: unknown;
      try {
        json = JSON.parse(ev.data);
      } catch {
        return;
      }
      const parsed = ServerMessage.safeParse(json);
      if (!parsed.success) return;
      if (this.listener) this.listener(parsed.data);
      else this.early.push(parsed.data);
    };
    this.socket.onclose = () => options.onClose?.();
  }

  send(msg: ClientMessage): void {
    const data = JSON.stringify(msg);
    if (this.socket.readyState === OPEN) this.socket.send(data);
    else this.queue.push(data);
  }

  onMessage(cb: (msg: ServerMessage) => void): void {
    this.listener = cb;
    for (const m of this.early.splice(0)) cb(m);
  }

  close(): void {
    this.socket.close();
  }
}

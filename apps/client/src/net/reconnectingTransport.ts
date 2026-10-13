// RelayTransport over ws that reconnects after a dropped socket. After every (re)connect it joins again with the same
// clientId, so the relay couples the connection to the same playerId (contract 2, lobby 5). Messages sent while the
// socket is down are dropped: commands and hashes of a dead connection are meaningless after the resync.
import type { ClientMessage, ServerMessage } from '@crawlout/protocol';
import { WsRelayClient, type RelayTransport, type WebSocketLike } from '@crawlout/relay/browser';

export interface ReconnectingOptions {
  url: string;
  roomId: string;
  name: string;
  clientId: string;
  /** Delay before a reconnect attempt, in ms. */
  retryMs?: number;
  createSocket?: (url: string) => WebSocketLike;
  /** Called with false when the socket drops and with true when a (re)joined socket is open. */
  onConnection?: (connected: boolean, reconnect: boolean) => void;
}

const OPEN = 1;
const DEFAULT_RETRY_MS = 1000;

export class ReconnectingTransport implements RelayTransport {
  private client: WsRelayClient | null = null;
  private socket: WebSocketLike | null = null;
  private listener: ((msg: ServerMessage) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private everOpen = false;

  constructor(private readonly options: ReconnectingOptions) {
    this.connect();
  }

  private connect(): void {
    this.timer = null;
    const opened = (): void => {
      if (this.client !== client) return;
      this.options.onConnection?.(true, this.everOpen);
      this.everOpen = true;
    };
    const create = this.options.createSocket ?? ((u: string) => new (globalThis as unknown as { WebSocket: new (u: string) => WebSocketLike }).WebSocket(u));
    const client = new WsRelayClient(this.options.url, {
      createSocket: (u) => {
        const s = create(u);
        this.socket = s;
        // WsRelayClient assigns its own handlers after this returns, so wrap onopen to learn when the socket is up.
        return {
          get readyState() {
            return s.readyState;
          },
          send: (data) => s.send(data),
          close: () => s.close(),
          get onopen() {
            return s.onopen;
          },
          set onopen(handler) {
            s.onopen = (ev) => {
              handler?.(ev);
              opened();
            };
          },
          get onmessage() {
            return s.onmessage;
          },
          set onmessage(handler) {
            s.onmessage = handler;
          },
          get onclose() {
            return s.onclose;
          },
          set onclose(handler) {
            s.onclose = handler;
          },
          get onerror() {
            return s.onerror;
          },
          set onerror(handler) {
            s.onerror = handler;
          },
        };
      },
      onClose: () => {
        if (this.client !== client || this.closed) return;
        this.client = null;
        this.socket = null;
        this.options.onConnection?.(false, this.everOpen);
        this.timer = setTimeout(() => this.connect(), this.options.retryMs ?? DEFAULT_RETRY_MS);
      },
    });
    this.client = client;
    client.onMessage((msg) => this.listener?.(msg));
    // Queued by WsRelayClient until the socket opens.
    client.send({ kind: 'join', roomId: this.options.roomId, name: this.options.name, clientId: this.options.clientId });
  }

  get connected(): boolean {
    return this.socket?.readyState === OPEN;
  }

  send(msg: ClientMessage): void {
    if (this.connected) this.client?.send(msg);
  }

  onMessage(cb: (msg: ServerMessage) => void): void {
    this.listener = cb;
  }

  close(): void {
    this.closed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.client?.close();
    this.client = null;
  }
}

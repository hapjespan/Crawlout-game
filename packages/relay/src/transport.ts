import type { ClientMessage, ServerMessage } from '@crawlout/protocol';

/** Eén verbinding met een relay. Geïmplementeerd door LoopbackRelay-verbindingen en WsRelayClient. */
export interface RelayTransport {
  send(msg: ClientMessage): void;
  onMessage(cb: (msg: ServerMessage) => void): void;
  close(): void;
}

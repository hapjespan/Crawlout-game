// Browser-veilige ingang: kern, loopback en ws-client. Importeert geen `ws` en geen node-modules.
export {
  Room,
  FrameScheduler,
  HashComparator,
  MAX_SCHEDULE_AHEAD,
  type RoomOptions,
} from './core/index.js';
export type { RelayTransport } from './transport.js';
export { LoopbackRelay, type LoopbackOptions, type LoopbackConnectOptions } from './loopback.js';
export { WsRelayClient, type WsRelayClientOptions, type WebSocketLike } from './wsClient.js';

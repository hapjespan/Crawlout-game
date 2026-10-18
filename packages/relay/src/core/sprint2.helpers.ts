// Split from sprint2.test.ts to stay under the 5,000-token file limit.
import {
  type CommandEnvelope,
  type ServerMessage,
  type ClientMessage,
  TICK_MS,
} from '@crawlout/protocol';
import { type RoomOptions, Room } from './room.js';

export const cmd = (playerId: number, seq: number, frame: number): CommandEnvelope => ({
  frame,
  playerId,
  seq,
  type: 'Stop',
  payload: { ids: [1] },
});

export function harness(options: Partial<RoomOptions> = {}) {
  const inbox = new Map<string, ServerMessage[]>();
  let clock = 0;
  const room = new Room({
    roomId: 'r',
    chooseSeed: () => 99,
    now: () => clock,
    send: (id, m) => inbox.get(id)?.push(m),
    ...options,
  });
  const box = (id: string) => {
    let b = inbox.get(id);
    if (!b) inbox.set(id, (b = []));
    return b;
  };
  const say = (id: string, m: ClientMessage) => {
    box(id);
    room.handle(id, m);
  };
  const of = <K extends ServerMessage['kind']>(id: string, kind: K) =>
    box(id).filter((m): m is Extract<ServerMessage, { kind: K }> => m.kind === kind);
  /** n ticks van TICK_MS. */
  const run = (n: number) => {
    for (let i = 0; i < n; i++) {
      clock += TICK_MS;
      room.advance();
    }
  };
  const tick = (ms: number) => {
    clock += ms;
  };
  return { room, say, of, box, run, tick, now: () => clock };
}

export function startTwo(options: Partial<RoomOptions> = {}) {
  const h = harness(options);
  h.say('a', { kind: 'join', roomId: 'r', name: 'A', clientId: 'client-aaaaaaaa' });
  h.say('b', { kind: 'join', roomId: 'r', name: 'B', clientId: 'client-bbbbbbbb' });
  h.say('a', { kind: 'ready', ready: true });
  h.say('b', { kind: 'ready', ready: true });
  return h;
}

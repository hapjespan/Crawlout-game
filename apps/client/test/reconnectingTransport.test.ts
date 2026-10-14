import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@crawlout/protocol';
import type { WebSocketLike } from '@crawlout/relay/browser';
import { ReconnectingTransport } from '../src/net/reconnectingTransport.js';

class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: unknown[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  drop(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
  receive(msg: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

describe('ReconnectingTransport', () => {
  const sockets: FakeSocket[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    sockets.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  const make = (events: Array<[boolean, boolean]> = []) =>
    new ReconnectingTransport({
      url: 'ws://x',
      roomId: 'room',
      name: 'Rik',
      clientId: 'client-12345678',
      retryMs: 100,
      createSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      onConnection: (up, reconnect) => events.push([up, reconnect]),
    });

  it('joins with the clientId, drops sends while down and rejoins after a close', () => {
    const events: Array<[boolean, boolean]> = [];
    const t = make(events);
    const got: ServerMessage[] = [];
    t.onMessage((m) => got.push(m));
    sockets[0]!.open();
    expect(sockets[0]!.sent).toEqual([
      { kind: 'join', roomId: 'room', name: 'Rik', clientId: 'client-12345678' },
    ]);
    t.send({ kind: 'ready', ready: true });
    expect(sockets[0]!.sent).toHaveLength(2);
    sockets[0]!.receive({ kind: 'error', message: 'hoi' });
    expect(got).toEqual([{ kind: 'error', message: 'hoi' }]);

    sockets[0]!.drop();
    t.send({ kind: 'ready', ready: true }); // dropped, no crash
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(sockets).toHaveLength(2);
    sockets[1]!.open();
    expect(sockets[1]!.sent).toEqual([
      { kind: 'join', roomId: 'room', name: 'Rik', clientId: 'client-12345678' },
    ]);
    expect(events).toEqual([
      [true, false],
      [false, true],
      [true, true],
    ]);
    sockets[1]!.receive({ kind: 'error', message: 'weer' });
    expect(got).toHaveLength(2);
    t.close();
  });

  it('keeps retrying when the relay is unreachable and stops after close()', () => {
    const t = make();
    sockets[0]!.drop();
    vi.advanceTimersByTime(100);
    sockets[1]!.drop();
    vi.advanceTimersByTime(100);
    expect(sockets).toHaveLength(3);
    t.close();
    sockets[2]!.drop();
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(3);
  });
});

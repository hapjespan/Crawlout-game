import { afterEach, describe, expect, it } from 'vitest';
import {
  HASH_INTERVAL_FRAMES,
  type ClientMessage,
  type CommandEnvelope,
  type ServerMessage,
} from '@crawlout/protocol';
import { LoopbackRelay } from './loopback.js';
import { startRelayServer, type RelayServer } from './server.js';
import { WsRelayClient } from './wsClient.js';
import type { RelayTransport } from './transport.js';

const SEED = 4242;
const cmd = (playerId: number, seq: number, frame: number, x: number): CommandEnvelope => ({
  frame,
  playerId,
  seq,
  type: 'Move',
  payload: { ids: [seq + 1], x, y: x },
});

// Gedeeld script: wat een driver per stap doet. Beide transporten krijgen exact dezelfde invoer.
interface Driver {
  clients: [RelayTransport, RelayTransport];
  inbox: [ServerMessage[], ServerMessage[]];
  /** Wacht tot alle eerder verstuurde berichten door de relay zijn verwerkt. */
  settle(): Promise<void>;
  tick(n: number): Promise<void>;
}

const comparable = (msgs: ServerMessage[]) =>
  msgs.filter((m) => m.kind === 'start' || m.kind === 'bundle' || m.kind === 'desync');

async function script(d: Driver): Promise<[ServerMessage[], ServerMessage[]]> {
  const [a, b] = d.clients;
  const join = (c: RelayTransport, name: string) => c.send({ kind: 'join', roomId: 'room', name });
  join(a, 'A');
  await d.settle();
  join(b, 'B');
  await d.settle();
  a.send({ kind: 'ready', ready: true });
  b.send({ kind: 'ready', ready: true });
  await d.settle();
  await d.tick(2);
  // Commando's in omgekeerde volgorde van playerId en met seq door elkaar.
  b.send({ kind: 'command', command: cmd(1, 0, 1, 10) });
  await d.settle();
  a.send({ kind: 'command', command: cmd(0, 1, 1, 20) });
  a.send({ kind: 'command', command: cmd(0, 0, 1, 30) });
  await d.settle();
  await d.tick(HASH_INTERVAL_FRAMES);
  a.send({ kind: 'hash', report: { frame: HASH_INTERVAL_FRAMES, playerId: 0, hash: 7 } });
  b.send({ kind: 'hash', report: { frame: HASH_INTERVAL_FRAMES, playerId: 1, hash: 8 } });
  await d.settle();
  return [comparable(d.inbox[0]), comparable(d.inbox[1])];
}

function loopbackDriver(): Driver {
  const relay = new LoopbackRelay({ chooseSeed: () => SEED });
  const clients: [RelayTransport, RelayTransport] = [relay.connect(), relay.connect()];
  const inbox: [ServerMessage[], ServerMessage[]] = [[], []];
  clients.forEach((c, i) => c.onMessage((m) => inbox[i]?.push(m)));
  return {
    clients,
    inbox,
    settle: async () => {},
    tick: async (n) => {
      for (let i = 0; i < n; i++) relay.advance();
    },
  };
}

let server: RelayServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function wsDriver(): Promise<Driver> {
  server = await startRelayServer({ port: 0, tickMs: 0, chooseSeed: () => SEED });
  const url = `ws://127.0.0.1:${server.port}`;
  const joinSent = [false, false];
  const track = (raw: RelayTransport, i: number): RelayTransport => ({
    send: (m) => {
      if (m.kind === 'join') joinSent[i] = true;
      raw.send(m);
    },
    onMessage: (cb) => raw.onMessage(cb),
    close: () => raw.close(),
  });
  const clients: [RelayTransport, RelayTransport] = [
    track(new WsRelayClient(url), 0),
    track(new WsRelayClient(url), 1),
  ];
  const inbox: [ServerMessage[], ServerMessage[]] = [[], []];
  clients.forEach((c, i) => c.onMessage((m) => inbox[i]?.push(m)));
  let barrier = 0;
  const waitFor = async (pred: () => boolean) => {
    const t0 = Date.now();
    while (!pred()) {
      if (Date.now() - t0 > 5000) throw new Error('timeout');
      await new Promise((r) => setTimeout(r, 2));
    }
  };
  const srv = server;
  return {
    clients,
    inbox,
    // Barrier: elke client stuurt een chat en wacht tot beide chats binnen zijn; per verbinding blijft de volgorde behouden.
    settle: async () => {
      const tag = `b${barrier++}`;
      const active = clients.map((_, i) => joinSent[i] === true);
      clients.forEach(
        (c, i) =>
          active[i] && c.send({ kind: 'chat', text: `${tag}-${i}` } satisfies ClientMessage),
      );
      await waitFor(() =>
        inbox.every(
          (box, i) => !active[i] || box.some((m) => m.kind === 'chat' && m.text === `${tag}-${i}`),
        ),
      );
    },
    tick: async (n) => {
      const count = (box: ServerMessage[]) => box.filter((m) => m.kind === 'bundle').length;
      const base = count(inbox[0]);
      for (let i = 0; i < n; i++) srv.tick();
      await waitFor(() => inbox.every((box) => count(box) >= base + n));
    },
  };
}

describe('loopback en ws-relay geven dezelfde berichten', () => {
  it('zelfde invoer geeft exact dezelfde start, bundels en desync', async () => {
    const viaLoopback = await script(loopbackDriver());
    const viaWs = await script(await wsDriver());
    expect(viaWs).toEqual(viaLoopback);

    const [a] = viaLoopback;
    const bundles = a.flatMap((m) => (m.kind === 'bundle' ? [m.bundle] : []));
    expect(bundles.map((x) => x.frame)).toEqual(
      Array.from({ length: bundles.length }, (_, i) => i),
    );
    // Frame 1 + delay 4 = 5: drie commando's, geordend op playerId dan seq.
    expect(bundles[5]?.commands.map((c) => [c.playerId, c.seq])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
    ]);
    expect(a.some((m) => m.kind === 'desync')).toBe(true);
  });

  it('ws-server weigert ongeldige berichten zonder te crashen', async () => {
    server = await startRelayServer({ port: 0, tickMs: 0 });
    const c = new WsRelayClient(`ws://127.0.0.1:${server.port}`);
    const got: ServerMessage[] = [];
    c.onMessage((m) => got.push(m));
    c.send({ kind: 'join', roomId: 'r', name: 'x' });
    c.send({
      kind: 'command',
      command: { frame: 0, playerId: 0, seq: 0, type: 'Move', payload: { nope: 1 } },
    } as unknown as ClientMessage);
    for (let i = 0; i < 100 && !got.some((m) => m.kind === 'error'); i++)
      await new Promise((r) => setTimeout(r, 10));
    expect(got.some((m) => m.kind === 'error')).toBe(true);
    c.close();
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import type { ServerMessage } from '@crawlout/protocol';
import { LoopbackRelay } from './loopback.js';
import { readDataVersion, startRelayServer, type RelayServer } from './server.js';
import { WsRelayClient } from './wsClient.js';

let server: RelayServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const until = async (pred: () => boolean) => {
  for (let i = 0; i < 500 && !pred(); i++) await new Promise((r) => setTimeout(r, 5));
  if (!pred()) throw new Error('timeout');
};

describe('LoopbackRelay.addAi', () => {
  it('een mens plus AI start via dezelfde weg als online, zonder tweede verbinding', () => {
    const relay = new LoopbackRelay({ chooseSeed: () => 5 });
    const me = relay.connect();
    const got: ServerMessage[] = [];
    me.onMessage((m) => got.push(m));
    me.send({ kind: 'join', roomId: 'x', name: 'Ik', clientId: 'client-12345678' });
    expect(relay.addAi('dwellers')).toBe(1);
    me.send({ kind: 'ready', ready: true });
    const start = got.find((m) => m.kind === 'start');
    expect(start?.kind === 'start' && start.players.map((p) => [p.playerId, p.ai])).toEqual([[0, false], [1, true]]);
    expect(relay.advance()?.frame).toBe(0);
  });
});

describe('ws-relay reconnect', () => {
  it('herkent clientId na een verbroken socket en start een resync bij de peer', async () => {
    server = await startRelayServer({ port: 0, tickMs: 0, chooseSeed: () => 1 });
    const url = `ws://127.0.0.1:${server.port}`;
    const connect = (name: string, clientId: string) => {
      const c = new WsRelayClient(url);
      const box: ServerMessage[] = [];
      c.onMessage((m) => box.push(m));
      c.send({ kind: 'join', roomId: 'r', name, clientId });
      return { c, box };
    };
    const a = connect('A', 'client-aaaaaaaa');
    const b = connect('B', 'client-bbbbbbbb');
    await until(() => b.box.some((m) => m.kind === 'lobby' && m.players.length === 2));
    a.c.send({ kind: 'ready', ready: true });
    b.c.send({ kind: 'ready', ready: true });
    await until(() => a.box.some((m) => m.kind === 'start'));
    for (let i = 0; i < 3; i++) server.tick();
    b.c.close();
    await until(() => server?.rooms().get('r')?.connectionCount === 1);
    const b2 = connect('B', 'client-bbbbbbbb');
    await until(() => b2.box.some((m) => m.kind === 'start'));
    expect(b2.box.find((m) => m.kind === 'start')).toMatchObject({ you: 1 });
    await until(() => a.box.some((m) => m.kind === 'resyncRequest'));
    a.c.send({ kind: 'resyncResponse', response: { frame: 3, stateBase64: 'AA==', bundles: [] } });
    await until(() => b2.box.some((m) => m.kind === 'resyncResponse'));
    a.c.close();
    b2.c.close();
  });

  it('een lege lobby-room wordt opgeruimd', async () => {
    server = await startRelayServer({ port: 0, tickMs: 0 });
    const url = `ws://127.0.0.1:${server.port}`;
    const c = new WsRelayClient(url);
    c.send({ kind: 'join', roomId: 'lobby', name: 'A' });
    await until(() => server?.rooms().has('lobby') === true);
    c.close();
    await until(() => server?.rooms().has('lobby') === false);
  });
});

describe('dataVersion', () => {
  it('de server geeft de ingestelde dataVersion door in start; readDataVersion leest data/VERSION', async () => {
    const version = readDataVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    server = await startRelayServer({ port: 0, tickMs: 0, dataVersion: version });
    expect(server.dataVersion).toBe(version);
    const c = new WsRelayClient(`ws://127.0.0.1:${server.port}`);
    const box: ServerMessage[] = [];
    c.onMessage((m) => box.push(m));
    c.send({ kind: 'join', roomId: 'v', name: 'A' });
    await until(() => box.some((m) => m.kind === 'lobby'));
    c.send({ kind: 'addAi', faction: 'dwellers' });
    c.send({ kind: 'ready', ready: true });
    await until(() => box.some((m) => m.kind === 'start'));
    expect(box.find((m) => m.kind === 'start')).toMatchObject({ dataVersion: version });
    c.close();
  });
});

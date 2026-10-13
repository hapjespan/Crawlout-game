import { describe, expect, it } from 'vitest';
import { DELAY_FRAMES_DEFAULT, HASH_INTERVAL_FRAMES, type ClientMessage, type CommandEnvelope, type ServerMessage } from '@crawlout/protocol';
import { FrameScheduler } from './scheduler.js';
import { Room } from './room.js';

const cmd = (playerId: number, seq: number, frame: number): CommandEnvelope => ({ frame, playerId, seq, type: 'Stop', payload: { ids: [1] } });

describe('FrameScheduler', () => {
  it('geeft bundels in volgorde zonder gaten, ook leeg', () => {
    const s = new FrameScheduler(4);
    const frames = Array.from({ length: 6 }, () => s.advance());
    expect(frames.map((b) => b.frame)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(frames.every((b) => b.commands.length === 0)).toBe(true);
  });

  it('past DELAY toe: uitvoering in frame + delay', () => {
    const s = new FrameScheduler(DELAY_FRAMES_DEFAULT);
    const c = cmd(0, 0, 3);
    expect(s.submit(c)).toBe(3 + DELAY_FRAMES_DEFAULT);
    const out = Array.from({ length: 10 }, () => s.advance());
    const hit = out.filter((b) => b.commands.length > 0);
    expect(hit).toEqual([{ frame: 7, commands: [c] }]);
  });

  it('ordent binnen een frame op playerId en dan seq, onafhankelijk van aankomst', () => {
    const inputs = [cmd(2, 0, 0), cmd(0, 5, 0), cmd(1, 1, 0), cmd(0, 2, 0), cmd(1, 0, 0)];
    const run = (order: CommandEnvelope[]) => {
      const s = new FrameScheduler(2);
      order.forEach((c) => s.submit(c));
      s.advance();
      s.advance();
      return s.advance().commands.map((c) => [c.playerId, c.seq]);
    };
    const expected = [
      [0, 2],
      [0, 5],
      [1, 0],
      [1, 1],
      [2, 0],
    ];
    expect(run(inputs)).toEqual(expected);
    expect(run([...inputs].reverse())).toEqual(expected);
  });

  it('schuift te late commando naar het eerstvolgende frame', () => {
    const s = new FrameScheduler(2);
    for (let i = 0; i < 10; i++) s.advance();
    expect(s.submit(cmd(0, 0, 1))).toBe(10);
    expect(s.advance().commands).toHaveLength(1);
  });

  it('weigert commando ver in de toekomst', () => {
    expect(new FrameScheduler(2).submit(cmd(0, 0, 100000))).toBeNull();
  });
});

function setup(opts: { hashExemptB?: boolean } = {}) {
  const inbox = new Map<string, ServerMessage[]>([
    ['a', []],
    ['b', []],
  ]);
  const room = new Room({ roomId: 'r', send: (id, m) => inbox.get(id)?.push(m), chooseSeed: () => 1234 });
  const say = (id: string, m: ClientMessage) => room.handle(id, m);
  say('a', { kind: 'join', roomId: 'r', name: 'A' });
  say('b', { kind: 'join', roomId: 'r', name: 'B' });
  if (opts.hashExemptB) room.setHashExempt('b', true);
  say('a', { kind: 'ready', ready: true });
  say('b', { kind: 'ready', ready: true });
  return { room, inbox, say };
}

describe('Room lobby', () => {
  it('start met seed van de relay en elk een eigen you', () => {
    const { inbox, room } = setup();
    expect(room.isStarted).toBe(true);
    const starts = ['a', 'b'].map((id) => inbox.get(id)?.find((m) => m.kind === 'start'));
    expect(starts.map((s) => s?.kind === 'start' && [s.seed, s.you])).toEqual([
      [1234, 0],
      [1234, 1],
    ]);
  });

  it('start niet zolang iemand niet ready is of bij te weinig spelers', () => {
    const room = new Room({ roomId: 'r', send: () => {} });
    room.handle('a', { kind: 'join', roomId: 'r', name: 'A' });
    room.handle('a', { kind: 'ready', ready: true });
    expect(room.isStarted).toBe(false);
    room.handle('b', { kind: 'join', roomId: 'r', name: 'B' });
    expect(room.isStarted).toBe(false);
  });

  it('negeert commando met andere playerId dan de verbinding', () => {
    const { say, inbox } = setup();
    say('a', { kind: 'command', command: cmd(1, 0, 0) });
    expect(inbox.get('a')?.some((m) => m.kind === 'error')).toBe(true);
  });
});

describe('Room bundels en hashes', () => {
  it('stuurt elke tick dezelfde bundel naar alle spelers, ook leeg', () => {
    const { room, inbox, say } = setup();
    say('a', { kind: 'command', command: cmd(0, 0, 0) });
    for (let i = 0; i < 6; i++) room.advance();
    const bundles = (id: string) => inbox.get(id)?.flatMap((m) => (m.kind === 'bundle' ? [m.bundle] : []));
    expect(bundles('a')).toEqual(bundles('b'));
    expect(bundles('a')?.map((b) => b.frame)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(bundles('a')?.[DELAY_FRAMES_DEFAULT]?.commands).toHaveLength(1);
  });

  it('geen desync bij gelijke hashes', () => {
    const { say, inbox } = setup();
    say('a', { kind: 'hash', report: { frame: HASH_INTERVAL_FRAMES, playerId: 0, hash: 9 } });
    say('b', { kind: 'hash', report: { frame: HASH_INTERVAL_FRAMES, playerId: 1, hash: 9 } });
    expect(inbox.get('a')?.some((m) => m.kind === 'desync')).toBe(false);
  });

  it('desync bij afwijkende hashes, en het potje stopt', () => {
    const { room, say, inbox } = setup();
    say('a', { kind: 'hash', report: { frame: HASH_INTERVAL_FRAMES, playerId: 0, hash: 1 } });
    expect(inbox.get('a')?.some((m) => m.kind === 'desync')).toBe(false); // wacht op b
    say('b', { kind: 'hash', report: { frame: HASH_INTERVAL_FRAMES, playerId: 1, hash: 2 } });
    for (const id of ['a', 'b']) {
      const ev = inbox.get(id)?.find((m) => m.kind === 'desync');
      expect(ev).toEqual({ kind: 'desync', event: { frame: HASH_INTERVAL_FRAMES, hashes: { '0': 1, '1': 2 } } });
    }
    expect(room.advance()).toBeNull();
  });

  it('hash-vrijgestelde verbinding (AI) hoeft niet te melden', () => {
    const { say, inbox } = setup({ hashExemptB: true });
    say('a', { kind: 'hash', report: { frame: HASH_INTERVAL_FRAMES, playerId: 0, hash: 1 } });
    expect(inbox.get('a')?.some((m) => m.kind === 'desync')).toBe(false);
  });
});

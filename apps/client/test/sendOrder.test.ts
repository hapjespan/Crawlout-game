import { describe, expect, it } from 'vitest';
import { COMMAND_PAYLOADS, type CommandType } from '@crawlout/protocol';
import { sendOrder } from '../src/main.orders.js';

describe('sendOrder (HUD orders)', () => {
  it('splits 120 selected units into 2 commands of at most 64 ids, for Stop and AttackMove', () => {
    const ids = Array.from({ length: 120 }, (_, i) => i + 1);
    for (const [type, payload] of [
      ['Stop', { ids }],
      ['AttackMove', { ids, x: 10, y: 20 }],
    ] as const) {
      const sent: { type: CommandType; payload: { ids: number[] } }[] = [];
      sendOrder(
        (t, p) => void sent.push({ type: t, payload: p as { ids: number[] } }),
        type,
        payload,
      );
      expect(sent.map((s) => s.payload.ids.length)).toEqual([64, 56]);
      expect(sent.flatMap((s) => s.payload.ids)).toEqual(ids);
      for (const s of sent) {
        expect(s.type).toBe(type);
        expect(COMMAND_PAYLOADS[type].safeParse(s.payload).success).toBe(true);
      }
    }
  });

  it('sends a payload without ids unchanged', () => {
    const sent: unknown[] = [];
    sendOrder((_t, p) => void sent.push(p), 'Research', { techId: 3 });
    expect(sent).toEqual([{ techId: 3 }]);
  });
});

import { describe, it, expect } from 'vitest';
import { CommandEnvelope } from './commands.js';

// Voorstel sim-core (protocol 0.18.0, ter bevestiging door de architect): Load en Unload van de Vertibird.
describe('Load en Unload (protocol 0.18.0, voorstel)', () => {
  const env = (type: string, payload: unknown) =>
    CommandEnvelope.safeParse({ frame: 0, playerId: 0, seq: 0, type, payload }).success;

  it('Load draagt de passagiers en de transport, Unload de transports en optioneel een punt', () => {
    expect(env('Load', { ids: [1048577], transportId: 2097153 })).toBe(true);
    expect(env('Load', { ids: [], transportId: 1 })).toBe(false);
    expect(env('Load', { ids: [1] })).toBe(false);
    expect(env('Unload', { ids: [2097153] })).toBe(true);
    expect(env('Unload', { ids: [2097153], x: 2560, y: 5120 })).toBe(true);
    expect(env('Unload', { ids: [1], x: 1.5 })).toBe(false);
  });
});

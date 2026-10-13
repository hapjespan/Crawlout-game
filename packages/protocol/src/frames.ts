import { z } from 'zod';
import { CommandEnvelope } from './commands.js';

// Contract 2: frame-bundels, hashes, desync, resync. De relay ordent alleen.
//
// Frame-semantiek (besluit sprint 1):
// - FrameBundle.frame is het uitvoerframe: de sim voert de commando's uit in de tick van dat frame.
// - CommandEnvelope.frame is het frame waarin de speler het commando gaf; de relay plant het op
//   max(frame + DELAY, eerstvolgende bundel). De sim leest alleen bundle.frame.
// - HashReport.frame = f betekent: de state-hash NA uitvoering van frame f. Gemeld als f % HASH_INTERVAL_FRAMES === 0.
//   Dezelfde conventie geldt voor Replay.hashes en voor de snapshot-header (tick = laatst uitgevoerde frame).
//   In de state-serialisatie staat tick = aantal uitgevoerde ticks = f + 1 (het volgende frame).
const uint = z.number().int().nonnegative();

export const FrameBundle = z.object({ frame: uint, commands: z.array(CommandEnvelope) }).strict();
export type FrameBundle = z.infer<typeof FrameBundle>;

export const HashReport = z.object({ frame: uint, playerId: uint, hash: uint }).strict();
export type HashReport = z.infer<typeof HashReport>;

export const DesyncEvent = z.object({ frame: uint, hashes: z.record(z.string(), uint) }).strict(); // playerId (als string) -> hash
export type DesyncEvent = z.infer<typeof DesyncEvent>;

export const ResyncRequest = z.object({ playerId: uint, lastFrame: uint }).strict();
export const ResyncResponse = z.object({ frame: uint, stateBase64: z.string(), bundles: z.array(FrameBundle) }).strict();
export type ResyncRequest = z.infer<typeof ResyncRequest>;
export type ResyncResponse = z.infer<typeof ResyncResponse>;

export const StallNotice = z.object({ waitingFor: z.array(uint) }).strict();
export type StallNotice = z.infer<typeof StallNotice>;

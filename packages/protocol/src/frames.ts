import { z } from 'zod';
import { CommandEnvelope } from './commands.js';

// Contract 2: frame-bundels, hashes, desync, resync. De relay ordent alleen.
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

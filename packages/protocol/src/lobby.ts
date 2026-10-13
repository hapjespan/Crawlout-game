import { z } from 'zod';
import { FrameBundle, HashReport, DesyncEvent, ResyncRequest, ResyncResponse, StallNotice } from './frames.js';
import { CommandEnvelope } from './commands.js';

// Contract 2: lobby en transport. JSON over WebSocket in fase 1.
const uint = z.number().int().nonnegative();
const name = z.string().min(1).max(32);

export const MatchSettings = z.object({ mode: z.enum(['skirmish', 'survival']), delayFrames: uint, dominanceMinutes: uint }).strict();
export const LobbyPlayer = z.object({ playerId: uint, name, faction: z.string(), ready: z.boolean(), online: z.boolean() }).strict();

export const ClientMessage = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('join'), roomId: z.string(), name }).strict(),
  z.object({ kind: z.literal('leave') }).strict(),
  z.object({ kind: z.literal('ready'), ready: z.boolean() }).strict(),
  z.object({ kind: z.literal('setFaction'), faction: z.string() }).strict(),
  z.object({ kind: z.literal('setMap'), map: z.string() }).strict(),
  z.object({ kind: z.literal('chat'), text: z.string().max(200) }).strict(),
  z.object({ kind: z.literal('command'), command: CommandEnvelope }).strict(),
  z.object({ kind: z.literal('hash'), report: HashReport }).strict(),
  z.object({ kind: z.literal('resyncRequest'), request: ResyncRequest }).strict(),
  z.object({ kind: z.literal('resyncResponse'), response: ResyncResponse }).strict(),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export const ServerMessage = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('lobby'), roomId: z.string(), map: z.string(), players: z.array(LobbyPlayer) }).strict(),
  z.object({ kind: z.literal('start'), seed: uint, map: z.string(), players: z.array(LobbyPlayer), settings: MatchSettings, dataVersion: z.string(), you: uint }).strict(),
  z.object({ kind: z.literal('bundle'), bundle: FrameBundle }).strict(),
  z.object({ kind: z.literal('desync'), event: DesyncEvent }).strict(),
  z.object({ kind: z.literal('stall'), notice: StallNotice }).strict(),
  z.object({ kind: z.literal('resyncRequest'), request: ResyncRequest }).strict(), // naar de aangewezen peer
  z.object({ kind: z.literal('resyncResponse'), response: ResyncResponse }).strict(),
  z.object({ kind: z.literal('chat'), playerId: uint, text: z.string() }).strict(),
  z.object({ kind: z.literal('error'), message: z.string() }).strict(),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

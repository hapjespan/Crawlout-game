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
//
// Besluiten sprint 2:
// - DELAY is adaptief op de relay (DELAY_FRAMES_MIN..MAX) uit het verschil tussen het frame dat de relay uitgeeft
//   en envelope.frame of HashReport.frame + 1. MatchSettings.delayFrames is alleen de startwaarde. Een client hoeft
//   DELAY niet te kennen: hij stuurt envelope.frame = zijn eerstvolgende frame en de relay plant.
// - StallNotice komt van de relay als een online menselijke speler zijn hash voor het oudste openstaande frame
//   langer dan STALL_TIMEOUT_MS schuldig blijft nadat een ander al meldde; waitingFor leeg wist de melding. De relay
//   blijft bundels uitgeven. Los daarvan pauzeert een client zelf zodra zijn eerstvolgende bundel ontbreekt.
// - Resync: ResyncResponse.frame is Sim.frame van de meegestuurde state (het eerstvolgende uit te voeren frame, dus
//   state na frame - 1); bundles zijn alle bundels vanaf frame, aansluitend. De peer stuurt de state en wat hij
//   heeft; de relay vult bundles aan uit zijn geschiedenis en wijst een state buiten die geschiedenis af. De
//   ontvanger laadt, voert de bundels versneld uit en meldt hashes vanaf frame.
const uint = z.number().int().nonnegative();

export const FrameBundle = z.object({ frame: uint, commands: z.array(CommandEnvelope) }).strict();
export type FrameBundle = z.infer<typeof FrameBundle>;

export const HashReport = z.object({ frame: uint, playerId: uint, hash: uint }).strict();
export type HashReport = z.infer<typeof HashReport>;

export const DesyncEvent = z.object({ frame: uint, hashes: z.record(z.string(), uint) }).strict(); // playerId (als string) -> hash
export type DesyncEvent = z.infer<typeof DesyncEvent>;

export const ResyncRequest = z.object({ playerId: uint, lastFrame: uint }).strict();
export const ResyncResponse = z
  .object({ frame: uint, stateBase64: z.string(), bundles: z.array(FrameBundle) })
  .strict();
export type ResyncRequest = z.infer<typeof ResyncRequest>;
export type ResyncResponse = z.infer<typeof ResyncResponse>;

export const StallNotice = z.object({ waitingFor: z.array(uint) }).strict();
export type StallNotice = z.infer<typeof StallNotice>;

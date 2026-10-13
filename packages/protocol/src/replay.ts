import { z } from 'zod';
import { SEED_MAX } from './constants.js';
import { FrameBundle } from './frames.js';
import { LobbyPlayer, MatchSettings } from './lobby.js';

// Contract 2: replay = alles wat nodig is om een potje deterministisch opnieuw te draaien.
// Besluit sprint 1: de startopstelling staat NIET in de replay. Zij volgt deterministisch uit map (spawns,
// in volgorde van playerId) plus data (factions.startUnits per factie van de speler) plus players. De sim
// bouwt haar op in start(), voor frame 0. Tot de integratie met packages/map en de data-loader (sprint 2)
// staat de programmatische testopstelling per mapnaam in tools/replay/src/scenarios.ts.
const uint = z.number().int().nonnegative();

export const Replay = z
  .object({
    dataVersion: z.string(),
    seed: uint.max(SEED_MAX),
    map: z.string(),
    players: z.array(LobbyPlayer),
    settings: MatchSettings,
    bundles: z.array(FrameBundle),
    hashes: z.array(z.object({ frame: uint, hash: uint }).strict()), // hash na frame f, elke HASH_INTERVAL_FRAMES (zie frames.ts)
  })
  .strict();
export type Replay = z.infer<typeof Replay>;

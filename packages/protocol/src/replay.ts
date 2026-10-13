import { z } from 'zod';
import { FrameBundle } from './frames.js';
import { LobbyPlayer, MatchSettings } from './lobby.js';

// Contract 2: replay = alles wat nodig is om een potje deterministisch opnieuw te draaien.
const uint = z.number().int().nonnegative();

export const Replay = z
  .object({
    dataVersion: z.string(),
    seed: uint,
    map: z.string(),
    players: z.array(LobbyPlayer),
    settings: MatchSettings,
    bundles: z.array(FrameBundle),
    hashes: z.array(z.object({ frame: uint, hash: uint }).strict()), // elke HASH_INTERVAL_FRAMES
  })
  .strict();
export type Replay = z.infer<typeof Replay>;

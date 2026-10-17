import { z } from 'zod';
import {
  FrameBundle,
  HashReport,
  DesyncEvent,
  ResyncRequest,
  ResyncResponse,
  StallNotice,
} from './frames.js';
import { CommandEnvelope } from './commands.js';
import { MAX_PLAYERS, SEED_MAX } from './constants.js';

// Contract 2: lobby en transport. JSON over WebSocket in fase 1.
const uint = z.number().int().nonnegative();
const name = z.string().min(1).max(32);
/** Door de client gekozen, willekeurig, bewaard in sessionStorage; de relay herkent er een terugkerende speler aan. */
const clientId = z.string().min(8).max(64);

// Besluiten sprint 1:
// - De relay kent geen spelregels. dominanceMinutes is een optionele override door de lobby; ontbreekt hij,
//   dan geldt de waarde uit de map (maps/*.json, dominance.minutes). Geen defaultgetal in relay-code.
// - Een AI-speler is een LobbyPlayer met ai = true, zonder verbinding. De AI draait in de sim op elke client
//   (deterministisch, systeem 2 "orders en AI") en meldt geen hashes.
// - Er is geen client-bericht `start`: de relay start zodra elke menselijke speler ready is en het minimum
//   aantal spelers (mens plus AI) gehaald is. Het `start`-bericht komt van de relay.
// Besluiten sprint 2:
// - delayFrames is de startwaarde van de adaptieve DELAY (frames.ts); de relay klemt hem op DELAY_FRAMES_MIN..MAX.
// - Reconnect: een join met bekend clientId na start krijgt opnieuw `start` (zelfde seed, map en spelers) en de
//   relay start de resync zelf (resyncRequest naar de laagste online menselijke peer). Een resyncRequest van de
//   client blijft toegestaan en is dan een no-op zolang er een resync loopt.
export const MatchSettings = z
  .object({
    mode: z.enum(['skirmish', 'survival']),
    delayFrames: uint,
    dominanceMinutes: uint.optional(),
  })
  .strict();
export type MatchSettings = z.infer<typeof MatchSettings>;
export const LobbyPlayer = z
  .object({
    playerId: uint,
    name,
    faction: z.string(),
    ready: z.boolean(),
    online: z.boolean(),
    ai: z.boolean(),
  })
  .strict();
export type LobbyPlayer = z.infer<typeof LobbyPlayer>;

export const ClientMessage = z.discriminatedUnion('kind', [
  // clientId: bij een reconnect na start koppelt de relay dezelfde playerId; daarna volgt resyncRequest.
  z
    .object({ kind: z.literal('join'), roomId: z.string(), name, clientId: clientId.optional() })
    .strict(),
  z.object({ kind: z.literal('leave') }).strict(),
  z.object({ kind: z.literal('ready'), ready: z.boolean() }).strict(),
  z.object({ kind: z.literal('setFaction'), faction: z.string() }).strict(),
  z.object({ kind: z.literal('setMap'), map: z.string() }).strict(),
  // Alleen de speler met de laagste playerId (de host van de room) mag settings en AI-spelers zetten.
  z.object({ kind: z.literal('setSettings'), settings: MatchSettings }).strict(),
  z.object({ kind: z.literal('addAi'), faction: z.string() }).strict(),
  z.object({ kind: z.literal('removeAi'), playerId: uint }).strict(),
  z.object({ kind: z.literal('chat'), text: z.string().max(200) }).strict(),
  z.object({ kind: z.literal('command'), command: CommandEnvelope }).strict(),
  z.object({ kind: z.literal('hash'), report: HashReport }).strict(),
  z.object({ kind: z.literal('resyncRequest'), request: ResyncRequest }).strict(),
  z.object({ kind: z.literal('resyncResponse'), response: ResyncResponse }).strict(),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export const ServerMessage = z.discriminatedUnion('kind', [
  // Besluit fase-0 sectie 23 (protocol 0.12.0): `you` is de playerId van de verbinding die dit lobby-bericht ontvangt,
  // zoals in `start`. De relay stuurt het lobby-bericht daarom per verbinding (dezelfde inhoud, een ander `you`); een
  // AI-speler ontvangt niets. Optioneel in 0.12.0 zodat een relay zonder het veld nog valideert; de client leest het
  // zodra het er is en valt alleen zonder terug op de naam (ui identifyYou). Verplicht in de volgende versie zodra
  // relay en client het dragen, op dezelfde weg als queue, dominance, robotPop en trained.
  z
    .object({
      kind: z.literal('lobby'),
      roomId: z.string(),
      map: z.string(),
      players: z.array(LobbyPlayer),
      settings: MatchSettings.optional(),
      you: uint.max(MAX_PLAYERS - 1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('start'),
      seed: uint.max(SEED_MAX),
      map: z.string(),
      players: z.array(LobbyPlayer),
      settings: MatchSettings,
      dataVersion: z.string(),
      you: uint,
    })
    .strict(),
  z.object({ kind: z.literal('bundle'), bundle: FrameBundle }).strict(),
  z.object({ kind: z.literal('desync'), event: DesyncEvent }).strict(),
  z.object({ kind: z.literal('stall'), notice: StallNotice }).strict(),
  z.object({ kind: z.literal('resyncRequest'), request: ResyncRequest }).strict(), // naar de aangewezen peer
  z.object({ kind: z.literal('resyncResponse'), response: ResyncResponse }).strict(),
  z.object({ kind: z.literal('chat'), playerId: uint, text: z.string() }).strict(),
  z.object({ kind: z.literal('error'), message: z.string() }).strict(),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

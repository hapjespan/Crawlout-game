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
// mode 'project' (protocol 0.16.0; bevestigd in fase-0 sectie 24 besluit 1): het speltype Bouwproject, Skirmish plus
// winroute C; alleen dan zet de sim de projectdelen van de map neer (envHash). 'skirmish' heeft de winroutes A en B.
// mode 'survival' (sim 0.27.0, data 0.33.0; sectie 24 besluit 1): Survival co-op, 1 tot 4 spelers zonder AI-speler, de
// bouwzones en golven uit data/survival; de winroutes A, B en C gelden niet, de uitkomst staat in PlayerStatus.survival.
export const MatchSettings = z
  .object({
    mode: z.enum(['skirmish', 'survival', 'project']),
    delayFrames: uint,
    dominanceMinutes: uint.optional(),
  })
  .strict();
export type MatchSettings = z.infer<typeof MatchSettings>;
// Held-keuze (protocol 0.19.0, sim 0.35.0, data 0.42.0; originally 0.18.0 on its own branch; voorstel, ter bevestiging door de architect; docs/held-keuze.md):
// een speler kiest een archetype, de factie bepaalt de held (de held van dat archetype van zijn factie). Afwezig = de
// Krijger; bij een AI-speler zonder keuze kiest zijn AI-script (data/ai heroArchetype, afwezig krijger). Het veld is
// deel van de start- en replay-invoer; zonder keuze blijft de envHash zoals hij was.
export const HeroArchetype = z.enum(['bouwer', 'krijger', 'tacticus']);
export type HeroArchetype = z.infer<typeof HeroArchetype>;
export const HERO_ARCHETYPES = HeroArchetype.options;
export const LobbyPlayer = z
  .object({
    playerId: uint,
    name,
    faction: z.string(),
    ready: z.boolean(),
    online: z.boolean(),
    ai: z.boolean(),
    heroArchetype: HeroArchetype.optional(),
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
  // protocol 0.19.0 (voorstel): het archetype van de eigen held, voor de start; zoals setFaction vraagt het opnieuw om ready
  z.object({ kind: z.literal('setHero'), heroArchetype: HeroArchetype }).strict(),
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
  // Besluit fase-0 sectie 23 (protocol 0.12.0, verplicht sinds 0.13.0; bevestigd in fase-0 sectie 24 besluit 1): `you` is
  // de playerId van de verbinding die dit lobby-bericht ontvangt, zoals in `start`. De relay stuurt het lobby-bericht
  // daarom per verbinding (dezelfde inhoud, een ander `you`; Room.broadcastLobby, relay 0.3.0); een AI-speler ontvangt
  // niets. De client leest het (session.ts, de menu-flow); de naam is geen identiteit meer, de unieke namen van de
  // relay zijn alleen nog een weergaveregel.
  z
    .object({
      kind: z.literal('lobby'),
      roomId: z.string(),
      map: z.string(),
      players: z.array(LobbyPlayer),
      settings: MatchSettings.optional(),
      you: uint.max(MAX_PLAYERS - 1),
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

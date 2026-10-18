import { z } from 'zod';
import { MAX_ENTITIES_PER_COMMAND, MAX_PLAYERS } from './constants.js';

// Contract 2: commando's. Alle getallen zijn integers in sim-eenheden (x, y in eenheden van 1/256 m).
const int = z.number().int();
const uint = int.nonnegative();
const EntityIds = z.array(uint).min(1).max(MAX_ENTITIES_PER_COMMAND);
const Pos = { x: int, y: int };

export const Role = z.enum(['scavenger', 'builder', 'militia']);
export type Role = z.infer<typeof Role>;

// Besluiten sprint 2:
// - Build: typeId is de gebouw-typeId (1024 + buildingId, packages/data typeIds.ts); x, y is het midden van de
//   footprint. De oorsprong (cel linksboven) is cel(x, y) - (w >> 1, h >> 1), met cel(v) = v >> 8. De HUD snapt
//   het midden op de celgrens (render: snapFootprintCenter); de sim valideert factie, kosten en vrije cellen.
//   Alleen units met de rol bouwer; wijst x, y naar een eigen bouwplaats van dit type, dan helpen ze daar.
// - Cancel: ids zijn eigen bouwplaatsen (teruggave) en/of eigen units (stoppen; een betaalde omscholing wordt
//   terugbetaald).
// - Claim: ids zijn bouwers; de sim laat hen het claimgebouw (provides `claim`) van hun factie bouwen binnen
//   claimRadiusM van het punt, als Build op de vrije plek het dichtst bij het punt (sinds sprint 3; het interim van
//   sprint 2 met claimS is weg).
// Besluiten sprint 3:
// - Recruit (buildingId): in de slice het oplappen van de gesneuvelde held. buildingId is het entity-id van het eigen
//   voltooide hoofdgebouw (provides `hq`); de sim rekent heroes.reviveScrap meteen af en de held staat reviveS later
//   naast het hoofdgebouw (HeroStatus.state reviving, daarna alive). Cancel met het hoofdgebouw stopt het oplappen
//   met teruggave. Later rekruteert hetzelfde commando op andere gebouwen (Garde-Initiate, zwervers); geen apart
//   commando.
// - Research (techId): de sim kiest zelf het eerste voltooide eigen gebouw van het type uit tech.building zonder
//   lopend onderzoek; kosten meteen. Cancel met dat gebouw stopt het onderzoek met teruggave.
// - HeroAbility: abilityId is de index in heroes.abilities van de held; zonder x, y en target geldt de positie van
//   de held. Het begin van de zone komt als event abilityZone (snapshot.ts).
// Besluiten robot-ronde (protocol 0.8.0, data 0.16.0; voorstel van content-x, bevestigd door de architect in fase-0
// sectie 20):
// - Produce (buildingId, loadoutId): een robot nieuw bouwen in een eigen voltooid gebouw waar het loadout gebouwd
//   wordt (loadouts.producedAt, de robotfabriek). Eén tegelijk per gebouw (geen onderzoek en geen andere job); de sim
//   rekent scrapCost meteen af en vraagt prereqTech en ruimte in popCapMax (bewoners plus robots, ook die in
//   productie). Na craftS staat de robot naast het gebouw. Cancel met het gebouw stopt het met teruggave. Craft en
//   SetRole weigeren een loadout met producedAt (geen omscholing van een bewoner tot robot) en een robot schoolt niet om.
// - Train (buildingId, programId): een SPECIAL-trainingsprogramma (data/training.json, programId = de index) in een
//   eigen voltooid gebouw van het type uit het programma (de trainingsfaciliteit). Eén tegelijk per gebouw en per
//   letter; kosten scrapCost + scrapCostStep maal de al getrainde punten op die letter, meteen afgerekend. Cancel met
//   het gebouw stopt het met teruggave. De punten horen bij de speler (PlayerStatus.trained), niet bij de held.
// - SetRole blijft de drie bewonersrollen; technician en robot (data 0.16.0) zijn unitrollen, geen doel van SetRole.
// Voorstel, ter bevestiging door de architect (protocol 0.15.0, data 0.29.0, sim 0.24.0; fase-0 sectie 5):
// - Guard (ids, targetId): bewaakmodus. targetId is een eigen voltooide Kooi (provides kooi, ook het Raiderkamp) of een
//   scrap-node met scrap. Alleen vechters (rol militia of robot, niet de held, geen slaaf). Ze lopen tot binnen
//   sim.json guard.standM van het doel (rand van de footprint, midden van de node), vechten met een vijand die ze zelf
//   kiezen zolang ze binnen guard.leashM van het doel blijven, en keren terug. De order blijft tot een ander commando
//   of tot het doel weg is (gesloopt, leeg). Voor de Raiders telt zo'n eenheid als bewaker van de slaven daar
//   (data/factions.json slaves.revolt); voor de Dwellers bewaakt hij gewoon de node.
export const COMMAND_PAYLOADS = {
  Move: z.object({ ids: EntityIds, ...Pos }).strict(),
  AttackMove: z.object({ ids: EntityIds, ...Pos }).strict(),
  Attack: z.object({ ids: EntityIds, target: uint }).strict(),
  Stop: z.object({ ids: EntityIds }).strict(),
  Gather: z.object({ ids: EntityIds, nodeId: uint }).strict(),
  Build: z.object({ ids: EntityIds, typeId: uint, ...Pos }).strict(),
  Cancel: z.object({ ids: EntityIds }).strict(),
  SetRole: z.object({ ids: EntityIds, role: Role }).strict(),
  Craft: z.object({ ids: EntityIds, loadoutId: uint }).strict(),
  Research: z.object({ techId: uint }).strict(),
  Recruit: z.object({ buildingId: uint }).strict(),
  Claim: z.object({ ids: EntityIds, pointId: uint }).strict(),
  HeroAbility: z
    .object({
      heroId: uint,
      abilityId: uint,
      x: int.optional(),
      y: int.optional(),
      target: uint.optional(),
    })
    .strict(),
  PickPerk: z.object({ heroId: uint, perkId: uint }).strict(),
  Surrender: z.object({}).strict(),
  Produce: z.object({ buildingId: uint, loadoutId: uint }).strict(),
  Train: z.object({ buildingId: uint, programId: uint }).strict(),
  Guard: z.object({ ids: EntityIds, targetId: uint }).strict(),
} as const;

const COMMAND_TYPE_NAMES = Object.keys(COMMAND_PAYLOADS) as [
  keyof typeof COMMAND_PAYLOADS,
  ...(keyof typeof COMMAND_PAYLOADS)[],
];
export const CommandType = z.enum(COMMAND_TYPE_NAMES);
export type CommandType = z.infer<typeof CommandType>;

export const CommandEnvelope = z
  .object({
    frame: uint, // frame waarin de speler het commando gaf; uitvoering in frame + DELAY
    playerId: uint.max(MAX_PLAYERS - 1),
    seq: uint, // oplopend per speler, voor ordening binnen een frame
    type: CommandType,
    payload: z.unknown(),
  })
  .strict()
  .superRefine((cmd, ctx) => {
    const schema = COMMAND_PAYLOADS[cmd.type];
    const r = schema.safeParse(cmd.payload);
    if (!r.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `payload ongeldig voor ${cmd.type}`,
        path: ['payload'],
      });
    }
  });
export type CommandEnvelope = z.infer<typeof CommandEnvelope>;

export type CommandPayload<T extends CommandType> = z.infer<(typeof COMMAND_PAYLOADS)[T]>;

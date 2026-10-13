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
//   claimRadiusM van het punt, als Build. Sprint 2 (interim, zie fase-0 sectie 13): ids staan claimS seconden
//   ongestoord binnen claimRadiusM.
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
    .object({ heroId: uint, abilityId: uint, x: int.optional(), y: int.optional(), target: uint.optional() })
    .strict(),
  PickPerk: z.object({ heroId: uint, perkId: uint }).strict(),
  Surrender: z.object({}).strict(),
} as const;

const COMMAND_TYPE_NAMES = Object.keys(COMMAND_PAYLOADS) as [keyof typeof COMMAND_PAYLOADS, ...(keyof typeof COMMAND_PAYLOADS)[]];
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
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `payload ongeldig voor ${cmd.type}`, path: ['payload'] });
    }
  });
export type CommandEnvelope = z.infer<typeof CommandEnvelope>;

export type CommandPayload<T extends CommandType> = z.infer<(typeof COMMAND_PAYLOADS)[T]>;

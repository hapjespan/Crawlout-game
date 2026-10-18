export interface SpawnUnitSpec {
  readonly typeId: number;
  readonly owner: number;
  readonly x: number;
  readonly y: number;
  readonly yaw?: number;
}

/** Soort entity, voor tests, debug en de query-API. */
export type EntityKind = 'unit' | 'hero' | 'corpse' | 'building' | 'scrapNode' | 'claimPoint';

/** Leesbare kijk op één entity, voor tests en debug. De renderer gebruikt snapshots, nooit dit. */
export interface UnitView {
  readonly id: number;
  readonly kind: EntityKind;
  readonly typeId: number;
  readonly owner: number;
  readonly x: number;
  readonly y: number;
  readonly yaw: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly moving: boolean;
  readonly flowField: number;
  readonly role: number;
  readonly loadoutId: number;
  /** Type van de huidige order (ORDER_* in ecs/world.ts), 0 = geen. */
  readonly order: number;
  readonly phase: number;
  readonly target: number;
  /** ordT van de huidige order: de bouwplaats bij Build, de node bij Gather, het doel bij Attack (Move: groepsstraal); 0 = geen order. */
  readonly orderTarget: number;
  /** Bouwer: de onthouden onafgemaakte bouwplaats waar hij zonder taak naar terugkeert, 0 = geen. */
  readonly resumeSite: number;
  readonly carry: number;
  /** Gebouw: 1 in aanbouw, 2 af; anders 0. */
  readonly buildState: number;
  readonly progress: number;
  /** Scrap-node: voorraad. */
  readonly amount: number;
  /** Claimpunt: wie neemt en hoe ver (ticks). */
  readonly claimBy: number;
  readonly claimProgress: number;
}

export type WinReason = 'destruction' | 'dominance' | 'surrender' | 'project';

export interface SimWinner {
  readonly playerId: number;
  readonly reason: WinReason;
  /** Frame waarin de winnaar vaststond. */
  readonly frame: number;
}

export interface CreateSimOptions {
  /** false: geen startopstelling (lege wereld, voor tests). Standaard true. */
  readonly start?: boolean;
}

/**
 * Meetpunt voor de benchmark (bench/profile.ts): tick(probe) roept probe(k) aan na stap k (TICK_STAGES). Geen klok in de
 * sim; de harnas meet de tijd tussen twee aanroepen. Zonder probe verandert er niets.
 */
export type TickProbe = (stage: number) => void;

/** Namen van de meetpunten van TickProbe, op index. */
export const TICK_STAGES = [
  'commands',
  'ai',
  'orders',
  'flow',
  'move',
  'combat',
  'economy',
  'claims',
  'cleanup',
  'vision',
  'hash',
] as const;

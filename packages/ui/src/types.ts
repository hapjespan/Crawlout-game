import type { CommandPayload, CommandType, DesyncEvent, PlayerStatus, Role, StallNotice } from '@crawlout/protocol';

/** Eén geselecteerde entity, zoals de client die uit snapshot en queryMessage samenstelt. */
export interface SelectedEntity {
  id: number;
  typeId: number;
  /** Naam van de loadout, of null als de entity er geen heeft (bijvoorbeeld een gebouw). */
  loadoutName: string | null;
  hpPct: number;
  /** Rol van een unit, of null voor gebouwen en nodes. */
  role: Role | null;
}

/** Netwerktoestand die de HUD toont: desync en stall komen uit de relay (frames.ts). */
export interface NetworkState {
  desync: DesyncEvent | null;
  stall: StallNotice | null;
}

/** Soorten doel die de HUD van de volgende wereldklik verwacht. */
export type TargetingKind = 'move' | 'attackMove' | 'gather';
export interface TargetPoint {
  x: number;
  y: number;
}
export interface TargetNode {
  nodeId: number;
}
export type TargetResult = TargetPoint | TargetNode;

/** Alles wat de HUD van buiten nodig heeft. Frame, seq en playerId vult de netwerklaag in. */
export interface HudDeps {
  /** Stuurt een commando; payload volgt COMMAND_PAYLOADS. */
  sendCommand<T extends CommandType>(type: T, payload: CommandPayload<T>): void;
  /** Laatste spelerstatus uit de queryMessage, of null zolang die er niet is. */
  getStatus(): PlayerStatus | null;
  /** Huidige selectie. */
  getSelection(): readonly SelectedEntity[];
  /** Desync en stall; optioneel, zonder is er geen melding. */
  getNetwork?(): NetworkState;
  /** Naam van een speler voor de stall-melding; valt terug op "speler N". */
  playerName?(playerId: number): string;
  /** De volgende wereldklik is een doel. De client roept daarna HudHandle.completeTargeting of cancelTargeting aan. */
  beginTargeting(kind: TargetingKind): void;
  /** Wordt aangeroepen als de HUD de targeting zelf stopt (Escape, ander commando). */
  endTargeting?(): void;
  /** Meldt wijzigingen in status, selectie of netwerk. Zonder subscribe pollt de HUD elke 250 ms. */
  subscribe?(listener: () => void): () => void;
}

export interface HudHandle {
  /** Een wereldklik die het doel van de actieve targeting is. Geeft false als er geen passende targeting actief is. */
  completeTargeting(target: TargetResult): boolean;
  cancelTargeting(): void;
  /** Forceer een nieuwe lezing van de deps. */
  refresh(): void;
  unmount(): void;
}

// The client entry's shared state (main.ts). main() creates one ClientContext and hands it to each stage in turn
// (main.boot.ts, main.state.ts, main.orders.ts, main.placement.ts, main.hud.ts, main.input.ts, main.devApi.ts). What
// used to be closure variables of main() and is used across stages lives here; a callback reads it at call time, so a
// value one stage reassigns (selection, entities, status, placing, ...) is seen by every other stage.
import type { SurvivalStatus } from '@crawlout/sim';
import type { CommandPayload, CommandType, FogMask, PlayerStatus } from '@crawlout/protocol';
import type { BuildingData, GameData } from '@crawlout/data';
import type { CrawloutRenderer } from '@crawlout/render';
import type {
  BuildOption,
  HudAlert,
  HudHandle,
  HudSkin,
  MenuMount,
  MenuSettings,
  MinimapFog,
  NetworkState,
  TargetingKind,
} from '@crawlout/ui';
import type { CardContext } from './game/cards.js';
import type { ClientMap } from './game/content.js';
import type { StartMode } from './game/menuParams.js';
import type { MinimapLayers } from './game/minimapLayers.js';
import type { raiderStats } from './game/raiders.js';
import type { SessionEvents, SessionOptions } from './game/session.js';
import type { SessionSlot } from './game/sessionSlot.js';
import type { EntityRow } from './game/snapshot.js';
import type { WsNetOptions } from './net/params.js';
import type { PerfBadge } from './net/perfBadge.js';
import type { WaterMaskData } from './render/water.js';
import type { AmbientCamera } from './ui/ambientCamera.js';

/** Where a building being placed would go under the pointer (main.placement.ts placementAt). */
export interface PlacementSpot {
  x: number;
  y: number;
  valid: boolean;
  reason: string | null;
  claimPointId?: number;
}

export interface ClientContext {
  // main.boot.ts: page elements, options, menu, game data, map and renderer
  canvas: HTMLCanvasElement;
  marquee: HTMLDivElement;
  hudEl: HTMLElement;
  endEl: HTMLElement;
  mode: StartMode;
  params: URLSearchParams;
  /** The menu's options; replaced when the player changes them. */
  settings: MenuSettings;
  perfEl: HTMLElement | null;
  hudSkin: HudSkin | undefined;
  skinOn: boolean;
  /** Starts the match: a no-op until main.hud.ts sets the real one. */
  launchMatch: (net: WsNetOptions | null, options: SessionOptions) => void;
  menu: MenuMount | null;
  data: GameData;
  map: ClientMap;
  renderer: CrawloutRenderer;
  water: WaterMaskData | null;
  minimapStatic: MinimapLayers;
  ambient: AmbientCamera | null;

  // main.state.ts: snapshot state, alerts, fog, data lookups, session
  selection: Set<number>;
  entities: Map<number, EntityRow>;
  ownCache: EntityRow[] | null;
  status: PlayerStatus | null;
  /** Survival co-op (client 0.12.0): the latest Sim.survivalStatus() with its sim frame; null outside Survival. */
  survival: { status: SurvivalStatus; frame: number } | null;
  network: NetworkState;
  listeners: Set<() => void>;
  notify: () => void;
  alertListeners: Set<(a: HudAlert) => void>;
  fogOn: boolean;
  minimapFog: MinimapFog | undefined;
  applyFog: (mask: FogMask | null) => void;
  loadoutOf: (typeId: number) => GameData['loadouts'][number] | undefined;
  heroOf: (typeId: number) => GameData['heroes'][number] | undefined;
  buildingOf: (typeId: number) => BuildingData | undefined;
  myFaction: () => GameData['factions'][number] | undefined;
  myHero: () => GameData['heroes'][number] | undefined;
  unlocked: (prereq: readonly number[]) => boolean;
  hqProvidesIdx: number;
  cardContext: (selected: readonly EntityRow[]) => CardContext;
  myHq: () => EntityRow | undefined;
  raiderStatsNow: () => ReturnType<typeof raiderStats>;
  perfBadge: PerfBadge | null;
  session: SessionSlot;
  sessionEvents: SessionEvents;
  statusPoll: number;
  fogPoll: number;

  // main.orders.ts: ownership checks and orders
  mine: (ids: Iterable<number>) => number[];
  hostileRow: (e: EntityRow) => boolean;
  isEnemyId: (id: number) => boolean;
  own: () => EntityRow[];
  canBuildId: (id: number) => boolean;
  sendChunked: <T extends CommandType>(
    type: T,
    ids: number[],
    extra: Omit<CommandPayload<T>, 'ids'>,
  ) => void;
  orderAt: (px: number, py: number) => void;

  // main.placement.ts: the build menu and the placement rule
  placing: BuildOption | null;
  buildable: () => BuildingData[];
  territoryNow: () => Uint8Array | null;
  placementReasonFor: (
    option: Pick<BuildOption, 'typeId' | 'footprint'>,
    cx: number,
    cy: number,
  ) => number;
  placementAt: (px: number, py: number) => PlacementSpot | null;

  // main.hud.ts: the HUD and the start of the match
  targeting: TargetingKind | null;
  hud: HudHandle;
}

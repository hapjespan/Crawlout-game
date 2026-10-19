// Split from fromData.ts to stay under the 5,000-token file limit; fromData.ts re-exports the public surface.
// Holds: SimMapSource, SimMapOptions, simMapFromGrid, simPlayersFromLobby.
import type { SimMap, SimPlayer } from './config.js';
import type { GameData } from '@crawlout/data';
import { CLAIM_KINDS } from './fromData.part1.js';
import { type SurvivalSource, survivalMapOf, survivalScrapNodes } from './fromData.part4.js';
import type { ClaimKind } from './fromData.part1.js';

/** Wat simMapFromGrid nodig heeft: MapGrid uit packages/map (structureel) plus de dominantie in ticks (convertDominance). */
export interface SimMapSource {
  readonly w: number;
  readonly h: number;
  readonly passable: Uint8Array;
  readonly spawns: readonly { readonly ux: number; readonly uy: number }[];
  readonly scrapNodes: readonly {
    readonly ux: number;
    readonly uy: number;
    readonly amount: number;
  }[];
  readonly claimPoints: readonly {
    readonly ux: number;
    readonly uy: number;
    readonly kind: string;
  }[];
  readonly dominance: { readonly pointsRequired: number; readonly ticks: number };
  /** Creep camps (data 0.25.0); absent = none. */
  readonly creepCamps?: readonly {
    readonly ux: number;
    readonly uy: number;
    readonly tier: number;
  }[];
  /** Win route C (map 0.11.0): the parts of the strip mall; only used with SimMapOptions.project. */
  readonly projectSites?: readonly {
    readonly ux: number;
    readonly uy: number;
    readonly part: string;
  }[];
}

/** Options of simMapFromGrid. */
export interface SimMapOptions {
  /**
   * Win route C (data 0.31.0): the game type Bouwproject (MatchSettings.mode 'project') puts the project sites of the
   * map into the sim, with their kind from these parts (GameData.project.parts). Absent: no Bouwproject (Skirmish).
   */
  readonly project?: { readonly parts: readonly { readonly key: string }[] };
  /**
   * Survival co-op (sim 0.27.0, data 0.33.0): the game type Survival (MatchSettings.mode 'survival') with
   * GameData.survival. Gives SimMap.survival (edges and build zones) and puts the spawns on the zone centres (slot =
   * playerId); sim 0.28.0 (data 0.34.0): the scrap nodes inside the zones become the fixed zone nodes of the data
   * (survivalScrapNodes). Absent: no survival.
   */
  readonly survival?: SurvivalSource | null;
}

/** MapGrid (plus dominantie in ticks) naar SimMap. */
export function simMapFromGrid(grid: SimMapSource, opts: SimMapOptions = {}): SimMap {
  const parts = opts.project?.parts;
  const sites =
    parts === undefined
      ? []
      : (grid.projectSites ?? []).map((p) => {
          const kind = parts.findIndex((k) => k.key === p.part);
          if (kind < 0) throw new Error(`onbekend projectdeel ${p.part}`);
          return { x: p.ux, y: p.uy, kind };
        });
  const survival =
    opts.survival === undefined || opts.survival === null
      ? undefined
      : survivalMapOf(grid, opts.survival);
  const mapNodes = grid.scrapNodes.map((n) => ({ x: n.ux, y: n.uy, amount: n.amount }));
  return {
    ...(sites.length === 0 ? {} : { projectSites: sites }),
    ...(survival === undefined ? {} : { survival }),
    w: grid.w,
    h: grid.h,
    passable: grid.passable,
    spawns:
      survival === undefined
        ? grid.spawns.map((s) => ({ x: s.ux, y: s.uy }))
        : survival.zones.map((z) => ({ x: z.x, y: z.y })),
    scrapNodes:
      survival === undefined
        ? mapNodes
        : survivalScrapNodes(grid, opts.survival!, survival.zones, mapNodes),
    claimPoints: grid.claimPoints.map((c) => {
      const kind = CLAIM_KINDS.indexOf(c.kind as ClaimKind);
      if (kind < 0) throw new Error(`onbekend claimpunt-soort ${c.kind}`);
      return { x: c.ux, y: c.uy, kind };
    }),
    dominance: { pointsRequired: grid.dominance.pointsRequired, ticks: grid.dominance.ticks },
    creepCamps: (grid.creepCamps ?? []).map((c) => ({ x: c.ux, y: c.uy, tier: c.tier })),
  };
}

/**
 * Spelers uit het start-bericht (LobbyPlayer[]) naar SimPlayer[], in playerId-volgorde. playerId moet 0..n-1 zijn:
 * spawns[i] hoort bij playerId i. Gooit bij een onbekende factie of een gat in de playerIds.
 */
export function simPlayersFromLobby(
  data: GameData,
  players: readonly { playerId: number; faction: string; ai: boolean }[],
): SimPlayer[] {
  const sorted = [...players].sort((a, b) => a.playerId - b.playerId);
  return sorted.map((p, i) => {
    if (p.playerId !== i)
      throw new Error(
        `playerIds moeten 0..${players.length - 1} zijn, kreeg ${p.playerId} op plek ${i}`,
      );
    const f = data.factions.find((x) => x.key === p.faction);
    if (f === undefined) throw new Error(`speler ${p.playerId}: onbekende factie ${p.faction}`);
    return { factionId: f.id, ai: p.ai };
  });
}

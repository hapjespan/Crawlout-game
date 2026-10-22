// Client entry, stage 4 (see main.ts): the build menu's options and where a building being placed may go (the HUD's
// own reasons first, then the sim's placement rule, and claim posts that snap to a claim point).
import { ANIM, OWNER_NEUTRAL, UNITS_PER_METER } from '@crawlout/protocol';
import {
  CLAIM_POINT_TYPE_ID,
  PROVIDES,
  SCRAP_NODE_TYPE_ID,
  type BuildingData,
} from '@crawlout/data';
import { snapFootprintCenter } from '@crawlout/render';
import type { BuildOption } from '@crawlout/ui';
import {
  AS_DEPOT,
  PLACE_HQ_RANGE,
  PLACE_OK,
  POINT_CLAIM,
  POINT_NODE,
  RECT_CLAIM,
  RECT_DEPOT,
  placementReason as simPlacementReason,
  territoryMask,
  type PlacementInput,
} from '@crawlout/sim/placement';
import {
  claimPlacement,
  type ClaimPlacement,
  type ClaimPointView,
  type OwnClaimSite,
} from './game/claimPlacement.js';
import { buildingName } from './game/cards.js';
import { zoneReason } from './game/survivalStatus.js';
import { placementIssue, type CellRect } from './game/placementRules.js';
import type { ClientContext, PlacementSpot } from './main.context.js';

export function wirePlacement(ctx: ClientContext): void {
  const { data, map, water, renderer, session, buildingOf, unlocked, hqProvidesIdx } = ctx;

  // Build menu: this player's faction buildings that need no research yet (tech arrives later) and are not the HQ.
  const buildable = (): BuildingData[] => {
    const faction = data.factions.find((f) => f.key === session.faction);
    if (!faction) return [];
    return data.buildings.filter(
      (b) =>
        b.factionId === faction.id && unlocked(b.prereqTech) && !b.provides.includes(hqProvidesIdx),
    );
  };
  ctx.placing = null;

  /** Why the footprint cannot go here (Dutch), or null when it can; the sim validates again on Build. */
  function hudPlacementReason(option: BuildOption, cx: number, cy: number): string | null {
    const { w, h } = option.footprint;
    const buildings: CellRect[] = [];
    for (const e of ctx.entities.values()) {
      const b = buildingOf(e.typeId);
      if (b)
        buildings.push({
          x0: (e.x >> 8) - (b.footprint.w >> 1),
          y0: (e.y >> 8) - (b.footprint.h >> 1),
          w: b.footprint.w,
          h: b.footprint.h,
        });
    }
    return placementIssue(
      {
        gridW: map.grid.w,
        gridH: map.grid.h,
        passable: map.grid.passable,
        water,
        buildings,
        scrap: ctx.status?.scrap ?? 0,
        scrapCost: option.scrapCost,
      },
      { x0: (cx >> 8) - (w >> 1), y0: (cy >> 8) - (h >> 1), w, h },
    );
  }
  /**
   * The sim's own placement rule (data 0.18.0, @crawlout/sim/placement): free footprint, a free walkable margin, the
   * aisle around a drop-off building, no scrap node or claim point; the sim validates again on Build. The reason code
   * (PLACEMENT_REASONS) is there for the preview to show why a spot is refused.
   */
  // sim 0.18.0: the Raiders' plundermarkt (provides depot) is a drop-off building too
  const DEPOT_PROVIDES = [
    PROVIDES.indexOf('hq'),
    PROVIDES.indexOf('werkplaats'),
    PROVIDES.indexOf('depot'),
  ];
  const isDepot = (b: BuildingData): boolean => b.provides.some((p) => DEPOT_PROVIDES.includes(p));
  const CLAIM_PROVIDES = PROVIDES.indexOf('claim');
  /** The sim placement rule's input from the snapshot: every building, scrap node and claim point. */
  /**
   * This player's territory (data 0.20.0, the sim's territoryMask): buildRange around every own building (sites too),
   * claimBuildRange around a finished own claim post. Rebuilt only when the own buildings change. null: no rule.
   */
  const HQ_PROVIDES = PROVIDES.indexOf('hq');
  let territoryKey = '';
  let territory: Uint8Array | null = null;
  function territoryNow(): Uint8Array | null {
    const pl = data.sim.placement;
    if (pl.buildRangeU <= 0) return null;
    const range = (pl.buildRangeU + 255) >> 8;
    const claimRange = (pl.claimBuildRangeU + 255) >> 8;
    const src: number[] = [];
    for (const e of ctx.entities.values()) {
      const b = buildingOf(e.typeId);
      if (!b || e.owner !== session.playerId) continue;
      const post = b.provides.includes(CLAIM_PROVIDES) && !b.provides.includes(HQ_PROVIDES);
      if (post && e.anim === ANIM.build) continue;
      const { w: bw, h: bh } = b.footprint;
      src.push((e.x >> 8) - (bw >> 1), (e.y >> 8) - (bh >> 1), bw, bh, post ? claimRange : range);
    }
    const key = src.join(',');
    if (key !== territoryKey || territory === null) {
      territoryKey = key;
      territory = territoryMask(map.grid.w, map.grid.h, map.grid.passable, src, src.length / 5);
    }
    return territory;
  }
  function placementInputNow(): PlacementInput {
    const rects: number[] = [];
    const points: number[] = [];
    for (const e of ctx.entities.values()) {
      const b = buildingOf(e.typeId);
      if (b) {
        const { w: bw, h: bh } = b.footprint;
        const flags =
          (isDepot(b) ? RECT_DEPOT : 0) | (b.provides.includes(CLAIM_PROVIDES) ? RECT_CLAIM : 0);
        rects.push((e.x >> 8) - (bw >> 1), (e.y >> 8) - (bh >> 1), bw, bh, flags);
      } else if (e.typeId === SCRAP_NODE_TYPE_ID) points.push(e.x, e.y, POINT_NODE);
      else if (e.typeId === CLAIM_POINT_TYPE_ID) points.push(e.x, e.y, POINT_CLAIM);
    }
    return {
      territory: territoryNow(),
      mapW: map.grid.w,
      mapH: map.grid.h,
      passable: map.grid.passable,
      rects,
      rectCount: rects.length / 5,
      points,
      pointCount: points.length / 3,
      clearance: data.sim.placement.clearanceU,
      depotClearance: data.sim.placement.depotClearanceU,
    };
  }
  /** Centres (x, y pairs, sim units) of this player's headquarters, for the distance rule of the Kooi. */
  function ownHqCentres(): number[] {
    const out: number[] = [];
    for (const e of ctx.entities.values()) {
      const b = buildingOf(e.typeId);
      if (b && e.owner === session.playerId && b.provides.includes(HQ_PROVIDES)) out.push(e.x, e.y);
    }
    return out;
  }
  const placeAsOf = (typeId: number): number => {
    const own = buildingOf(typeId);
    return own !== undefined && isDepot(own) ? AS_DEPOT : 0;
  };
  function placementReasonFor(
    option: Pick<BuildOption, 'typeId' | 'footprint'>,
    cx: number,
    cy: number,
  ): number {
    const { w, h } = option.footprint;
    // a building with a distance rule to the own headquarters (the Raiders' Kooi, data 0.21.0, sim 0.18.0)
    const rule = buildingOf(option.typeId)?.placement ?? null;
    const input = placementInputNow();
    return simPlacementReason(
      rule === null
        ? input
        : {
            ...input,
            hqRange: { hqs: ownHqCentres(), min: rule.minFromHqU, max: rule.maxFromHqU },
          },
      (cx >> 8) - (w >> 1),
      (cy >> 8) - (h >> 1),
      w,
      h,
      placeAsOf(option.typeId),
    );
  }
  /**
   * A claim building (the Claimpaal) from the build menu near a claim point is a Claim (data 0.20.0): the preview snaps
   * to the spot the sim will use and a click sends Claim (game/claimPlacement.ts). null: not a claim building, or not
   * near a claim point (then it is placed as a plain Build).
   */
  function claimPlacementFor(option: BuildOption, cx: number, cy: number): ClaimPlacement | null {
    if (!buildingOf(option.typeId)?.provides.includes(CLAIM_PROVIDES)) return null;
    const points: ClaimPointView[] = [];
    const ownSites: OwnClaimSite[] = [];
    for (const e of ctx.entities.values()) {
      if (e.typeId === CLAIM_POINT_TYPE_ID)
        points.push({
          id: e.id,
          x: e.x,
          y: e.y,
          owner: e.owner === OWNER_NEUTRAL ? null : e.owner,
        });
      const b = buildingOf(e.typeId);
      if (
        b &&
        e.owner === session.playerId &&
        e.anim === ANIM.build &&
        b.provides.includes(CLAIM_PROVIDES)
      ) {
        const { w: fw, h: fh } = b.footprint;
        ownSites.push({
          x: e.x,
          y: e.y,
          fx: (e.x >> 8) - (fw >> 1),
          fy: (e.y >> 8) - (fh >> 1),
          fw,
          fh,
        });
      }
    }
    return claimPlacement({
      input: placementInputNow(),
      cursor: { x: cx, y: cy },
      footprint: option.footprint,
      as: placeAsOf(option.typeId),
      claimRadius: data.sim.claimRadiusU,
      points,
      ownSites,
      me: session.playerId,
      scrap: ctx.status?.scrap ?? 0,
      scrapCost: option.scrapCost,
    });
  }
  /** Dutch text per sim reason code (index = code); PLACE_OK has none. */
  const SIM_REASON_TEXT: readonly (string | null)[] = [
    null,
    'Overlapt een gebouw of onbegaanbaar terrein',
    'Te weinig vrije, begaanbare ruimte rondom',
    'Te dicht bij een ander gebouw',
    'Te dicht bij een afleverpunt (houd een looppad vrij)',
    'Staat op een scrapbron of claimpunt',
    `Buiten je gebied (bouw binnen ${data.sim.placement.buildRangeU >> 8} m van je gebouwen, ${data.sim.placement.claimBuildRangeU >> 8} m van een claimpaal)`,
    'Te ver van of te dicht bij je hoofdgebouw (een Kooi staat aan de rand van je basis)',
  ];
  /** Why the footprint cannot go here (Dutch), or null when it can: the clear HUD reasons first, then the sim rule. */
  function placementReason(option: BuildOption, cx: number, cy: number): string | null {
    const hud = hudPlacementReason(option, cx, cy);
    if (hud) return hud;
    // survival co-op: outside the own build zone (the sim's PLACE_ZONE; its rule is not in the sim placement module)
    const { w, h } = option.footprint;
    const zone = zoneReason(
      session.survivalZones()?.[session.playerId] ?? null,
      (cx >> 8) - (w >> 1),
      (cy >> 8) - (h >> 1),
      w,
      h,
      buildingOf(option.typeId)?.provides.includes(CLAIM_PROVIDES) === true,
    );
    if (zone !== null) return zone;
    const code = placementReasonFor(option, cx, cy);
    if (code === PLACE_HQ_RANGE) {
      // the Kooi's rule, in meters from the data: "Kooi moet aan de rand van je basis staan (18–34 m van het kamp)"
      const rule = buildingOf(option.typeId)?.placement;
      const key = buildingOf(option.typeId)?.key ?? '';
      return rule
        ? `${buildingName(key)} moet aan de rand van je basis staan (${Math.round(rule.minFromHqU / UNITS_PER_METER)}–${Math.round(rule.maxFromHqU / UNITS_PER_METER)} m van het kamp)`
        : SIM_REASON_TEXT[code]!;
    }
    return code === PLACE_OK ? null : (SIM_REASON_TEXT[code] ?? 'Hier kun je niet bouwen');
  }

  function placementAt(px: number, py: number): PlacementSpot | null {
    if (!ctx.placing) return null;
    const ground = renderer.pickAt(px, py).ground;
    if (!ground) return null;
    const at = snapFootprintCenter(ground.x, ground.y, ctx.placing.footprint);
    const claim = claimPlacementFor(ctx.placing, Math.round(at.x), Math.round(at.y));
    if (claim)
      return {
        x: claim.x,
        y: claim.y,
        valid: claim.valid,
        reason: claim.reason,
        claimPointId: claim.pointId,
      };
    const reason = placementReason(ctx.placing, at.x, at.y);
    return { x: Math.round(at.x), y: Math.round(at.y), valid: reason === null, reason };
  }

  ctx.buildable = buildable;
  ctx.territoryNow = territoryNow;
  ctx.placementReasonFor = placementReasonFor;
  ctx.placementAt = placementAt;
}

// Client entry, stage 7 (see main.ts): window.crawlout, the handle for the browser tests, the render bench and dev.
import { UNITS_PER_METER } from '@crawlout/protocol';
import { buildingTypeId, unitTypeId } from '@crawlout/data';
import { runBaseBench } from './render/bench.js';
import type { ClientContext } from './main.context.js';

export function exposeDevApi(ctx: ClientContext): void {
  const { data, renderer, session, menu, own, applyFog, territoryNow, placementReasonFor } = ctx;

  (window as unknown as { crawlout: unknown }).crawlout = {
    renderer,
    session,
    /** The pre-match menu (null when the URL started the match directly); for the browser tests. */
    menu,
    /** Scripted camera run for the render bench (render/bench.ts): base turn, pan to the middle, wide turns. */
    bench: (opts?: { seconds?: number }) => {
      const mine = own();
      const n = Math.max(1, mine.length);
      const bounds = renderer.cameraControls.bounds;
      return runBaseBench(
        renderer,
        bounds ? bounds.maxX : 384,
        [
          mine.reduce((a, e) => a + e.x, 0) / n / UNITS_PER_METER,
          mine.reduce((a, e) => a + e.y, 0) / n / UNITS_PER_METER,
        ],
        opts,
      );
    },
    entities: () => ctx.entities,
    status: () => ctx.status,
    /** Unit type id of a loadout by data key (-1 if unknown), so a browser test never hard-codes ids that shift with new data. */
    unitTypeId: (key: string): number => {
      const l = data.loadouts.find((x) => x.key === key);
      return l ? unitTypeId(l.id) : -1;
    },
    /** Fog of war, dev and tests (tools/replay hud-clicks): true shows every entity, false only what this player sees. */
    revealAll: (on: boolean) => {
      // The sim's reveal-all view shows every entity: the fog of war goes with it, and returns when switched off.
      ctx.fogOn = !on;
      if (on) applyFog(null);
      else session.requestFog();
      session.revealAll(on);
    },
    /** This player's territory mask (1 per cell, map width), for a later territory overlay in render or the HUD. */
    territory: () => territoryNow(),
    /** For the real-browser HUD test (tools/replay hud-clicks): building type ids by data key, and the sim's rule. */
    placement: {
      typeId: (key: string): number => {
        const b = data.buildings.find((x) => x.key === key);
        return b ? buildingTypeId(b.id) : -1;
      },
      footprint: (key: string) => data.buildings.find((x) => x.key === key)?.footprint,
      /** Sim reason code (PLACE_OK = 0) for the building with this data key centred on (cx, cy) in sim units. */
      reason: (key: string, cx: number, cy: number): number => {
        const b = data.buildings.find((x) => x.key === key);
        return b
          ? placementReasonFor({ typeId: buildingTypeId(b.id), footprint: b.footprint }, cx, cy)
          : -1;
      },
    },
  };
}

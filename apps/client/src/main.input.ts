// Client entry, stage 6 (see main.ts): pointer and keyboard on the map (select, drag a marquee, place, target, give
// orders), HUD panels that keep the pointer from the camera, and the cleanup when the page goes.
import { ENTITY_FLAG } from '@crawlout/protocol';
import { kindOfTypeId } from '@crawlout/data';
import { placementCommand } from './game/claimPlacement.js';
import { leftClickIs, nextSelection, type ClickMode } from './game/clickRules.js';
import type { ClientContext } from './main.context.js';

/** A press that moves less than this is a click, not a drag: trackpad clicks often wobble a few pixels. */
const DRAG_THRESHOLD_PX = 8;
/** A drag this small that catches no unit counts as a click at the press point. */
const SMALL_DRAG_PX = 24;

export function wireInput(ctx: ClientContext): void {
  const {
    canvas,
    marquee,
    hudEl,
    renderer,
    session,
    hud,
    perfBadge,
    statusPoll,
    fogPoll,
    notify,
    mine,
    hostileRow,
    isEnemyId,
    canBuildId,
    sendChunked,
    orderAt,
    placementAt,
  } = ctx;

  // Pointer: left click/drag selects (shift adds); while placing or targeting a left click picks the spot.
  let drag: { x: number; y: number; moved: boolean } | null = null;
  const local = (e: PointerEvent | MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  /**
   * The HUD ends targeting and placement on its own (finished order, Escape, empty selection) and tells us through
   * endTargeting and endPlacement. If that ever goes missing, a stale mode would swallow every click and nothing
   * could be selected any more: so check with the HUD before treating a click as a target or a placement.
   */
  const syncModes = (): void => {
    if (ctx.targeting && !hud.targetingActive()) {
      ctx.targeting = null;
      canvas.style.cursor = 'default';
    }
    if (ctx.placing && !hud.placementActive()) {
      ctx.placing = null;
      renderer.setPlacementPreview(null);
      canvas.style.cursor = 'default';
    }
  };
  const endDrag = (): void => {
    marquee.style.display = 'none';
    drag = null;
  };
  canvas.addEventListener('pointerdown', (e) => {
    // Ctrl+click is the Mac right click: the contextmenu event that follows gives the order.
    if (e.button !== 0 || e.ctrlKey) return;
    const p = local(e);
    syncModes();
    if (ctx.placing || ctx.targeting) {
      const hit = renderer.pickAt(p.x, p.y);
      const picked = hit.entityId === null ? undefined : ctx.entities.get(hit.entityId);
      const hitKind = picked ? kindOfTypeId(picked.typeId).kind : 'none';
      const state: ClickMode = ctx.placing
        ? { mode: 'placement' }
        : { mode: 'targeting', kind: ctx.targeting! };
      const hostile = picked !== undefined && hostileRow(picked);
      // A ghost is no target (the sim refuses it): a click on one is a click on its spot.
      const ghost = picked !== undefined && (picked.flags & ENTITY_FLAG.ghost) !== 0;
      if (leftClickIs(state, hitKind, hostile) === 'complete') {
        if (ctx.placing) {
          const at = placementAt(p.x, p.y);
          if (at?.valid && at.claimPointId !== undefined) {
            // a claim post at a claim point: Claim, so the sim places it next to the point (claimPlacement.ts)
            const builders = mine(ctx.selection).filter(canBuildId);
            const order = placementCommand(at, ctx.placing.typeId, builders);
            if (builders.length > 0 && order.type === 'Claim')
              sendChunked('Claim', builders, { pointId: order.payload.pointId });
            hud.cancelPlacement();
            syncModes();
          } else if (at?.valid && hud.completePlacement({ x: at.x, y: at.y })) {
            ctx.placing = null;
            renderer.setPlacementPreview(null);
            canvas.style.cursor = 'default';
          }
        } else if (picked && hostile && !ghost && (hitKind === 'unit' || hitKind === 'building')) {
          hud.completeTargeting({ enemyId: picked.id, x: picked.x, y: picked.y });
        } else if (
          (ctx.targeting === 'gather' || ctx.targeting === 'guard') &&
          picked &&
          hitKind === 'scrapNode'
        ) {
          hud.completeTargeting({ nodeId: picked.id });
        } else if (ctx.targeting === 'claim' && picked && hitKind === 'claimPoint') {
          // Claim: de bouwers zetten het claimgebouw van hun factie bij dit punt (contract 2 Claim)
          hud.completeTargeting({ pointId: picked.id });
        } else if (ctx.targeting === 'guard' && picked && hitKind === 'building' && !hostile) {
          // Bewaak on an own building: the sim takes a Kooi (or the Raiderkamp) and refuses anything else
          hud.completeTargeting({ ownId: picked.id });
        } else if (hit.ground) {
          hud.completeTargeting({ x: Math.round(hit.ground.x), y: Math.round(hit.ground.y) });
        }
        return;
      }
      // A click on a unit or building leaves placement or targeting and selects what was clicked (pointerup).
      hud.cancelPlacement();
      hud.cancelTargeting();
      syncModes();
    }
    canvas.setPointerCapture(e.pointerId);
    drag = { ...p, moved: false };
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (ctx.placing) {
      const at = placementAt(p.x, p.y);
      renderer.setPlacementPreview(
        at ? { typeId: ctx.placing.typeId, x: at.x, y: at.y, valid: at.valid } : null,
      );
      hud.setPlacementHint(at?.reason ?? null);
      return;
    }
    if (!drag) return;
    if (!drag.moved && Math.hypot(p.x - drag.x, p.y - drag.y) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    marquee.style.display = 'block';
    marquee.style.left = `${Math.min(p.x, drag.x)}px`;
    marquee.style.top = `${Math.min(p.y, drag.y)}px`;
    marquee.style.width = `${Math.abs(p.x - drag.x)}px`;
    marquee.style.height = `${Math.abs(p.y - drag.y)}px`;
  });
  canvas.addEventListener('pointerup', (e) => {
    if (e.button !== 0 || !drag) return;
    const p = local(e);
    let ids = drag.moved
      ? renderer.boxSelect(
          { x0: drag.x, y0: drag.y, x1: p.x, y1: p.y },
          { owner: session.playerId },
        )
      : [];
    if (ids.length === 0 && Math.hypot(p.x - drag.x, p.y - drag.y) < SMALL_DRAG_PX) {
      // A click, or a tiny drag that caught nobody: pick where the press started (buildings by their whole drawn volume, see the renderer's pick box).
      const hit = renderer.pickAt(drag.x, drag.y).entityId;
      ids = hit === null ? [] : [hit];
    }
    ctx.selection = nextSelection(ctx.selection, ids, e.shiftKey, isEnemyId);
    endDrag();
    notify();
  });
  // A press that never gets its pointerup (cancelled by the system, capture lost) must not leave the marquee on screen.
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    syncModes();
    if (ctx.placing) return hud.cancelPlacement();
    if (ctx.targeting) return hud.cancelTargeting();
    const p = local(e);
    orderAt(p.x, p.y);
  });

  // Edge scroll follows the pointer over the whole window, so a pointer resting on a panel near the screen edge kept
  // scrolling the map away. Pointer moves over HUD panels no longer reach the camera; one synthetic blur on entering a
  // panel makes it forget the last canvas position (and stop scrolling) until the pointer is over the canvas again.
  let overPanel = false;
  hudEl.addEventListener('pointermove', (e) => {
    e.stopPropagation();
    if (!overPanel) {
      overPanel = true;
      window.dispatchEvent(new Event('blur'));
    }
  });
  canvas.addEventListener('pointermove', () => {
    overPanel = false;
  });

  // Escape that the HUD did not use (no mode, menu or dialog to close) clears the selection, so a new pick is always free.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || ctx.selection.size === 0) return;
    ctx.selection = new Set();
    notify();
  });

  window.addEventListener('beforeunload', () => {
    perfBadge?.dispose();
    window.clearInterval(statusPoll);
    window.clearInterval(fogPoll);
    session.dispose();
    hud.unmount();
    renderer.dispose();
  });
}

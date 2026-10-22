import { describe, expect, it, vi } from 'vitest';
import { act } from 'preact/test-utils';
import type { SelectedEntity } from './index.js';
import { keepMounted, q, registerMountHooks, setup } from './hud.buildings.helpers.js';

// The HUD against a small model of the game (see hud.buildings.helpers.ts).
registerMountHooks();

describe('klikken die niet verloren gaan', () => {
  it('de kaartknop blijft hetzelfde DOM-element terwijl de HUD elke snapshot opnieuw rendert', () => {
    const t = setup({ selection: [11] });
    keepMounted(t.handle);
    const before = q(t.el, '[data-card-id="1"]');
    for (let i = 0; i < 5; i++) t.tick();
    expect(q(t.el, '[data-card-id="1"]')).toBe(before);
  });

  it('pointerdown en pointerup op dezelfde kaart starten hem één keer, ook zonder click', () => {
    const t = setup({ selection: [11] });
    keepMounted(t.handle);
    const card = q(t.el, '[data-card-id="1"]');
    act(() => {
      card.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      card.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    });
    expect(t.model.queue).toHaveLength(1);
    // de click die bij dezelfde druk hoort, telt niet nog een keer
    expect(t.sent).toHaveLength(1);
  });

  it('indrukken op de ene kaart en loslaten op een andere start niets', () => {
    const t = setup({ selection: [11] });
    keepMounted(t.handle);
    act(() => {
      q(t.el, '[data-card-id="1"]').dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0 }),
      );
      q(t.el, '[data-card-id="2"]').dispatchEvent(
        new MouseEvent('pointerup', { bubbles: true, button: 0 }),
      );
    });
    expect(t.sent).toEqual([]);
  });

  it('muis en pointer-events op het HUD bereiken niets daarbuiten', () => {
    const t = setup({ selection: [11] });
    keepMounted(t.handle);
    const outside = vi.fn();
    document.body.addEventListener('pointerdown', outside);
    document.body.addEventListener('mousedown', outside);
    document.body.addEventListener('click', outside);
    document.body.addEventListener('contextmenu', outside);
    const card = q(t.el, '[data-card-id="2"]');
    act(() => {
      card.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      card.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });
    expect(outside).not.toHaveBeenCalled();
    document.body.removeEventListener('pointerdown', outside);
  });
});

describe("context-gevoelige commando's", () => {
  const unit = (id: number, role: SelectedEntity['role'], typeId = 3): SelectedEntity => ({
    id,
    typeId,
    loadoutName: 'x',
    hpPct: 100,
    role,
  });
  const actionsOf = (el: HTMLElement): string[] =>
    [...el.querySelectorAll('.co-buttons [data-action]')].map((b) =>
      b.getAttribute('data-action')!,
    );

  it('zonder selectie staat er alleen een hint', () => {
    const t = setup();
    keepMounted(t.handle);
    expect(actionsOf(t.el)).toEqual([]);
    expect(q(t.el, '.co-commands').textContent).toContain('Selecteer een eenheid of gebouw');
  });

  it('bouwer: Verplaats, Stop, Bouw en de andere rollen; geen Val aan', () => {
    const t = setup({ units: [unit(1, 'builder')] });
    keepMounted(t.handle);
    expect(actionsOf(t.el)).toEqual(['move', 'stop', 'build', 'roleScavenger', 'roleMilitia']);
  });

  it('plunderaar: Verplaats, Stop, Verzamel', () => {
    const t = setup({ units: [unit(1, 'scavenger')] });
    keepMounted(t.handle);
    expect(actionsOf(t.el)).toEqual(['move', 'stop', 'gather', 'roleBuilder', 'roleMilitia']);
  });

  it('militie: Verplaats, Stop, Val aan', () => {
    const t = setup({ units: [unit(1, 'militia')] });
    keepMounted(t.handle);
    expect(actionsOf(t.el)).toEqual([
      'move',
      'stop',
      'attackMove',
      'guard',
      'roleScavenger',
      'roleBuilder',
    ]);
  });

  it('een robot (geen rol): Verplaats, Stop, Val aan en geen rolknoppen', () => {
    const t = setup({ units: [unit(1, null)] });
    keepMounted(t.handle);
    expect(actionsOf(t.el)).toEqual(['move', 'stop', 'attackMove', 'guard']);
  });

  it('een geselecteerd gebouw heeft geen commando-knoppen maar een hint', () => {
    const t = setup({ selection: [11] });
    keepMounted(t.handle);
    expect(actionsOf(t.el)).toEqual([]);
    expect(q(t.el, '.co-commands').textContent).toContain('Kies hierboven');
  });

  it('Held-, Craft- en Minimap-knoppen bestaan niet meer', () => {
    const t = setup({ units: [unit(1, 'builder')] });
    keepMounted(t.handle);
    for (const id of ['hero', 'craft', 'minimap'])
      expect(t.el.querySelector(`[data-action="${id}"]`)).toBeNull();
  });
});

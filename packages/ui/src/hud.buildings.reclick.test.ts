import { describe, expect, it } from 'vitest';
import { act } from 'preact/test-utils';
import type { SelectedEntity, TargetingKind } from './index.js';
import { keepMounted, press, q, registerMountHooks, setup } from './hud.buildings.helpers.js';

// The HUD against a small model of the game (see hud.buildings.helpers.ts).
registerMountHooks();

describe('plaatsing van het kaartenvenster', () => {
  it('het kaartenvenster staat in dezelfde kolom direct boven de commando-kaart', () => {
    const t = setup({ selection: [11] });
    keepMounted(t.handle);
    const col = q(t.el, '.co-right-col');
    const kids = [...col.children].map((c) => c.className);
    expect(kids[0]).toContain('co-cards');
    expect(kids[1]).toContain('co-commands');
  });
});

describe('targeting zonder vastlopers', () => {
  it('een afgeronde order meldt endTargeting, zodat de client geen klikken meer opslokt', () => {
    const t = setup({
      units: [{ id: 1, typeId: 3, loadoutName: 'x', hpPct: 100, role: 'militia' }],
    });
    keepMounted(t.handle);
    const kinds: TargetingKind[] = [];
    press('m');
    expect(t.handle.targetingActive()).toBe(true);
    act(() => void t.handle.completeTargeting({ x: 5, y: 5 }));
    expect(t.handle.targetingActive()).toBe(false);
    expect(t.model.targetingEnded).toBe(1);
    expect(kinds).toEqual([]);
  });
});

describe('robots in de bovenbalk', () => {
  it('toont de robot-pop naast de pop', () => {
    const t = setup();
    keepMounted(t.handle);
    expect(q(t.el, '[aria-label="Voorraad en bewoners"]').textContent).not.toContain('Robots');
    t.model.robotPop = 4;
    t.tick();
    const text = q(t.el, '[aria-label="Voorraad en bewoners"]').textContent!;
    expect(text).toContain('Robots');
    expect(text).toContain('4');
  });
});

describe('altijd opnieuw kunnen klikken', () => {
  const militia: SelectedEntity = {
    id: 1,
    typeId: 3,
    loadoutName: 'x',
    hpPct: 100,
    role: 'militia',
  };

  it('gebouw selecteren en dan op lege grond klikken sluit het kaartenvenster en reset de commando-kaart', () => {
    const t = setup();
    keepMounted(t.handle);
    t.clickWorld(11);
    expect(t.el.querySelector('.co-cards')).not.toBeNull();
    act(() => {
      t.model.selection = []; // click on empty ground: the client clears the selection
      t.handle.refresh();
    });
    expect(t.el.querySelector('.co-cards')).toBeNull();
    expect(q(t.el, '.co-commands').textContent).toContain('Selecteer een eenheid of gebouw');
    expect(t.el.querySelectorAll('.co-buttons [data-action]')).toHaveLength(0);
  });

  it('eenheid selecteren en dan op lege grond klikken laat niets geselecteerd', () => {
    const t = setup({ units: [militia] });
    keepMounted(t.handle);
    expect(t.el.querySelectorAll('.co-buttons [data-action]').length).toBeGreaterThan(0);
    act(() => {
      t.model.units = [];
      t.handle.refresh();
    });
    expect(q(t.el, '.co-selection').textContent).toContain('Niets geselecteerd');
    expect(t.el.querySelectorAll('.co-buttons [data-action]')).toHaveLength(0);
  });

  it('gebouw geselecteerd en dan een eenheid aanklikken: de eenheid is geselecteerd en het kaartenvenster weg', () => {
    const t = setup();
    keepMounted(t.handle);
    t.clickWorld(11);
    act(() => {
      t.model.selection = [];
      t.model.units = [militia];
      t.handle.refresh();
    });
    expect(t.el.querySelector('.co-cards')).toBeNull();
    expect(q(t.el, '[data-action="attackMove"]')).not.toBeNull();
  });

  it('een open commandomodus (targeting) stopt als de selectie leeg wordt', () => {
    const t = setup({ units: [militia] });
    keepMounted(t.handle);
    press('m');
    expect(t.handle.targetingActive()).toBe(true);
    act(() => {
      t.model.units = [];
      t.handle.refresh();
    });
    expect(t.handle.targetingActive()).toBe(false);
    expect(t.model.targetingEnded).toBe(1);
  });
});

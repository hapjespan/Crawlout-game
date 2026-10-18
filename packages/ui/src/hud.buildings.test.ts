import { describe, expect, it, vi } from 'vitest';
import { act } from 'preact/test-utils';
import { click, keepMounted, q, registerMountHooks, setup } from './hud.buildings.helpers.js';

// The HUD against a small model of the game (see hud.buildings.helpers.ts).
registerMountHooks();

describe('gebouwenpaneel', () => {
  it('toont alle eigen gebouwen per type, met aantal ("Woning ×3")', () => {
    const t = setup();
    keepMounted(t.handle);
    const names = [...t.el.querySelectorAll('.co-building-btn .co-building-name')].map(
      (e) => e.textContent,
    );
    expect(names).toEqual(['Basis', 'Werkplaats', 'Lab', 'Woning', 'Robotfabriek', 'Training']);
    expect(q(t.el, '[data-building="woning"]').textContent).toContain('×3');
    expect(q(t.el, '[data-building="lab"]').textContent).not.toContain('×');
  });

  it('toont een badge met het aantal beschikbare acties en geen badge als er niets is', () => {
    const t = setup();
    keepMounted(t.handle);
    expect(q(t.el, '[data-building="werkplaats"] .co-building-badge').textContent).toBe('1');
    expect(t.el.querySelector('[data-building="woning"] .co-building-badge')).toBeNull();
  });

  it('toont voortgang zolang er iets loopt', () => {
    const t = setup();
    keepMounted(t.handle);
    t.model.queue = [{ kind: 'research', buildingId: 11, unitId: 0, id: 1, progressPermille: 450 }];
    t.tick();
    const bar = q(t.el, '[data-building="werkplaats"] [role="progressbar"]');
    expect(bar.getAttribute('aria-valuenow')).toBe('45');
    expect(q(t.el, '[data-building="werkplaats"]').classList.contains('co-busy')).toBe(true);
  });

  it('een klik selecteert het gebouw en opent zijn kaarten; klik op een kaart start het onderzoek', () => {
    const t = setup();
    keepMounted(t.handle);
    expect(t.el.querySelector('.co-cards')).toBeNull();
    click(q(t.el, '[data-building="werkplaats"]'));
    expect(t.model.selection).toEqual([11]);
    expect(q(t.el, '.co-cards').textContent).toContain('Geweerrek');
    click(q(t.el, '[data-card-id="1"]'));
    expect(t.sent).toEqual([{ type: 'Research', payload: { techId: 1 } }]);
    expect(t.model.queue).toHaveLength(1);
    expect(t.model.queue[0]).toMatchObject({ kind: 'research', id: 1, buildingId: 11 });
  });

  it('dezelfde route via een wereldklik op het gebouw', () => {
    const t = setup();
    keepMounted(t.handle);
    t.clickWorld(11);
    click(q(t.el, '[data-card-id="1"]'));
    expect(t.model.queue).toHaveLength(1);
    expect(t.model.scrap).toBe(200);
  });

  it('klikken met meerdere gebouwen van een type loopt ze om en zet de camera op elk gebouw; dubbelklik loopt niet verder', () => {
    const t = setup();
    keepMounted(t.handle);
    const btn = (): HTMLElement => q(t.el, '[data-building="woning"]');
    click(btn());
    expect(t.model.selection).toEqual([13]);
    expect(t.focus).toEqual([[300, 0]]); // a single click already moves the camera
    click(btn());
    expect(t.model.selection).toEqual([14]);
    expect(t.focus.at(-1)).toEqual([400, 0]);
    click(btn());
    click(btn());
    expect(t.model.selection).toEqual([13]); // rond
    const before = t.focus.length;
    act(() => void btn().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(t.focus.length).toBe(before + 1);
    expect(t.focus.at(-1)).toEqual([300, 0]);
    expect(t.model.selection).toEqual([13]); // dubbelklik loopt niet verder om
  });

  it('shift-klik op een gebouwknop voegt toe en laat de camera staan', () => {
    const t = setup();
    keepMounted(t.handle);
    act(
      () =>
        void q(t.el, '[data-building="werkplaats"]').dispatchEvent(
          new MouseEvent('click', { bubbles: true, shiftKey: true }),
        ),
    );
    expect(t.focus).toEqual([]);
  });

  it('een geselecteerd gebouwtype is gemarkeerd', () => {
    const t = setup();
    keepMounted(t.handle);
    t.clickWorld(12);
    expect(q(t.el, '[data-building="lab"]').getAttribute('aria-pressed')).toBe('true');
    expect(q(t.el, '[data-building="werkplaats"]').getAttribute('aria-pressed')).toBe('false');
  });

  it('robotfabriek en trainingsfaciliteit starten Produce en Train met het gebouw erbij', () => {
    const t = setup();
    keepMounted(t.handle);
    click(q(t.el, '[data-building="robotfabriek"]'));
    expect(q(t.el, '[aria-label="Robotfabriek"]')).not.toBeNull();
    click(q(t.el, '[data-card-kind="produce"]'));
    click(q(t.el, '[data-building="trainingsfaciliteit"]'));
    expect(q(t.el, '[aria-label="Training"]')).not.toBeNull();
    click(q(t.el, '[data-card-kind="train"]'));
    expect(t.sent).toEqual([
      { type: 'Produce', payload: { buildingId: 16, loadoutId: 7 } },
      { type: 'Train', payload: { buildingId: 17, programId: 0 } },
    ]);
  });
});

describe('kaarten die niet starten', () => {
  it('een vergrendelde kaart toont zijn reden, ook als tooltip, en klikken geeft de melding', () => {
    const t = setup({ selection: [11] });
    keepMounted(t.handle);
    const locked = q(t.el, '[data-card-id="2"]');
    expect(locked.getAttribute('aria-disabled')).toBe('true');
    expect(locked.textContent).toContain('Vereist: Geweerrek');
    expect(locked.getAttribute('title')).toBe('Vergrendeld: vereist Geweerrek');
    click(locked);
    expect(t.sent).toEqual([]);
    expect(q(t.el, '.co-card-notice').textContent).toBe('Vergrendeld: vereist Geweerrek');
  });

  it('een te dure kaart legt uit waarom, en er verdwijnt geen scrap', () => {
    const t = setup({ selection: [11], scrap: 40 });
    keepMounted(t.handle);
    const card = q(t.el, '[data-card-id="1"]');
    expect(card.getAttribute('aria-disabled')).toBe('true');
    click(card);
    expect(t.sent).toEqual([]);
    expect(t.model.scrap).toBe(40);
    expect(q(t.el, '.co-card-notice').textContent).toContain('Te duur');
  });

  it('een lopend onderzoek toont als running (de kaart start niet opnieuw)', () => {
    const t = setup({ selection: [12] });
    keepMounted(t.handle);
    t.model.queue = [{ kind: 'research', buildingId: 11, unitId: 0, id: 1, progressPermille: 100 }];
    t.model.selection = [11];
    t.tick();
    const running = q(t.el, '[data-card-id="1"]');
    expect(running.closest('li')!.getAttribute('data-state')).toBe('running');
  });

  it('de melding verdwijnt vanzelf', () => {
    vi.useFakeTimers();
    const t = setup({ selection: [11] });
    keepMounted(t.handle);
    click(q(t.el, '[data-card-id="2"]'));
    expect(t.el.querySelector('.co-card-notice')).not.toBeNull();
    act(() => void vi.advanceTimersByTime(4000));
    expect(t.el.querySelector('.co-card-notice')).toBeNull();
  });
});

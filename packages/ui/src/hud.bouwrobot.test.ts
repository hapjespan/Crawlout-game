import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'preact/test-utils';
import type { CommandType, PlayerStatus } from '@crawlout/protocol';
import { unitTypeId } from '@crawlout/data';
import { mountHud } from './index.js';
import { portraitOfEntity, portraitOfGroup } from './portraits.js';
import type { HudDeps, HudHandle, SelectedEntity } from './index.js';

// The Bouwrobot (data 0.26.0): a robot that builds. The client gives it role builder and robot: true; the command card
// shows Verplaats, Stop and Bouw (like a bouwer), never a role switch (a robot never retrains) and never Val aan.

const status: PlayerStatus = {
  playerId: 0,
  scrap: 500,
  settlers: 5,
  pop: 6,
  popCap: 8,
  beds: 8,
  hero: null,
  queue: [],
  dominance: { pointsHeld: 0, pointsRequired: 2, ticksHeld: 0, ticksRequired: 9600, leader: null },
  noBedPop: 1,
  trained: [0, 0, 0, 0, 0, 0, 0],
  claimPoints: [],
};

const unit = (over: Partial<SelectedEntity>): SelectedEntity => ({
  id: 1,
  typeId: unitTypeId(1),
  loadoutName: 'Bouwrobot',
  hpPct: 100,
  role: 'builder',
  robot: true,
  ...over,
});

function setup(over: Partial<HudDeps> = {}) {
  const sent: { type: CommandType; payload: unknown }[] = [];
  const state: { selection: SelectedEntity[] } = { selection: [] };
  const deps: HudDeps = {
    sendCommand: (type, payload) => void sent.push({ type, payload }),
    getStatus: () => status,
    getSelection: () => state.selection,
    beginTargeting: () => {},
    startCard: () => undefined,
    canSwitchRole: () => true,
    ...over,
  };
  const el = document.createElement('div');
  document.body.appendChild(el);
  let handle!: HudHandle;
  act(() => {
    handle = mountHud(el, deps);
  });
  const select = (s: SelectedEntity[]): void => {
    state.selection = s;
    act(() => handle.refresh());
  };
  return { el, handle, sent, select };
}

const actions = (el: HTMLElement): string[] =>
  [...el.querySelectorAll('.co-buttons [data-action]')].map((b) => b.getAttribute('data-action')!);

let mounted: HudHandle | null = null;
beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('Bouwrobot in the HUD', () => {
  it('gets Verplaats, Stop and Bouw, no role switch and no Val aan, even with a workshop', () => {
    const t = setup();
    mounted = t.handle;
    t.select([unit({})]);
    expect(actions(t.el)).toEqual(['move', 'stop', 'build', 'claim']);
    expect(t.el.querySelector('.co-selection')!.textContent).toContain('Bouwrobot');
    // a human bouwer with him: the role buttons are for the human only
    t.select([unit({}), unit({ id: 2, loadoutName: 'Bouwer', robot: false })]);
    expect(actions(t.el)).toEqual(['move', 'stop', 'build', 'claim', 'roleScavenger', 'roleMilitia']);
    act(() => void (t.el.querySelector('[data-action="roleMilitia"]') as HTMLElement).click());
    expect(t.sent).toEqual([{ type: 'SetRole', payload: { ids: [2], role: 'militia' } }]);
  });

  it('has the robot portrait, not the bouwer face', () => {
    expect(portraitOfEntity(unit({}))).toBe('robot');
    expect(portraitOfGroup('bouwrobot')).toBe('robot');
    expect(portraitOfEntity(unit({ loadoutName: 'Bouwer', robot: false }))).not.toBe('robot');
  });
});

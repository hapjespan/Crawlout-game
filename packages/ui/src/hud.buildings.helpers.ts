import { afterEach, beforeEach, vi } from 'vitest';
import { act } from 'preact/test-utils';
import type { CommandPayload, CommandType, PlayerStatus } from '@crawlout/protocol';
import { mountHud } from './index.js';
import type { BuildingButton, BuildingCard, HudDeps, HudHandle, SelectedEntity } from './index.js';

// A small model of the game the HUD talks to: buildings, a selection, a scrap stock and a work queue. The deps read
// it the way the client does, so "select a building, click a card, the queue has the research" runs end to end
// without a browser (the real-browser version lives in tools/replay/src/hud-clicks.ts).

const WORKSHOP = 1024 + 2;
const LAB = 1024 + 8;
const HOUSE = 1024 + 1;
const FACTORY = 1024 + 7;
const TRAINING = 1024 + 9;
const HQ = 1024;

interface Site {
  id: number;
  typeId: number;
  key: string;
  naam: string;
  x: number;
  y: number;
}
const SITES: Site[] = [
  { id: 10, typeId: HQ, key: 'hoofdgebouw', naam: 'Basis', x: 0, y: 0 },
  { id: 11, typeId: WORKSHOP, key: 'werkplaats', naam: 'Werkplaats', x: 100, y: 0 },
  { id: 12, typeId: LAB, key: 'lab', naam: 'Lab', x: 200, y: 0 },
  { id: 13, typeId: HOUSE, key: 'woning', naam: 'Woning', x: 300, y: 0 },
  { id: 14, typeId: HOUSE, key: 'woning', naam: 'Woning', x: 400, y: 0 },
  { id: 15, typeId: HOUSE, key: 'woning', naam: 'Woning', x: 500, y: 0 },
  { id: 16, typeId: FACTORY, key: 'robotfabriek', naam: 'Robotfabriek', x: 600, y: 0 },
  { id: 17, typeId: TRAINING, key: 'trainingsfaciliteit', naam: 'Training', x: 700, y: 0 },
];

const research = (
  id: number,
  naam: string,
  scrapCost: number,
  state: BuildingCard['state'],
  extra: Partial<BuildingCard> = {},
): BuildingCard => ({
  kind: 'research',
  id,
  naam,
  icon: 'research',
  scrapCost,
  seconds: 25,
  effects: [],
  unlocks: [],
  requires: [],
  state,
  hotkey: String(id),
  ...extra,
});

export function setup(
  opts: { scrap?: number; selection?: number[]; units?: SelectedEntity[] } = {},
) {
  const sent: { type: CommandType; payload: unknown }[] = [];
  const focus: [number, number][] = [];
  const model = {
    scrap: opts.scrap ?? 300,
    selection: opts.selection ?? [],
    units: opts.units ?? [],
    queue: [] as PlayerStatus['queue'],
    targetingEnded: 0,
    robotPop: 0,
  };
  const status = (): PlayerStatus => ({
    playerId: 0,
    scrap: model.scrap,
    settlers: 3,
    pop: 3,
    popCap: 8,
    beds: 4,
    hero: null,
    queue: model.queue,
    robotPop: model.robotPop,
    dominance: {
      pointsHeld: 0,
      pointsRequired: 2,
      ticksHeld: 0,
      ticksRequired: 9600,
      leader: null,
    },
    trained: [0, 0, 0, 0, 0, 0, 0],
    claimPoints: [],
  });
  const runningHere = (id: number) => model.queue.find((q) => q.buildingId === id);
  /** Cards of one building, like the client's: the workshop and the lab research, busy while they work. */
  const cardsOf = (site: Site): BuildingCard[] => {
    const busy = runningHere(site.id) !== undefined;
    if (site.typeId === WORKSHOP) {
      const running = model.queue.find((q) => q.kind === 'research' && q.id === 1);
      return [
        research(
          1,
          'Geweerrek',
          100,
          running ? 'running' : busy ? 'busy' : model.scrap >= 100 ? 'available' : 'tooExpensive',
          running ? { progressPct: Math.round(running.progressPermille / 10) } : {},
        ),
        research(2, 'Composiet pantser', 150, 'locked', {
          requires: ['Geweerrek'],
          reason: 'Vergrendeld: vereist Geweerrek',
        }),
      ];
    }
    if (site.typeId === LAB) return [research(3, 'Raffinage', 125, 'available')];
    if (site.typeId === FACTORY)
      return [
        {
          ...research(7, 'Beveiligingsrobot', 150, 'available'),
          kind: 'produce',
          buildingId: site.id,
          icon: 'robot',
        },
      ];
    if (site.typeId === TRAINING)
      return [
        {
          ...research(0, 'Training kracht', 100, 'available'),
          kind: 'train',
          buildingId: site.id,
          icon: 'training',
        },
      ];
    return [];
  };
  const selected = (): SelectedEntity[] => [
    ...model.selection.flatMap((id) => {
      const s = SITES.find((x) => x.id === id);
      return s
        ? [{ id, typeId: s.typeId, loadoutName: s.naam, hpPct: 100, role: null } as SelectedEntity]
        : [];
    }),
    ...model.units,
  ];
  const buttons = (): BuildingButton[] => {
    const groups = new Map<string, Site[]>();
    for (const s of SITES) groups.set(s.key, [...(groups.get(s.key) ?? []), s]);
    return [...groups.entries()].map(([key, list]) => {
      const sites = list.map((s) => ({
        id: s.id,
        x: s.x,
        y: s.y,
        available: cardsOf(s).filter((c) => c.state === 'available').length,
        running: runningHere(s.id) ? 1 : 0,
        ...(runningHere(s.id)
          ? { progressPct: Math.round(runningHere(s.id)!.progressPermille / 10) }
          : {}),
      }));
      const prog = sites.flatMap((s) => (s.progressPct === undefined ? [] : [s.progressPct]));
      return {
        key,
        naam: list[0]!.naam,
        sites,
        available: sites.reduce((n, s) => n + s.available, 0),
        running: sites.reduce((n, s) => n + s.running, 0),
        ...(prog.length > 0 ? { progressPct: Math.max(...prog) } : {}),
      };
    });
  };
  const listeners = new Set<() => void>();
  const deps: HudDeps = {
    sendCommand: <T extends CommandType>(type: T, payload: CommandPayload<T>) =>
      void sent.push({ type, payload }),
    getStatus: status,
    getSelection: selected,
    beginTargeting: () => undefined,
    endTargeting: () => void model.targetingEnded++,
    subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
    focusCamera: (x, y) => void focus.push([x, y]),
    selectUnits: (ids, add) => {
      model.selection = add ? [...model.selection, ...ids] : [...ids];
      model.units = [];
    },
    getBuildingButtons: buttons,
    getBuildingCards: () => {
      const sites = model.selection.flatMap((id) => SITES.filter((s) => s.id === id));
      return model.units.length > 0 ? [] : sites.flatMap(cardsOf);
    },
    startCard: (card) => {
      // The sim's own rule: a card starts only when it is available; research takes the scrap and queues.
      if (card.kind === 'research' && card.state === 'available') {
        model.scrap -= card.scrapCost;
        model.queue = [
          ...model.queue,
          {
            kind: 'research',
            buildingId: model.selection[0]!,
            unitId: 0,
            id: card.id,
            progressPermille: 0,
          },
        ];
        sent.push({ type: 'Research', payload: { techId: card.id } });
      } else if (card.kind === 'produce')
        sent.push({
          type: 'Produce',
          payload: { buildingId: card.buildingId, loadoutId: card.id },
        });
      else if (card.kind === 'train')
        sent.push({ type: 'Train', payload: { buildingId: card.buildingId, programId: card.id } });
    },
  };
  const el = document.createElement('div');
  document.body.appendChild(el);
  let handle!: HudHandle;
  act(() => {
    handle = mountHud(el, deps);
  });
  /** A world click on a building: the client replaces the selection and tells the HUD. */
  const clickWorld = (id: number): void =>
    void act(() => {
      model.selection = [id];
      model.units = [];
      handle.refresh();
    });
  const tick = (): void => void act(() => handle.refresh());
  return { el, sent, focus, model, handle, clickWorld, tick, listeners };
}

export const q = <T extends Element = HTMLElement>(root: ParentNode, sel: string): T =>
  root.querySelector<T>(sel)!;
export const click = (el: Element | null): void => void act(() => void (el as HTMLElement).click());
export const press = (key: string): void =>
  void act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));

let mounted: HudHandle | null = null;
/** Hands the HUD of the running test to the afterEach of `registerMountHooks`, which unmounts it. */
export const keepMounted = (handle: HudHandle): void => {
  mounted = handle;
};
/** Per test: an empty body and real timers before, the kept HUD unmounted after (call once per test file). */
export function registerMountHooks(): void {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });
  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });
}

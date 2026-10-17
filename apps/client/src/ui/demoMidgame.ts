// Mid-game preset of the HUD demo page (`/hud-demo.html?preset=midgame`): the state of a game some twenty minutes in, with
// every HUD part open at once, for the designer's review image (tools/replay/src/hud-shots.ts renders it at 4K). It is a
// static still life made of mock deps: nothing ticks, nothing comes from the sim. The real HUD never shows the build menu,
// the placement strip and a card window together in one frame; the demo mounts with `keepBuildMenuWhilePlacing` to allow it.
import type {
  BuildOption,
  BuildingButton,
  BuildingCard,
  DominanceView,
  HeroAbilityOption,
  HudAlert,
  HudDeps,
  HudHandle,
  MinimapData,
  PerkOption,
  RosterGroup,
  RosterUnit,
  SelectedEntity,
  UnitActivity,
} from '@crawlout/ui';
import type { PlayerStatus } from '@crawlout/protocol';

const U = 256;

/** The mid-game state: scrap, population, hero level 5 with a perk waiting, a threat on the dominance strip. */
const STATUS: PlayerStatus = {
  playerId: 0,
  scrap: 1200,
  settlers: 34,
  pop: 38,
  popCap: 40,
  beds: 40,
  robotPop: 4,
  hero: {
    heroId: 0,
    level: 5,
    xp: 410,
    xpNext: 560,
    // Base 6 5 6 4 4 6 3 plus the points trained in the training facility (trained below).
    special: [6, 5, 8, 6, 4, 7, 4],
    perks: [1],
    pendingPerks: 1,
    revivesLeft: 3,
    state: 'alive',
    reviveTicksLeft: 0,
    entityId: 1,
    abilityCooldownTicks: [0],
  },
  queue: [],
  dominance: { pointsHeld: 2, pointsRequired: 3, ticksHeld: 0, ticksRequired: 6000, leader: null },
  trained: [0, 0, 2, 2, 0, 1, 1],
};

const DOMINANCE: DominanceView = {
  pointsHeld: 2,
  pointsRequired: 3,
  secondsHeld: 0,
  secondsRequired: 300,
  // The enemy holds all three points and is counting: the strip shows the warning with its running timer.
  leader: { name: 'Roestlegioen', pointsHeld: 3, secondsHeld: 168, isYou: false },
};

const ABILITIES: HeroAbilityOption[] = [
  { abilityId: 1, naam: 'Lockdown', needsTarget: true, cooldownPct: 62 },
];

const PERKS: PerkOption[] = [
  {
    perkId: 2,
    naam: 'Opzichterblik',
    effects: ['+15% bouwsnelheid voor bouwers'],
    requirement: 'Intelligentie 4',
    available: true,
    flavour: 'Wie het werk bekijkt, ziet waar het stokt.',
  },
  {
    perkId: 3,
    naam: 'Kluisvet',
    effects: ['+20% leven voor alle bewoners'],
    requirement: 'Uithoudingsvermogen 6',
    available: true,
  },
  {
    perkId: 5,
    naam: 'De Stille Knop',
    effects: ['-30% cooldown voor abilities'],
    requirement: 'Intelligentie 8',
    available: false,
  },
];

const BUILD_OPTIONS: BuildOption[] = [
  {
    buildingId: 1,
    typeId: 21,
    naam: 'Woning',
    scrapCost: 95,
    footprint: { w: 13, h: 19 },
    affordable: true,
  },
  {
    buildingId: 2,
    typeId: 22,
    naam: 'Werkplaats',
    scrapCost: 120,
    footprint: { w: 21, h: 19 },
    affordable: true,
  },
  {
    buildingId: 3,
    typeId: 23,
    naam: 'Turret',
    scrapCost: 120,
    footprint: { w: 3, h: 3 },
    affordable: true,
  },
  // Mock price above the 1200 scrap, only to show the "too expensive" look of an option.
  {
    buildingId: 4,
    typeId: 25,
    naam: 'Sentinelpost',
    scrapCost: 1800,
    footprint: { w: 5, h: 5 },
    affordable: false,
  },
];

/** Cards of the workshop in every state; the costs of the two unaffordable entries are mock prices above 1200 scrap. */
const CARDS: BuildingCard[] = [
  {
    kind: 'craft',
    id: 1,
    naam: 'Geweer',
    icon: 'gun',
    scrapCost: 55,
    seconds: 6,
    effects: ['Bewoner schiet op afstand'],
    unlocks: [],
    requires: [],
    state: 'available',
    hotkey: '1',
  },
  {
    kind: 'craft',
    id: 2,
    naam: 'Pantserjas',
    icon: 'shield',
    scrapCost: 1450,
    seconds: 14,
    effects: ['+25% pantser voor een bewoner'],
    unlocks: [],
    requires: [],
    reason: 'Te weinig scrap: nog 250 nodig',
    state: 'tooExpensive',
    hotkey: '2',
  },
  {
    kind: 'craft',
    id: 3,
    naam: 'Shotgun, composiet',
    icon: 'blade',
    scrapCost: 90,
    seconds: 8,
    effects: ['Zware schade op korte afstand'],
    unlocks: [],
    requires: ['Composietpantser'],
    reason: 'Vereist: Composietpantser',
    state: 'locked',
    hotkey: '3',
  },
  {
    kind: 'craft',
    id: 4,
    naam: 'Technicus',
    icon: 'wrench',
    scrapCost: 40,
    seconds: 5,
    effects: ['Repareert gebouwen en robots'],
    unlocks: [],
    requires: [],
    state: 'running',
    progressPct: 62,
    hotkey: '4',
  },
  {
    kind: 'craft',
    id: 5,
    naam: 'Militie',
    icon: 'craft',
    scrapCost: 30,
    seconds: 5,
    effects: ['Bewoner vecht met een knuppel'],
    unlocks: [],
    requires: [],
    state: 'done',
    hotkey: '5',
  },
];

const BUILDING_BUTTONS: BuildingButton[] = [
  {
    key: 'werkplaats',
    naam: 'Werkplaats',
    sites: [
      { id: 9, x: 12 * U, y: 34 * U, available: 3, running: 1, progressPct: 62 },
      { id: 10, x: 18 * U, y: 36 * U, available: 2, running: 0 },
    ],
    available: 5,
    running: 1,
    progressPct: 62,
  },
  {
    key: 'lab',
    naam: 'Lab',
    sites: [{ id: 11, x: 16 * U, y: 30 * U, available: 0, running: 1, progressPct: 45 }],
    available: 0,
    running: 1,
    progressPct: 45,
  },
  {
    key: 'robotfabriek',
    naam: 'Robotfabriek',
    sites: [{ id: 12, x: 20 * U, y: 32 * U, available: 1, running: 1, progressPct: 80 }],
    available: 1,
    running: 1,
    progressPct: 80,
  },
  {
    key: 'trainingsfaciliteit',
    naam: 'Training',
    sites: [{ id: 13, x: 14 * U, y: 38 * U, available: 2, running: 0 }],
    available: 2,
    running: 0,
  },
];

/** Mock map: a ring of walls, a ridge, our base bottom left and fog over the rest. */
const MAP_W = 48;
function mockMinimap(): MinimapData {
  const passable = new Uint8Array(MAP_W * MAP_W).fill(1);
  const visible = new Uint8Array(MAP_W * MAP_W);
  for (let y = 0; y < MAP_W; y++)
    for (let x = 0; x < MAP_W; x++) {
      if (
        x === 0 ||
        y === 0 ||
        x === MAP_W - 1 ||
        y === MAP_W - 1 ||
        (x > 20 && x < 26 && y > 10 && y < 30)
      )
        passable[y * MAP_W + x] = 0;
      if ((x - 14) ** 2 + (y - 34) ** 2 < 150 || (x - 36) ** 2 + (y - 14) ** 2 < 40)
        visible[y * MAP_W + x] = 1;
    }
  const own = (i: number, kind: 'unit' | 'building' | 'hero'): MinimapData['blips'][number] => ({
    x: (8 + (i % 9) * 1.6) * U,
    y: (30 + Math.floor(i / 9) * 2.4) * U,
    owner: 0,
    kind,
  });
  return {
    w: MAP_W,
    h: MAP_W,
    passable,
    visible,
    blips: [
      ...Array.from({ length: 14 }, (_, i) => own(i, 'unit')),
      own(15, 'hero'),
      { x: 12 * U, y: 34 * U, owner: 0, kind: 'building' },
      { x: 18 * U, y: 36 * U, owner: 0, kind: 'building' },
      { x: 16 * U, y: 30 * U, owner: 0, kind: 'building' },
      { x: 14 * U, y: 38 * U, owner: 0, kind: 'building' },
      { x: 36 * U, y: 14 * U, owner: 1, kind: 'unit' },
      { x: 38 * U, y: 13 * U, owner: 1, kind: 'unit' },
      { x: 37 * U, y: 16 * U, owner: 1, kind: 'building' },
      { x: 30 * U, y: 20 * U, owner: -1, kind: 'node' },
      { x: 6 * U, y: 20 * U, owner: -1, kind: 'node' },
    ],
    claims: [
      { x: 24 * U, y: 8 * U, owner: 1 },
      { x: 8 * U, y: 28 * U, owner: 0 },
      { x: 30 * U, y: 38 * U, owner: 0 },
      { x: 38 * U, y: 40 * U, owner: null, progress: 0.6, claimer: 0 },
    ],
  };
}

const ACTIVITIES: UnitActivity[] = [
  'idle',
  'moving',
  'fighting',
  'idle',
  'gathering',
  'carrying',
  'building',
];
function squad(
  firstId: number,
  count: number,
  loadoutName: string,
  role: SelectedEntity['role'],
  pattern: readonly UnitActivity[],
  x0: number,
  y0: number,
): { units: RosterUnit[]; cards: SelectedEntity[] } {
  const units: RosterUnit[] = [];
  const cards: SelectedEntity[] = [];
  for (let i = 0; i < count; i++) {
    const unit: RosterUnit = {
      id: firstId + i,
      hpPct: 35 + ((i * 29) % 66),
      activity: pattern[i % pattern.length]!,
      x: (x0 + (i % 6) * 2) * U,
      y: (y0 + Math.floor(i / 6) * 2) * U,
    };
    if (unit.activity === 'gathering') unit.progressPct = (i * 23) % 100;
    units.push(unit);
    cards.push({
      id: unit.id,
      typeId: 2,
      loadoutName,
      hpPct: unit.hpPct,
      role,
      x: unit.x,
      y: unit.y,
    });
  }
  return { units, cards };
}

export interface MidgamePreset {
  /** Overrides for the demo's mock deps. */
  deps: Partial<HudDeps>;
  /** Alerts to show as toasts once the HUD is mounted. */
  alerts: HudAlert[];
  /**
   * Opens everything the way a player would, with clicks and keys on the mounted HUD: the militia group (and its list),
   * a builder added to the selection, the build menu, the first option in placement with a reason, the perk panel.
   */
  stage(root: HTMLElement, hud: HudHandle): void;
}

export function createMidgamePreset(notify: () => void): MidgamePreset {
  const militia = squad(300, 30, 'Militie', 'militia', ACTIVITIES, 14, 26);
  const scavengers = squad(400, 2, 'Plunderaar', 'scavenger', ['gathering', 'carrying'], 6, 34);
  const builders = squad(200, 2, 'Bouwer', 'builder', ['building', 'idle'], 20, 38);
  const robots = squad(500, 4, 'Beveiligingsrobot', null, ['idle', 'fighting', 'moving'], 26, 30);
  const hero: RosterUnit = { id: 1, hpPct: 88, activity: 'idle', x: 10 * U, y: 33 * U };
  const roster: RosterGroup[] = [
    { key: 'hero', naam: 'Opziener', units: [hero] },
    { key: 'militie', naam: 'Militie', units: militia.units },
    { key: 'scavenger', naam: 'Plunderaar', units: scavengers.units },
    { key: 'bouwer', naam: 'Bouwer', units: builders.units },
    { key: 'beveiligingsrobot', naam: 'Robot', units: robots.units },
  ];
  const byId = new Map<number, SelectedEntity>(
    [...militia.cards, ...scavengers.cards, ...builders.cards, ...robots.cards].map((c) => [
      c.id,
      c,
    ]),
  );
  let selection: SelectedEntity[] = [];
  const minimap = mockMinimap();

  const deps: Partial<HudDeps> = {
    getStatus: () => STATUS,
    getSelection: () => selection,
    getRoster: () => roster,
    selectUnits: (ids, add) => {
      const picked = ids.flatMap((id) => byId.get(id) ?? []);
      selection = add
        ? [...selection, ...picked.filter((p) => !selection.some((s) => s.id === p.id))]
        : picked;
      notify();
    },
    getBuildingButtons: () => BUILDING_BUTTONS,
    getBuildOptions: () => BUILD_OPTIONS,
    getBuildingCards: () => CARDS,
    startCard: () => undefined,
    cancelCard: () => undefined,
    getPerkOptions: () => PERKS,
    getHeroAbilities: () => ABILITIES,
    heroName: () => 'Opziener',
    getDominance: () => DOMINANCE,
    getMinimap: () => minimap,
    canSwitchRole: () => true,
  };

  const press = (key: string): void => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  };

  return {
    deps,
    alerts: [
      { kind: 'attack', x: 36 * U, y: 14 * U },
      { kind: 'dominance', x: 0, y: 0 },
    ],
    stage(root, hud) {
      // Select all militia from the unit bar (this also opens the unit list), then add one builder.
      root
        .querySelector<HTMLButtonElement>('[data-group="militie"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const builder = builders.cards[0];
      if (builder) deps.selectUnits?.([builder.id], true);
      selection = [
        ...selection.filter((s) => s.role === 'builder'),
        ...selection.filter((s) => s.role !== 'builder'),
      ];
      notify();
      press('b'); // the build menu
      press('1'); // the first option goes into placement, the menu stays open (demo flag)
      hud.setPlacementHint('Overlapt een gebouw');
      press('p'); // the perk panel of the pending perk
    },
  };
}

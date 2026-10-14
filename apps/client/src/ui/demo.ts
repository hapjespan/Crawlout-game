// Demo van de HUD met mock-deps. Open /hud-demo.html in `pnpm dev`. Niet gekoppeld aan main.ts.
import { mountHud } from '@crawlout/ui';
import type {
  BuildOption,
  BuildingCard,
  DominanceView,
  HudAlert,
  HudDeps,
  MinimapData,
  NetworkState,
  SelectedEntity,
  TargetingKind,
} from '@crawlout/ui';
import type { PlayerStatus } from '@crawlout/protocol';

const hudEl = document.getElementById('hud');
const worldEl = document.getElementById('world');
const logEl = document.getElementById('log');
if (!hudEl || !worldEl || !logEl) throw new Error('hud-demo.html mist #hud, #world of #log');

const ALL: SelectedEntity[] = [
  { id: 9, typeId: 1024 + 1, loadoutName: null, hpPct: 100, role: null },
  { id: 1, typeId: 2, loadoutName: 'Pijp', hpPct: 90, role: 'scavenger' },
  { id: 2, typeId: 2, loadoutName: 'Knuppel', hpPct: 40, role: 'militia' },
  { id: 3, typeId: 2, loadoutName: null, hpPct: 15, role: 'builder' },
];
let status: PlayerStatus = {
  playerId: 0,
  scrap: 150,
  settlers: 6,
  pop: 6,
  popCap: 10,
  beds: 8,
  hero: {
    heroId: 99,
    level: 2,
    xp: 120,
    xpNext: 300,
    special: [6, 5, 6, 3, 4, 6, 3],
    perks: [],
    pendingPerks: 1,
    revivesLeft: 4,
    state: 'alive',
    reviveTicksLeft: 0,
    entityId: 0,
    abilityCooldownTicks: [0, 0],
  },
  queue: [],
};
let heroDead = false;
// Mock-dominantie: T wisselt tussen niets, eigen voortgang, eigen telling en een tellende tegenstander.
const DOM_STEPS = ['none', 'own', 'ownCounting', 'threat'] as const;
let domStep = 0;
let domSeconds = 0;
const DOM_REQUIRED = 300;
function mockDominance(): DominanceView | null {
  switch (DOM_STEPS[domStep]) {
    case 'own':
      return {
        pointsHeld: 1,
        pointsRequired: 2,
        secondsHeld: 0,
        secondsRequired: DOM_REQUIRED,
        leader: { name: 'Jij', pointsHeld: 1, secondsHeld: 0, isYou: true },
      };
    case 'ownCounting':
      return {
        pointsHeld: 2,
        pointsRequired: 2,
        secondsHeld: domSeconds,
        secondsRequired: DOM_REQUIRED,
        leader: { name: 'Jij', pointsHeld: 2, secondsHeld: domSeconds, isYou: true },
      };
    case 'threat':
      return {
        pointsHeld: 1,
        pointsRequired: 2,
        secondsHeld: 0,
        secondsRequired: DOM_REQUIRED,
        leader: { name: 'AI', pointsHeld: 2, secondsHeld: domSeconds, isYou: false },
      };
    default:
      return null;
  }
}
const abilities = [
  { abilityId: 1, naam: 'Schreeuw', needsTarget: false, readyAt: 0 },
  { abilityId: 2, naam: 'Vuurbal', needsTarget: true, readyAt: 0 },
];

// Mock-kaart 48x48 cellen (1 m): ring van muren met een paar blokken.
const MAP_W = 48;
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
    if ((x - 10) ** 2 + (y - 36) ** 2 < 150) visible[y * MAP_W + x] = 1;
  }
const U = 256;
const minimap: MinimapData = {
  w: MAP_W,
  h: MAP_W,
  passable,
  visible,
  blips: [
    { x: 10 * U, y: 36 * U, owner: 0, kind: 'building' },
    { x: 12 * U, y: 34 * U, owner: 0, kind: 'unit' },
    { x: 9 * U, y: 38 * U, owner: 0, kind: 'hero' },
    { x: 36 * U, y: 10 * U, owner: 1, kind: 'building' }, // buiten zicht: verborgen
    { x: 14 * U, y: 30 * U, owner: 1, kind: 'unit' }, // in zicht
    { x: 30 * U, y: 20 * U, owner: -1, kind: 'node' },
  ],
  claims: [
    { x: 24 * U, y: 8 * U, owner: null },
    { x: 8 * U, y: 30 * U, owner: 0 },
    { x: 38 * U, y: 40 * U, owner: 1 },
  ],
};
const buildOptions: BuildOption[] = [
  {
    buildingId: 1,
    typeId: 21,
    naam: 'Hut',
    scrapCost: 40,
    footprint: { w: 2, h: 2 },
    affordable: true,
  },
  {
    buildingId: 2,
    typeId: 22,
    naam: 'Werkbank',
    scrapCost: 90,
    footprint: { w: 3, h: 2 },
    affordable: true,
  },
  {
    buildingId: 3,
    typeId: 23,
    naam: 'Toren',
    scrapCost: 400,
    footprint: { w: 2, h: 2 },
    affordable: false,
  },
];
// Mock-kaarten: in de demo regelt dit de "client". Alle vijf de statussen komen voor.
interface MockCard extends Omit<BuildingCard, 'state' | 'progressPct' | 'hotkey'> {
  /** Vereist (naam) tot dat onderzoek klaar is; null = niets. */
  needs: { id: number; naam: string } | null;
  done: boolean;
  /** Seconden die al lopen; null = loopt niet. */
  elapsed: number | null;
}
const researchMocks: MockCard[] = [
  {
    kind: 'research',
    id: 1,
    naam: 'Pantserplaten',
    icon: 'shield',
    scrapCost: 80,
    seconds: 30,
    effects: ['+20% schade voor militie'],
    unlocks: [],
    requires: [],
    needs: null,
    done: false,
    elapsed: null,
  },
  {
    kind: 'research',
    id: 2,
    naam: 'Geweerrek',
    icon: 'gun',
    scrapCost: 90,
    seconds: 45,
    effects: ['Militie kan geweren dragen'],
    unlocks: ['Patrouille', 'Turret'],
    requires: [],
    needs: null,
    done: false,
    elapsed: 18,
  },
  {
    kind: 'research',
    id: 3,
    naam: 'Scherpschutters',
    icon: 'bolt',
    scrapCost: 140,
    seconds: 60,
    effects: ['+30% bereik voor geweren'],
    unlocks: [],
    requires: [],
    needs: { id: 2, naam: 'Geweerrek' },
    done: false,
    elapsed: null,
  },
  {
    kind: 'research',
    id: 4,
    naam: 'Waterfilter',
    icon: 'research',
    scrapCost: 900,
    seconds: 50,
    effects: ['+2 bewoners per hut'],
    unlocks: ['Moestuin'],
    requires: [],
    needs: null,
    done: false,
    elapsed: null,
  },
  {
    kind: 'research',
    id: 5,
    naam: 'Betere wapens',
    icon: 'blade',
    scrapCost: 60,
    seconds: 20,
    effects: ['+10% schade voor alle bewoners'],
    unlocks: [],
    requires: [],
    needs: null,
    done: true,
    elapsed: null,
  },
  {
    kind: 'revive',
    id: 9,
    naam: 'Held oplappen',
    icon: 'revive',
    scrapCost: 120,
    seconds: 40,
    effects: ['De held keert terug met volle gezondheid'],
    unlocks: [],
    requires: [],
    needs: null,
    done: false,
    elapsed: null,
  },
];
const craftMocks: MockCard[] = [
  {
    kind: 'craft',
    id: 2,
    naam: 'Knuppel',
    icon: 'craft',
    scrapCost: 20,
    seconds: 8,
    effects: ['Bewoner vecht met een knuppel'],
    unlocks: [],
    requires: [],
    needs: null,
    done: false,
    elapsed: null,
  },
  {
    kind: 'craft',
    id: 3,
    naam: 'Geweer',
    icon: 'gun',
    scrapCost: 300,
    seconds: 25,
    effects: ['Bewoner schiet op afstand'],
    unlocks: [],
    requires: [],
    needs: { id: 2, naam: 'Geweerrek' },
    done: false,
    elapsed: null,
  },
];
const mockOf = (c: BuildingCard): MockCard | undefined =>
  [...researchMocks, ...craftMocks].find((m) => m.kind === c.kind && m.id === c.id);
const isDone = (id: number): boolean =>
  researchMocks.find((m) => m.kind === 'research' && m.id === id)?.done ?? false;
function cardsFor(sel: readonly SelectedEntity[]): BuildingCard[] {
  const onlyBuildings = sel.length > 0 && sel.every((s) => s.typeId >= 1024);
  const mocks = onlyBuildings ? researchMocks : craftMocks;
  return mocks.map((m, i) => {
    const locked = m.needs !== null && !isDone(m.needs.id);
    const state: BuildingCard['state'] = m.done
      ? 'done'
      : m.elapsed !== null
        ? 'running'
        : locked
          ? 'locked'
          : status.scrap < m.scrapCost
            ? 'tooExpensive'
            : 'available';
    return {
      kind: m.kind,
      id: m.id,
      naam: m.naam,
      icon: m.icon,
      scrapCost: m.scrapCost,
      seconds: m.seconds,
      effects: m.effects,
      unlocks: m.unlocks,
      requires: locked && m.needs ? [m.needs.naam] : [],
      state,
      hotkey: String(i + 1),
      ...(state === 'running'
        ? { progressPct: Math.round(((m.elapsed ?? 0) / m.seconds) * 100) }
        : {}),
    };
  });
}
function startCard(c: BuildingCard): void {
  const m = mockOf(c);
  if (!m) return;
  status = { ...status, scrap: status.scrap - m.scrapCost };
  m.elapsed = 0;
  log(`start ${c.kind} ${c.naam} (${m.scrapCost} scrap)`);
}
function cancelCard(c: BuildingCard): void {
  const m = mockOf(c);
  if (!m) return;
  m.elapsed = null;
  status = { ...status, scrap: status.scrap + m.scrapCost };
  log(`geannuleerd: ${c.naam} (teruggave ${m.scrapCost})`);
}
const alertCbs = new Set<(a: HudAlert) => void>();
const emitAlert = (a: HudAlert): void => alertCbs.forEach((cb) => cb(a));
let selection: SelectedEntity[] = ALL;
let network: NetworkState = { desync: null, stall: null };
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((l) => l());
const lines: string[] = [];
const log = (line: string): void => {
  lines.unshift(line);
  lines.length = Math.min(lines.length, 6);
  logEl.textContent = lines.join('\n');
};

const deps: HudDeps = {
  sendCommand: (type, payload) => {
    log(`${type} ${JSON.stringify(payload)}`);
    if (type === 'HeroAbility') {
      const a = abilities.find((x) => x.abilityId === (payload as { abilityId: number }).abilityId);
      if (a) a.readyAt = Date.now() + 5000;
    }
  },
  getStatus: () => status,
  getSelection: () => selection,
  getNetwork: () => network,
  playerName: (id) => ['Jij', 'Rik', 'Sanne'][id] ?? `speler ${id + 1}`,
  beginTargeting: (kind: TargetingKind) => log(`targeting: ${kind}`),
  endTargeting: () => log('targeting gestopt'),
  getMinimap: () => minimap,
  getDominance: mockDominance,
  focusCamera: (x, y) => log(`camera -> ${x}, ${y}`),
  getBuildOptions: () =>
    buildOptions.map((o) => ({ ...o, affordable: status.scrap >= o.scrapCost })),
  beginPlacement: (o) => log(`plaatsing: ${o.naam} ${o.footprint.w}x${o.footprint.h}`),
  endPlacement: () => log('plaatsing gestopt'),
  heroName: () => 'Krijger',
  getHeroAbilities: () =>
    abilities.map((a) => ({
      ...a,
      cooldownPct: Math.max(0, Math.round((a.readyAt - Date.now()) / 50)),
    })),
  isHeroDead: () => heroDead,
  reviveHero: () => {
    heroDead = false;
    log('held opgelapt');
  },
  getBuildingCards: (sel) => cardsFor(sel),
  startCard,
  cancelCard,
  getPerkOptions: () => [
    { perkId: 1, naam: 'Taai', beschrijving: '+10% hp' },
    { perkId: 2, naam: 'Snel', beschrijving: '+10% tempo' },
    { perkId: 3, naam: 'Scherp', beschrijving: '+10% schade' },
  ],
  subscribeAlerts: (cb) => {
    alertCbs.add(cb);
    return () => alertCbs.delete(cb);
  },
  subscribe: (l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

const hud = mountHud(hudEl, deps);

// Wereldklik: in de echte client doet de renderer-picking dit.
worldEl.addEventListener('click', (e) => {
  const r = worldEl.getBoundingClientRect();
  const x = Math.round((e.clientX - r.left) * 256);
  const y = Math.round((e.clientY - r.top) * 256);
  if (hud.completePlacement({ x, y })) return;
  if (!hud.completeTargeting({ x, y })) hud.completeTargeting({ nodeId: 7 });
});

// Mock-gedrag: scrap loopt op; D = desync, W = stall, Y = selectie wisselen.
setInterval(() => {
  status = { ...status, scrap: status.scrap + 3 };
  domSeconds = Math.min(DOM_REQUIRED, domSeconds + 1);
  for (const m of [...researchMocks, ...craftMocks]) {
    if (m.elapsed === null) continue;
    m.elapsed += 1;
    if (m.elapsed >= m.seconds) {
      m.elapsed = null;
      m.done = m.kind === 'research';
    }
  }
  notify();
}, 1000);
window.addEventListener('keydown', (e) => {
  if (e.key === 'd')
    network = {
      ...network,
      desync: network.desync ? null : { frame: 1240, hashes: { '0': 1, '1': 2 } },
    };
  else if (e.key === 'w')
    network = { ...network, stall: network.stall ? null : { waitingFor: [1] } };
  else if (e.key === 'j')
    emitAlert({
      kind: (['attack', 'settlerLost', 'claimLost'] as const)[Math.floor(Math.random() * 3)]!,
      x: Math.round(Math.random() * MAP_W) * U,
      y: Math.round(Math.random() * MAP_W) * U,
    });
  else if (e.key === 't') {
    domStep = (domStep + 1) % DOM_STEPS.length;
    domSeconds = 90;
  } else if (e.key === 'u')
    status = {
      ...status,
      hero: status.hero ? { ...status.hero, pendingPerks: status.hero.pendingPerks ? 0 : 1 } : null,
    };
  else if (e.key === 'o') heroDead = !heroDead;
  else if (e.key === 'y')
    selection =
      selection === ALL
        ? ALL.slice(0, 1)
        : selection.length === 1 && selection[0]?.typeId === ALL[0]?.typeId
          ? ALL.slice(1)
          : selection.length > 0 && selection !== ALL
            ? []
            : ALL;
  else return;
  notify();
});
log(
  'Demo: D = desync, W = stall, Y = selectie (alles, gebouw, bewoners, niets; gebouw toont de onderzoekskaarten, bewoners de craftkaarten met K + cijfer), J = alert, T = dominantie (niets, eigen punten, eigen telling, tegenstander telt), U = level-up, O = held dood/levend; B = bouwen, cijfer kiest gebouw, klik plaatst',
);

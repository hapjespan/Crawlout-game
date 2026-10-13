// Demo van de HUD met mock-deps. Open /hud-demo.html in `pnpm dev`. Niet gekoppeld aan main.ts.
import { mountHud } from '@crawlout/ui';
import type { BuildOption, HudAlert, HudDeps, MinimapData, NetworkState, SelectedEntity, TargetingKind } from '@crawlout/ui';
import type { PlayerStatus } from '@crawlout/protocol';

const hudEl = document.getElementById('hud');
const worldEl = document.getElementById('world');
const logEl = document.getElementById('log');
if (!hudEl || !worldEl || !logEl) throw new Error('hud-demo.html mist #hud, #world of #log');

const ALL: SelectedEntity[] = [
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
  hero: { level: 2, xp: 120, special: [6, 5, 6, 3, 4, 6, 3], perks: [] },
};
let pendingPerks = 1;

// Mock-kaart 48x48 cellen (1 m): ring van muren met een paar blokken.
const MAP_W = 48;
const passable = new Uint8Array(MAP_W * MAP_W).fill(1);
const visible = new Uint8Array(MAP_W * MAP_W);
for (let y = 0; y < MAP_W; y++)
  for (let x = 0; x < MAP_W; x++) {
    if (x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_W - 1 || (x > 20 && x < 26 && y > 10 && y < 30)) passable[y * MAP_W + x] = 0;
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
  { buildingId: 1, typeId: 21, naam: 'Hut', scrapCost: 40, footprint: { w: 2, h: 2 }, affordable: true },
  { buildingId: 2, typeId: 22, naam: 'Werkbank', scrapCost: 90, footprint: { w: 3, h: 2 }, affordable: true },
  { buildingId: 3, typeId: 23, naam: 'Toren', scrapCost: 400, footprint: { w: 2, h: 2 }, affordable: false },
];
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
  sendCommand: (type, payload) => log(`${type} ${JSON.stringify(payload)}`),
  getStatus: () => status,
  getSelection: () => selection,
  getNetwork: () => network,
  playerName: (id) => ['Jij', 'Rik', 'Sanne'][id] ?? `speler ${id + 1}`,
  beginTargeting: (kind: TargetingKind) => log(`targeting: ${kind}`),
  endTargeting: () => log('targeting gestopt'),
  getMinimap: () => minimap,
  focusCamera: (x, y) => log(`camera -> ${x}, ${y}`),
  getBuildOptions: () => buildOptions.map((o) => ({ ...o, affordable: status.scrap >= o.scrapCost })),
  beginPlacement: (o) => log(`plaatsing: ${o.naam} ${o.footprint.w}x${o.footprint.h}`),
  endPlacement: () => log('plaatsing gestopt'),
  getHeroInfo: () => ({ heroId: 99, naam: 'Krijger', xpForNext: 300, pendingPerks }),
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

// Mock-gedrag: scrap loopt op; D = desync, W = stall, X = selectie wisselen (3, 1, 0).
setInterval(() => {
  status = { ...status, scrap: status.scrap + 3 };
  notify();
}, 1000);
window.addEventListener('keydown', (e) => {
  if (e.key === 'd') network = { ...network, desync: network.desync ? null : { frame: 1240, hashes: { '0': 1, '1': 2 } } };
  else if (e.key === 'w') network = { ...network, stall: network.stall ? null : { waitingFor: [1] } };
  else if (e.key === 'k') emitAlert({ kind: (['attack', 'settlerLost', 'claimLost'] as const)[Math.floor(Math.random() * 3)]!, x: Math.round(Math.random() * MAP_W) * U, y: Math.round(Math.random() * MAP_W) * U });
  else if (e.key === 'u') pendingPerks = pendingPerks > 0 ? 0 : 1;
  else if (e.key === 'x') selection = selection.length === 3 ? ALL.slice(0, 1) : selection.length === 1 ? [] : ALL;
  else return;
  notify();
});
log('Demo: D = desync, W = stall, X = selectie, K = alert, U = level-up; B = bouwen, cijfer kiest gebouw, klik plaatst');

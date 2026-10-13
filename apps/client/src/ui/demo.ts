// Demo van de HUD met mock-deps. Open /hud-demo.html in `pnpm dev`. Niet gekoppeld aan main.ts.
import { mountHud } from '@crawlout/ui';
import type { HudDeps, NetworkState, SelectedEntity, TargetingKind } from '@crawlout/ui';
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
let status: PlayerStatus = { playerId: 0, scrap: 150, settlers: 6, pop: 6, popCap: 10, beds: 8, hero: null };
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
  else if (e.key === 'x') selection = selection.length === 3 ? ALL.slice(0, 1) : selection.length === 1 ? [] : ALL;
  else return;
  notify();
});
log('Demo: D = desync, W = stall, X = selectie wisselen');

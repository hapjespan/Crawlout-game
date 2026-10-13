import { MAX_ENTITIES_PER_COMMAND } from '@crawlout/protocol';
import type { PlayerStatus, Role } from '@crawlout/protocol';
import type { HudDeps, HudHandle, NetworkState, SelectedEntity, TargetResult, TargetingKind } from './types.js';

export type ActionId = 'move' | 'stop' | 'attackMove' | 'gather' | 'roleScavenger' | 'roleBuilder' | 'roleMilitia' | 'build';

export interface ActionDef {
  id: ActionId;
  label: string;
  /** Toets in kleine letters, zoals KeyboardEvent.key. */
  key: string;
  needsSelection: boolean;
}

/** Commandokaart: volgorde is de volgorde op het scherm. */
export const ACTIONS: readonly ActionDef[] = [
  { id: 'move', label: 'Verplaats', key: 'm', needsSelection: true },
  { id: 'stop', label: 'Stop', key: 's', needsSelection: true },
  { id: 'attackMove', label: 'Val aan', key: 'a', needsSelection: true },
  { id: 'gather', label: 'Verzamel', key: 'g', needsSelection: true },
  { id: 'roleScavenger', label: 'Plunderaar', key: '1', needsSelection: true },
  { id: 'roleBuilder', label: 'Bouwer', key: '2', needsSelection: true },
  { id: 'roleMilitia', label: 'Militie', key: '3', needsSelection: true },
  { id: 'build', label: 'Bouw', key: 'b', needsSelection: false },
];

export const ROLE_LABEL: Record<Role, string> = { scavenger: 'Plunderaar', builder: 'Bouwer', militia: 'Militie' };
const ACTION_ROLE: Partial<Record<ActionId, Role>> = { roleScavenger: 'scavenger', roleBuilder: 'builder', roleMilitia: 'militia' };
const ACTION_TARGETING: Partial<Record<ActionId, TargetingKind>> = { move: 'move', attackMove: 'attackMove', gather: 'gather' };

export interface HudState {
  status: PlayerStatus | null;
  selection: readonly SelectedEntity[];
  network: NetworkState;
  targeting: TargetingKind | null;
  buildMenuOpen: boolean;
  confirmSurrender: boolean;
}

const NO_NETWORK: NetworkState = { desync: null, stall: null };

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true;
}

/** HUD-logica zonder Preact: state, sneltoetsen en commando-opbouw. De view tekent alleen de state. */
export class HudController implements HudHandle {
  private state: HudState;
  private readonly listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: HudDeps) {
    this.state = { status: null, selection: [], network: NO_NETWORK, targeting: null, buildMenuOpen: false, confirmSurrender: false };
    this.read();
  }

  getState(): HudState {
    return this.state;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Begin met luisteren op de deps (subscribe of polling). */
  start(): void {
    if (this.deps.subscribe) this.unsubscribe = this.deps.subscribe(() => this.refresh());
    else this.timer = setInterval(() => this.refresh(), 250);
  }

  unmount(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.listeners.clear();
  }

  refresh(): void {
    this.read();
    this.emit();
  }

  playerName(playerId: number): string {
    return this.deps.playerName?.(playerId) ?? `speler ${playerId + 1}`;
  }

  isEnabled(action: ActionDef): boolean {
    return !action.needsSelection || this.state.selection.length > 0;
  }

  /** Voert een actie uit; geeft false als ze niet beschikbaar is. */
  run(id: ActionId): boolean {
    const action = ACTIONS.find((a) => a.id === id);
    if (!action || !this.isEnabled(action) || this.state.confirmSurrender) return false;
    const ids = this.selectedIds();
    const targeting = ACTION_TARGETING[id];
    const role = ACTION_ROLE[id];
    if (targeting) {
      this.set({ targeting, buildMenuOpen: false });
      this.deps.beginTargeting(targeting);
    } else if (role) {
      this.stopTargeting();
      this.deps.sendCommand('SetRole', { ids, role });
    } else if (id === 'stop') {
      this.stopTargeting();
      this.deps.sendCommand('Stop', { ids });
    } else if (id === 'build') {
      this.stopTargeting();
      this.set({ buildMenuOpen: !this.state.buildMenuOpen });
    }
    return true;
  }

  completeTargeting(target: TargetResult): boolean {
    const kind = this.state.targeting;
    if (!kind) return false;
    const ids = this.selectedIds();
    if (ids.length === 0) {
      this.cancelTargeting();
      return false;
    }
    if (kind === 'gather') {
      if (!('nodeId' in target)) return false;
      this.deps.sendCommand('Gather', { ids, nodeId: target.nodeId });
    } else {
      if (!('x' in target)) return false;
      const pos = { x: Math.round(target.x), y: Math.round(target.y) };
      this.deps.sendCommand(kind === 'move' ? 'Move' : 'AttackMove', { ids, ...pos });
    }
    this.set({ targeting: null });
    return true;
  }

  cancelTargeting(): void {
    this.stopTargeting();
  }

  requestSurrender(): void {
    this.stopTargeting();
    this.set({ confirmSurrender: true, buildMenuOpen: false });
  }

  cancelSurrender(): void {
    this.set({ confirmSurrender: false });
  }

  confirmSurrender(): void {
    if (!this.state.confirmSurrender) return;
    this.set({ confirmSurrender: false });
    this.deps.sendCommand('Surrender', {});
  }

  closeBuildMenu(): void {
    this.set({ buildMenuOpen: false });
  }

  /** Verwerkt een sneltoets. Geeft true als de toets is afgehandeld (dan preventDefault). */
  handleKeyDown(e: KeyboardEvent): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return false;
    const key = e.key.toLowerCase();
    if (key === 'escape') {
      if (this.state.confirmSurrender) this.cancelSurrender();
      else if (this.state.targeting) this.cancelTargeting();
      else if (this.state.buildMenuOpen) this.closeBuildMenu();
      else return false;
      return true;
    }
    if (this.state.confirmSurrender) return false;
    const action = ACTIONS.find((a) => a.key === key);
    return action ? this.run(action.id) : false;
  }

  private selectedIds(): number[] {
    return this.state.selection.slice(0, MAX_ENTITIES_PER_COMMAND).map((s) => s.id);
  }

  private stopTargeting(): void {
    if (!this.state.targeting) return;
    this.set({ targeting: null });
    this.deps.endTargeting?.();
  }

  private read(): void {
    const selection = [...this.deps.getSelection()];
    this.state = {
      ...this.state,
      status: this.deps.getStatus(),
      selection,
      network: this.deps.getNetwork?.() ?? NO_NETWORK,
      // Targeting zonder selectie heeft geen zin meer.
      targeting: selection.length === 0 ? null : this.state.targeting,
    };
  }

  private set(patch: Partial<HudState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

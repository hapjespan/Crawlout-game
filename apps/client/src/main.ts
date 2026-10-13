// Composition: sim worker (packages/sim) + renderer (packages/render) + HUD (packages/ui) + loopback relay.
// Local skirmish on the slice map; the same session code drives the ws relay later.
import {
  ENTITY_FLAG,
  MAX_ENTITIES_PER_COMMAND,
  readSnapshotHeader,
  snapshotLayout,
  type CommandPayload,
  type CommandType,
  type DesyncEvent,
  type PlayerStatus,
  type StallNotice,
} from '@crawlout/protocol';
import { ROLES } from '@crawlout/data';
import { createRenderer } from '@crawlout/render';
import { mountHud, type HudDeps, type NetworkState, type SelectedEntity, type TargetingKind } from '@crawlout/ui';
import { loadClientGameData, loadClientMap } from './game/content.js';
import { startSession } from './game/session.js';

const SLICE_MAP = 'rustbelt';

interface EntityRow {
  id: number;
  typeId: number;
  owner: number;
  hpPct: number;
}

function showError(message: string): void {
  const el = document.getElementById('error');
  if (!el) return;
  el.textContent = message;
  el.style.display = 'grid';
}

async function main(): Promise<void> {
  const canvas = document.getElementById('view') as HTMLCanvasElement | null;
  const marquee = document.getElementById('marquee') as HTMLDivElement | null;
  const hudEl = document.getElementById('hud');
  if (!canvas || !marquee || !hudEl) throw new Error('index.html mist #view, #marquee of #hud');

  const data = loadClientGameData();
  const map = loadClientMap(SLICE_MAP);
  const params = new URLSearchParams(location.search);
  const perf = document.getElementById('perf') ?? true;
  const renderer = await createRenderer({ canvas, forceWebGL: params.has('webgl'), stats: perf });
  renderer.setTerrain(map.terrain);

  // Selection is local UI state, never sim state: the client stamps the selected flag into each snapshot.
  let selection = new Set<number>();
  let entities = new Map<number, EntityRow>();
  let network: NetworkState = { desync: null, stall: null };
  const listeners = new Set<() => void>();
  const notify = (): void => listeners.forEach((l) => l());

  const faction = data.factions[0];
  const loadoutName = (typeId: number): string | null => data.loadouts[typeId - 1]?.key ?? null;
  const roleOf = (typeId: number): SelectedEntity['role'] => {
    const role = data.loadouts[typeId - 1]?.role;
    return role === undefined ? null : (ROLES[role] ?? null);
  };

  const session = startSession(data, map, {
    onSnapshot(buf) {
      const { entityCount, eventCount } = readSnapshotHeader(buf);
      const layout = snapshotLayout(entityCount, eventCount);
      const ids = new Uint32Array(buf, layout.entity.id, entityCount);
      const typeIds = new Uint16Array(buf, layout.entity.typeId, entityCount);
      const owners = new Uint8Array(buf, layout.entity.owner, entityCount);
      const hp = new Uint8Array(buf, layout.entity.hpPct, entityCount);
      const flags = new Uint8Array(buf, layout.entity.flags, entityCount);
      const next = new Map<number, EntityRow>();
      for (let i = 0; i < entityCount; i++) {
        const id = ids[i]!;
        if (selection.has(id)) flags[i] = flags[i]! | ENTITY_FLAG.selected;
        if ((flags[i]! & ENTITY_FLAG.dead) === 0) next.set(id, { id, typeId: typeIds[i]!, owner: owners[i]!, hpPct: hp[i]! });
      }
      entities = next;
      for (const id of selection) if (!entities.has(id)) selection.delete(id);
      renderer.pushSnapshot(buf);
      notify();
    },
    onDesync(event: DesyncEvent) {
      network = { ...network, desync: event };
      notify();
    },
    onStall(notice: StallNotice | null) {
      network = { ...network, stall: notice };
      notify();
    },
    onError: (message) => console.error(`sim: ${message}`),
  });

  const mine = (ids: Iterable<number>): number[] => [...ids].filter((id) => entities.get(id)?.owner === session.playerId);

  /** Commands carry at most 64 entity ids; larger selections are split. */
  function sendForSelection<T extends 'Move' | 'AttackMove'>(type: T, x: number, y: number): void {
    const ids = mine(selection);
    for (let i = 0; i < ids.length; i += MAX_ENTITIES_PER_COMMAND) {
      const chunk = ids.slice(i, i + MAX_ENTITIES_PER_COMMAND);
      session.sendCommand(type, { ids: chunk, x: Math.round(x), y: Math.round(y) } as CommandPayload<T>);
    }
  }

  let targeting: TargetingKind | null = null;

  const deps: HudDeps = {
    sendCommand: <T extends CommandType>(type: T, payload: CommandPayload<T>) => session.sendCommand(type, payload),
    getStatus: (): PlayerStatus => {
      const own = mine(entities.keys()).length;
      // No economy in sprint 1 yet: scrap is the faction's start value, pop cap follows the settlers.
      return { playerId: session.playerId, scrap: faction?.startScrap ?? 0, settlers: own, pop: own, popCap: own, beds: 0, hero: null };
    },
    getSelection: () =>
      mine(selection).map((id) => {
        const e = entities.get(id)!;
        return { id, typeId: e.typeId, loadoutName: loadoutName(e.typeId), hpPct: e.hpPct, role: roleOf(e.typeId) };
      }),
    getNetwork: () => network,
    playerName: (id) => (id === session.playerId ? 'Jij' : 'AI'),
    beginTargeting: (kind) => {
      targeting = kind;
      canvas.style.cursor = 'crosshair';
    },
    endTargeting: () => {
      targeting = null;
      canvas.style.cursor = 'default';
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  const hud = mountHud(hudEl, deps);

  const home = map.grid.spawns[session.playerId];
  if (home) renderer.focus(home.ux, home.uy);

  // Pointer: left click/drag selects (shift adds), right click moves, a left click while targeting picks the target.
  let drag: { x: number; y: number; moved: boolean } | null = null;
  const local = (e: PointerEvent | MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (targeting) {
      const ground = renderer.pickAt(local(e).x, local(e).y).ground;
      if (ground) hud.completeTargeting({ x: Math.round(ground.x), y: Math.round(ground.y) });
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    drag = { ...local(e), moved: false };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = local(e);
    if (!drag.moved && Math.hypot(p.x - drag.x, p.y - drag.y) < 4) return;
    drag.moved = true;
    marquee.style.display = 'block';
    marquee.style.left = `${Math.min(p.x, drag.x)}px`;
    marquee.style.top = `${Math.min(p.y, drag.y)}px`;
    marquee.style.width = `${Math.abs(p.x - drag.x)}px`;
    marquee.style.height = `${Math.abs(p.y - drag.y)}px`;
  });
  canvas.addEventListener('pointerup', (e) => {
    if (e.button !== 0 || !drag) return;
    const p = local(e);
    let ids: number[];
    if (drag.moved) {
      ids = renderer.boxSelect({ x0: drag.x, y0: drag.y, x1: p.x, y1: p.y }, { owner: session.playerId });
    } else {
      const hit = renderer.pickAt(p.x, p.y).entityId;
      ids = hit === null ? [] : [hit];
    }
    selection = e.shiftKey ? new Set([...selection, ...ids]) : new Set(ids);
    marquee.style.display = 'none';
    drag = null;
    notify();
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (targeting) {
      hud.cancelTargeting();
      return;
    }
    const ground = renderer.pickAt(local(e).x, local(e).y).ground;
    if (ground && selection.size > 0) sendForSelection('Move', ground.x, ground.y);
  });

  window.addEventListener('beforeunload', () => {
    session.dispose();
    hud.unmount();
    renderer.dispose();
  });
  (window as unknown as { crawlout: unknown }).crawlout = { renderer, session, entities: () => entities };
}

main().catch((err: unknown) => {
  console.error(err);
  showError(`Crawlout kon niet starten: ${err instanceof Error ? err.message : String(err)}`);
});

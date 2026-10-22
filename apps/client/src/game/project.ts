// Win route C, the Bouwproject (client 0.11.0, protocol 0.16.0 PlayerStatus.project): the sim status to the HUD's
// project panel, minimap markers and toasts, and the restore target of a card. Names and prices come from packages/data
// (GameData.project.parts, the part kind is the index); seconds from ticks.
import { buildingTypeId, kindOfTypeId, type GameData } from '@crawlout/data';
import {
  OWNER_NEUTRAL,
  TICK_HZ,
  type PlayerStatus,
  type ProjectPartStatus,
} from '@crawlout/protocol';
import type { HudAlert, MinimapProjectPart, ProjectHold, ProjectView } from '@crawlout/ui';

/** Whether a building typeId is a ruin of the strip mall. */
export function isProjectRuin(data: GameData, typeId: number): boolean {
  const k = kindOfTypeId(typeId);
  return k.kind === 'building' && data.project.parts.some((p) => p.ruinBuildingId === k.index);
}

const holdOf = (parts: readonly ProjectPartStatus[], kind: number, p: (o: number) => boolean) => {
  let hold: ProjectHold = 'none';
  let pct = 0;
  for (const part of parts) {
    if (part.kind !== kind || part.owner === OWNER_NEUTRAL || !p(part.owner)) continue;
    if (part.state === 'restored') return { hold: 'restored' as ProjectHold, pct: 100 };
    hold = 'restoring';
    pct = Math.max(pct, Math.floor(part.progressPermille / 10));
  }
  return { hold, pct };
};

let last: { key: string; view: ProjectView | null } = { key: '', view: null };

/** The project panel, or null without a Bouwproject. Same object while nothing changed. */
export function projectView(
  data: GameData,
  status: PlayerStatus | null,
  playerName: (id: number) => string,
  you: number,
  builders: boolean,
): ProjectView | null {
  const pr = status?.project ?? null;
  const scrap = status?.scrap ?? 0;
  const key = pr === null ? '' : `${JSON.stringify(pr)}|${builders}|${scrap}`;
  if (key === last.key) return last.view;
  let view: ProjectView | null = null;
  if (pr !== null) {
    const seconds = (t: number): number => Math.floor(t / TICK_HZ);
    const me = pr.players.find((p) => p.playerId === you);
    let lead: (typeof pr.players)[number] | null = null;
    for (const p of pr.players)
      if (
        p.playerId !== you &&
        (lead === null ||
          p.ticksHeld > lead.ticksHeld ||
          (p.ticksHeld === lead.ticksHeld && p.kindsHeld > lead.kindsHeld))
      )
        lead = p;
    view = {
      secondsRequired: seconds(pr.ticksRequired),
      kinds: data.project.parts.map((part, kind) => {
        const mine = holdOf(pr.parts, kind, (o) => o === you);
        const enemy = holdOf(pr.parts, kind, (o) => o !== you);
        const cost = data.buildings[part.buildingId]?.scrapCost ?? 0;
        const ruin = pr.parts.some((p) => p.kind === kind && p.state === 'ruin');
        return {
          kind,
          naam: part.naam,
          scrapCost: cost,
          mine: mine.hold,
          minePct: mine.pct,
          enemy: enemy.hold,
          underAttack: pr.parts.some((p) => p.kind === kind && p.owner === you && p.underAttack),
          canRestore: builders && ruin && mine.hold === 'none' && scrap >= cost,
        };
      }),
      you: {
        kindsHeld: me?.kindsHeld ?? 0,
        secondsHeld: seconds(me?.ticksHeld ?? 0),
        paused: me?.paused ?? false,
      },
      leader:
        lead === null
          ? null
          : {
              name: playerName(lead.playerId),
              kindsHeld: lead.kindsHeld,
              secondsHeld: seconds(lead.ticksHeld),
              paused: lead.paused,
            },
    };
  }
  last = { key, view };
  return view;
}

/** The parts for the minimap (map knowledge); empty without a Bouwproject. */
export function projectMinimap(status: PlayerStatus | null): MinimapProjectPart[] {
  return (status?.project?.parts ?? []).map((p) => ({
    x: p.x,
    y: p.y,
    owner: p.owner === OWNER_NEUTRAL ? null : p.owner,
    restored: p.state === 'restored',
    underAttack: p.underAttack,
  }));
}

/** Where a restore card of `kind` sends the builders: the ruin of that kind nearest to them, as a Build payload. */
export function nearestRuin(
  data: GameData,
  status: PlayerStatus | null,
  kind: number,
  builders: readonly { x: number; y: number }[],
): { typeId: number; x: number; y: number } | null {
  const part = data.project.parts[kind];
  if (part === undefined || builders.length === 0) return null;
  const cx = builders.reduce((s, b) => s + b.x, 0) / builders.length;
  const cy = builders.reduce((s, b) => s + b.y, 0) / builders.length;
  let best: ProjectPartStatus | null = null;
  let bestD = Infinity;
  for (const p of status?.project?.parts ?? []) {
    if (p.kind !== kind || p.state !== 'ruin') continue;
    const d = (p.x - cx) ** 2 + (p.y - cy) ** 2;
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best === null
    ? null
    : { typeId: buildingTypeId(part.ruinBuildingId), x: best.x, y: best.y };
}

/** Toasts from one status to the next: own parts restored, lost or sabotaged, and a countdown that starts. */
export function projectAlerts(
  data: GameData,
  prev: PlayerStatus | null,
  next: PlayerStatus,
  you: number,
): HudAlert[] {
  const a = prev?.project;
  const b = next.project;
  if (!a || !b) return [];
  const out: HudAlert[] = [];
  const naam = (kind: number): string => data.project.parts[kind]?.naam ?? 'Deel';
  b.parts.forEach((p, k) => {
    const was = a.parts[k];
    if (was === undefined) return;
    const at = { x: p.x, y: p.y };
    if (was.owner === you && p.owner !== you)
      out.push({ kind: 'project', ...at, text: `${naam(p.kind)} verloren: weer een ruïne` });
    else if (p.owner === you && was.state === 'restoring' && p.state === 'restored')
      out.push({ kind: 'project', ...at, text: `${naam(p.kind)} hersteld` });
    else if (p.owner === you && p.underAttack && !was.underAttack)
      out.push({ kind: 'project', ...at, text: `Sabotage: ${naam(p.kind)} wordt aangevallen` });
  });
  for (const q of b.players) {
    const old = a.players.find((x) => x.playerId === q.playerId);
    if (old === undefined || old.ticksHeld > 0 || q.ticksHeld === 0) continue;
    const part = b.parts.find((p) => p.owner === q.playerId) ?? b.parts[0];
    out.push({
      kind: 'project',
      x: part?.x ?? 0,
      y: part?.y ?? 0,
      text:
        q.playerId === you
          ? 'Bouwproject compleet: de countdown loopt'
          : 'Let op: de tegenstander houdt het hele Bouwproject!',
    });
  }
  return out;
}

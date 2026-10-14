import { EVENT_TYPE } from '@crawlout/protocol';
import type { LobbyPlayer } from '@crawlout/protocol';
import { ROLES } from '@crawlout/data';
import { createSim } from '@crawlout/sim';
import type { Sim, WinReason } from '@crawlout/sim';
import { buildEnv, gameData } from './env.js';
import type { BotPlan, Controller, PlannedBuilding } from './bot.js';

// Balansmeting (speltest 14 oktober): speelt een potje op Rustbelt met de scripted AI (of een bot via controllers)
// en houdt per speler bij wat er met scrap, bewoners, leger, held en claims gebeurt. Gebruikt door
// `pnpm --filter @crawlout/replay balance` (rapport) en door de potjelengte-test (match-length.test.ts).
// Leest alleen wat de sim publiek laat zien; de meting zelf mag floats gebruiken.

export const TICKS_PER_MINUTE = 1200;

export interface PlayerTrace {
  /** Scrap op de bank aan het eind van elke minuut. */
  scrapByMinute: number[];
  /** Bewoners (settlers) en pop-cap aan het eind van elke minuut. */
  settlersByMinute: number[];
  popCapByMinute: number[];
  /** Militie (rol militia) aan het eind van elke minuut. */
  militiaByMinute: number[];
  /** Claimpunten van deze speler aan het eind van elke minuut. */
  claimsByMinute: number[];
  /** Totaal binnengekomen en uitgegeven scrap (som van de stijgingen en dalingen per tick). */
  income: number;
  spent: number;
  peakScrap: number;
  heroLevel: number;
  heroXp: number;
  techs: number;
  /** Voltooide gebouwen per type-key. */
  built: Record<string, number>;
  /** Eigen units die sneuvelden. */
  lost: number;
}

export interface MatchResult {
  seed: number;
  winner: number | null;
  reason: WinReason | null;
  /** Frame waarin de winnaar vaststond, of het laatste gespeelde frame. */
  frame: number;
  minutes: number;
  players: PlayerTrace[];
}

const lobby = (ai: readonly boolean[]): LobbyPlayer[] =>
  ai.map((isAi, i) => ({
    playerId: i,
    name: `p${i}`,
    faction: 'dwellers',
    ready: true,
    online: !isAi,
    ai: isAi,
  }));

export interface MatchOptions {
  /** Welke spelers AI zijn (standaard beide). */
  ai?: readonly boolean[];
  /** Controllers voor de niet-AI-spelers (bot.ts). */
  controllers?: readonly Controller[];
  /** Hoogstens zoveel frames (standaard 60 minuten). */
  maxFrames?: number;
}

const militiaRole = ROLES.indexOf('militia');

function newTrace(): PlayerTrace {
  return {
    scrapByMinute: [],
    settlersByMinute: [],
    popCapByMinute: [],
    militiaByMinute: [],
    claimsByMinute: [],
    income: 0,
    spent: 0,
    peakScrap: 0,
    heroLevel: 1,
    heroXp: 0,
    techs: 0,
    built: {},
    lost: 0,
  };
}

/** Speelt één potje op Rustbelt tot er een winnaar is (of maxFrames) en geeft de meting. */
export function playMatch(seed: number, opts: MatchOptions = {}): MatchResult {
  const ai = opts.ai ?? [true, true];
  const env = buildEnv('rustbelt', lobby(ai), { mode: 'skirmish', delayFrames: 4 });
  const sim = createSim({ seed, ...env });
  const maxFrames = opts.maxFrames ?? 60 * TICKS_PER_MINUTE;
  const n = ai.length;
  const traces = ai.map(() => newTrace());
  const keyOf = buildingKeys(sim);
  const last = ai.map((_, p) => sim.playerStatus(p).scrap);
  const seq: number[] = [];
  let f = 0;
  for (; f < maxFrames && sim.winner() === null; f++) {
    const commands: {
      frame: number;
      playerId: number;
      seq: number;
      type: never;
      payload: unknown;
    }[] = [];
    for (const c of opts.controllers ?? []) {
      c(sim, f, (playerId, type, payload) => {
        const s = seq[playerId] ?? 0;
        seq[playerId] = s + 1;
        commands.push({
          frame: Math.max(0, f - 4),
          playerId,
          seq: s,
          type: type as never,
          payload,
        });
      });
    }
    sim.applyBundle({ frame: f, commands });
    sim.tick();
    for (let p = 0; p < n; p++) {
      const s = sim.ps.scrap[p]!;
      const d = s - last[p]!;
      if (d > 0) traces[p]!.income += d;
      else traces[p]!.spent -= d;
      last[p] = s;
      if (s > traces[p]!.peakScrap) traces[p]!.peakScrap = s;
    }
    for (let k = 0; k < sim.events.count; k++) {
      const t = sim.events.type[k]!;
      if (t === EVENT_TYPE.buildingDone) {
        const u = sim.getUnit(sim.events.a[k]!);
        if (u !== null && u.owner < n) {
          const key = keyOf.get(u.typeId) ?? String(u.typeId);
          traces[u.owner]!.built[key] = (traces[u.owner]!.built[key] ?? 0) + 1;
        }
      } else if (t === EVENT_TYPE.death) {
        const u = sim.getUnit(sim.events.a[k]!);
        if (
          u !== null &&
          u.owner < n &&
          (u.kind === 'corpse' || u.kind === 'unit' || u.kind === 'hero')
        )
          traces[u.owner]!.lost++;
      }
    }
    if ((f + 1) % TICKS_PER_MINUTE === 0) sample(sim, traces);
  }
  if (f % TICKS_PER_MINUTE !== 0) sample(sim, traces);
  for (let p = 0; p < n; p++) {
    const st = sim.playerStatus(p);
    traces[p]!.heroLevel = st.hero?.level ?? 0;
    traces[p]!.heroXp = st.hero?.xp ?? 0;
    traces[p]!.techs = (st.techs ?? []).length;
  }
  const w = sim.winner();
  const frame = w === null ? f - 1 : w.frame;
  return {
    seed,
    winner: w?.playerId ?? null,
    reason: w?.reason ?? null,
    frame,
    minutes: (frame + 1) / TICKS_PER_MINUTE,
    players: traces,
  };
}

function sample(sim: Sim, traces: PlayerTrace[]): void {
  const claims = traces.map(() => 0);
  const militia = traces.map(() => 0);
  for (const id of sim.entityIds()) {
    const u = sim.getUnit(id)!;
    if (u.owner >= traces.length) continue;
    if (u.kind === 'claimPoint') claims[u.owner]!++;
    else if (u.kind === 'unit' && u.role === militiaRole) militia[u.owner]!++;
  }
  traces.forEach((t, p) => {
    const st = sim.playerStatus(p);
    t.scrapByMinute.push(st.scrap);
    t.settlersByMinute.push(st.settlers);
    t.popCapByMinute.push(st.popCap);
    t.militiaByMinute.push(militia[p]!);
    t.claimsByMinute.push(claims[p]!);
  });
}

function buildingKeys(sim: Sim): Map<number, string> {
  const out = new Map<number, string>();
  const keys = gameData().data.buildings;
  for (const b of sim.config.buildingTypes)
    out.set(b.typeId, keys[b.buildingId]?.key ?? String(b.typeId));
  return out;
}

/** Woningen voor speler 0 (midden van de 2 bij 2 footprint, in cellen) in een blok links boven het hoofdgebouw. */
const HOUSES: PlannedBuilding[] = [6, 9, 12].flatMap((cy) =>
  [6, 9, 12, 15].map((cx) => ({ key: 'woning', cx, cy })),
);

/** Bot-plannen voor de balansmeting: passief zoals fixture s4-rustbelt-turrets, actief met omscholen boven een drempel. */
export const BOT_PLANS: Record<'passief' | 'actief', BotPlan> = {
  passief: {
    builds: [
      { key: 'werkplaats', cx: 26, cy: 20 },
      HOUSES[0]!,
      { key: 'turret', cx: 28, cy: 27 },
      { key: 'lab', cx: 14, cy: 26 },
      HOUSES[1]!,
    ],
    research: ['geweerrek', 'raffinage', 'lasergeleiding'],
    builders: 1,
    militiaAtSettlers: 99,
    militiaFrame: 2500,
    militiaCount: 4,
    attackWithMilitia: 4,
    attackFrame: 6400,
  },
  actief: {
    builds: [
      { key: 'werkplaats', cx: 26, cy: 20 },
      ...HOUSES.slice(0, 3),
      { key: 'turret', cx: 28, cy: 27 },
      { key: 'lab', cx: 14, cy: 26 },
      ...HOUSES.slice(3),
    ],
    research: [
      'geweerrek',
      'raffinage',
      'composiet_pantser',
      'snelle_voeten',
      'bouwrobots',
      'lasergeleiding',
    ],
    builders: 2,
    militiaAtSettlers: 99,
    militiaFrame: 4800,
    militiaCount: 4,
    attackWithMilitia: 16,
    attackFrame: 24000,
    spend: { aboveScrap: 150, army: ['patrol', 'militie'], keepScavengers: 12 },
  },
};

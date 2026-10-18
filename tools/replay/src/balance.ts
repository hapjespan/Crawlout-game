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

/** De seeds van de eerlijkheidsmeting (fair-ronde): 1 tot 30, 42, 99 en 123. */
export const FAIRNESS_SEEDS: readonly number[] = [
  ...Array.from({ length: 30 }, (_, k) => k + 1),
  42,
  99,
  123,
];

export interface PlayerTrace {
  /** Scrap op de bank aan het eind van elke minuut. */
  scrapByMinute: number[];
  /** Bewoners (settlers) en pop-cap aan het eind van elke minuut. */
  settlersByMinute: number[];
  popCapByMinute: number[];
  /** Militie (rol militia) aan het eind van elke minuut. */
  militiaByMinute: number[];
  /** Slaves and captives (Raiders, sim 0.18.0) aan het eind van elke minuut. */
  slavesByMinute: number[];
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
  /** Minuut waarin elk gebouwtype voor het eerst af was. */
  firstBuilt: Record<string, number>;
  /** Minuut waarin elke tech klaar was (tech-key). */
  techAt: Record<string, number>;
  /** Geproduceerde robots per loadout-key. */
  robots: Record<string, number>;
  /** Getrainde SPECIAL-punten (som over de zeven letters) aan het eind. */
  trained: number;
  /** Eigen units die sneuvelden. */
  lost: number;
  /** Units this player caught (they became its captives; Raiders, data 0.24.0), sampled every second. */
  captured: number;
  /** Slaves and captives that were freed back to this player (or to it as the liberator), sampled every second. */
  freed: number;
}

export interface MatchResult {
  seed: number;
  winner: number | null;
  reason: WinReason | null;
  /** Frame waarin de winnaar vaststond, of het laatste gespeelde frame. */
  frame: number;
  minutes: number;
  players: PlayerTrace[];
  /** Creep camps of the map (sim 0.20.0), in map order: who cleared each and in which minute (null = not cleared). */
  camps: CampTrace[];
  /**
   * Win route C (data 0.31.0, only in the game type Bouwproject): per player the minute he first held a restored part of
   * every kind (null = never), how many parts he restored and lost, and his longest countdown in minutes.
   */
  project: ProjectTrace[] | null;
}

export interface ProjectTrace {
  allKindsAt: number | null;
  restored: number;
  lost: number;
  longestMinutes: number;
}

export interface CampTrace {
  tier: number;
  clearedBy: number | null;
  minute: number | null;
}

const lobby = (ai: readonly boolean[], factions?: readonly string[]): LobbyPlayer[] =>
  ai.map((isAi, i) => ({
    playerId: i,
    name: `p${i}`,
    faction: factions?.[i] ?? 'dwellers',
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
  /** Factie per speler (standaard dwellers; sim 0.18.0: raiders). */
  factions?: readonly string[] | undefined;
  /** Speltype (data 0.31.0): 'project' is Skirmish met winroute C, het Bouwproject; standaard 'skirmish'. */
  mode?: 'skirmish' | 'project' | undefined;
}

const militiaRole = ROLES.indexOf('militia');

function newTrace(): PlayerTrace {
  return {
    scrapByMinute: [],
    settlersByMinute: [],
    popCapByMinute: [],
    militiaByMinute: [],
    slavesByMinute: [],
    claimsByMinute: [],
    income: 0,
    spent: 0,
    peakScrap: 0,
    heroLevel: 1,
    heroXp: 0,
    techs: 0,
    built: {},
    firstBuilt: {},
    techAt: {},
    robots: {},
    trained: 0,
    lost: 0,
    captured: 0,
    freed: 0,
  };
}

/** Speelt één potje op Rustbelt tot er een winnaar is (of maxFrames) en geeft de meting. */
export function playMatch(seed: number, opts: MatchOptions = {}): MatchResult {
  const ai = opts.ai ?? [true, true];
  const env = buildEnv('rustbelt', lobby(ai, opts.factions), {
    mode: opts.mode ?? 'skirmish',
    delayFrames: 4,
  });
  const sim = createSim({ seed, ...env });
  const maxFrames = opts.maxFrames ?? 60 * TICKS_PER_MINUTE;
  const n = ai.length;
  const traces = ai.map(() => newTrace());
  const keyOf = buildingKeys(sim);
  const unitKeyOf = unitKeys(sim);
  const techKeys = gameData().data.tech.map((t) => t.key);
  const techSeen = ai.map(() => 0);
  const last = ai.map((_, p) => sim.playerStatus(p).scrap);
  const seq: number[] = [];
  const slaveSeen = new Uint8Array(sim.world.slaveState.length);
  const project: ProjectTrace[] | null =
    sim.projectParts.length === 0
      ? null
      : ai.map(() => ({ allKindsAt: null, restored: 0, lost: 0, longestMinutes: 0 }));
  const partOwner = sim.projectParts.map(() => -1);
  const partDone = sim.projectParts.map(() => false);
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
          const tr = traces[u.owner]!;
          tr.built[key] = (tr.built[key] ?? 0) + 1;
          tr.firstBuilt[key] ??= Math.floor((f / TICKS_PER_MINUTE) * 10) / 10;
        }
      } else if (t === EVENT_TYPE.spawn) {
        const u = sim.getUnit(sim.events.a[k]!);
        const key = unitKeyOf.get(sim.events.b[k]!);
        if (u !== null && u.owner < n && key !== undefined) {
          const tr = traces[u.owner]!;
          tr.robots[key] = (tr.robots[key] ?? 0) + 1;
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
    if ((f + 1) % 20 === 0) countSlaveChanges(sim, traces, slaveSeen);
    if (project !== null && (f + 1) % 20 === 0) {
      sim.projectParts.forEach((i, k) => {
        const w = sim.world;
        const owner = w.owner[i]!;
        const done = owner < n && w.bstate[i] === 2;
        if (done && !partDone[k]) project[owner]!.restored++;
        if (!done && partDone[k] && partOwner[k]! >= 0) project[partOwner[k]!]!.lost++;
        partDone[k] = done;
        partOwner[k] = done ? owner : -1;
      });
      for (let p = 0; p < n; p++) {
        const t = sim.ps.projTicks[p]!;
        const pt = project[p]!;
        if (t > 0) pt.allKindsAt ??= Math.floor(((f + 1) / TICKS_PER_MINUTE) * 10) / 10;
        pt.longestMinutes = Math.max(
          pt.longestMinutes,
          Math.floor((t / TICKS_PER_MINUTE) * 10) / 10,
        );
      }
    }
    if ((f + 1) % 20 === 0)
      for (let p = 0; p < n; p++) {
        const bits = sim.ps.tech[p]!;
        if (bits === techSeen[p]) continue;
        for (let t = 0; t < techKeys.length; t++)
          if (((bits >>> t) & 1) !== 0 && ((techSeen[p]! >>> t) & 1) === 0)
            traces[p]!.techAt[techKeys[t]!] = Math.floor(((f + 1) / TICKS_PER_MINUTE) * 10) / 10;
        techSeen[p] = bits;
      }
    if ((f + 1) % TICKS_PER_MINUTE === 0) sample(sim, traces);
  }
  if (f % TICKS_PER_MINUTE !== 0) sample(sim, traces);
  for (let p = 0; p < n; p++) {
    const st = sim.playerStatus(p);
    traces[p]!.heroLevel = st.hero?.level ?? 0;
    traces[p]!.heroXp = st.hero?.xp ?? 0;
    traces[p]!.techs = (st.techs ?? []).length;
    traces[p]!.trained = (st.trained ?? []).reduce((a: number, b: number) => a + b, 0);
  }
  const w = sim.winner();
  const frame = w === null ? f - 1 : w.frame;
  const camps = (sim.map.creepCamps ?? []).map((c, k): CampTrace => ({
    tier: c.tier,
    clearedBy: sim.creeps.clearedBy[k] === 0 ? null : sim.creeps.clearedBy[k]! - 1,
    minute:
      sim.creeps.clearedAt[k] === 0
        ? null
        : Math.floor((sim.creeps.clearedAt[k]! / TICKS_PER_MINUTE) * 10) / 10,
  }));
  return {
    seed,
    winner: w?.playerId ?? null,
    reason: w?.reason ?? null,
    frame,
    minutes: (frame + 1) / TICKS_PER_MINUTE,
    players: traces,
    camps,
    project,
  };
}

/** Captures (none to captive) and liberations (slave or captive to freed) since the last call, per new owner. */
function countSlaveChanges(sim: Sim, traces: PlayerTrace[], seen: Uint8Array): void {
  const w = sim.world;
  for (let i = 0; i < w.highWater; i++) {
    const st = w.alive[i] === 1 ? w.slaveState[i]! : 0;
    const was = seen[i]!;
    if (st !== was && w.alive[i] === 1 && w.owner[i]! < traces.length) {
      if (st === 1 && was === 0) traces[w.owner[i]!]!.captured++;
      else if (st === 3) traces[w.owner[i]!]!.freed++;
    }
    seen[i] = st;
  }
}

function sample(sim: Sim, traces: PlayerTrace[]): void {
  const claims = traces.map(() => 0);
  const militia = traces.map(() => 0);
  const slaves = traces.map(() => 0);
  const w = sim.world;
  for (let i = 0; i < w.highWater; i++)
    if (
      w.alive[i] === 1 &&
      w.owner[i]! < traces.length &&
      w.slaveState[i]! !== 0 &&
      w.slaveState[i]! !== 3
    )
      slaves[w.owner[i]!]!++;
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
    t.slavesByMinute.push(slaves[p]!);
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

/** Key van elk robot-unittype (alleen robots: wat in een fabriek gebouwd wordt). */
function unitKeys(sim: Sim): Map<number, string> {
  const out = new Map<number, string>();
  const keys = gameData().data.loadouts;
  for (const u of sim.config.unitTypes)
    if (u.producedAtTypeId !== 0) out.set(u.typeId, keys[u.loadoutId]?.key ?? String(u.typeId));
  return out;
}

/** Een woning bij het eigen hoofdgebouw (de plek volgt uit de map en de state, zie SitePlanner in bot.ts). */
const HOUSE: PlannedBuilding = { key: 'woning', at: 'hq' };
const houses = (n: number): PlannedBuilding[] => Array.from({ length: n }, () => HOUSE);

/** Bot-plannen voor de balansmeting: passief zoals fixture s4-rustbelt-turrets, actief met omscholen boven een drempel. */
export const BOT_PLANS: Record<'passief' | 'actief', BotPlan> = {
  passief: {
    builds: [
      { key: 'werkplaats', at: 'hq' },
      HOUSE,
      { key: 'turret', at: 'hq' },
      { key: 'lab', at: 'hq' },
      HOUSE,
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
      { key: 'werkplaats', at: 'hq' },
      ...houses(3),
      { key: 'turret', at: 'hq' },
      { key: 'lab', at: 'hq' },
      ...houses(9),
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

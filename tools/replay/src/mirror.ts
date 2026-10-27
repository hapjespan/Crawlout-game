import type { LobbyPlayer } from '@crawlout/protocol';
import { OWNER_NEUTRAL } from '@crawlout/protocol';
import { TECH_WORDS, createSim } from '@crawlout/sim';
import type { Sim, SimConfig, SimEnv, UnitView } from '@crawlout/sim';
import { buildEnv } from './env.js';

// Spiegelmeting (fair-ronde): twee scripted AI's op een puntsymmetrische map (Rustbelt XL) horen elkaars spiegelbeeld
// te spelen zolang er geen toeval in het spel komt. Deze meting draait AI tegen AI en vergelijkt elke tick de wereld van
// speler 0 met het spiegelbeeld (180 graden om het midden van de map) van die van speler 1: gebouwen (type, footprint,
// voortgang, hp), units (type, positie, hp, order, rol, vracht), de spelerstate (scrap, bouwvolgorde, golven, held,
// techs), de eigenaars van de claimpunten en de voorraad van de scrap-nodes. Het eerste frame waarop dat verschilt, is
// een spiegelbreuk; de meting geeft de verschillen van dat frame. Met `neutral` gaat het toeval eruit (geen golf-jitter,
// geen kritieke schoten), zodat elke breuk een volgorde- of tiebreakfout is en niet het verschil tussen twee
// rng-trekkingen. Leest alleen state; de meting zelf mag floats gebruiken.

export interface MirrorOptions {
  /** Hoogstens zoveel frames (standaard 20 minuten). */
  maxFrames?: number;
  /** Toeval eruit: waveJitterTicks 0 en luckCritPermille 0 (standaard true). */
  neutral?: boolean;
  /** Doorgaan na de eerste breuk en per minuut de economie meten (standaard false: stoppen bij de breuk). */
  full?: boolean;
  /** Hoogstens zoveel verschillen in het rapport (standaard 12). */
  maxDiffs?: number;
  /** De factie van beide spelers (standaard dwellers; data 0.24.0: raiders voor de Raider-spiegel). */
  faction?: string;
}

export interface MirrorEconomy {
  /** Per minuut, per speler: scrap op de bank, totaal inkomen, bewoners, gebouwen (af), militie, claimpunten. */
  scrap: [number, number][];
  income: [number, number][];
  units: [number, number][];
  buildings: [number, number][];
  claims: [number, number][];
}

export interface MirrorResult {
  seed: number;
  /** Eerste frame (na de tick) waarop de spiegel breekt, of null. */
  breakFrame: number | null;
  /** De verschillen op dat frame: "p0 ..." staat alleen bij speler 0, "p1 ..." alleen (gespiegeld) bij speler 1. */
  diffs: string[];
  /** Frames waarop het n-de gebouw (af of in aanbouw, in volgorde van plaatsing) van elke speler verscheen. */
  buildOrder: [string[], string[]];
  economy: MirrorEconomy;
  winner: number | null;
  frame: number;
}

const lobby = (faction: string): LobbyPlayer[] =>
  [0, 1].map((i) => ({
    playerId: i,
    name: `p${i}`,
    faction,
    ready: true,
    online: false,
    ai: true,
  }));

/** Rustbelt XL met twee AI's (van één factie); met neutral zonder toeval (geen jitter, geen kritieke schoten). */
export function mirrorEnv(neutral: boolean, faction = 'dwellers'): SimEnv {
  const env = buildEnv('rustbelt', lobby(faction), { mode: 'skirmish', delayFrames: 4 });
  if (!neutral) return env;
  const config: SimConfig = {
    ...env.config,
    aiScripts: env.config.aiScripts.map((s) => ({ ...s, waveJitterTicks: 0 })),
    special: { ...env.config.special, luckCritPermille: 0 },
  };
  return { ...env, config };
}

/** Beschrijving van de wereld van speler p, gespiegeld als mirror (posities en footprints 180 graden om het midden). */
function describe(sim: Sim, p: number, mirror: boolean): string[] {
  const w = sim.world;
  const W = sim.map.w;
  const H = sim.map.h;
  const mx = (x: number): number => (mirror ? (W << 8) - x : x);
  const my = (y: number): number => (mirror ? (H << 8) - y : y);
  const out: string[] = [];
  for (const id of sim.entityIds()) {
    const u = sim.getUnit(id)!;
    if (u.kind === 'scrapNode' || u.kind === 'claimPoint') continue;
    if (u.owner !== p) continue;
    const i = w.resolve(id);
    if (u.kind === 'building') {
      const fx = mirror ? W - w.fx[i]! - w.fw[i]! : w.fx[i]!;
      const fy = mirror ? H - w.fy[i]! - w.fh[i]! : w.fy[i]!;
      out.push(
        `gebouw t${u.typeId} @${fx},${fy} st${u.buildState} prog${u.progress} hp${u.hp} res${w.research[i]} work${w.work[i]} job${w.job[i]}/${w.jobKind[i]}/${w.jobWork[i]}`,
      );
    } else if (u.kind === 'corpse') {
      out.push(`lijk t${u.typeId} @${mx(u.x)},${my(u.y)} t${w.work[i]}`);
    } else {
      out.push(
        `${u.kind} t${u.typeId} @${mx(u.x)},${my(u.y)} hp${u.hp} ord${u.order} ph${u.phase} rol${u.role} carry${u.carry} mv${u.moving ? 1 : 0} work${w.work[i]} cd${w.cooldown[i]} rm${w.repairMilli[i]} sl${w.slaveState[i]}/${w.slaveTicks[i]}/${w.capWork[i]} chem${w.chem[i]}/${w.chemPhase[i]}/${w.chemTicks[i]}`,
      );
    }
  }
  out.sort();
  const ps = sim.ps;
  out.push(
    `ps scrap${ps.scrap[p]} growth${ps.growth[p]} dom${ps.domTicks[p]} build${ps.aiBuild[p]} attack${ps.aiAttack[p]} waveAt${ps.aiWaveAt[p]} claimAt${ps.aiClaimAt[p]} tech${ps.tech.slice(p * TECH_WORDS, p * TECH_WORDS + TECH_WORDS).join('.')} hero${ps.heroState[p]}/${ps.heroLevel[p]}/${ps.heroXp[p]}/${ps.heroPerks[p]}/${ps.heroTimer[p]} trained${ps.trained.slice(p * 7, p * 7 + 7).join('.')} net${ps.netTimer[p]}/${ps.netArrivals[p]} robot${ps.aiRobot[p]} mix${ps.aiMix[p]} raid${ps.aiRaidAt[p]}/${ps.aiRaidOut[p]} trib${ps.tributeAcc[p]}`,
  );
  return out;
}

interface Feature {
  /** Entity-index. */
  i: number;
  x: number;
  y: number;
  claim: boolean;
}

/** Scrap-nodes en claimpunten van een sim. */
function features(sim: Sim): Feature[] {
  const out: Feature[] = [];
  for (const id of sim.entityIds()) {
    const u = sim.getUnit(id)!;
    if (u.kind !== 'scrapNode' && u.kind !== 'claimPoint') continue;
    out.push({ i: sim.world.resolve(id), x: u.x, y: u.y, claim: u.kind === 'claimPoint' });
  }
  return out;
}

/** De feature uit `list` van dezelfde soort die het dichtst bij het spiegelbeeld van f ligt. */
function mirrorPartner(sim: Sim, f: Feature, list: readonly Feature[]): Feature {
  const W = sim.map.w << 8;
  const H = sim.map.h << 8;
  let best = f;
  let bestD = Infinity;
  for (const g of list) {
    if (g.claim !== f.claim) continue;
    const d = Math.abs(W - g.x - f.x) + Math.abs(H - g.y - f.y);
    if (d < bestD) {
      best = g;
      bestD = d;
    }
  }
  return best;
}

/** Eigenaar met speler 0 en 1 verwisseld (neutraal blijft neutraal). */
const swapOwner = (o: number): number => (o === 0 ? 1 : o === 1 ? 0 : o);

/** Claimpunten en nodes van sim a tegen het spiegelbeeld van sim b (eigenaars verwisseld). */
function describeNeutralPair(a: Sim, b: Sim): string[] {
  const out: string[] = [];
  const fb = features(b);
  for (const f of features(a)) {
    const g = mirrorPartner(a, f, fb);
    if (f.claim) {
      const oa = a.world.owner[f.i]!;
      const ob = b.world.owner[g.i]!;
      if (oa !== swapOwner(ob))
        out.push(`claimpunt @${f.x >> 8},${f.y >> 8}: eigenaar ${oa} tegen ${ob}`);
    } else if (a.world.amount[f.i] !== b.world.amount[g.i])
      out.push(
        `node @${f.x >> 8},${f.y >> 8}: ${a.world.amount[f.i]} tegen ${b.world.amount[g.i]}`,
      );
  }
  return out;
}

export interface SwapResult {
  seeds: [number, number];
  /** Frame waarop de twee potjes geen spiegelbeeld meer zijn (met verwisselde spelers), of null. */
  breakFrame: number | null;
  diffs: string[];
  winners: [number | null, number | null];
  frames: [number, number];
}

/**
 * Verwisselproef: twee potjes zonder toeval die alleen verschillen in wie het midden kreeg (een gelijke stand bij het
 * midden gaat via sim.rng, dus per seed naar de een of de ander). Is de sim eerlijk, dan is potje b vanaf daar het
 * spiegelbeeld van potje a met de spelers verwisseld: speler 0 in a doet wat speler 1 in b gespiegeld doet, tot het
 * einde. Het eerste frame waarop dat niet zo is, wijst een verborgen voorkeur aan (volgorde op entity-index, playerId).
 */
export function mirrorSwap(
  seedA: number,
  seedB: number,
  maxFrames = 45 * 1200,
  max = 12,
  faction = 'dwellers',
): SwapResult {
  const env = mirrorEnv(true, faction);
  const a = createSim({ seed: seedA, ...env });
  const b = createSim({ seed: seedB, ...env });
  let breakFrame: number | null = null;
  let diffs: string[] = [];
  for (let f = 0; f < maxFrames && (a.winner() === null || b.winner() === null); f++) {
    for (const s of [a, b]) {
      if (s.winner() !== null) continue;
      s.applyBundle({ frame: f, commands: [] });
      s.tick();
    }
    if (breakFrame !== null) continue;
    // voor het midden zijn beide potjes zelf al symmetrisch; daarna hoort a gespiegeld en verwisseld gelijk aan b
    const d = [
      ...describeNeutralPair(a, b),
      ...listDiff(describe(a, 0, false), describe(b, 1, true), max),
      ...listDiff(describe(a, 1, false), describe(b, 0, true), max),
    ];
    if (d.length > 0) {
      breakFrame = f + 1;
      diffs = d.slice(0, max);
    }
  }
  const wa = a.winner();
  const wb = b.winner();
  return {
    seeds: [seedA, seedB],
    breakFrame,
    diffs,
    winners: [wa?.playerId ?? null, wb?.playerId ?? null],
    frames: [wa?.frame ?? a.frame, wb?.frame ?? b.frame],
  };
}

/** Claimpunten en nodes: eigenaar en voorraad, gekoppeld aan hun spiegelpartner (binnen één cel). */
function describeNeutral(sim: Sim): string[] {
  const w = sim.world;
  const feats = features(sim);
  const out: string[] = [];
  for (const f of feats) {
    const g = mirrorPartner(sim, f, feats);
    if (f.i > g.i) continue; // elk paar één keer
    if (f.claim) {
      const a = w.owner[f.i]!;
      const b = w.owner[g.i]!;
      const centre = f.i === g.i; // het punt in het midden is zijn eigen partner
      if (a !== swapOwner(b) && !(centre && a === OWNER_NEUTRAL))
        out.push(`claimpunt @${f.x >> 8},${f.y >> 8}: eigenaar ${a} tegen spiegel ${b}`);
      if (centre && a !== OWNER_NEUTRAL)
        out.push(`claimpunt @${f.x >> 8},${f.y >> 8} (midden): eigenaar ${a}`);
    } else if (w.amount[f.i] !== w.amount[g.i]) {
      out.push(
        `node @${f.x >> 8},${f.y >> 8}: voorraad ${w.amount[f.i]} tegen spiegel ${w.amount[g.i]}`,
      );
    }
  }
  return out;
}

/** Verschil tussen twee gesorteerde lijsten: wat alleen in a staat (p0) en alleen in b (p1, gespiegeld). */
function listDiff(a: string[], b: string[], max: number): string[] {
  const out: string[] = [];
  const cb = new Map<string, number>();
  for (const s of b) cb.set(s, (cb.get(s) ?? 0) + 1);
  const ca = new Map<string, number>();
  for (const s of a) ca.set(s, (ca.get(s) ?? 0) + 1);
  for (const s of a) {
    const n = cb.get(s) ?? 0;
    if (n > 0) cb.set(s, n - 1);
    else if (out.length < max) out.push(`p0 ${s}`);
  }
  for (const s of b) {
    const n = ca.get(s) ?? 0;
    if (n > 0) ca.set(s, n - 1);
    else if (out.length < max) out.push(`p1 ${s}`);
  }
  return out;
}

/** AI tegen AI op Rustbelt XL; vergelijkt elke tick speler 0 met het spiegelbeeld van speler 1. */
export function mirrorRun(seed: number, opts: MirrorOptions = {}): MirrorResult {
  const sim = createSim({ seed, ...mirrorEnv(opts.neutral ?? true, opts.faction) });
  const maxFrames = opts.maxFrames ?? 20 * 1200;
  const max = opts.maxDiffs ?? 12;
  const tpm = sim.config.ticksPerMinute;
  let breakFrame: number | null = null;
  let diffs: string[] = [];
  const buildOrder: [string[], string[]] = [[], []];
  const seenBuildings = new Set<number>();
  const economy: MirrorEconomy = { scrap: [], income: [], units: [], buildings: [], claims: [] };
  const income = [0, 0];
  const last = [sim.ps.scrap[0]!, sim.ps.scrap[1]!];
  for (let f = 0; f < maxFrames && sim.winner() === null; f++) {
    sim.applyBundle({ frame: f, commands: [] });
    sim.tick();
    for (let p = 0; p < 2; p++) {
      const d = sim.ps.scrap[p]! - last[p]!;
      if (d > 0) income[p]! += d;
      last[p] = sim.ps.scrap[p]!;
    }
    for (const id of sim.entityIds()) {
      if (seenBuildings.has(id)) continue;
      const u = sim.getUnit(id)!;
      if (u.kind !== 'building' || u.owner > 1) continue;
      seenBuildings.add(id);
      if (f > 0) buildOrder[u.owner]!.push(`${f}:t${u.typeId}`);
    }
    if ((f + 1) % tpm === 0) {
      const n = (p: number, pred: (u: UnitView) => boolean): number =>
        sim.entityIds().filter((id) => {
          const u = sim.getUnit(id)!;
          return u.owner === p && pred(u);
        }).length;
      const pair = (g: (p: number) => number): [number, number] => [g(0), g(1)];
      economy.scrap.push(pair((p) => sim.ps.scrap[p]!));
      economy.income.push(pair((p) => income[p]!));
      economy.units.push(pair((p) => n(p, (u) => u.kind === 'unit')));
      economy.buildings.push(pair((p) => n(p, (u) => u.kind === 'building' && u.buildState === 2)));
      economy.claims.push(pair((p) => n(p, (u) => u.kind === 'claimPoint')));
    }
    if (breakFrame === null) {
      const a = describe(sim, 0, false);
      const b = describe(sim, 1, true);
      const d = listDiff(a, b, max);
      const nd = describeNeutral(sim);
      if (d.length > 0 || nd.length > 0) {
        breakFrame = f + 1;
        diffs = [...nd, ...d].slice(0, max);
        if (opts.full !== true) break;
      }
    }
  }
  const win = sim.winner();
  return {
    seed,
    breakFrame,
    diffs,
    buildOrder,
    economy,
    winner: win?.playerId ?? null,
    frame: win?.frame ?? sim.frame,
  };
}

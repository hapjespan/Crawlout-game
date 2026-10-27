// Split from fixtures-def.ts to stay under the 5,000-token file limit; fixtures-def.ts re-exports the public surface.
// Holds: FixtureDef, players, base, Start, startOf, nearest, +13 more.
import {
  type Replay,
  type LobbyPlayer,
  DELAY_FRAMES_DEFAULT,
  type CommandEnvelope,
  type FrameBundle,
  EVENT_TYPE,
} from '@crawlout/protocol';
import { gameData } from './env.js';
import type { Sim } from '@crawlout/sim';
import { createReplaySim } from './run.js';
import { ROLES, buildingTypeId } from '@crawlout/data';
import {
  type PlannedBuilding,
  type BotPlan,
  recordControlled,
  settlementBot,
  centrePoint,
  toward,
  SitePlanner,
} from './bot.js';

// Definities van de replay-fixtures in tools/replay/fixtures. `pnpm --filter @crawlout/replay record` draait ze
// en schrijft de JSON met verwachte hashes. Een fixture opnieuw opnemen mag alleen bij een bewuste
// gedragswijziging in de sim, met uitleg in de CHANGELOG. Alles draait op de echte data (data/) en de echte maps
// (data/maps); de startopstelling volgt uit map, data en spelers (contract 2). Plekken en doelen op Rustbelt komen uit
// de map (spawns, claimpunten) en de state (SitePlanner in bot.ts), niet uit vaste cellen: een nieuwe Rustbelt vraagt
// alleen een nieuwe opname.

export interface FixtureDef {
  readonly name: string;
  build(): Replay;
}

const players = (ai: boolean[]): LobbyPlayer[] =>
  ai.map((isAi, i) => ({
    playerId: i,
    name: isAi ? `ai${i}` : `speler${i}`,
    faction: 'dwellers',
    ready: true,
    online: !isAi,
    ai: isAi,
  }));

export const base = (map: string, seed: number, ai: boolean[]): Replay => ({
  dataVersion: gameData().data.dataVersion,
  seed,
  map,
  players: players(ai),
  settings: { mode: 'skirmish', delayFrames: DELAY_FRAMES_DEFAULT },
  bundles: [],
  hashes: [],
});

/** Wat er na de startopstelling staat, per soort en per speler (ids oplopend). */
interface Start {
  sim: Sim;
  nodes: number[];
  claims: number[];
  hq: number[];
  hero: number[][];
  scav: number[][];
  builder: number[][];
  militia: number[][];
}

export function startOf(r: Replay): Start {
  const sim = createReplaySim(r);
  const s: Start = {
    sim,
    nodes: [],
    claims: [],
    hq: [],
    hero: [],
    scav: [],
    builder: [],
    militia: [],
  };
  for (let p = 0; p < r.players.length; p++) {
    s.scav.push([]);
    s.hero.push([]);
    s.builder.push([]);
    s.militia.push([]);
  }
  for (const id of sim.entityIds()) {
    const u = sim.getUnit(id)!;
    if (u.kind === 'scrapNode') s.nodes.push(id);
    else if (u.kind === 'claimPoint') s.claims.push(id);
    else if (u.owner >= r.players.length)
      continue; // the bandits of the creep camps (sim 0.20.0)
    else if (u.kind === 'building') s.hq.push(id);
    else if (u.kind === 'hero') s.hero[u.owner]!.push(id);
    else if (u.role === ROLES.indexOf('scavenger')) s.scav[u.owner]!.push(id);
    else if (u.role === ROLES.indexOf('builder')) s.builder[u.owner]!.push(id);
    else if (u.role === ROLES.indexOf('militia')) s.militia[u.owner]!.push(id);
  }
  return s;
}

/** Node die het dichtst bij een positie ligt (tiebreak laagste id). */
export function nearest(sim: Sim, ids: readonly number[], x: number, y: number): number {
  let best = ids[0]!;
  let bestD = Infinity;
  for (const id of ids) {
    const u = sim.getUnit(id)!;
    const d = (u.x - x) ** 2 + (u.y - y) ** 2;
    if (d < bestD) {
      best = id;
      bestD = d;
    }
  }
  return best;
}

export const cell = (cx: number, cy: number): { x: number; y: number } => ({
  x: cx * 256 + 128,
  y: cy * 256 + 128,
});

export const building = (key: string): number =>
  buildingTypeId(gameData().data.buildings.find((b) => b.key === key)!.id);

export const tech = (key: string): number => gameData().data.tech.find((t) => t.key === key)!.id;

export const loadout = (key: string): number =>
  gameData().data.loadouts.find((l) => l.key === key)!.id;

export const data = {
  get heroes() {
    return gameData().data.heroes;
  },
};

export class Script {
  private readonly frames = new Map<number, CommandEnvelope[]>();
  private readonly seqs: number[] = [];

  /** Commando dat in `execFrame` wordt uitgevoerd; gegeven in execFrame - DELAY. */
  add(
    execFrame: number,
    playerId: number,
    type: CommandEnvelope['type'],
    payload: unknown,
    seq?: number,
  ): this {
    const s = seq ?? this.seqs[playerId] ?? 0;
    this.seqs[playerId] = Math.max(this.seqs[playerId] ?? 0, s + 1);
    const list = this.frames.get(execFrame) ?? [];
    list.push({
      frame: Math.max(0, execFrame - DELAY_FRAMES_DEFAULT),
      playerId,
      seq: s,
      type,
      payload,
    });
    this.frames.set(execFrame, list);
    return this;
  }

  move(execFrame: number, playerId: number, ids: number[], cx: number, cy: number): this {
    return this.add(execFrame, playerId, 'Move', { ids, ...cell(cx, cy) });
  }

  bundles(): FrameBundle[] {
    return [...this.frames.keys()]
      .sort((a, b) => a - b)
      .map((frame) => ({ frame, commands: this.frames.get(frame)! }));
  }
}

/** Een woning bij het eigen hoofdgebouw (de plek volgt uit map en state, zie SitePlanner in bot.ts). */
export const HOUSE: PlannedBuilding = { key: 'woning', at: 'hq' };

const houses = (n: number): PlannedBuilding[] => Array.from({ length: n }, () => HOUSE);

export const FIXTURES_S4: FixtureDef[] = [
  {
    // Turrets en onderzoek op Rustbelt, mens tegen AI. Speler 0 (een bot die gewone commando's geeft): werkplaats,
    // geweerrek, claimpalen bij zijn twee settlement-punten en in het midden met een turret ernaast, lab, raffinage en
    // lasergeleiding (turret +20% schade, +1 m), daarna een kleine aanval met held op het hoofdgebouw van de AI, waar
    // zijn tweede turret staat. De AI (speler 1) onderzoekt geweerrek voor zijn turret (besluit 8), claimt het midden
    // niet zolang het van de bot is en stuurt een raid met een bouwer op het midden omdat de bot genoeg punten voor
    // dominantie houdt (3 van de 5 op Rustbelt XL), zodat beide turrets schieten. Lockdown, dood en oplappen komen voor.
    name: 's4-rustbelt-turrets',
    build() {
      const r = base('rustbelt', 404, [false, true]);
      const plan: BotPlan = {
        builds: [
          { key: 'werkplaats', at: 'hq' },
          HOUSE,
          { key: 'claimpaal', at: 'settlement' },
          { key: 'claimpaal', at: 'settlement2' },
          { key: 'claimpaal', at: 'centre' },
          { key: 'turret', at: 'centre', homewardM: 3 },
          { key: 'lab', at: 'hq' },
          HOUSE,
        ],
        research: ['geweerrek', 'raffinage', 'lasergeleiding'],
        builders: 1,
        militiaAtSettlers: 99,
        militiaFrame: 2500,
        militiaCount: 4,
        attackWithMilitia: 4,
        attackFrame: 15500,
        attackTarget: 'hq',
      };
      recordControlled(r, 20000, [settlementBot(0, plan)]);
      return r;
    },
  },
  {
    // Brief-eindcriterium sim-core (fase-0 sectie 9): 50 bewoners per kant verzamelen, bouwen, wisselen van rol en
    // vechten op de slice-map. Twee bots, gespiegeld: werkplaats en negen woningen (6 + 45 bedden, pop-cap 50; data
    // 0.14.0, woningen op echte schaal met 5 bedden), drie bouwers, alle scavengers verzamelen; de bewoners groeien uit
    // huisvesting tot 50 per kant. Dan worden 24 van hen militie en vallen ze elkaars basis aan, tot er 40 doden zijn
    // (met 20 bleef het bij 39: de grotere gebouwen houden een aanval langer op). Geen spawns buiten de regels om.
    name: 's4-rustbelt-fifty',
    build() {
      const r = base('rustbelt', 50, [false, false]);
      const plan: BotPlan = {
        builds: [{ key: 'werkplaats', at: 'hq' }, ...houses(9)],
        research: [],
        builders: 3,
        militiaAtSettlers: 50,
        militiaCount: 24,
        attackWithMilitia: 24,
      };
      let deaths = 0;
      recordControlled(r, 36000, [settlementBot(0, plan), settlementBot(1, plan)], (sim) => {
        for (let k = 0; k < sim.events.count; k++)
          if (sim.events.type[k] === EVENT_TYPE.death) deaths++;
        return deaths >= 40;
      });
      return r;
    },
  },
];

export const FIXTURES_S6: FixtureDef[] = [
  {
    // Winroute B op Rustbelt (fase-0 sectie 17, advies 3): speler 0 is een bot die zijn twee settlement-punten en het
    // midden claimt (3 van de 5 op Rustbelt XL), bij het midden twee turrets zet (geweerrek in de werkplaats) en zijn
    // militie het midden laat houden; de scripted AI (speler 1, de echte data) claimt zijn eigen punten en raidt het
    // midden zodra de bot genoeg punten houdt. De bot houdt ze dominance.minutes vast en wint op dominantie; de fixture
    // loopt tot net na de winst.
    name: 's6-rustbelt-dominance',
    build() {
      const r = base('rustbelt', 600, [false, true]);
      const plan: BotPlan = {
        builds: [
          { key: 'werkplaats', at: 'hq' },
          { key: 'claimpaal', at: 'settlement' },
          { key: 'claimpaal', at: 'settlement2' },
          { key: 'claimpaal', at: 'centre' },
          HOUSE,
          HOUSE,
          // turrets van 3 x 3 (echte schaal): een aan de kant van de vijand, zodat een raid op de paal binnen bereik is
          { key: 'turret', at: 'centre', homewardM: -4 },
          { key: 'turret', at: 'centre', homewardM: 3 },
          HOUSE,
        ],
        research: ['geweerrek'],
        builders: 2,
        militiaAtSettlers: 10,
        militiaCount: 6,
        attackWithMilitia: 999,
        spend: { aboveScrap: 100, army: ['militie'], keepScavengers: 6 },
        guard: 'centre',
      };
      let end = -1;
      recordControlled(r, 30000, [settlementBot(0, plan)], (sim, f) => {
        const w = sim.winner();
        if (w !== null && end < 0) end = w.frame + 20;
        return end >= 0 && f >= end;
      });
      return r;
    },
  },
];

export const FIXTURES_S7: FixtureDef[] = [
  {
    // Group-order spreading (visual review 15 October, item 5): every unit of a group Move or AttackMove gets its own
    // formation slot. Both players (humans): the whole start army walks toward the middle, a repeated Move to the same
    // point (no reshuffle), an AttackMove onward, a Move onto their own headquarters (a point in a building: since sim
    // 0.22.0 a formation at the nearest free cells beside it, on the group's side; before, no formation and everybody
    // walked at the point and stood at the edge), and all workers to one node (ring spots, off in data 0.15.0).
    name: 's7-rustbelt-formation',
    build() {
      const r = base('rustbelt', 715, [false, false]);
      const st = startOf(r);
      const sim = st.sim;
      const s = new Script();
      const centre = centrePoint(sim);
      for (let p = 0; p < 2; p++) {
        const sp = sim.map.spawns[p]!;
        const army = [...st.militia[p]!, ...st.builder[p]!, ...st.hero[p]!];
        const near = toward(sp, centre, 30);
        const far = toward(sp, centre, 45);
        s.add(4, p, 'Move', { ids: army, x: near.x, y: near.y });
        s.add(500, p, 'Move', { ids: army, x: near.x, y: near.y });
        s.add(560, p, 'AttackMove', { ids: army, x: far.x, y: far.y });
        s.add(1000, p, 'Move', { ids: army, x: sp.x, y: sp.y });
        const node = nearest(sim, st.nodes, sp.x, sp.y);
        s.add(6, p, 'Gather', { ids: st.scav[p]!, nodeId: node });
      }
      r.bundles = s.bundles();
      r.hashes = [{ frame: 1599, hash: 0 }]; // length; record fills in the real hashes
      return r;
    },
  },
];

/**
 * Content-x (data 0.16.0) for speler p: zodra er een voltooide robotfabriek zonder werk is, een robot uit `robots` (in
 * volgorde, cyclisch) tot `max` robots; zodra er een voltooide trainingsfaciliteit zonder werk is, het eerste
 * trainingsprogramma uit `train` dat nog kan. Alleen gewone commando's (Produce, Train); de sim weigert wat niet kan.
 */
export function contentBot(
  p: number,
  robots: readonly string[],
  max: number,
  train: readonly string[],
) {
  let k = 0;
  return (
    sim: Sim,
    f: number,
    add: (p: number, type: CommandEnvelope['type'], payload: unknown) => void,
  ): void => {
    if (f % 10 !== (p + 5) % 10) return;
    const mine = sim
      .entityIds()
      .map((id) => sim.getUnit(id)!)
      .filter((u) => u.owner === p);
    const busy = new Set(sim.queue(p).map((q) => q.buildingId));
    const idle = (key: string) =>
      mine.find(
        (u) =>
          u.kind === 'building' &&
          u.typeId === building(key) &&
          u.buildState === 2 &&
          !busy.has(u.id),
      );
    const robotCount = mine.filter(
      (u) => u.kind === 'unit' && u.role === ROLES.indexOf('robot'),
    ).length;
    const factory = idle('robotfabriek');
    if (factory !== undefined && robotCount < max) {
      add(p, 'Produce', { buildingId: factory.id, loadoutId: loadout(robots[k % robots.length]!) });
      k++;
    }
    const facility = idle('trainingsfaciliteit');
    const trained = sim.playerStatus(p).trained ?? [];
    if (facility !== undefined) {
      const prog = train
        .map((key) => gameData().data.training.find((t) => t.key === key)!)
        .find((t) => (trained[t.special] ?? 0) < t.maxPoints);
      if (prog !== undefined) add(p, 'Train', { buildingId: facility.id, programId: prog.id });
    }
  };
}

export const FIXTURES_S8: FixtureDef[] = [
  {
    // Content-x (data 0.16.0), speler 0 een bot met de nieuwe content: werkplaats, lab, robotfabriek,
    // trainingsfaciliteit en drie turrets bij het hoofdgebouw; onderzoek tot turret_netwerk (het turret-netwerk), een
    // reparatiedrone en vijf beveiligingsrobots met één bouwer (vier gedekt, twee ongedekt: de technicus-regel), en
    // training van Kracht en Waarneming. Speler 1 valt met vier militie het hoofdgebouw van speler 0 aan: turrets,
    // robots en reparatie aan het werk.
    name: 's8-rustbelt-robots',
    build() {
      const r = base('rustbelt', 816, [false, false]);
      const p0: BotPlan = {
        builds: [
          { key: 'werkplaats', at: 'hq' },
          HOUSE,
          { key: 'lab', at: 'hq' },
          HOUSE,
          { key: 'robotfabriek', at: 'hq' },
          { key: 'turret', at: 'settlement', homewardM: 6 },
          { key: 'turret', at: 'settlement', homewardM: 10 },
          { key: 'trainingsfaciliteit', at: 'hq' },
          { key: 'turret', at: 'settlement', homewardM: 14 },
          HOUSE,
          HOUSE,
        ],
        research: [
          'raffinage',
          'geweerrek',
          'robotica',
          'lasergeleiding',
          'lasertechniek',
          'turret_netwerk',
        ],
        builders: 1,
        militiaAtSettlers: 99,
        militiaCount: 0,
        attackWithMilitia: 99,
      };
      const p1: BotPlan = {
        builds: [{ key: 'werkplaats', at: 'hq' }, HOUSE, HOUSE],
        research: [],
        builders: 1,
        militiaAtSettlers: 99,
        militiaFrame: 20000,
        militiaCount: 6,
        attackWithMilitia: 6,
        attackFrame: 21000,
        attackTarget: 'hq',
      };
      recordControlled(r, 30000, [
        settlementBot(0, p0),
        contentBot(
          0,
          [
            'reparatiedrone',
            'beveiligingsrobot',
            'beveiligingsrobot',
            'beveiligingsrobot',
            'beveiligingsrobot',
            'beveiligingsrobot',
          ],
          6,
          ['training_kracht', 'training_waarneming'],
        ),
        settlementBot(1, p1),
      ]);
      return r;
    },
  },
  {
    // Vangnet (data 0.16.0): speler 1 zet meteen een radiobaken en stuurt daarna al zijn bewoners (niet de held) naar
    // het hoofdgebouw van speler 0, waar de held en de militie ze opvangen. Onder drie bewoners komt er elke 40 s een
    // scavenger bij het baken, zonder bed.
    name: 's8-rustbelt-safety-net',
    build() {
      const r = base('rustbelt', 817, [false, false]);
      const st = startOf(r);
      const sim = st.sim;
      const s = new Script();
      const plan = new SitePlanner(sim);
      s.add(4, 1, 'Build', {
        ids: st.builder[1]!,
        typeId: building('radiobaken'),
        ...plan.take(1, 'radiobaken', 'hq'),
      });
      const hq0 = sim.getUnit(st.hq[0]!)!;
      s.add(700, 1, 'AttackMove', {
        ids: [...st.scav[1]!, ...st.builder[1]!, ...st.militia[1]!],
        x: hq0.x,
        y: hq0.y,
      });
      r.bundles = s.bundles();
      r.hashes = [{ frame: 9599, hash: 0 }];
      return r;
    },
  },
];

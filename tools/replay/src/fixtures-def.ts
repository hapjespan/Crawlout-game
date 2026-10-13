import { DELAY_FRAMES_DEFAULT } from '@crawlout/protocol';
import type { CommandEnvelope, FrameBundle, LobbyPlayer, Replay } from '@crawlout/protocol';
import { ROLES, buildingTypeId } from '@crawlout/data';
import type { Sim } from '@crawlout/sim';
import { gameData } from './env.js';
import { createReplaySim } from './run.js';

// Definities van de replay-fixtures in tools/replay/fixtures. `pnpm --filter @crawlout/replay record` draait ze
// en schrijft de JSON met verwachte hashes. Een fixture opnieuw opnemen mag alleen bij een bewuste
// gedragswijziging in de sim, met uitleg in de CHANGELOG. Alles draait op de echte data (data/) en de echte maps
// (data/maps); de startopstelling volgt uit map, data en spelers (contract 2).

export interface FixtureDef {
  readonly name: string;
  build(): Replay;
}

const players = (ai: boolean[]): LobbyPlayer[] =>
  ai.map((isAi, i) => ({ playerId: i, name: isAi ? `ai${i}` : `speler${i}`, faction: 'dwellers', ready: true, online: !isAi, ai: isAi }));

const base = (map: string, seed: number, ai: boolean[]): Replay => ({
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
  scav: number[][];
  builder: number[][];
  militia: number[][];
}

function startOf(r: Replay): Start {
  const sim = createReplaySim(r);
  const s: Start = { sim, nodes: [], claims: [], hq: [], scav: [], builder: [], militia: [] };
  for (let p = 0; p < r.players.length; p++) {
    s.scav.push([]);
    s.builder.push([]);
    s.militia.push([]);
  }
  for (const id of sim.entityIds()) {
    const u = sim.getUnit(id)!;
    if (u.kind === 'scrapNode') s.nodes.push(id);
    else if (u.kind === 'claimPoint') s.claims.push(id);
    else if (u.kind === 'building') s.hq.push(id);
    else if (u.role === ROLES.indexOf('scavenger')) s.scav[u.owner]!.push(id);
    else if (u.role === ROLES.indexOf('builder')) s.builder[u.owner]!.push(id);
    else if (u.role === ROLES.indexOf('militia')) s.militia[u.owner]!.push(id);
  }
  return s;
}

/** Node die het dichtst bij een positie ligt (tiebreak laagste id). */
function nearest(sim: Sim, ids: readonly number[], x: number, y: number): number {
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

const cell = (cx: number, cy: number): { x: number; y: number } => ({ x: cx * 256 + 128, y: cy * 256 + 128 });
const building = (key: string): number => buildingTypeId(gameData().data.buildings.find((b) => b.key === key)!.id);

class Script {
  private readonly frames = new Map<number, CommandEnvelope[]>();
  private readonly seqs: number[] = [];

  /** Commando dat in `execFrame` wordt uitgevoerd; gegeven in execFrame - DELAY. */
  add(execFrame: number, playerId: number, type: CommandEnvelope['type'], payload: unknown, seq?: number): this {
    const s = seq ?? (this.seqs[playerId] ?? 0);
    this.seqs[playerId] = Math.max(this.seqs[playerId] ?? 0, s + 1);
    const list = this.frames.get(execFrame) ?? [];
    list.push({ frame: Math.max(0, execFrame - DELAY_FRAMES_DEFAULT), playerId, seq: s, type, payload });
    this.frames.set(execFrame, list);
    return this;
  }

  move(execFrame: number, playerId: number, ids: number[], cx: number, cy: number): this {
    return this.add(execFrame, playerId, 'Move', { ids, ...cell(cx, cy) });
  }

  bundles(): FrameBundle[] {
    return [...this.frames.keys()].sort((a, b) => a - b).map((frame) => ({ frame, commands: this.frames.get(frame)! }));
  }
}

export const FIXTURES: readonly FixtureDef[] = [
  {
    // Beweging en commando-validatie op de kleine testmap: Move, Stop, seq-volgorde, ongeldige commando's.
    name: 's2-testmap-move-stop',
    build() {
      const r = base('testmap', 20261013, [false, false]);
      const st = startOf(r);
      const a = [...st.scav[0]!, ...st.builder[0]!, ...st.militia[0]!];
      const b = [...st.scav[1]!, ...st.builder[1]!, ...st.militia[1]!];
      const s = new Script()
        .move(4, 0, a, 24, 10)
        .move(5, 1, b, 8, 22)
        .add(6, 1, 'Move', { ids: a, ...cell(3, 3) }) // ongeldig: niet van speler 1
        .add(60, 0, 'Stop', { ids: a.slice(0, 2) })
        .move(90, 0, a.slice(0, 2), 16, 16)
        .add(150, 0, 'Move', { ids: a, x: -10, y: 500 }) // ongeldig: buiten de map
        .move(200, 1, b, 24, 10) // zelfde doel als speler 0: veld hergebruiken
        // zelfde frame, seq bepaalt de volgorde: het tweede Move-commando wint
        .add(302, 0, 'Move', { ids: a.slice(2, 4), ...cell(12, 26) }, 101)
        .add(302, 0, 'Move', { ids: a.slice(2, 4), ...cell(20, 26) }, 100)
        .move(400, 1, b, 16, 16)
        .add(450, 1, 'Research', { techId: 0 }); // nog no-op
      r.bundles = s.bundles();
      r.hashes = [{ frame: 599, hash: 0 }]; // lengte; record vult de echte hashes in
      return r;
    },
  },
  {
    // Een potje-fragment op Rustbelt met twee mensen: verzamelen, bouwen (woning, werkplaats), rol wisselen,
    // claimen, en gevecht met AttackMove en Attack. Plus een Cancel met teruggave en een Surrender aan het eind.
    name: 's2-rustbelt-skirmish',
    build() {
      const r = base('rustbelt', 777, [false, false]);
      const st = startOf(r);
      const sim = st.sim;
      const s = new Script();
      const spawns = [cell(20, 20), cell(107, 107)];
      const toward = [cell(30, 30), cell(97, 97)]; // bouwplekken richting het midden
      for (let p = 0; p < 2; p++) {
        const node = nearest(sim, st.nodes, spawns[p]!.x, spawns[p]!.y);
        s.add(4, p, 'Gather', { ids: st.scav[p]!, nodeId: node });
        s.add(6, p, 'Build', { ids: st.builder[p]!, typeId: building('woning'), ...toward[p]! });
      }
      // speler 0 bouwt meteen een werkplaats (hij heeft genoeg scrap na een paar ritten), speler 1 later
      s.add(700, 0, 'Build', { ids: st.builder[0]!, typeId: building('werkplaats'), ...cell(28, 20) });
      s.add(1000, 1, 'Build', { ids: st.builder[1]!, typeId: building('werkplaats'), ...cell(99, 107) });
      // cancel: speler 1 zet een radiobaken neer en trekt het terug
      s.add(1010, 1, 'Build', { ids: st.builder[1]!, typeId: building('radiobaken'), ...cell(104, 100) });
      // omscholen: twee scavengers van speler 0 worden militie
      s.add(1800, 0, 'SetRole', { ids: st.scav[0]!.slice(0, 2), role: 'militia' });
      // claim: de militie van speler 1 neemt het nederzettingspunt aan zijn kant
      const claim1 = nearest(sim, st.claims, spawns[1]!.x, spawns[1]!.y);
      s.add(300, 1, 'Claim', { ids: st.militia[1]!, pointId: claim1 });
      // gevecht: militie van speler 0 op AttackMove naar dat claimpunt
      const c1 = sim.getUnit(claim1)!;
      s.add(1200, 0, 'AttackMove', { ids: st.militia[0]!, x: c1.x, y: c1.y });
      r.bundles = s.bundles();
      // de radiobaken-id volgt pas uit de run: Cancel op alle entities die er dan staan is ongeldig voor de rest
      r.bundles.push({ frame: 1015, commands: [{ frame: 1011, playerId: 1, seq: 500, type: 'Cancel', payload: { ids: radioIds(r) } }] });
      r.bundles.push({ frame: 2900, commands: [{ frame: 2896, playerId: 1, seq: 501, type: 'Surrender', payload: {} }] });
      r.bundles.sort((x, y) => x.frame - y.frame);
      r.hashes = [{ frame: 2999, hash: 0 }];
      return r;
    },
  },
  {
    // Scripted AI tegen scripted AI op Rustbelt tot er een winnaar is. Geen bundels met commando's: de AI zit in de sim.
    name: 's2-rustbelt-ai-vs-ai',
    build() {
      const r = base('rustbelt', 42, [true, true]);
      r.hashes = [{ frame: 10999, hash: 0 }];
      return r;
    },
  },
];

/** Ids van de radiobakens die speler 1 in de skirmish-fixture heeft na frame 1014 (deterministisch uit de run). */
function radioIds(r: Replay): number[] {
  const probe: Replay = { ...r, bundles: r.bundles.filter((b) => b.frame < 1015) };
  const sim = createReplaySim(probe);
  const byFrame = new Map(probe.bundles.map((b) => [b.frame, b]));
  for (let f = 0; f < 1015; f++) {
    sim.applyBundle(byFrame.get(f) ?? { frame: f, commands: [] });
    sim.tick();
  }
  const radio = building('radiobaken');
  const ids = sim.entityIds().filter((id) => sim.getUnit(id)!.typeId === radio && sim.getUnit(id)!.owner === 1);
  return ids.length > 0 ? ids : [1];
}

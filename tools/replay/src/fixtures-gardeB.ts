import type { Sim, UnitView } from '@crawlout/sim';
import { gameData } from './env.js';
import type { FixtureDef } from './fixtures-def.part1.js';
import { base, building, loadout, tech } from './fixtures-def.part1.js';
import { type Controller, SitePlanner, recordControlled, toward } from './bot.js';

// The Garde, round B (sim 0.33.0, data 0.39.0, protocol 0.18.0; docs/garde.md items 3 and 5): s19-rustbelt-vertibird.
// Player 0 is a Garde bot, player 1 the Dweller AI. The bot gathers, builds three kazernes, the archief
// and the landingsplatform, researches fusiekernen and plasmakern, recruits zoekers and a Klerk, and produces a Vertibird.
// Then: Load (the Klerk and two Initiate-wachten, flown over the terrain), Unload at a point 30 m toward the enemy, the
// Vertibird strafes the Dweller headquarters (a normal attack) and is shot at, flies back to the Klerk, who repairs it
// (idle repair of a vehicle), and all three board again and are set down at home.

const KEYS = ['kazerne', 'archief', 'kazerne', 'landingsplatform', 'kazerne'] as const;
const RESEARCH = ['fusiekernen', 'plasmakern'] as const;

function gardeBot(): { bot: Controller; over: () => boolean } {
  const data = gameData().data;
  const cost = (key: string) => data.buildings.find((b) => b.key === key)!.scrapCost;
  const typeOf = (key: string) => 1 + data.loadouts.find((l) => l.key === key)!.id;
  let planner: SitePlanner | null = null;
  let nextBuild = 0;
  let phase = 0;
  let phaseAt = 0;
  let point = { x: 0, y: 0 };
  let crew: number[] = [];
  let klerkMade = false;
  let birdMade = false;
  const bot: Controller = (sim: Sim, f: number, add) => {
    if (f % 10 !== 0) return;
    planner ??= new SitePlanner(sim);
    const all = sim.entityIds().map((id) => sim.getUnit(id)!);
    const mine = all.filter((u) => u.owner === 0);
    const of = (key: string) => mine.filter((u) => u.typeId === typeOf(key));
    const done = (key: string) =>
      mine.filter((u) => u.kind === 'building' && u.typeId === building(key) && u.buildState === 2);
    const st = sim.playerStatus(0);
    const busy = new Set(sim.queue(0).map((q) => q.buildingId));
    const free = (key: string) => done(key).find((b) => !busy.has(b.id));
    const home = sim.map.spawns[0]!;
    const enemyHq = all.find((u) => u.kind === 'building' && u.owner === 1);
    // economy: idle zoekers to the nearest node with scrap
    const nodes = all.filter((u) => u.kind === 'scrapNode' && u.amount > 0);
    for (const z of of('initiate_zoeker').filter((u) => u.order === 0)) {
      const n = nearestTo(nodes, z);
      if (n !== undefined) add(0, 'Gather', { ids: [z.id], nodeId: n.id });
    }
    // build list, one site at a time
    const b = of('initiate_bouwer')[0];
    const key = KEYS[nextBuild];
    const sites = mine.filter((u) => u.kind === 'building' && u.buildState === 1);
    if (b !== undefined && key !== undefined && sites.length === 0 && st.scrap >= cost(key)) {
      const pre = data.buildings.find((x) => x.key === key)!.prereqTech;
      if (pre.every((t) => (st.techs ?? []).includes(t))) {
        add(0, 'Build', { ids: [b.id], typeId: building(key), ...planner.take(0, key, 'hq') });
        nextBuild++;
      }
    }
    for (const t of RESEARCH)
      if (!(st.techs ?? []).includes(tech(t)) && f % 100 === 0)
        add(0, 'Research', { techId: tech(t) });
    const kaz = free('kazerne');
    if (kaz !== undefined) {
      if (!klerkMade && done('kazerne').length >= 2 && st.scrap >= 60) {
        add(0, 'Produce', { buildingId: kaz.id, loadoutId: loadout('klerk') });
        klerkMade = true;
      } else if (of('initiate_zoeker').length < 7 && st.scrap >= 200)
        add(0, 'Produce', { buildingId: kaz.id, loadoutId: loadout('initiate_zoeker') });
    }
    const pad = free('landingsplatform');
    if (!birdMade && pad !== undefined && st.scrap >= 320) {
      add(0, 'Produce', { buildingId: pad.id, loadoutId: loadout('vertibird') });
      birdMade = true;
    }
    // the transport run
    const bird = of('vertibird')[0];
    const klerk = of('klerk')[0];
    if (bird === undefined || enemyHq === undefined || phase > 6) return;
    const cargo = sim.garde.cargoN[sim.world.resolve(bird.id)]!;
    const step = (p: number) => {
      phase = p;
      phaseAt = f;
    };
    if (phase === 0 && klerk !== undefined) {
      crew = [
        klerk.id,
        ...of('initiate_wacht')
          .slice(0, 2)
          .map((u) => u.id),
      ];
      add(0, 'Load', { ids: crew, transportId: bird.id });
      step(1);
    } else if (phase === 1 && cargo === 3) {
      point = toward(home, enemyHq, 30);
      add(0, 'Unload', { ids: [bird.id], x: point.x, y: point.y });
      step(2);
    } else if (phase === 2 && cargo === 0) {
      add(0, 'AttackMove', { ids: [bird.id], x: enemyHq.x, y: enemyHq.y }); // strafe: a normal attack
      step(3);
    } else if (phase === 3 && (bird.hp * 10 < bird.maxHp * 7 || f - phaseAt > 1200)) {
      add(0, 'Move', { ids: [bird.id], ...toward(point, home, 3) });
      step(4);
    } else if (phase === 4 && f - phaseAt > 900) {
      const near = mine.filter(
        (u) => u.kind === 'unit' && u.id !== bird.id && dist(u, point) < 12 * 256,
      );
      crew = near
        .filter((u) => u.typeId !== typeOf('vertibird'))
        .map((u) => u.id)
        .slice(0, 4);
      if (crew.length > 0) add(0, 'Load', { ids: crew, transportId: bird.id });
      step(5);
    } else if (phase === 5 && (cargo === crew.length || f - phaseAt > 600)) {
      add(0, 'Unload', { ids: [bird.id], ...toward(home, enemyHq, 12) });
      step(6);
    } else if (phase === 6 && cargo === 0) step(7);
  };
  return { bot, over: () => phase === 7 };
}

const dist = (a: UnitView, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function nearestTo(list: readonly UnitView[], u: UnitView): UnitView | undefined {
  let best: UnitView | undefined;
  let bestD = Infinity;
  for (const n of list) {
    const d = dist(n, u);
    if (d < bestD) {
      best = n;
      bestD = d;
    }
  }
  return best;
}

export const GARDE_B_FIXTURES: readonly FixtureDef[] = [
  {
    name: 's19-rustbelt-vertibird',
    build() {
      const r = base('rustbelt', 1902, [false, true]);
      r.players = r.players.map((pl) => (pl.playerId === 0 ? { ...pl, faction: 'garde' } : pl));
      const g = gardeBot();
      let doneAt = -1;
      recordControlled(r, 36000, [g.bot], (_sim, f) => {
        // stop 300 frames after the second unload
        if (doneAt < 0 && g.over()) doneAt = f;
        return doneAt >= 0 && f >= doneAt + 300;
      });
      const last = r.hashes[0]!.frame;
      r.hashes = [];
      for (let f = 3000; f < last; f += 3000) r.hashes.push({ frame: f, hash: 0 });
      r.hashes.push({ frame: last, hash: 0 });
      return r;
    },
  },
];

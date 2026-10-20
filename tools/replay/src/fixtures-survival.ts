import type { Replay } from '@crawlout/protocol';
import type { Sim } from '@crawlout/sim';
import { hqOf } from '@crawlout/sim';
import { toward } from './bot.js';
import { Script, base, startOf } from './fixtures-def.part1.js';
import type { FixtureDef } from './fixtures-def.part1.js';
import { raidersVsDwellers } from './fixtures-def.part2.js';

// Survival co-op (sim 0.27.0, data 0.33.0; voorstel, ter bevestiging door de architect): the game type Survival
// (MatchSettings.mode 'survival') on Rustbelt XL, human players without AI, through wave 1 and the start of wave 2.
//  - s17-rustbelt-survival-solo: one Dweller player; his hero and militia attack-move 20 m from the HQ toward the
//    north edge when wave 1 (8 ghouls, 2 batches) comes, and kill it (loot and hero xp); the recording ends while
//    wave 2 (12 ghouls) marches in.
//  - s17-rustbelt-survival-duo: Raiders (slot 0) and Dwellers (slot 1). The Dwellers score lower (one militia against
//    three plunderaars and a knuppelaar), so wave 1 (scaled to 14) goes for slot 1 from the east edge; the Dwellers
//    meet it with hero and militia, and since the defend stance (sim 0.30.0, data 0.36.0) their armed workers defend
//    the base too: the HQ holds and wave 2 picks slot 1 again (before: the HQ fell at frame 4.7k, the waves to slot 0).

const END = 5300;

function survival(r: Replay): Replay {
  r.settings = { ...r.settings, mode: 'survival' };
  return r;
}

/** Hero and militia of player p attack-move 20 m from his HQ toward the edge of his zone (frame `at`). */
function defend(s: Script, sim: Sim, p: number, ids: number[], at: number): void {
  const sm = sim.map.survival!;
  const hq = hqOf(sim, p);
  const from = { x: sim.world.x[hq]!, y: sim.world.y[hq]! };
  const to = toward(from, sm.edges[sm.zones[p]!.nearEdge]!, 20);
  s.add(at, p, 'AttackMove', { ids, x: to.x, y: to.y });
}

export const SURVIVAL_FIXTURES: readonly FixtureDef[] = [
  {
    name: 's17-rustbelt-survival-solo',
    build() {
      const r = survival(base('rustbelt', 1701, [false]));
      const st = startOf(r);
      const s = new Script();
      defend(s, st.sim, 0, [...st.militia[0]!, ...st.hero[0]!], 2500);
      r.bundles = s.bundles();
      r.hashes = [{ frame: END, hash: 0 }];
      return r;
    },
  },
  {
    name: 's17-rustbelt-survival-duo',
    build() {
      const r = survival(raidersVsDwellers(base('rustbelt', 1702, [false, false])));
      const st = startOf(r);
      const s = new Script();
      defend(s, st.sim, 1, [...st.militia[1]!, ...st.hero[1]!], 2500);
      r.bundles = s.bundles();
      r.hashes = [{ frame: END, hash: 0 }];
      return r;
    },
  },
];

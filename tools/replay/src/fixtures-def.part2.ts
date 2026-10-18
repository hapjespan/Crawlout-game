// Split from fixtures-def.ts to stay under the 5,000-token file limit; fixtures-def.ts re-exports the public surface.
// Holds: FIXTURES_S9, raidersVsDwellers, FIXTURES_S10, FIXTURES_S11, bouwrobotHelper, FIXTURES_S12, +1 more.
import { centrePoint, toward, recordControlled, settlementBot, type BotPlan } from './bot.js';
import type { Replay, CommandEnvelope } from '@crawlout/protocol';
import { createReplaySim } from './run.js';
import { raiderBot, dwellerBaitBot } from './raiders-bot.js';
import { unitTypeId } from '@crawlout/data';
import type { Sim } from '@crawlout/sim';
import {
  HOUSE,
  Script,
  base,
  contentBot,
  data,
  loadout,
  nearest,
  startOf,
} from './fixtures-def.part1.js';
import type { FixtureDef } from './fixtures-def.part1.js';

export const FIXTURES_S9: FixtureDef[] = [
  {
    // Fog of war (phase 2, sim 0.17.0, data 0.22.0): two humans on Rustbelt XL. A command on an enemy entity that the
    // player does not see is refused (Attack on the hidden HQ, a HeroAbility on a hidden unit, at the start); player 0
    // scouts with his hero and militia toward the enemy spawn (AttackMove into the fog: explored grows, the fight starts
    // when they see the enemy), player 1 walks his militia to the centre and back, and later, once player 0 has seen it,
    // the same Attack on the HQ is accepted. The hashes cover the explored bitsets and World.spotted.
    name: 's9-rustbelt-fog',
    build() {
      const r = base('rustbelt', 909, [false, false]);
      const st = startOf(r);
      const sim = st.sim;
      const s = new Script();
      const spawns = sim.map.spawns;
      const centre = centrePoint(sim);
      const hero = data.heroes[0]!.id;
      for (let p = 0; p < 2; p++) {
        const node = nearest(sim, st.nodes, spawns[p]!.x, spawns[p]!.y);
        s.add(6, p, 'Gather', { ids: st.scav[p]!, nodeId: node });
      }
      // refused: the HQ of player 1 and the units of player 0 lie in the fog
      s.add(4, 0, 'Attack', { ids: st.militia[0]!, target: st.hq[1]! });
      s.add(4, 1, 'Attack', { ids: st.militia[1]!, target: st.hero[0]![0]! });
      s.add(5, 1, 'HeroAbility', { heroId: hero, abilityId: 0, target: st.militia[0]![0]! });
      // player 0 scouts toward the enemy spawn; player 1 to the centre and home again
      s.add(10, 0, 'AttackMove', { ids: [...st.hero[0]!, ...st.militia[0]!], ...spawns[1]! });
      s.add(1500, 1, 'Move', { ids: st.militia[1]!, x: centre.x, y: centre.y });
      s.add(2600, 1, 'Move', { ids: st.militia[1]!, ...toward(spawns[1]!, centre, 15) });
      // the same Attack later: refused while the HQ is unseen, accepted once his scouts see it
      for (let k = 0; k < 8; k++)
        s.add(1200 + 400 * k, 0, 'Attack', { ids: st.hero[0]!, target: st.hq[1]! });
      r.bundles = s.bundles();
      r.hashes = [{ frame: 5999, hash: 0 }];
      return r;
    },
  },
];

/** Player 0 plays the Raiders (sim 0.18.0), player 1 the Dwellers. */
export const raidersVsDwellers = (r: Replay): Replay => {
  r.players = r.players.map((pl) => (pl.playerId === 0 ? { ...pl, faction: 'raiders' } : pl));
  return r;
};

export const FIXTURES_S10: FixtureDef[] = [
  {
    // Raiders in the sim (sim 0.18.0, data 0.23.0): the scripted Raider AI (player 0) against the Dweller AI on Rustbelt
    // XL until just after the win: tents and Produce, slave builders via SetRole, slave raids, buggies, the garrison,
    // claims and the dominance camp, plunder and tribute, the Warlord's aura and Raid. Sim 0.19.0, data 0.24.0: the
    // Dweller AI plays ai/dwellers-vs-raiders.json (versus: defendHqFirst, liberate), the Raider camp holds its own
    // point and answers what it sees; the Dwellers win by destruction in frame 34.526 (28:47; data 0.23.0: on
    // dominance in frame 30.962). Sim 0.22.0, data 0.27.0 (camp takeover, weaker Raider fighters; voorstel): seed 6
    // (was 5, where the Raider AI now catches nobody): the Raider AI takes its two low camps over in minute 2 and the
    // high camp later, catches settlers from minute 6, and wins on dominance in frame 30.021 (25:01). Sim 0.24.0, data
    // 0.29.0 (the guard rule, Raider fighters back to strength, the weak low camp; voorstel): the Raider AI guards its
    // slave groups with Bewaak and raids from 7:45; the Dwellers win by destruction in frame 43.326 (36:06).
    name: 's10-rustbelt-raiders-ai-vs-ai',
    build() {
      const r = raidersVsDwellers(base('rustbelt', 6, [true, true]));
      const sim = createReplaySim(r);
      let end = 47999;
      for (let f = 0; f < 48000; f++) {
        sim.applyBundle({ frame: f, commands: [] });
        sim.tick();
        const w = sim.winner();
        if (w !== null) {
          end = w.frame + 20;
          break;
        }
      }
      r.hashes = [{ frame: end, hash: 0 }];
      return r;
    },
  },
  {
    // Slaves (sim 0.18.0): player 0 (Raiders, a bot) puts up a tent, produces Slavers and hunts the Dweller settlers that
    // gather outside their base (player 1 sends them to a far node): the Slaver beats one down and catches it, the
    // captive walks to the Raiderkamp and becomes a slave after the transition. Player 1 then walks his militia and hero
    // into the Raiders' camp and frees every slave he sees by touch (Attack on a slave); player 0 has sent all his
    // fighters and his hero away to a settlement point, so his slaves revolt (no garrison) and nobody guards them.
    name: 's10-rustbelt-raiders-slaves',
    build() {
      const r = raidersVsDwellers(base('rustbelt', 1001, [false, false]));
      recordControlled(r, 12000, [
        raiderBot(0, {
          builds: ['tent', 'kooi'],
          research: [],
          produce: ['slaver', 'slaver', 'plunderaar'],
          huntFrom: 300,
          toSettlementAt: 6000,
        }),
        dwellerBaitBot(1, { farM: 40, liberateAt: 5000 }),
      ]);
      return r;
    },
  },
  {
    // Chems, tribute and plunder (sim 0.18.0): player 0 (Raiders, a bot) builds a tent and a chemlab, claims his
    // settlement point with a plunderpost (tribute), researches chemie and psycho and produces a Chem-dealer among his
    // fighters; player 1 (Dwellers) attacks the Raiders' camp with his militia and hero, the dealer doses in the fight
    // (Psycho: damage, then the crash), and the Raiders strike back at the Dweller base (plunder).
    name: 's10-rustbelt-raiders-chems',
    build() {
      const r = raidersVsDwellers(base('rustbelt', 1002, [false, false]));
      recordControlled(r, 14000, [
        raiderBot(0, {
          builds: ['tent', 'chemlab', 'tent'],
          claimAt: 900,
          research: ['chemie', 'psycho'],
          produce: ['plunderaar', 'chemdealer', 'knuppelaar'],
          keep: 140,
          allOutAt: 11500,
        }),
        settlementBot(1, {
          builds: [{ key: 'werkplaats', at: 'hq' }, HOUSE, HOUSE],
          research: [],
          builders: 1,
          militiaAtSettlers: 99,
          militiaFrame: 2400,
          militiaCount: 8,
          attackWithMilitia: 8,
          attackFrame: 8000,
        }),
      ]);
      return r;
    },
  },
  {
    // The Raiders' safety net (tenten_instroom, sim 0.18.0): player 0 (Raiders, a bot) puts up a tent and sends every
    // fighter and his hero at the Dweller headquarters, where player 1 (a bot with a workshop and eight militie guarding
    // it) beats them; under five fighters a plunderaar comes at the tent every 30 s, the timer stops at five.
    name: 's10-rustbelt-raiders-net',
    build() {
      const r = raidersVsDwellers(base('rustbelt', 1003, [false, false]));
      recordControlled(r, 9000, [
        raiderBot(0, { builds: ['tent'], research: [], produce: [], allOutAt: 3600 }),
        settlementBot(1, {
          builds: [{ key: 'werkplaats', at: 'hq' }, HOUSE],
          research: [],
          builders: 1,
          militiaAtSettlers: 99,
          militiaFrame: 1200,
          militiaCount: 8,
          attackWithMilitia: 99,
          guard: 'hq',
        }),
      ]);
      return r;
    },
  },
];

export const FIXTURES_S11: FixtureDef[] = [
  {
    // Creep camps (sim 0.20.0, data 0.25.0; voorstel, ter bevestiging door de architect): six bandit camps on Rustbelt
    // XL. Player 0 is the scripted Dweller AI: from minute 10 it clears its near camp, the ford camp and (with 16 idle
    // militia) the high camp, with loot and hero xp. Player 1 is a human script: his hero walks up to his near camp and
    // stops outside the aggro radius (the camp sleeps), attacks a bandit (the hit wakes the camp), runs home (the camp
    // chases to its leash, goes home and heals), and later sends his hero and militia at the camp again with an
    // AttackMove. Until minute 19, after the AI cleared its camps.
    name: 's11-rustbelt-creeps',
    build() {
      const r = base('rustbelt', 1101, [true, false]);
      const st = startOf(r);
      const sim = st.sim;
      const s = new Script();
      const camps = sim.map.creepCamps!;
      const spawn = sim.map.spawns[1]!;
      // the near camp of player 1: the one closest to his spawn
      let near = camps[0]!;
      for (const c of camps)
        if (
          (c.x - spawn.x) ** 2 + (c.y - spawn.y) ** 2 <
          (near.x - spawn.x) ** 2 + (near.y - spawn.y) ** 2
        )
          near = c;
      const bandit = sim
        .entityIds()
        .filter((id) => {
          const u = sim.getUnit(id)!;
          return (
            u.owner === 255 &&
            u.kind === 'unit' &&
            (u.x - near.x) ** 2 + (u.y - near.y) ** 2 < (4 * 256) ** 2
          );
        })
        .sort((a, b) => a - b)[0]!;
      const node = nearest(sim, st.nodes, spawn.x, spawn.y);
      s.add(6, 1, 'Gather', { ids: st.scav[1]!, nodeId: node });
      s.add(10, 1, 'Move', { ids: st.hero[1]!, ...toward(near, spawn, 11) });
      s.add(900, 1, 'Attack', { ids: st.hero[1]!, target: bandit });
      s.add(1000, 1, 'Move', { ids: st.hero[1]!, ...toward(spawn, near, 10) });
      s.add(3000, 1, 'AttackMove', {
        ids: [...st.hero[1]!, ...st.militia[1]!],
        x: near.x,
        y: near.y,
      });
      r.bundles = s.bundles();
      r.hashes = [{ frame: 22799, hash: 0 }];
      return r;
    },
  },
  {
    // Raiders against Raiders (sim 0.19.0, data 0.24.0): two Raider AIs on Rustbelt XL, seed 2, for nine minutes. At
    // 5:52 their two Slavers catch each other in the same tick; sim.rng picks who catches whom (systems/slaves.ts
    // captureTick; with seed 2 player 1), where entity order gave it to player 0 every time. Sim 0.22.0, data 0.27.0
    // (voorstel): thirteen minutes (was nine). Both AIs take their camps over from minute 1 and send their Slavers
    // only from minute 6, so the mirror now ends at 7:20, where their armies with the recruits meet; the first catch
    // comes after that. Sim 0.24.0, data 0.29.0: the slave raids start at 7:45 and the mirror holds until 11:28; the
    // first catch still falls within the thirteen minutes.
    name: 's11-rustbelt-raiders-mirror',
    build() {
      const r = base('rustbelt', 2, [true, true]);
      r.players = r.players.map((pl) => ({ ...pl, faction: 'raiders' }));
      r.hashes = [{ frame: 15599, hash: 0 }];
      return r;
    },
  },
];

/**
 * Bouwrobot helper (data 0.26.0): every second, each idle builder robot of player p goes to help at the own unfinished
 * site with the lowest id (Build with the type and centre of the site, the right click of the client).
 */
function bouwrobotHelper(p: number) {
  const bot = unitTypeId(loadout('bouwrobot'));
  return (
    sim: Sim,
    f: number,
    add: (p: number, type: CommandEnvelope['type'], payload: unknown) => void,
  ): void => {
    if (f % 20 !== 7) return;
    const mine = sim
      .entityIds()
      .map((id) => sim.getUnit(id)!)
      .filter((u) => u.owner === p);
    const site = mine.find((u) => u.kind === 'building' && u.buildState === 1);
    const idle = mine.filter((u) => u.typeId === bot && u.order === 0).map((u) => u.id);
    if (site !== undefined && idle.length > 0)
      add(p, 'Build', { ids: idle, typeId: site.typeId, x: site.x, y: site.y });
  };
}

export const FIXTURES_S12: FixtureDef[] = [
  {
    // Bouwrobot (data 0.26.0, sim 0.21.0; voorstel, ter bevestiging door de architect): player 0 is a bot that builds
    // a workshop, a lab and the robot factory, researches robotica and produces two builder robots; from then on every
    // idle builder robot is sent (Build on the site) to the next unfinished building of his plan (houses and a radio
    // beacon) and builds it with his human builder. Player 1 builds a few houses. Twenty minutes.
    name: 's12-rustbelt-bouwrobot',
    build() {
      const r = base('rustbelt', 1201, [false, false]);
      const p0: BotPlan = {
        builds: [
          { key: 'werkplaats', at: 'hq' },
          HOUSE,
          { key: 'lab', at: 'hq' },
          { key: 'robotfabriek', at: 'hq' },
          HOUSE,
          HOUSE,
          { key: 'radiobaken', at: 'hq' },
          HOUSE,
          HOUSE,
          HOUSE,
          HOUSE,
        ],
        research: ['raffinage', 'robotica', 'bouwrobots'],
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
        militiaCount: 0,
        attackWithMilitia: 99,
      };
      recordControlled(r, 24000, [
        settlementBot(0, p0),
        contentBot(0, ['bouwrobot'], 2, []),
        bouwrobotHelper(0),
        settlementBot(1, p1),
      ]);
      return r;
    },
  },
];

export const FIXTURES_S13: FixtureDef[] = [
  {
    // Camp takeover (sim 0.22.0, data 0.27.0; voorstel, ter bevestiging door de architect): player 0 plays the Raiders
    // by hand, player 1 is the Dweller AI. In the first second the Warlord and the four start fighters (3 plunderaar,
    // 1 knuppelaar) go at the near camp of player 0 with one AttackMove; the camp surrenders at 30 percent of its hp
    // and its survivors join the Raiders (loot and hero xp as for a clear). At minute 3 the army and the recruits walk
    // home; the camp is an outpost and yields a bandit for player 0 every 4 minutes (twice). Ten minutes.
    name: 's13-rustbelt-raiders-takeover',
    build() {
      const r = raidersVsDwellers(base('rustbelt', 1301, [false, true]));
      const st = startOf(r);
      const sim = st.sim;
      const s = new Script();
      const camps = sim.map.creepCamps!;
      const spawn = sim.map.spawns[0]!;
      let near = camps[0]!;
      for (const c of camps)
        if (
          (c.x - spawn.x) ** 2 + (c.y - spawn.y) ** 2 <
          (near.x - spawn.x) ** 2 + (near.y - spawn.y) ** 2
        )
          near = c;
      const bandits = sim
        .entityIds()
        .filter((id) => {
          const u = sim.getUnit(id)!;
          return (
            u.owner === 255 &&
            u.kind === 'unit' &&
            (u.x - near.x) ** 2 + (u.y - near.y) ** 2 < (4 * 256) ** 2
          );
        })
        .sort((a, b) => a - b);
      const army = [...st.hero[0]!, ...st.militia[0]!];
      const node = nearest(sim, st.nodes, spawn.x, spawn.y);
      s.add(6, 0, 'Gather', { ids: st.scav[0]!, nodeId: node });
      s.add(20, 0, 'AttackMove', { ids: army, x: near.x, y: near.y });
      s.add(3600, 0, 'Move', { ids: [...army, ...bandits], ...toward(spawn, near, 12) });
      r.bundles = s.bundles();
      r.hashes = [{ frame: 11999, hash: 0 }];
      return r;
    },
  },
];

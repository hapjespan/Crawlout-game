// Split from fixtures-def.ts to stay under the 5,000-token file limit; fixtures-def.ts re-exports the public surface.
// Holds: FIXTURES_S5, FIXTURES_S14, FIXTURES_S15, stateAt, radioIds.
import { centrePoint, toward, SitePlanner } from './bot.js';
import type { Replay } from '@crawlout/protocol';
import type { Sim } from '@crawlout/sim';
import { createReplaySim } from './run.js';
import { Script, base, building, nearest, startOf } from './fixtures-def.part1.js';
import type { FixtureDef } from './fixtures-def.part1.js';
import { raidersVsDwellers } from './fixtures-def.part2.js';

export const FIXTURES_S5: FixtureDef[] = [
  {
    // Bouwers na de speltest van Martien (data 0.8.0), twee mensen op Rustbelt:
    //  - speler 0: werkplaats; halverwege een Move ver weg (buiten de hulpstraal), daarna hervat hij vanzelf. Dan een
    //    woning, Stop (geen hervatten, geen automatisch helpen ernaast), en later een Build met typeId en het midden
    //    van die bouwplaats (de rechtsklik van de client): hij helpt weer, zonder kosten;
    //  - speler 1: woning A en meteen woning B (het nieuwe bouwbevel overschrijft het geheugen); na B pakt hij A
    //    vanzelf op (binnen builderAutoHelpRadius), vlucht halverwege A (Move) en hervat A daarna.
    name: 's5-rustbelt-builder-resume',
    build() {
      const r = base('rustbelt', 505, [false, false]);
      const st = startOf(r);
      const s = new Script();
      const b0 = st.builder[0]!;
      const b1 = st.builder[1]!;
      const plan = new SitePlanner(st.sim);
      const centre = centrePoint(st.sim);
      const workshop = plan.take(0, 'werkplaats', 'hq');
      s.add(6, 0, 'Build', { ids: b0, typeId: building('werkplaats'), ...workshop });
      // ver weg: 25 m van de werkplaats richting het midden, buiten builderAutoHelpRadius
      s.add(250, 0, 'Move', { ids: b0, ...toward(workshop, centre, 25) });
      s.add(1300, 0, 'Build', {
        ids: b0,
        typeId: building('woning'),
        ...plan.take(0, 'woning', 'hq'),
      });
      s.add(1400, 0, 'Stop', { ids: b0 });
      // woning A en B naast elkaar bij het hoofdgebouw (binnen builderAutoHelpRadius van elkaar)
      const a1 = plan.take(1, 'woning', 'hq');
      s.add(6, 1, 'Build', { ids: b1, typeId: building('woning'), ...a1 });
      s.add(8, 1, 'Build', {
        ids: b1,
        typeId: building('woning'),
        ...plan.take(1, 'woning', 'hq'),
      });
      s.add(700, 1, 'Move', { ids: b1, ...toward(a1, centre, 20) });
      r.bundles = s.bundles();
      // de rechtsklik: Build met het typeId en het midden van de bouwplaats zoals de client die uit de snapshot leest
      const sim = stateAt(r, 1800);
      const woning = building('woning');
      const site = sim
        .entityIds()
        .map((id) => sim.getUnit(id)!)
        .find(
          (u) =>
            u.kind === 'building' && u.owner === 0 && u.typeId === woning && u.buildState === 1,
        )!;
      s.add(1800, 0, 'Build', { ids: b0, typeId: woning, x: site.x, y: site.y });
      r.bundles = s.bundles();
      r.hashes = [{ frame: 2599, hash: 0 }];
      return r;
    },
  },
];

export const FIXTURES_S14: FixtureDef[] = [
  {
    // Playtest H1 and M1 (sim 0.23.0, data 0.28.0; voorstel, ter bevestiging door de architect): a Move to a point inside
    // a footprint resolves to the nearest reachable free point and the units go idle there (before, they stood at the
    // edge in the walk animation for good). Player 1 (Dwellers, human) walks his militia and hero out, then into the
    // edge of his own headquarters facing the centre, then onto its middle; player 0 (Raiders, human) walks his slave
    // builder behind his camp and then into the camp from the far side, and retrains him into a slave at the camp
    // (SetRole), who then gathers on his own like the start slaves (M1). Two minutes.
    name: 's14-rustbelt-move-into-building',
    build() {
      const r = raidersVsDwellers(base('rustbelt', 1401, [false, false]));
      const st = startOf(r);
      const sim = st.sim;
      const s = new Script();
      const centre = centrePoint(sim);
      const sp0 = sim.map.spawns[0]!;
      const sp1 = sim.map.spawns[1]!;
      const army = [...st.militia[1]!, ...st.hero[1]!];
      const out = toward(sp1, centre, 30);
      const edge = toward(sp1, centre, 10);
      s.add(4, 1, 'Move', { ids: army, x: out.x, y: out.y });
      s.add(600, 1, 'Move', { ids: army, x: edge.x, y: edge.y });
      s.add(1400, 1, 'Move', { ids: army, x: sp1.x, y: sp1.y });
      const builder = st.builder[0]!;
      const behind = toward(sp0, centre, -25);
      const into = toward(sp0, centre, 6);
      s.add(4, 0, 'Move', { ids: builder, x: behind.x, y: behind.y });
      s.add(600, 0, 'Move', { ids: builder, x: into.x, y: into.y });
      s.add(1400, 0, 'SetRole', { ids: builder, role: 'scavenger' });
      r.bundles = s.bundles();
      r.hashes = [{ frame: 2399, hash: 0 }]; // length; record fills in the real hashes
      return r;
    },
  },
];

export const FIXTURES_S15: FixtureDef[] = [
  {
    // The guard rule and Bewaak (sim 0.24.0, data 0.29.0, protocol 0.15.0 Guard; voorstel, ter bevestiging door de
    // architect). Player 0 plays the Raiders by hand, player 1 is the Dweller AI. The start slaves gather at the node
    // next to the Raiderkamp (a Kooi within 15 m: one guard keeps them). In the first second one start fighter takes
    // Bewaak on the Raiderkamp and another on that node; the Warlord and the rest take the near camp. At minute 2:30 both
    // guards walk away (Move): the group has no guard and after 15 s half the slaves run off as wanderers, again 25 s
    // later; at minute 3:30 one fighter takes Bewaak on the Raiderkamp again and the rest keep working. Six minutes.
    name: 's15-rustbelt-raiders-guard',
    build() {
      const r = raidersVsDwellers(base('rustbelt', 1501, [false, true]));
      const st = startOf(r);
      const sim = st.sim;
      const s = new Script();
      const spawn = sim.map.spawns[0]!;
      const camp = st.hq.find((id) => sim.getUnit(id)!.owner === 0)!;
      const node = nearest(sim, st.nodes, spawn.x, spawn.y);
      const fighters = [...st.militia[0]!].sort((a, b) => a - b);
      const [g1, g2, ...rest] = fighters;
      const camps = sim.map.creepCamps!;
      let near = camps[0]!;
      for (const c of camps)
        if (
          (c.x - spawn.x) ** 2 + (c.y - spawn.y) ** 2 <
          (near.x - spawn.x) ** 2 + (near.y - spawn.y) ** 2
        )
          near = c;
      s.add(6, 0, 'Gather', { ids: st.scav[0]!, nodeId: node });
      s.add(20, 0, 'Guard', { ids: [g1!], targetId: camp });
      s.add(20, 0, 'Guard', { ids: [g2!], targetId: node });
      s.add(24, 0, 'AttackMove', { ids: [...st.hero[0]!, ...rest], x: near.x, y: near.y });
      const away = toward(spawn, near, 60);
      s.add(3000, 0, 'Move', { ids: [g1!, g2!], x: away.x, y: away.y });
      s.add(4200, 0, 'Guard', { ids: [g1!], targetId: camp });
      r.bundles = s.bundles();
      r.hashes = [{ frame: 7199, hash: 0 }]; // length; record fills in the real hashes
      return r;
    },
  },
];

/** De sim na het uitvoeren van de frames 0 tot `frame` (exclusief) met de bundels die de replay tot dan heeft. */
export function stateAt(r: Replay, frame: number): Sim {
  const sim = createReplaySim(r);
  const byFrame = new Map(r.bundles.filter((b) => b.frame < frame).map((b) => [b.frame, b]));
  for (let f = 0; f < frame; f++) {
    sim.applyBundle(byFrame.get(f) ?? { frame: f, commands: [] });
    sim.tick();
  }
  return sim;
}

/** Ids van de radiobakens die speler 1 in de skirmish-fixture heeft na frame 1014 (deterministisch uit de run). */
export function radioIds(r: Replay): number[] {
  const probe: Replay = { ...r, bundles: r.bundles.filter((b) => b.frame < 1015) };
  const sim = createReplaySim(probe);
  const byFrame = new Map(probe.bundles.map((b) => [b.frame, b]));
  for (let f = 0; f < 1015; f++) {
    sim.applyBundle(byFrame.get(f) ?? { frame: f, commands: [] });
    sim.tick();
  }
  const radio = building('radiobaken');
  const ids = sim
    .entityIds()
    .filter((id) => sim.getUnit(id)!.typeId === radio && sim.getUnit(id)!.owner === 1);
  return ids.length > 0 ? ids : [1];
}

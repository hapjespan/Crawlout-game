// Split from bot.ts to stay under the 5,000-token file limit; bot.ts re-exports the public surface.
// Holds: settlementBot.
import { gameData } from './env.js';
import { type UnitView, ORDER_CRAFT, ORDER_NONE } from '@crawlout/sim';
import { type CommandEnvelope, MAX_ENTITIES_PER_COMMAND } from '@crawlout/protocol';
import { PROVIDES } from '@crawlout/data';
import {
  GUARD_REACT_M,
  ROLE_BUILDER,
  ROLE_MILITIA,
  ROLE_SCAV,
  SitePlanner,
  anchorOf,
  buildingType,
  centrePoint,
  settlementPoint,
  techOf,
} from './bot.part1.js';
import type { BotPlan, Controller } from './bot.part1.js';

/** Een bot voor speler p volgens plan. Kijkt elke `every` frames. */
export function settlementBot(p: number, plan: BotPlan, every = 10): Controller {
  const data = gameData().data;
  let militiaDone = false;
  let attacked = false;
  let lastAttack = -1;
  let next = 0;
  return (sim, f, add) => {
    if (f % every !== p % every || sim.isDefeated(p)) return;
    const all = sim.entityIds().map((id) => sim.getUnit(id)!);
    const mine = all.filter((u) => u.owner === p);
    const units = mine.filter((u) => u.kind === 'unit');
    const hero = mine.find((u) => u.kind === 'hero');
    const hq = mine.find((u) => u.kind === 'building' && u.typeId === buildingType('hoofdgebouw'));
    const st = sim.playerStatus(p);
    const techs = st.techs ?? [];
    const done = (key: string): UnitView | undefined =>
      mine.find(
        (u) => u.kind === 'building' && u.typeId === buildingType(key) && u.buildState === 2,
      );
    const role = (r: number): UnitView[] =>
      units.filter((u) => u.role === r && u.order !== ORDER_CRAFT);
    const idle = (list: UnitView[]): UnitView[] => list.filter((u) => u.order === ORDER_NONE);
    const send = (type: CommandEnvelope['type'], ids: number[], payload: object): void => {
      for (let k = 0; k < ids.length; k += MAX_ENTITIES_PER_COMMAND)
        add(p, type, { ids: ids.slice(k, k + MAX_ENTITIES_PER_COMMAND), ...payload });
    };

    // verzamelen: scavengers zonder werk naar de dichtstbijzijnde node met voorraad
    const nodes = all.filter((u) => u.kind === 'scrapNode' && u.amount > 0);
    const byNode = new Map<number, number[]>();
    for (const u of idle(role(ROLE_SCAV))) {
      let best: UnitView | undefined;
      let bestD = Infinity;
      for (const n of nodes) {
        const d = (n.x - u.x) ** 2 + (n.y - u.y) ** 2;
        if (d < bestD) {
          best = n;
          bestD = d;
        }
      }
      if (best !== undefined) byNode.set(best.id, [...(byNode.get(best.id) ?? []), u.id]);
    }
    for (const [nodeId, ids] of [...byNode].sort((a, b) => a[0] - b[0]))
      send('Gather', ids, { nodeId });

    // bouwers: aanvullen in de werkplaats, één tegelijk
    const scavs = role(ROLE_SCAV);
    const crafting = units.some((u) => u.order === ORDER_CRAFT);
    if (
      done('werkplaats') &&
      !crafting &&
      role(ROLE_BUILDER).length < plan.builders &&
      scavs.length > 0
    ) {
      add(p, 'SetRole', { ids: [scavs[scavs.length - 1]!.id], role: 'builder' });
    }

    // bouwen: bouwplaatsen afmaken, daarna het volgende gebouw uit de lijst. Gebouw k van type T staat zodra er
    // (af of in aanbouw) minstens zoveel T zijn als er T in de lijst staan tot en met k.
    const builders = idle(role(ROLE_BUILDER)).map((u) => u.id);
    const site = mine.find((u) => u.kind === 'building' && u.buildState === 1);
    while (next < plan.builds.length) {
      const t = buildingType(plan.builds[next]!.key);
      const want = plan.builds.slice(0, next + 1).filter((b) => buildingType(b.key) === t).length;
      const have = mine.filter((u) => u.kind === 'building' && u.typeId === t).length;
      if (have < want) break;
      next++;
    }
    if (builders.length > 0) {
      if (site !== undefined)
        send('Build', builders, { typeId: site.typeId, x: site.x, y: site.y });
      else if (next < plan.builds.length) {
        const b = plan.builds[next]!;
        const def = data.buildings.find((x) => x.key === b.key)!;
        const claimPost = def.provides.includes(PROVIDES.indexOf('claim')) && b.at !== 'hq';
        if (def.prereqTech.every((t) => techs.includes(t)) && st.scrap >= def.scrapCost) {
          if (claimPost) {
            // a claim post at a claim point goes out as Claim, as the client sends it from the build menu (data
            // 0.20.0): the sim puts it next to the point, outside the territory rule
            const pt =
              b.at === 'centre'
                ? centrePoint(sim)
                : settlementPoint(sim, p, b.at === 'settlement2' ? 1 : 0);
            send('Claim', builders, { pointId: pt.id });
          } else {
            const at = new SitePlanner(sim).find(p, b.key, b.at, b.homewardM);
            if (at !== null) send('Build', builders, { typeId: buildingType(b.key), ...at });
          }
        }
      }
    }

    // onderzoek: de eerste tech die er nog niet is; de sim weigert zonder gebouw, prereqTech of scrap
    const todo = plan.research.map(techOf).find((t) => !techs.includes(t));
    if (todo !== undefined) add(p, 'Research', { techId: todo });

    // uitgeven boven een drempel: omscholen tot het beste leger-loadout
    const sp = plan.spend;
    if (
      sp !== undefined &&
      st.scrap >= sp.aboveScrap &&
      done('werkplaats') &&
      !crafting &&
      scavs.length > sp.keepScavengers
    ) {
      const lo = sp.army
        .map((k) => data.loadouts.find((l) => l.key === k)!)
        .find((l) => l.prereqTech.every((t) => techs.includes(t)));
      if (lo !== undefined) add(p, 'Craft', { ids: [scavs[0]!.id], loadoutId: lo.id });
    }

    // militie
    if (
      !militiaDone &&
      (st.settlers >= plan.militiaAtSettlers ||
        (plan.militiaFrame !== undefined && f >= plan.militiaFrame)) &&
      done('werkplaats')
    ) {
      militiaDone = true;
      send(
        'SetRole',
        scavs.slice(0, plan.militiaCount).map((u) => u.id),
        { role: 'militia' },
      );
    }
    const militia = role(ROLE_MILITIA);
    if (plan.guard !== undefined) {
      const g = anchorOf(sim, p, plan.guard);
      const guards =
        hero !== undefined && hero.order === ORDER_NONE ? [...idle(militia), hero] : idle(militia);
      // an enemy unit near the guarded point (a raid of patrols outranges the aggro range of idle militia): the idle
      // guards go and meet it, as a player would
      let raider: UnitView | undefined;
      let raiderD = (GUARD_REACT_M * 256) ** 2;
      for (const u of all) {
        if ((u.kind !== 'unit' && u.kind !== 'hero') || u.owner === p || u.owner >= 8) continue;
        const d = (u.x - g.x) ** 2 + (u.y - g.y) ** 2;
        if (d < raiderD) {
          raider = u;
          raiderD = d;
        }
      }
      if (raider !== undefined && guards.length > 0)
        send(
          'AttackMove',
          guards.map((u) => u.id),
          { x: raider.x, y: raider.y },
        );
      const go = guards
        .filter((u) => (u.x - g.x) ** 2 + (u.y - g.y) ** 2 > (6 * 256) ** 2)
        .map((u) => u.id);
      if (raider === undefined && go.length > 0) send('AttackMove', go, g);
    }
    const enemyHq = all.find(
      (u) =>
        u.kind === 'building' &&
        u.owner !== p &&
        u.owner < 8 &&
        u.typeId === buildingType('hoofdgebouw'),
    );
    if (
      enemyHq !== undefined &&
      militia.length >= plan.attackWithMilitia &&
      f >= (plan.attackFrame ?? 0)
    ) {
      if (!attacked || f - lastAttack >= 400) {
        const ids = (attacked ? idle(militia) : militia).map((u) => u.id);
        if (hero !== undefined && (!attacked || hero.order === ORDER_NONE)) ids.push(hero.id);
        const goal =
          plan.attackTarget === undefined || plan.attackTarget === 'hq'
            ? enemyHq
            : settlementPoint(sim, enemyHq.owner, plan.attackTarget === 'settlement2' ? 1 : 0);
        if (ids.length > 0) send('AttackMove', ids, { x: goal.x, y: goal.y });
        attacked = true;
        lastAttack = f;
      }
    }

    // de held: oplappen, perks, Lockdown op de dichtstbijzijnde vijand binnen bereik
    const h = data.heroes[st.hero?.heroId ?? -1];
    if (h !== undefined && st.hero !== null) {
      if (st.hero.state === 'dead' && hq !== undefined && st.scrap >= h.reviveScrap)
        add(p, 'Recruit', { buildingId: hq.id });
      if (st.hero.pendingPerks > 0)
        for (const perkId of h.perkPool) add(p, 'PickPerk', { heroId: h.id, perkId });
      if (hero !== undefined && st.hero.abilityCooldownTicks[0] === 0) {
        const ab = h.abilities[0]!;
        const enemies = all.filter(
          (u) => (u.kind === 'unit' || u.kind === 'hero') && u.owner !== p && u.owner < 8,
        );
        const near = enemies
          .map((u) => ({ u, d: (u.x - hero.x) ** 2 + (u.y - hero.y) ** 2 }))
          .filter((e) => e.d <= ab.rangeU * ab.rangeU)
          .sort((a, b) => a.d - b.d || a.u.id - b.u.id)[0];
        if (near !== undefined)
          add(p, 'HeroAbility', { heroId: h.id, abilityId: 0, x: near.u.x, y: near.u.y });
      }
    }
  };
}

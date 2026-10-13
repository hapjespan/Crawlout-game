import { DELAY_FRAMES_DEFAULT, MAX_ENTITIES_PER_COMMAND } from '@crawlout/protocol';
import type { CommandEnvelope, FrameBundle, Replay } from '@crawlout/protocol';
import { ROLES, buildingTypeId } from '@crawlout/data';
import { ORDER_CRAFT, ORDER_NONE } from '@crawlout/sim';
import type { Sim, UnitView } from '@crawlout/sim';
import { gameData } from './env.js';
import { createReplaySim } from './run.js';

// Een eenvoudige speler-bot voor het opnemen van fixtures: hij kijkt naar de state (zoals een speler naar zijn scherm)
// en geeft gewone commando's. Alleen bij `record` draait hij; de fixture bevat de bundels die hij gaf, en de replay
// speelt die af zonder bot. Hij mag dus alles wat de sim publiek laat zien gebruiken, ook floats: het determinisme
// zit in de sim, niet hier.

export type Add = (playerId: number, type: CommandEnvelope['type'], payload: unknown) => void;
/** Kijkt naar de state na frame f - 1 en geeft commando's die in frame f worden uitgevoerd. */
export type Controller = (sim: Sim, frame: number, add: Add) => void;

/**
 * Neemt een replay op met controllers: per frame eerst de controllers (in volgorde), dan de bundel voor dat frame.
 * envelope.frame = uitvoerframe - DELAY, seq per speler oplopend. `until` mag eerder stoppen (true = stop na dit frame).
 * Vult r.bundles en zet het laatste frame in r.hashes (record vult de echte hashes in).
 */
export function recordControlled(r: Replay, frames: number, controllers: readonly Controller[], until?: (sim: Sim, frame: number) => boolean): Sim {
  const sim = createReplaySim(r);
  const seqs: number[] = [];
  const bundles: FrameBundle[] = [];
  let last = frames - 1;
  for (let f = 0; f < frames; f++) {
    const commands: CommandEnvelope[] = [];
    const add: Add = (playerId, type, payload) => {
      const seq = seqs[playerId] ?? 0;
      seqs[playerId] = seq + 1;
      commands.push({ frame: Math.max(0, f - DELAY_FRAMES_DEFAULT), playerId, seq, type, payload });
    };
    for (const c of controllers) c(sim, f, add);
    const b = { frame: f, commands };
    if (commands.length > 0) bundles.push(b);
    sim.applyBundle(b);
    sim.tick();
    if (until?.(sim, f) === true) {
      last = f;
      break;
    }
  }
  r.bundles = bundles;
  r.hashes = [{ frame: last, hash: 0 }];
  return sim;
}

const ROLE_SCAV = ROLES.indexOf('scavenger');
const ROLE_BUILDER = ROLES.indexOf('builder');
const ROLE_MILITIA = ROLES.indexOf('militia');

export const buildingType = (key: string): number => buildingTypeId(gameData().data.buildings.find((b) => b.key === key)!.id);
export const techOf = (key: string): number => gameData().data.tech.find((t) => t.key === key)!.id;

/** Gebouw in de bouwlijst: type en het midden (cellen) van de footprint voor speler 0; speler 1 krijgt het spiegelbeeld. */
export interface PlannedBuilding {
  readonly key: string;
  readonly cx: number;
  readonly cy: number;
}

export interface BotPlan {
  /** Bouwlijst in volgorde; een gebouw met prereqTech wacht tot de tech er is. */
  readonly builds: readonly PlannedBuilding[];
  /** Techs in volgorde; Research zodra het kan (de sim weigert wat niet kan). */
  readonly research: readonly string[];
  /** Zoveel bouwers houdt hij (omscholen zodra er een werkplaats is). */
  readonly builders: number;
  /** Omscholen tot militie zodra hij zoveel bewoners heeft (of vanaf militiaFrame), tot militiaCount militie. */
  readonly militiaAtSettlers: number;
  readonly militiaFrame?: number;
  readonly militiaCount: number;
  /** Aanvallen (AttackMove naar het hoofdgebouw van de ander, held mee) zodra hij zoveel militie heeft, vanaf attackFrame. */
  readonly attackWithMilitia: number;
  readonly attackFrame?: number;
}

/** Midden van een footprint van `size` cellen, gespiegeld in het midden van een map van `side` cellen (puntsymmetrie). */
export const mirror = (c: number, size: number, side: number): number => (size % 2 === 1 ? side - 1 - c : side - c);

/** Een bot voor speler p volgens plan. Kijkt elke `every` frames. */
export function settlementBot(p: number, plan: BotPlan, every = 10): Controller {
  const data = gameData().data;
  let militiaDone = false;
  let attacked = false;
  let lastAttack = -1;
  let next = 0;
  return (sim, f, add) => {
    if (f % every !== p % every || sim.isDefeated(p)) return;
    const side = sim.map.w;
    const all = sim.entityIds().map((id) => sim.getUnit(id)!);
    const mine = all.filter((u) => u.owner === p);
    const units = mine.filter((u) => u.kind === 'unit');
    const hero = mine.find((u) => u.kind === 'hero');
    const hq = mine.find((u) => u.kind === 'building' && u.typeId === buildingType('hoofdgebouw'));
    const st = sim.playerStatus(p);
    const techs = st.techs ?? [];
    const done = (key: string): UnitView | undefined => mine.find((u) => u.kind === 'building' && u.typeId === buildingType(key) && u.buildState === 2);
    const role = (r: number): UnitView[] => units.filter((u) => u.role === r && u.order !== ORDER_CRAFT);
    const idle = (list: UnitView[]): UnitView[] => list.filter((u) => u.order === ORDER_NONE);
    const send = (type: CommandEnvelope['type'], ids: number[], payload: object): void => {
      for (let k = 0; k < ids.length; k += MAX_ENTITIES_PER_COMMAND) add(p, type, { ids: ids.slice(k, k + MAX_ENTITIES_PER_COMMAND), ...payload });
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
    for (const [nodeId, ids] of [...byNode].sort((a, b) => a[0] - b[0])) send('Gather', ids, { nodeId });

    // bouwers: aanvullen in de werkplaats, één tegelijk
    const scavs = role(ROLE_SCAV);
    const crafting = units.some((u) => u.order === ORDER_CRAFT);
    if (done('werkplaats') && !crafting && role(ROLE_BUILDER).length < plan.builders && scavs.length > 0) {
      add(p, 'SetRole', { ids: [scavs[scavs.length - 1]!.id], role: 'builder' });
    }

    // bouwen: bouwplaatsen afmaken, daarna het volgende gebouw uit de lijst
    const builders = idle(role(ROLE_BUILDER)).map((u) => u.id);
    const site = mine.find((u) => u.kind === 'building' && u.buildState === 1);
    const at = (b: PlannedBuilding): { typeId: number; x: number; y: number } => {
      const def = data.buildings.find((x) => x.key === b.key)!;
      const cx = p === 0 ? b.cx : mirror(b.cx, def.footprint.w, side);
      const cy = p === 0 ? b.cy : mirror(b.cy, def.footprint.h, side);
      return { typeId: buildingType(b.key), x: cx * 256 + 128, y: cy * 256 + 128 };
    };
    while (next < plan.builds.length) {
      const t = at(plan.builds[next]!);
      const placed = mine.some((u) => u.kind === 'building' && u.typeId === t.typeId && Math.abs(u.x - t.x) <= 128 && Math.abs(u.y - t.y) <= 128);
      if (!placed) break;
      next++;
    }
    if (builders.length > 0) {
      if (site !== undefined) send('Build', builders, { typeId: site.typeId, x: site.x, y: site.y });
      else if (next < plan.builds.length) {
        const b = plan.builds[next]!;
        const def = data.buildings.find((x) => x.key === b.key)!;
        if (def.prereqTech.every((t) => techs.includes(t)) && st.scrap >= def.scrapCost) send('Build', builders, at(b));
      }
    }

    // onderzoek: de eerste tech die er nog niet is; de sim weigert zonder gebouw, prereqTech of scrap
    const todo = plan.research.map(techOf).find((t) => !techs.includes(t));
    if (todo !== undefined) add(p, 'Research', { techId: todo });

    // militie
    if (!militiaDone && (st.settlers >= plan.militiaAtSettlers || (plan.militiaFrame !== undefined && f >= plan.militiaFrame)) && done('werkplaats')) {
      militiaDone = true;
      send('SetRole', scavs.slice(0, plan.militiaCount).map((u) => u.id), { role: 'militia' });
    }
    const militia = role(ROLE_MILITIA);
    const enemyHq = all.find((u) => u.kind === 'building' && u.owner !== p && u.owner < 8 && u.typeId === buildingType('hoofdgebouw'));
    if (enemyHq !== undefined && militia.length >= plan.attackWithMilitia && f >= (plan.attackFrame ?? 0)) {
      if (!attacked || f - lastAttack >= 400) {
        const ids = (attacked ? idle(militia) : militia).map((u) => u.id);
        if (hero !== undefined && (!attacked || hero.order === ORDER_NONE)) ids.push(hero.id);
        if (ids.length > 0) send('AttackMove', ids, { x: enemyHq.x, y: enemyHq.y });
        attacked = true;
        lastAttack = f;
      }
    }

    // de held: oplappen, perks, Lockdown op de dichtstbijzijnde vijand binnen bereik
    const h = data.heroes[st.hero?.heroId ?? -1];
    if (h !== undefined && st.hero !== null) {
      if (st.hero.state === 'dead' && hq !== undefined && st.scrap >= h.reviveScrap) add(p, 'Recruit', { buildingId: hq.id });
      if (st.hero.pendingPerks > 0) for (const perkId of h.perkPool) add(p, 'PickPerk', { heroId: h.id, perkId });
      if (hero !== undefined && st.hero.abilityCooldownTicks[0] === 0) {
        const ab = h.abilities[0]!;
        const enemies = all.filter((u) => (u.kind === 'unit' || u.kind === 'hero') && u.owner !== p && u.owner < 8);
        const near = enemies
          .map((u) => ({ u, d: (u.x - hero.x) ** 2 + (u.y - hero.y) ** 2 }))
          .filter((e) => e.d <= ab.rangeU * ab.rangeU)
          .sort((a, b) => a.d - b.d || a.u.id - b.u.id)[0];
        if (near !== undefined) add(p, 'HeroAbility', { heroId: h.id, abilityId: 0, x: near.u.x, y: near.u.y });
      }
    }
  };
}

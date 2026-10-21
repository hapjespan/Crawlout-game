// Split from cards.ts to stay under the 5,000-token file limit; cards.ts re-exports the public surface.
// Holds: buildingCards, reviveProgress, buildingButtons.
import type { BuildingCard, CardState, BuildingButton, BuildingSite } from '@crawlout/ui';
import type { EntityRow } from './snapshot.js';
import { ANIM, TICK_HZ, type PlayerStatus } from '@crawlout/protocol';
import { kindOfTypeId, heroIdOfTypeId, PROVIDES, type GameData } from '@crawlout/data';
import { LOADOUT_NAMES } from './roster.js';
import {
  BUTTON_ORDER,
  SPECIAL_LABELS,
  STAT_ICON,
  buildingName,
  effectTexts,
  hasFinishedWorkshop,
  humanize,
  isRobotBody,
  occupiesBuilding,
  producingPop,
  queueItem,
  raiderTechEffects,
} from './cards.part1.js';
import type { CardContext } from './cards.part1.js';

export function buildingCards(ctx: CardContext): BuildingCard[] {
  const { data, factionId, status } = ctx;
  const researched = new Set(status?.techs ?? []);
  const scrap = status?.scrap ?? 0;
  const techName = (id: number): string => humanize(data.tech[id]?.key ?? String(id));
  const missing = (prereq: readonly number[]): string[] =>
    prereq.filter((t) => !researched.has(t)).map(techName);
  const finished = (e: EntityRow): boolean => e.anim !== ANIM.build;
  const busyBuildings = new Set(status?.queue?.filter(occupiesBuilding).map((q) => q.buildingId));
  const tooExpensive = (cost: number): string => `Te duur: nog ${cost - scrap} scrap nodig`;
  /** Own finished buildings of a building id (index in data.buildings). */
  const finishedOf = (buildingIdx: number): EntityRow[] =>
    ctx.own.filter((e) => {
      const k = kindOfTypeId(e.typeId);
      return k.kind === 'building' && k.index === buildingIdx && finished(e);
    });
  const nameOfBuilding = (idx: number): string =>
    buildingName(data.buildings[idx]?.key ?? String(idx));

  /**
   * One state for every kind: done, running, locked (missing requirement), busy (every finished building of the type
   * has other work, so the sim ignores the command without charging), too expensive, else available. `reason` says
   * why a card does not start, in plain Dutch.
   */
  const stateOf = (
    cost: number,
    prereq: readonly number[],
    running: boolean,
    done: boolean,
    buildingIdx: number | null,
  ): { state: CardState; reason?: string } => {
    if (done) return { state: 'done' };
    if (running) return { state: 'running' };
    const lacking = missing(prereq);
    if (lacking.length > 0)
      return { state: 'locked', reason: `Vergrendeld: vereist ${lacking.join(', ')}` };
    if (buildingIdx !== null) {
      const idle = finishedOf(buildingIdx).filter((e) => !busyBuildings.has(e.id));
      if (idle.length === 0)
        return { state: 'busy', reason: `${nameOfBuilding(buildingIdx)} is bezig met ander werk` };
    }
    return scrap >= cost
      ? { state: 'available' }
      : { state: 'tooExpensive', reason: tooExpensive(cost) };
  };

  const selectedBuildings = ctx.selected.filter((e) => kindOfTypeId(e.typeId).kind === 'building');
  // Settlers only: the hero is a unit too, but he never crafts.
  const selectedUnits = ctx.selected.filter(
    (e) => kindOfTypeId(e.typeId).kind === 'unit' && heroIdOfTypeId(e.typeId) < 0,
  );
  const cards: Omit<BuildingCard, 'hotkey'>[] = [];

  if (selectedBuildings.length > 0 && selectedUnits.length === 0) {
    // Only finished buildings have anything to offer; a site under construction shows no cards.
    const ready = selectedBuildings.filter(finished);
    const buildingIds = new Set(ready.map((e) => kindOfTypeId(e.typeId).index));
    for (const t of data.tech) {
      if (t.factionId !== factionId || !buildingIds.has(t.buildingId)) continue;
      const running = queueItem(status, 'research', t.id);
      const unlocks = [
        ...data.loadouts
          .filter((l) => l.prereqTech.includes(t.id))
          .map((l) => LOADOUT_NAMES[l.key] ?? humanize(l.key)),
        ...data.buildings
          .filter((b) => b.prereqTech.includes(t.id))
          .map((b) => buildingName(b.key)),
      ];
      const first = t.effects[0];
      const st = stateOf(
        t.scrapCost,
        t.prereqTech,
        running !== undefined,
        researched.has(t.id),
        t.buildingId,
      );
      cards.push({
        kind: 'research',
        id: t.id,
        naam: humanize(t.key),
        icon: first
          ? (STAT_ICON[first.stat] ?? 'research')
          : unlocks.length > 0
            ? 'gear'
            : 'research',
        scrapCost: t.scrapCost,
        seconds: Math.round(t.researchTicks / TICK_HZ),
        effects: [...effectTexts(t.effects), ...raiderTechEffects(data, factionId, t.key)],
        unlocks,
        requires: missing(t.prereqTech),
        ...st,
        ...(running ? { progressPct: Math.round(running.progressPermille / 10) } : {}),
      });
    }
    // Robots: built new in their factory (loadouts.producedAt), one at a time per building.
    for (const idx of buildingIds) {
      const factories = ready.filter((e) => kindOfTypeId(e.typeId).index === idx);
      for (const l of data.loadouts) {
        if (l.factionId !== factionId || l.producedAt !== idx) continue;
        const run = status?.queue?.find(
          (q) =>
            q.kind === 'produce' && q.id === l.id && factories.some((f) => f.id === q.buildingId),
        );
        const target = factories.find((f) => !busyBuildings.has(f.id)) ?? factories[0]!;
        const pop = (status?.pop ?? 0) + (status?.robotPop ?? 0) + producingPop(data, status);
        const popFull = pop + l.popCost > data.sim.popCapMax;
        let st = stateOf(l.scrapCost, l.prereqTech, run !== undefined, false, idx);
        // A Raider fighter from a tent also needs a free bed (slaves and prisoners sleep in the Kooi and do not count).
        const needsBed = data.factions[l.factionId]?.slaves != null && !isRobotBody(data, l);
        if (st.state === 'available' && needsBed && (status?.pop ?? 0) >= (status?.popCap ?? 0))
          st = { state: 'locked', reason: 'Geen vrij bed: bouw een tent' };
        if ((st.state === 'available' || st.state === 'tooExpensive') && popFull)
          st = {
            state: 'locked',
            reason: `Pop-limiet bereikt (${pop} van ${data.sim.popCapMax}, dit kost ${l.popCost})`,
          };
        cards.push({
          kind: 'produce',
          id: l.id,
          buildingId: run?.buildingId ?? target.id,
          naam: LOADOUT_NAMES[l.key] ?? humanize(l.key),
          icon: 'robot',
          scrapCost: l.scrapCost,
          seconds: Math.round(l.craftTicks / TICK_HZ),
          effects: [
            // the Bouwrobot (data 0.26.0) builds instead of fighting
            `${l.hpI} leven, ${l.canBuild ? 'bouwt als een bouwer' : `${l.damage} schade`}${l.popCost > 1 ? `, telt voor ${l.popCost} pop` : ''}`,
          ],
          unlocks: [],
          requires: missing(l.prereqTech),
          ...st,
          ...(run ? { progressPct: Math.round(run.progressPermille / 10) } : {}),
        });
      }
    }
    // SPECIAL training: +1 point on a letter per run, costlier and slower per point already trained.
    for (const tr of data.training) {
      if (tr.factionId !== factionId || !buildingIds.has(tr.buildingId)) continue;
      const trained = status?.trained?.[tr.special] ?? 0;
      const cost = tr.scrapCost + tr.scrapCostStep * trained;
      const ticks = tr.trainTicks + tr.trainTicksStep * trained;
      const run = status?.queue?.find((q) => q.kind === 'train' && q.id === tr.id);
      const factories = ready.filter((e) => kindOfTypeId(e.typeId).index === tr.buildingId);
      const target = factories.find((f) => !busyBuildings.has(f.id)) ?? factories[0]!;
      const letter = SPECIAL_LABELS[tr.special] ?? humanize(tr.key);
      cards.push({
        kind: 'train',
        id: tr.id,
        buildingId: run?.buildingId ?? target.id,
        naam: `Training ${letter.toLowerCase()}`,
        icon: 'training',
        scrapCost: cost,
        seconds: Math.round(ticks / TICK_HZ),
        effects: [`+${tr.pointsPerRun} ${letter} voor de held (nu ${trained} van ${tr.maxPoints})`],
        unlocks: [],
        requires: missing(tr.prereqTech),
        ...stateOf(cost, tr.prereqTech, run !== undefined, trained >= tr.maxPoints, tr.buildingId),
        ...(run ? { progressPct: Math.round(run.progressPermille / 10) } : {}),
      });
    }
    const hqIdx = PROVIDES.indexOf('hq');
    const hq = ready.find((e) =>
      data.buildings[kindOfTypeId(e.typeId).index]?.provides.includes(hqIdx),
    );
    // hero choice (protocol 0.19.0): the player's own hero from HeroStatus, else the first hero of the faction
    const hero =
      (status?.hero ? data.heroes[status.hero.heroId] : undefined) ??
      data.heroes.find((h) => h.factionId === factionId);
    if (hq && hero && ctx.heroDead) {
      const reviving = status?.hero?.state === 'reviving';
      cards.push({
        kind: 'revive',
        id: hq.id,
        naam: `Oplappen: ${hero.naam}`,
        icon: 'heart',
        scrapCost: hero.reviveScrap,
        seconds: Math.round(hero.reviveTicks / TICK_HZ),
        effects: [
          `Nog ${status?.hero?.revivesLeft ?? 0} keer mogelijk; elke keer kost perks en leven`,
        ],
        unlocks: [],
        requires: [],
        state: reviving ? 'running' : scrap >= hero.reviveScrap ? 'available' : 'tooExpensive',
        ...(!reviving && scrap < hero.reviveScrap
          ? { reason: tooExpensive(hero.reviveScrap) }
          : {}),
      });
    }
  } else if (selectedUnits.length > 0) {
    // Crafting needs a finished workshop of your own; the sim walks the settlers there.
    if (hasFinishedWorkshop(data, ctx.own)) {
      for (const l of data.loadouts) {
        // robots (producedAt >= 0) are built new in their factory, never retrained from a settler
        if (l.factionId !== factionId || l.producedAt >= 0) continue;
        const running = queueItem(status, 'craft', l.id);
        cards.push({
          kind: 'craft',
          id: l.id,
          naam: LOADOUT_NAMES[l.key] ?? humanize(l.key),
          icon:
            l.key === 'patrol'
              ? 'patrol'
              : l.key === 'scavenger'
                ? 'crate'
                : l.key === 'bouwer'
                  ? 'wrench'
                  : 'gun',
          scrapCost: l.scrapCost,
          seconds: Math.round(l.craftTicks / TICK_HZ),
          effects: [`Uitrusting: ${humanize(l.weapon)}, ${l.hpI} leven, ${l.damage} schade`],
          unlocks: [],
          requires: missing(l.prereqTech),
          ...stateOf(l.scrapCost, l.prereqTech, running !== undefined, false, null),
          ...(running ? { progressPct: Math.round(running.progressPermille / 10) } : {}),
        });
      }
    }
  }
  return cards.map((c, i) => ({ ...c, hotkey: String(i + 1) }));
}

/** Revive progress 0..100 from the hero status (reviveTicksLeft against the full revive time). */
function reviveProgress(data: GameData, status: PlayerStatus | null): number {
  const hero = status?.hero;
  const full = hero ? (data.heroes[hero.heroId]?.reviveTicks ?? 0) : 0;
  return full > 0 && hero ? 100 - (hero.reviveTicksLeft * 100) / full : 0;
}

/**
 * One button per building type among the own finished buildings that HAVE an action (Werkplaats, Lab, Training,
 * Robotfabriek, and the Basis while the hero can be revived), each with its buildings in id order. A site counts its
 * cards ready to start and its running jobs; a revive of the hero counts on the HQ. A building has an action when it
 * offers a card that is not finished for good (available, too expensive, locked, busy or running): a lab that is short
 * of scrap stays listed, a workshop with every tech researched drops off. Buildings that never act (woning, claimpaal,
 * turret, radiobaken) are not listed; click them in the world.
 */
export function buildingButtons(ctx: CardContext): BuildingButton[] {
  const { data, status } = ctx;
  const groups = new Map<number, BuildingSite[]>();
  const done = ctx.own
    .filter((e) => kindOfTypeId(e.typeId).kind === 'building' && e.anim !== ANIM.build)
    .sort((a, b) => a.id - b.id);
  for (const e of done) {
    const cards = buildingCards({ ...ctx, selected: [e] });
    const jobs = status?.queue?.filter((q) => q.buildingId === e.id && occupiesBuilding(q)) ?? [];
    if (!cards.some((c) => c.state !== 'done')) continue;
    const reviving = cards.some((c) => c.kind === 'revive' && c.state === 'running');
    const progress = [
      ...jobs.map((q) => q.progressPermille / 10),
      ...(reviving ? [reviveProgress(data, status)] : []),
    ];
    const idx = kindOfTypeId(e.typeId).index;
    const list = groups.get(idx) ?? [];
    list.push({
      id: e.id,
      x: e.x,
      y: e.y,
      available: cards.filter((c) => c.state === 'available').length,
      running: jobs.length + (reviving ? 1 : 0),
      ...(progress.length > 0 ? { progressPct: Math.round(Math.max(...progress)) } : {}),
    });
    groups.set(idx, list);
  }
  const rank = (idx: number): number => {
    const at = BUTTON_ORDER.indexOf(data.buildings[idx]?.key ?? '');
    return at >= 0 ? at : BUTTON_ORDER.length + idx;
  };
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([idx, sites]) => {
      const key = data.buildings[idx]?.key ?? String(idx);
      const progress = sites.flatMap((s) => (s.progressPct === undefined ? [] : [s.progressPct]));
      return {
        key,
        naam: buildingName(key),
        sites,
        available: sites.reduce((n, s) => n + s.available, 0),
        running: sites.reduce((n, s) => n + s.running, 0),
        ...(progress.length > 0 ? { progressPct: Math.max(...progress) } : {}),
      };
    });
}

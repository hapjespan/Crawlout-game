// Building panel cards (research, craft, revive, robot production, SPECIAL training) for the HUD: names, effects in
// plain Dutch, what a card unlocks, and its state from scrap, researched techs and the sim's work queue. The HUD only
// renders what this returns. The same cards feed the building buttons in the bottom bar (buildingButtons).
import {
  ANIM,
  ENTITY_NONE,
  UNITS_PER_METER,
  TICK_HZ,
  type PlayerStatus,
  type QueueItem,
} from '@crawlout/protocol';
import {
  PROVIDES,
  heroIdOfTypeId,
  kindOfTypeId,
  type EffectData,
  type GameData,
} from '@crawlout/data';
import type {
  BuildingButton,
  BuildingCard,
  BuildingSite,
  CardIconId,
  CardState,
} from '@crawlout/ui';
import { LOADOUT_NAMES } from './roster.js';
import type { EntityRow } from './snapshot.js';

/** Display names per building key; buildings.json has no name field yet, so unknown keys are humanized. */
export const BUILDING_NAMES: Record<string, string> = {
  hoofdgebouw: 'Basis',
  woning: 'Woning',
  werkplaats: 'Werkplaats',
  radiobaken: 'Radiobaken',
  claimpaal: 'Claimpaal',
  turret: 'Turret',
  turret_laser: 'Lasertoren',
  robotfabriek: 'Robotfabriek',
  lab: 'Lab',
  trainingsfaciliteit: 'Training',
  // Raiders (data 0.21.0): names only, the faction is not playable yet
  raiderkamp: 'Raiderkamp',
  tent: 'Tent',
  kooi: 'Kooi',
  plundermarkt: 'Plundermarkt',
  chemlab: 'Chemlab',
  autosloperij: 'Autosloperij',
  mitrailleursnest: 'Mitrailleursnest',
  plunderpost: 'Plunderpost',
};

/** Order of the building buttons: what the player works with first, then the rest in data order. */
const BUTTON_ORDER = [
  'hoofdgebouw',
  'werkplaats',
  'lab',
  'trainingsfaciliteit',
  'robotfabriek',
  'woning',
];

/** The SPECIAL letters in data order (S P E C I A L), for the training cards. */
export const SPECIAL_LABELS = [
  'Kracht',
  'Perceptie',
  'Uithoudingsvermogen',
  'Charisma',
  'Intelligentie',
  'Behendigheid',
  'Geluk',
] as const;

const STAT_TEXT: Record<string, { label: string; unit: 'pct' | 'm' | 'raw' }> = {
  hpPct: { label: 'leven', unit: 'pct' },
  damagePct: { label: 'schade', unit: 'pct' },
  speedPct: { label: 'snelheid', unit: 'pct' },
  rangeM: { label: 'bereik', unit: 'm' },
  gatherRatePct: { label: 'verzameltempo', unit: 'pct' },
  buildTimePct: { label: 'bouwtijd', unit: 'pct' },
  researchTimePct: { label: 'onderzoekstijd', unit: 'pct' },
};

const STAT_ICON: Record<string, CardIconId> = {
  hpPct: 'shield',
  damagePct: 'gun',
  speedPct: 'bolt',
  rangeM: 'tower',
  gatherRatePct: 'crate',
  buildTimePct: 'wrench',
  researchTimePct: 'gear',
};

/** "composiet_pantser" → "Composiet pantser": data keys until the data carries display names. */
export const humanize = (key: string): string => {
  const words = key.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Dutch name of a building key. */
export const buildingName = (key: string): string => BUILDING_NAMES[key] ?? humanize(key);

const TARGET_NAMES: Record<string, string> = {
  held: 'de held',
  scavenger: 'plunderaars',
  turret: 'turrets',
  turret_laser: 'lasertorens',
  alle: 'alle eenheden',
};
const targetName = (target: string): string =>
  TARGET_NAMES[target] ?? (LOADOUT_NAMES[target] ?? humanize(target)).toLowerCase();

/** Stats that apply to the whole player, not to units: "-10% onderzoekstijd", without a "voor alle eenheden". */
const PLAYER_WIDE_STATS = new Set(['researchTimePct', 'buildTimePct']);

/** One effect in plain language, e.g. "+20% schade voor turrets" or "+1 m bereik voor turrets". */
export function effectText(e: EffectData): string {
  const t = STAT_TEXT[e.stat];
  if (!t) return `${e.stat} ${e.delta > 0 ? '+' : ''}${e.delta} voor ${targetName(e.target)}`;
  const value =
    t.unit === 'pct' ? e.delta / 10 : t.unit === 'm' ? e.delta / UNITS_PER_METER : e.delta;
  const sign = value > 0 ? '+' : '';
  const amount =
    t.unit === 'pct'
      ? `${sign}${value}%`
      : t.unit === 'm'
        ? `${sign}${value} m`
        : `${sign}${value}`;
  if (e.target === 'alle' && PLAYER_WIDE_STATS.has(e.stat)) return `${amount} ${t.label}`;
  return `${amount} ${t.label} voor ${targetName(e.target)}`;
}

/** Effects in plain language, one line per stat and amount: "+15% leven voor militie, patrouille, ...". */
export function effectTexts(effects: readonly EffectData[]): string[] {
  const groups = new Map<string, { first: EffectData; targets: string[] }>();
  for (const e of effects) {
    const key = `${e.stat}:${e.delta}`;
    const g = groups.get(key) ?? { first: e, targets: [] };
    g.targets.push(targetName(e.target));
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => {
    const line = effectText(g.first);
    const at = line.lastIndexOf(' voor ');
    return at < 0 ? line : `${line.slice(0, at)} voor ${g.targets.join(', ')}`;
  });
}

export interface CardContext {
  data: GameData;
  factionId: number | undefined;
  playerId: number;
  status: PlayerStatus | null;
  /** Own selected entities, from the latest snapshot. */
  selected: readonly EntityRow[];
  /** Own entities, to find workshops for crafting. */
  own: readonly EntityRow[];
  heroDead: boolean;
}

const queueItem = (
  status: PlayerStatus | null,
  kind: QueueItem['kind'],
  id: number,
): QueueItem | undefined => status?.queue?.find((q) => q.kind === kind && q.id === id);

/** Work that occupies a building in the sim (idleOwnBuilding): research, robot production or training; crafting does not. */
const occupiesBuilding = (q: QueueItem): boolean =>
  q.kind !== 'craft' && q.buildingId !== ENTITY_NONE;

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
        ...data.buildings.filter((b) => b.prereqTech.includes(t.id)).map((b) => humanize(b.key)),
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
        effects: effectTexts(t.effects),
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
            `${l.hpI} leven, ${l.damage} schade${l.popCost > 1 ? `, telt voor ${l.popCost} pop` : ''}`,
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
    const hero = data.heroes.find((h) => h.factionId === factionId);
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

/** Does the player own a finished workshop? Crafting and role switching (SetRole) both walk to one. */
export function hasFinishedWorkshop(data: GameData, own: readonly EntityRow[]): boolean {
  const workshopIdx = PROVIDES.indexOf('werkplaats');
  return own.some((e) => {
    const k = kindOfTypeId(e.typeId);
    return (
      k.kind === 'building' &&
      data.buildings[k.index]?.provides.includes(workshopIdx) === true &&
      e.anim !== ANIM.build
    );
  });
}

/** Pop that robots in production already claim (their popCost), for the pop-limit check of a new robot. */
function producingPop(data: GameData, status: PlayerStatus | null): number {
  let pop = 0;
  for (const q of status?.queue ?? [])
    if (q.kind === 'produce') pop += data.loadouts[q.id]?.popCost ?? 0;
  return pop;
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

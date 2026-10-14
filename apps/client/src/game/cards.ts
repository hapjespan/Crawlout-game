// Building panel cards (research, craft, revive) for the HUD: names, effects in plain Dutch, what a card unlocks,
// and its state from scrap, researched techs and the sim's work queue. The HUD only renders what this returns.
import {
  ANIM,
  UNITS_PER_METER,
  TICK_HZ,
  type PlayerStatus,
  type QueueItem,
} from '@crawlout/protocol';
import { PROVIDES, kindOfTypeId, type EffectData, type GameData } from '@crawlout/data';
import type { BuildingCard, CardIconId, CardState } from '@crawlout/ui';
import { LOADOUT_NAMES } from './roster.js';
import type { EntityRow } from './snapshot.js';

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

const targetName = (target: string): string => {
  if (target === 'turret') return 'turrets';
  if (target === 'alle') return 'alle eenheden';
  return (LOADOUT_NAMES[target] ?? humanize(target)).toLowerCase();
};

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
  return `${amount} ${t.label} voor ${targetName(e.target)}`;
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

export function buildingCards(ctx: CardContext): BuildingCard[] {
  const { data, factionId, status } = ctx;
  const researched = new Set(status?.techs ?? []);
  const scrap = status?.scrap ?? 0;
  const techName = (id: number): string => humanize(data.tech[id]?.key ?? String(id));
  const missing = (prereq: readonly number[]): string[] =>
    prereq.filter((t) => !researched.has(t)).map(techName);
  const stateOf = (
    cost: number,
    prereq: readonly number[],
    running: boolean,
    done: boolean,
  ): CardState => {
    if (done) return 'done';
    if (running) return 'running';
    if (missing(prereq).length > 0) return 'locked';
    return scrap >= cost ? 'available' : 'tooExpensive';
  };

  const selectedBuildings = ctx.selected.filter((e) => kindOfTypeId(e.typeId).kind === 'building');
  const selectedUnits = ctx.selected.filter((e) => kindOfTypeId(e.typeId).kind === 'unit');
  const cards: Omit<BuildingCard, 'hotkey'>[] = [];

  if (selectedBuildings.length > 0 && selectedUnits.length === 0) {
    const buildingIds = new Set(selectedBuildings.map((e) => kindOfTypeId(e.typeId).index));
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
        effects: t.effects.map(effectText),
        unlocks,
        requires: missing(t.prereqTech),
        state: stateOf(t.scrapCost, t.prereqTech, running !== undefined, researched.has(t.id)),
        ...(running ? { progressPct: Math.round(running.progressPermille / 10) } : {}),
      });
    }
    const hqIdx = PROVIDES.indexOf('hq');
    const hq = selectedBuildings.find((e) =>
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
      });
    }
  } else if (selectedUnits.length > 0) {
    // Crafting needs a finished workshop of your own; the sim walks the settlers there.
    const workshopIdx = PROVIDES.indexOf('werkplaats');
    const hasWorkshop = ctx.own.some((e) => {
      const k = kindOfTypeId(e.typeId);
      return (
        k.kind === 'building' &&
        data.buildings[k.index]?.provides.includes(workshopIdx) &&
        e.anim !== ANIM.build
      );
    });
    if (hasWorkshop) {
      for (const l of data.loadouts) {
        if (l.factionId !== factionId) continue;
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
          state: stateOf(l.scrapCost, l.prereqTech, running !== undefined, false),
          ...(running ? { progressPct: Math.round(running.progressPermille / 10) } : {}),
        });
      }
    }
  }
  return cards.map((c, i) => ({ ...c, hotkey: String(i + 1) }));
}

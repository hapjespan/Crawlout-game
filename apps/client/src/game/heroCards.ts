// Hero choice (protocol 0.19.0, docs/held-keuze.md): the three hero cards per faction for the menu (Tegen AI and the
// lobby). Names and numbers come from the data; the texts are Dutch and live here, like the faction blurbs.
import {
  ARCHETYPES,
  type AbilityData,
  type AbilityEffectData,
  type GameData,
  type HeroData,
} from '@crawlout/data';
import { TICK_HZ, UNITS_PER_METER, type HeroArchetype } from '@crawlout/protocol';
import type { MenuHero } from '@crawlout/ui';
import { effectText, effectTexts } from './cards.part1.js';

const ROLES: Readonly<Record<HeroArchetype, string>> = {
  bouwer: 'Bouwer · economie',
  krijger: 'Krijger · aanval',
  tacticus: 'Tacticus · controle',
};

/** Order of the cards: Bouwer, Krijger, Tacticus (the ARCHETYPES order). */
export function heroCards(data: GameData, factionId: number): MenuHero[] {
  return data.heroes
    .filter((h) => h.factionId === factionId)
    .sort((a, b) => a.archetype - b.archetype || a.id - b.id)
    .map((h) => {
      const archetype = ARCHETYPES[h.archetype] as HeroArchetype;
      return {
        archetype,
        name: h.naam,
        role: ROLES[archetype],
        passive: passiveText(h),
        ability: abilityText(h),
      };
    });
}

const meters = (u: number): number => Math.round((u * 10) / UNITS_PER_METER) / 10;
const seconds = (t: number): number => Math.round(t / TICK_HZ);

/** The effect without its target: "+25% snelheid" out of "+25% snelheid voor alle eenheden". */
const amountOf = (e: AbilityEffectData): string => {
  const line = effectText({ stat: e.stat, target: 'alle', delta: e.delta });
  const at = line.lastIndexOf(' voor ');
  return at < 0 ? line : line.slice(0, at);
};

/** "Vijanden -40% snelheid, -25% schade" and "eigen units +25% snelheid": the effects per side. */
function sides(effects: readonly AbilityEffectData[]): string {
  const out: string[] = [];
  for (const side of ['ally', 'enemy']) {
    const list = effects.filter((e) => e.side === side).map(amountOf);
    if (list.length > 0)
      out.push(`${side === 'ally' ? 'eigen units' : 'vijanden'} ${list.join(', ')}`);
  }
  return out.join('; ');
}

function passiveText(h: HeroData): string {
  const parts = effectTexts(h.passives);
  if (h.aura !== null) parts.push(`aura ${meters(h.aura.radiusU)} m: ${sides(h.aura.effects)}`);
  return parts.length > 0 ? parts.join('; ') : 'geen';
}

function abilityText(h: HeroData): string {
  const ab: AbilityData | undefined = h.abilities[0];
  if (ab === undefined) return 'Geen ability';
  const where =
    ab.rangeU > 0
      ? `tot ${meters(ab.rangeU)} m, straal ${meters(ab.radiusU)} m`
      : `rond de held, ${meters(ab.radiusU)} m`;
  return `${ab.naam}: ${sides(ab.effects)} (${where}, ${seconds(ab.durationTicks)} s, cd ${seconds(ab.cooldownTicks)} s)`;
}

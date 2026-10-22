// The hero's perk choices for the HUD's perk panel: name, effect in plain Dutch and the SPECIAL requirement, from
// data/perks.json through the hero's perkPool. The sim (applyPickPerk) refuses a perk outside the pool, one already
// picked, or one whose SPECIAL requirement the hero does not meet, so the panel shows the unmet ones but cannot pick them.
import type { HeroStatus } from '@crawlout/protocol';
import type { GameData } from '@crawlout/data';
import type { PerkOption } from '@crawlout/ui';
import { SPECIAL_LABELS, effectTexts } from './cards.js';

export function perkOptions(data: GameData, hero: HeroStatus | null): PerkOption[] {
  const heroData = hero ? data.heroes[hero.heroId] : undefined;
  if (!hero || !heroData) return [];
  const out: PerkOption[] = [];
  for (const id of heroData.perkPool) {
    const perk = data.perks[id];
    if (!perk || hero.perks.includes(perk.id)) continue;
    const { stat, min } = perk.requires;
    out.push({
      perkId: perk.id,
      naam: perk.naam,
      effects: effectTexts(perk.effects),
      requirement: `${SPECIAL_LABELS[stat] ?? `SPECIAL ${stat}`} ${min}`,
      available: (hero.special[stat] ?? 0) >= min,
      flavour: perk.flavourText,
    });
  }
  return out;
}

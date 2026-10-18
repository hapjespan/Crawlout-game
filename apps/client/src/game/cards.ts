// Building panel cards (research, craft, revive, robot production, SPECIAL training) for the HUD: names, effects in
// plain Dutch, what a card unlocks, and its state from scrap, researched techs and the sim's work queue. The HUD only
// renders what this returns. The same cards feed the building buttons in the bottom bar (buildingButtons).

export {
  BUILDING_NAMES,
  SPECIAL_LABELS,
  humanize,
  buildingName,
  effectText,
  effectTexts,
  raiderTechEffects,
  hasFinishedWorkshop,
  hasFinished,
} from './cards.part1.js';
export type { CardContext } from './cards.part1.js';
export { buildingCards, buildingButtons } from './cards.part2.js';

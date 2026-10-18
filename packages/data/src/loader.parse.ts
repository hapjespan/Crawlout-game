import {
  AiScript,
  Building,
  DamageMatrix,
  Faction,
  Hero,
  Loadout,
  Perk,
  SimTuning,
  Tech,
  Training,
} from './schemas.js';
import type { RawGameData } from './loader.types.js';
import { indexOf, parseList, parseWith, sortById, type IdIndex } from './loader.util.js';

// Part of the pure loader (see loader.ts): no IO, no clock; falls under the determinism lint.

/** Stage 1 result: the validated records sorted by string id, plus the id indexes the later stages resolve against. */
export interface LoadContext {
  factionsRaw: Faction[];
  loadoutsRaw: Loadout[];
  buildingsRaw: Building[];
  techRaw: Tech[];
  heroesRaw: Hero[];
  perksRaw: Perk[];
  trainingRaw: Training[];
  matrixRaw: DamageMatrix;
  simRaw: SimTuning;
  aiRaw: AiScript[];
  factionIx: IdIndex;
  loadoutIx: IdIndex;
  buildingIx: IdIndex;
  techIx: IdIndex;
  perkIx: IdIndex;
  trainingIx: IdIndex;
}

/** Validates every list file with its schema and sorts it by id (same order and errors as before the split). */
export function parseRawData(raw: RawGameData): LoadContext {
  const factionsRaw = sortById('factions.json', parseList('factions.json', Faction, raw.factions));
  const loadoutsRaw = sortById('loadouts.json', parseList('loadouts.json', Loadout, raw.loadouts));
  const buildingsRaw = sortById(
    'buildings.json',
    parseList('buildings.json', Building, raw.buildings),
  );
  const techRaw = sortById('tech.json', parseList('tech.json', Tech, raw.tech));
  const heroesRaw = sortById('heroes.json', parseList('heroes.json', Hero, raw.heroes));
  const perksRaw = sortById('perks.json', parseList('perks.json', Perk, raw.perks));
  const trainingRaw = sortById('training.json', parseList('training.json', Training, raw.training));
  const matrixRaw = parseWith('damage-matrix.json', DamageMatrix, raw.damageMatrix);
  const simRaw = parseWith('sim.json', SimTuning, raw.sim);
  const aiRaw = sortById(
    'ai/*.json',
    raw.ai.map((item, index) => parseWith(`ai/[${index}]`, AiScript, item)),
  );

  const factionIx = indexOf(factionsRaw);
  const loadoutIx = indexOf(loadoutsRaw);
  const buildingIx = indexOf(buildingsRaw);
  const techIx = indexOf(techRaw);
  const perkIx = indexOf(perksRaw);
  const trainingIx = indexOf(trainingRaw);
  return {
    factionsRaw,
    loadoutsRaw,
    buildingsRaw,
    techRaw,
    heroesRaw,
    perksRaw,
    trainingRaw,
    matrixRaw,
    simRaw,
    aiRaw,
    factionIx,
    loadoutIx,
    buildingIx,
    techIx,
    perkIx,
    trainingIx,
  };
}

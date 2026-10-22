import type { Difficulty } from '@crawlout/protocol';
import type { FixtureDef } from './fixtures-def.part1.js';
import { base } from './fixtures-def.part1.js';

// Moeilijkheidsgraad (sim 0.37.0, data 0.45.0, protocol 0.21.0; besluit fase-0 sectie 26). De AI-scripts schuiven met
// de vermenigvuldiger die de sim één keer in start() uit sim.rng trekt, binnen de band van MatchSettings.difficulty.
// Twee potjes AI tegen AI op Rustbelt op dezelfde seed, één op `hard` en één op `easy`: de hashes van de twee lopen
// vanaf de eerste bouwopdracht uiteen, en elke hash hangt alleen af van seed plus settings. Een `normal`-potje is er
// bewust niet bij: dat niveau loot ook, dus het zou alleen hetzelfde bewijzen. De potjes zonder `difficulty` (alle
// andere fixtures) zijn het bewijs dat een potje zonder niveau exact zijn oude gedrag houdt.
// 6 minuten, hashes elke 600 frames.
const END = 7200;

function levelled(seed: number, difficulty: Difficulty) {
  const r = base('rustbelt', seed, [true, true]);
  r.players = r.players.map((pl) =>
    pl.playerId === 1 ? { ...pl, faction: 'raiders' } : pl,
  );
  r.settings = { ...r.settings, difficulty };
  r.hashes = [];
  for (let f = 600; f <= END; f += 600) r.hashes.push({ frame: f, hash: 0 });
  return r;
}

export const DIFFICULTY_FIXTURES: readonly FixtureDef[] = [
  { name: 's21-rustbelt-difficulty-hard', build: () => levelled(2101, 'hard') },
  { name: 's21-rustbelt-difficulty-easy', build: () => levelled(2101, 'easy') },
];

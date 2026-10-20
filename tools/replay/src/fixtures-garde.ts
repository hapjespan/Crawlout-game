import type { FixtureDef } from './fixtures-def.part1.js';
import { base } from './fixtures-def.part1.js';

// The Garde, round A (sim 0.32.0, data 0.38.0; docs/garde.md): s18-rustbelt-garde, the scripted Garde AI
// (ai/garde-basic.json, player 0) against the Dweller AI on Rustbelt XL for 17.5 minutes (short, no win): the Initiates
// from the kazerne, the archief and smederij, fusiekernen, an Initiate-wacht promoted to Ridder (minute 10), fusion cores
// in stock (minute 15), the first krachtpantser from the smederij with a core (minute 17), the waves and the
// Paladin-Commander with his Charge and armour aura. Hashes every 3000 frames.
const END = 21000;

export const GARDE_FIXTURES: readonly FixtureDef[] = [
  {
    name: 's18-rustbelt-garde',
    build() {
      const r = base('rustbelt', 1801, [true, true]);
      r.players = r.players.map((pl) => (pl.playerId === 0 ? { ...pl, faction: 'garde' } : pl));
      r.hashes = [];
      for (let f = 3000; f <= END; f += 3000) r.hashes.push({ frame: f, hash: 0 });
      return r;
    },
  },
];

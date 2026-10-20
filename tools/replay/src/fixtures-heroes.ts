import type { HeroArchetype } from '@crawlout/protocol';
import type { FixtureDef } from './fixtures-def.part1.js';
import { base } from './fixtures-def.part1.js';

// Hero choice (sim 0.33.0, data 0.39.0, protocol 0.18.0; docs/held-keuze.md): every faction plays a non-Krijger hero
// for a short while, AI against AI on Rustbelt (two spawns, so two matches). s20-rustbelt-heroes: the Dwellers with
// the Controleur (Tacticus: aura, Noodslot, turret range) against the Raiders with the Marktmeester (Bouwer: slaves,
// Opbod). s20-rustbelt-heroes-garde: the Garde with the Kwartiermeester (Bouwer: zoekers, research) against the
// Dwellers with the Voorman (Bouwer). The archetype comes from LobbyPlayer.heroArchetype, so the replay input carries
// it. 6 minutes each, hashes every 600 frames.
const END = 7200;

function heroes(seed: number, picks: readonly [string, HeroArchetype][]) {
  const r = base('rustbelt', seed, [true, true]);
  r.players = r.players.map((pl) => {
    const [faction, heroArchetype] = picks[pl.playerId]!;
    return { ...pl, faction, heroArchetype };
  });
  r.hashes = [];
  for (let f = 600; f <= END; f += 600) r.hashes.push({ frame: f, hash: 0 });
  return r;
}

export const HERO_FIXTURES: readonly FixtureDef[] = [
  {
    name: 's20-rustbelt-heroes',
    build: () =>
      heroes(2001, [
        ['dwellers', 'tacticus'],
        ['raiders', 'bouwer'],
      ]),
  },
  {
    name: 's20-rustbelt-heroes-garde',
    build: () =>
      heroes(2002, [
        ['garde', 'bouwer'],
        ['dwellers', 'bouwer'],
      ]),
  },
];

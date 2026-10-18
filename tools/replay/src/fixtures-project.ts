import { DELAY_FRAMES_DEFAULT } from '@crawlout/protocol';
import type { Replay } from '@crawlout/protocol';
import { gameData } from './env.js';
import { createReplaySim } from './run.js';
import type { FixtureDef } from './fixtures-def.js';

// Win route C (sim 0.25.0, data 0.30.0): the fixture of the game type Bouwproject (MatchSettings.mode 'project').
// s16-rustbelt-project: the scripted Dweller AI against itself on Rustbelt XL with the strip mall; on seed 6 player 0
// restores his wing from minute 13, holds all four kinds from minute 25 and wins on the countdown (minute 30). The
// recording ends 20 frames after the win.

const ai = (i: number) => ({
  playerId: i,
  name: `ai${i}`,
  faction: 'dwellers',
  ready: true,
  online: false,
  ai: true,
});

export const PROJECT_FIXTURES: readonly FixtureDef[] = [
  {
    name: 's16-rustbelt-project',
    build(): Replay {
      const r: Replay = {
        dataVersion: gameData().data.dataVersion,
        seed: 6,
        map: 'rustbelt',
        players: [ai(0), ai(1)],
        settings: { mode: 'project', delayFrames: DELAY_FRAMES_DEFAULT },
        bundles: [],
        hashes: [],
      };
      const sim = createReplaySim(r);
      let end = 47999;
      for (let f = 0; f < 48000; f++) {
        sim.applyBundle({ frame: f, commands: [] });
        sim.tick();
        const w = sim.winner();
        if (w !== null) {
          if (w.reason !== 'project') throw new Error(`s16: winst door ${w.reason}, niet project`);
          end = w.frame + 20;
          break;
        }
      }
      r.hashes = [{ frame: end, hash: 0 }];
      return r;
    },
  },
];

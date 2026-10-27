// Split from sim.ts to stay under the 5,000-token file limit: the class in one file, the two ways to get one in this
// file. sim.ts re-exports both, so every caller keeps importing them from '@crawlout/sim'.
import { Sim } from './sim.js';
import type { CreateSimOptions } from './sim.types.js';
import type { SimEnv, SimInit } from './config.js';
import { isInt } from './math/int.js';

/** Maakt een nieuwe sim met startopstelling (tenzij opts.start === false). Valideert de invoer; gooit bij ongeldige invoer. */
export function createSim(init: SimInit, opts: CreateSimOptions = {}): Sim {
  if (!isInt(init.seed) || init.seed < 0 || init.seed > 0xffffffff)
    throw new Error(`SimInit ongeldig: seed ${init.seed}`);
  const { seed, ...env } = init;
  const sim = new Sim(env, seed);
  if (opts.start !== false) sim.start();
  return sim;
}

/** Laadt een state uit serialize(). De omgeving (map, config, spelers) moet dezelfde zijn; anders gooit hij. */
export function deserialize(buf: ArrayBuffer, env: SimEnv): Sim {
  const sim = new Sim(env, 0);
  sim.loadState(buf);
  return sim;
}

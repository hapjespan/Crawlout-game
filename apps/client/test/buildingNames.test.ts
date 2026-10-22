import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadGameDataFromDir } from '@crawlout/data/node';
import { BUILDING_NAMES, buildingName } from '../src/game/cards.js';

const data = loadGameDataFromDir(fileURLToPath(new URL('../../../data', import.meta.url)));

describe('building names', () => {
  it('every building in the data has a Dutch display name (the build menu shows it, not the data key)', () => {
    for (const b of data.buildings) expect(BUILDING_NAMES[b.key], b.key).toBeDefined();
  });

  it('a name starts with a capital, so it never reads as a raw data key', () => {
    for (const b of data.buildings) expect(buildingName(b.key)).toMatch(/^\p{Lu}/u);
  });
});

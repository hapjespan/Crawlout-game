import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadGameDataFromDir } from '@crawlout/data/node';
import { loadClientGameData } from '../src/game/content.js';

const dataDir = fileURLToPath(new URL('../../../data', import.meta.url));

describe('client data bundle', () => {
  it('includes the survival co-op data and hostile loadouts, same as the Node loader', () => {
    const client = loadClientGameData();
    const node = loadGameDataFromDir(dataDir);
    expect(client.survival).not.toBeNull();
    expect(client.survival).toEqual(node.survival);
    expect(client.loadouts.map((l) => l.key)).toEqual(node.loadouts.map((l) => l.key));
  });
});

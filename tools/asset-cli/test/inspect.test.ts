// findSockets: the back socket falls back along the spine, in the order render uses for the back slot.
import { NodeIO } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { findSockets } from '../src/inspect.js';
import { makeHumanoid } from './fixtures.js';

const io = new NodeIO();

describe('findSockets', () => {
  it('puts the back socket on Spine2, or on Spine when the rig has only that', async () => {
    const doc = await io.readBinary(await makeHumanoid({ segments: 6, rings: 6 }));
    const node = (name: string) =>
      doc
        .getRoot()
        .listNodes()
        .find((n) => n.getName().endsWith(name))!;
    expect(findSockets(doc).back).toEqual(
      node('Spine2')
        .getWorldTranslation()
        .map((v) => Math.round(v * 1e6) / 1e6),
    );
    const spine = node('Spine'); // read before the renames: Spine1 and Spine2 also end in a digit, not in 'Spine'
    node('Spine1').setName('Chest_a');
    node('Spine2').setName('Chest_b');
    expect(findSockets(doc).back).toEqual(
      spine.getWorldTranslation().map((v) => Math.round(v * 1e6) / 1e6),
    );
  });
});

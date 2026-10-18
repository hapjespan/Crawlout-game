import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildingTypeId } from '@crawlout/data';
import { loadGameDataFromDir } from '@crawlout/data/node';
import { OWNER_NEUTRAL, type PlayerStatus, type ProjectStatus } from '@crawlout/protocol';
import {
  isProjectRuin,
  nearestRuin,
  projectAlerts,
  projectMinimap,
  projectView,
} from '../src/game/project.js';

// Win route C (client 0.11.0): PlayerStatus.project to the project panel, the minimap and the toasts.
const data = loadGameDataFromDir(fileURLToPath(new URL('../../../data', import.meta.url)));

function status(project: ProjectStatus | null, scrap = 1000): PlayerStatus {
  return { playerId: 0, scrap, project } as unknown as PlayerStatus;
}

const part = (
  k: number,
  kind: number,
  owner: number,
  state: 'ruin' | 'restoring' | 'restored',
) => ({
  partId: 100 + k,
  kind,
  x: 1000 * (k + 1),
  y: 500,
  state,
  owner,
  progressPermille: state === 'restored' ? 1000 : state === 'restoring' ? 400 : 0,
  hpPermille: 1000,
  underAttack: false,
});

const project = (parts: ReturnType<typeof part>[], ticks: [number, number] = [0, 0]) => ({
  kinds: 4,
  ticksRequired: 6000,
  parts,
  players: [
    { playerId: 0, kindsHeld: 0, ticksHeld: ticks[0], paused: false },
    { playerId: 1, kindsHeld: 4, ticksHeld: ticks[1], paused: false },
  ],
});

describe('Bouwproject in de client', () => {
  it('names the kinds from the data, shows own and enemy holds and offers a restore card', () => {
    const v = projectView(
      data,
      status(
        project([
          part(0, 0, 0, 'restoring'),
          part(1, 1, 1, 'restored'),
          part(2, 3, OWNER_NEUTRAL, 'ruin'),
        ]),
      ),
      () => 'AI',
      0,
      true,
    )!;
    expect(v.kinds.map((k) => k.naam)).toEqual([
      'Supermarkt',
      'Benzinestation',
      'Garage',
      'Watertoren',
    ]);
    expect(v.kinds[0]).toMatchObject({ mine: 'restoring', minePct: 40, canRestore: false });
    expect(v.kinds[1]).toMatchObject({ mine: 'none', enemy: 'restored' });
    expect(v.kinds[3]!.canRestore).toBe(true);
    expect(v.leader).toMatchObject({ name: 'AI', kindsHeld: 4 });
    expect(projectView(data, status(null), () => '', 0, true)).toBeNull();
  });

  it('marks the parts on the minimap and finds the nearest ruin for a card', () => {
    const st = status(project([part(0, 3, OWNER_NEUTRAL, 'ruin'), part(1, 3, 0, 'restored')]));
    expect(projectMinimap(st).map((p) => p.owner)).toEqual([null, 0]);
    const at = nearestRuin(data, st, 3, [{ x: 0, y: 0 }]);
    expect(at).toEqual({
      typeId: buildingTypeId(data.project.parts[3]!.ruinBuildingId),
      x: 1000,
      y: 500,
    });
    expect(isProjectRuin(data, at!.typeId)).toBe(true);
  });

  it('warns when an own part is lost or sabotaged and when a countdown starts', () => {
    const a = status(project([part(0, 0, 0, 'restored')]));
    const hit = { ...part(0, 0, 0, 'restored'), underAttack: true };
    expect(projectAlerts(data, a, status(project([hit])), 0)[0]!.text).toMatch(/Sabotage/);
    const lost = status(project([part(0, 0, OWNER_NEUTRAL, 'ruin')]));
    expect(projectAlerts(data, a, lost, 0)[0]!.text).toMatch(/verloren/);
    const count = status(project([part(0, 0, 0, 'restored')], [0, 20]));
    expect(projectAlerts(data, a, count, 0)[0]!.text).toMatch(/tegenstander/);
  });
});

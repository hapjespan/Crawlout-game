// Split from rigidUnits.test.ts to stay under the 5,000-token file limit.
import { describe, it, expect } from 'vitest';
import type { InterpolatedFrame } from '../snapshot/interpolate.js';
import {
  type PickShape,
  pickEntity,
  selectInRect,
  pickNearestOnScreen,
} from '../picking/selection.js';
import { ENTITY_FLAG } from '@crawlout/protocol';
import { Vector3 } from 'three/webgpu';
import { SYNTHETIC_ROBOT_TYPE_IDS } from '../dev/syntheticRobots.js';
import { drawsAsUnit } from '../entities/typeIds.js';
import {
  rigidManifest,
  DRONE_ID,
  GUARD_ID,
  SENTINEL_ID,
  FIXTURE_ID,
} from './testing/rigidFixture.js';
import { splitRigidEntries, parseRigidEntry } from './rigidUnitManifest.js';
import { manifestSchema } from '@crawlout/asset-cli/manifest';
import {
  DRONE_TYPE,
  GUARD_TYPE,
  SENTINEL_TYPE,
  camera,
  frameOf,
  robotLayer,
} from './rigidUnits.helpers.js';

describe('picking and selecting rigid units', () => {
  const { layer } = robotLayer();
  const shape = (frame: InterpolatedFrame) => (i: number, out: PickShape) =>
    layer.pickShape(frame.typeId[i]!, out);

  it('gives each robot a pick sphere that fits its size, a floating drone one up where it floats', () => {
    const out: PickShape = { radius: 0, height: 0 };
    layer.pickShape(GUARD_TYPE, out);
    expect(out.height).toBeCloseTo(1.1, 2);
    expect(out.radius).toBeGreaterThan(0.75); // larger than a 1.8 m human's
    layer.pickShape(SENTINEL_TYPE, out);
    expect(out.height).toBeCloseTo(1.75, 2);
    expect(out.radius).toBeGreaterThan(1.2);
    layer.pickShape(DRONE_TYPE, out);
    expect(out.height).toBeCloseTo(1.35 + 0.4, 2);
    expect(out.radius).toBeGreaterThanOrEqual(0.55); // small, but still clickable
    expect(layer.pickShape(1, out)).toBeNull();
  });

  it('picks the robot under a ray, where a floating drone really is, and not the empty air below it', () => {
    const frame = frameOf([
      { id: 7, typeId: DRONE_TYPE, x: 0, z: 0 },
      { id: 8, typeId: GUARD_TYPE, x: 5, z: 0 },
      { id: 9, typeId: SENTINEL_TYPE, x: 10, z: 0, flags: ENTITY_FLAG.dead },
    ]);
    const s = shape(frame);
    // A ray from the south at drone height hits the drone; one at ground level passes below it.
    expect(pickEntity(frame, 0, 1.75, 20, 0, 0, -1, s)).toBe(0);
    expect(pickEntity(frame, 0, 0.2, 20, 0, 0, -1, s)).toBe(-1);
    // Without the rigid shape the default unit sphere (center 0.9 m) would have taken the ground ray.
    expect(pickEntity(frame, 0, 0.9, 20, 0, 0, -1)).toBe(0);
    // A guard: center 1.1 m. A dead robot is not pickable.
    expect(pickEntity(frame, 5, 1.1, 20, 0, 0, -1, s)).toBe(1);
    expect(pickEntity(frame, 10, 1.75, 20, 0, 0, -1, s)).toBe(-1);
    // Along the row of robots the nearer hit wins (the drone, then the guard behind it).
    expect(pickEntity(frame, -5, 1.5, 0, 1, 0, 0, s)).toBe(0);
  });

  it('box-selects robots by where they are on screen, skips the dead and filters by owner', () => {
    const frame = frameOf([
      { id: 1, typeId: DRONE_TYPE, x: 0, z: 0, owner: 0 },
      { id: 2, typeId: GUARD_TYPE, x: 3, z: 0, owner: 0 },
      { id: 3, typeId: SENTINEL_TYPE, x: -3, z: 0, owner: 1 },
      { id: 4, typeId: GUARD_TYPE, x: 1.5, z: 1, owner: 0, flags: ENTITY_FLAG.dead },
      { id: 5, typeId: 1, x: 6, z: 0, owner: 0 }, // a humanoid, selectable too
    ]);
    const c = camera();
    c.updateMatrixWorld();
    const viewProj = c.projectionMatrix.clone().multiply(c.matrixWorldInverse).elements;
    const w = 1600;
    const h = 900;
    const everything = { x0: 0, y0: 0, x1: w, y1: h };
    const s = shape(frame);
    expect(selectInRect(frame, viewProj, w, h, everything, { shape: s }).sort()).toEqual([
      1, 2, 3, 5,
    ]);
    expect(selectInRect(frame, viewProj, w, h, everything, { shape: s, owner: 0 }).sort()).toEqual([
      1, 2, 5,
    ]);
    expect(
      selectInRect(frame, viewProj, w, h, everything, { shape: s, includeDead: true }).sort(),
    ).toEqual([1, 2, 3, 4, 5]);

    // A drone is selected through its floating center: a box around where its feet would be misses it.
    const project = (x: number, y: number, z: number) => {
      const v = new Vector3(x, y, z).project(c);
      return { sx: (v.x + 1) * 0.5 * w, sy: (1 - v.y) * 0.5 * h };
    };
    const floating = project(0, 1.75, 0);
    const feet = project(0, 0.9, 0);
    expect(feet.sy).toBeGreaterThan(floating.sy + 10); // the drone is drawn higher up the screen
    const around = (p: { sx: number; sy: number }) => ({
      x0: p.sx - 4,
      y0: p.sy - 4,
      x1: p.sx + 4,
      y1: p.sy + 4,
    });
    expect(selectInRect(frame, viewProj, w, h, around(floating), { shape: s })).toEqual([1]);
    expect(selectInRect(frame, viewProj, w, h, around(feet), { shape: s })).toEqual([]);
    expect(selectInRect(frame, viewProj, w, h, around(feet))).toEqual([1]); // the default center, for contrast
  });

  it('falls back to the nearest robot on screen for a click that just misses', () => {
    const frame = frameOf([{ id: 1, typeId: DRONE_TYPE, x: 0, z: 0 }]);
    const c = camera();
    const viewProj = c.projectionMatrix.clone().multiply(c.matrixWorldInverse).elements;
    const v = new Vector3(0, 1.75, 0).project(c);
    const sx = (v.x + 1) * 0.5 * 1600;
    const sy = (1 - v.y) * 0.5 * 900;
    expect(pickNearestOnScreen(frame, viewProj, 1600, 900, sx + 6, sy + 6, 16, shape(frame))).toBe(
      0,
    );
    expect(pickNearestOnScreen(frame, viewProj, 1600, 900, sx + 40, sy, 16, shape(frame))).toBe(-1);
  });

  it('keeps robots in the unit kind, so the sim ids it selects are the ones the HUD expects', () => {
    for (const t of Object.values(SYNTHETIC_ROBOT_TYPE_IDS)) expect(drawsAsUnit(t)).toBe(true);
  });
});

describe('rigid entries of the manifest', () => {
  it('takes the entries of kind rigid-unit out of the manifest, validated by the asset-cli schema', () => {
    const raw = rigidManifest();
    const { rest, rigid } = splitRigidEntries(raw);
    expect(manifestSchema.safeParse(rest).success).toBe(true);
    expect([...rigid.keys()].sort()).toEqual([DRONE_ID, GUARD_ID, SENTINEL_ID].sort());
    const drone = rigid.get(DRONE_ID)!;
    expect(drone).toMatchObject({ id: DRONE_ID, hover: 1.35, teamMaterials: ['Team_Plate'] });
    expect(typeof drone).toBe('object');
    expect(rigid.get(GUARD_ID)).toMatchObject({ hover: 0 });
    // The skinned character stays in the manifest.
    expect(manifestSchema.parse(rest).assets.map((a) => a.id)).toContain(FIXTURE_ID);
  });

  it('reports an unusable rigid entry as a reason, not as a broken manifest', () => {
    const raw = rigidManifest([{ id: GUARD_ID, height: 2.2 }]) as {
      assets: Record<string, unknown>[];
    };
    const guard = raw.assets.find((a) => a.id === GUARD_ID)!;
    const bad = (patch: Record<string, unknown>) => {
      const copy = {
        ...raw,
        assets: raw.assets.map((a) => (a.id === GUARD_ID ? { ...guard, ...patch } : a)),
      };
      return splitRigidEntries(copy).rigid.get(GUARD_ID);
    };
    expect(bad({ bounds: undefined })).toMatch(/bounds/);
    expect(bad({ lods: [] })).toMatch(/lods/);
    expect(bad({ hover: -1 })).toMatch(/hover/);
    expect(bad({ hover: 0.5 })).toMatch(/hover/); // not the model's lowest point (bounds.min.y)
    expect(bad({ teamMaterials: 'team' })).toMatch(/teamMaterials/);
    expect(bad({ teamMaterials: [] })).toMatch(/team-materiaal/);
    expect(bad({ bounds: { min: [0, 1, 0], max: [1, 1, 1] } })).toMatch(/height/);
    expect(parseRigidEntry({ ...guard, id: '' })).toMatch(/without an id/);
    // The kind alone says it is a robot; a character entry with the old flag is not one.
    const { rigid } = splitRigidEntries({
      ...raw,
      assets: raw.assets.map((a) =>
        a.id === GUARD_ID ? { ...guard, kind: 'character', rigid: true } : a,
      ),
    });
    expect(rigid.has(GUARD_ID)).toBe(false);
    expect(splitRigidEntries({ nonsense: true }).rest).toEqual({ nonsense: true });
  });
});

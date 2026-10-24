// Takes the ground penetration out of the ankle before anything lifts the whole body.
//
// Why this and not a bigger root lift. Measured on the donor's own `Walk_Loop`: around t = 0.83 s the toe bone's tail
// stands 72 mm below the floor, and the donor gets away with it because its bare toe mesh stops 82 mm short of that
// tail and is 49 mm tall. The heavy power armour's boot reaches 93 mm past the same tail and is 261 mm tall, so the
// identical bone pose drives its tip 130 mm through the floor. The weights are not wrong there - the boot tip really
// does belong to the toe - the foot is simply far bigger than the one the pose was animated for.
//
// Lifting the root for that is the wrong lever: it is a rigid translation of the whole body, so one pointed toe
// carries the hips, the head and the gun up with it, and it does so on one step and not on the other because the
// source cycle is not symmetric (the donor's own skin reaches -26.4 mm on the left swing and -7.1 mm on the right).
// Measured on the heavy power armour that turned 65.9 mm of hip travel into 105.8 mm and a 9.8 mm per-frame step into
// 38.4 mm: a visible limp.
//
// The penetration belongs to the ankle, so it is paid there. The offending foot is pitched up around its own lateral
// axis - toes up, the one thing an ankle does - by the smallest angle that clears the floor. The toe joint is a child
// and follows rigidly, so an armoured boot keeps its shape, and nothing above the ankle moves at all. Each leg is
// judged on its own sampler (the vertices that only its ankle subtree drives), so relieving the swing leg never
// disturbs the planted one and a leg that is already clear is never touched. When even `maxDegrees` does not clear
// the floor the lowest point is not the foot - the kneeling shin of `build`, the hip of `death` - and the ankle is
// put back exactly where the clip had it, leaving the root lift behind this step to deal with the remainder.
import type { Document, Node, Skin } from '@gltf-transform/core';
import { createGroundSampler } from './ground.js';
import {
  cross,
  normalize3,
  quatFromAxisAngle,
  quatInvert,
  quatMultiply,
  rotationOf,
  sub3,
  type Mat,
  type Pose,
  type Quat,
  type Vec3,
} from './math.js';

/** Bisection steps on the angle; 7 puts it within 1/128 of the smallest rotation that clears the ground. */
const STEPS = 7;
/** Ternary-search steps for the angle at which the foot stands highest; 12 narrows the range to 1 percent. */
const PEAK_STEPS = 12;
/** How far an ankle may be pitched up. A human ankle dorsiflexes about 20 degrees; this is deliberately generous. */
const MAX_DEGREES = 60;

export interface AnkleRelief {
  /** The ankle joints this may rotate; the caller has to write their new value into the clip. */
  readonly bones: readonly Node[];
  /** Pitches up the ankles that stand below `groundY`, in place. Returns the largest angle used, in degrees. */
  settle(pose: Map<Node, Pose>, groundY: number): number;
}

interface Leg {
  ankle: Node;
  toe: Node | undefined;
  lowestY: (jointWorld: readonly Mat[]) => number;
}

const position = (m: Mat): Vec3 => [m[12]!, m[13]!, m[14]!];

/**
 * Builds the relief over the first skin of `document`. Returns null when neither ankle can be found or neither has
 * geometry of its own, so a skeleton without feet simply keeps the old behaviour.
 */
export function createAnkleRelief(
  document: Document,
  skin: Skin,
  byName: ReadonlyMap<string, Node>,
  worldMatrices: (overrides: ReadonlyMap<Node, Pose>) => (node: Node) => Mat,
  maxDegrees: number = MAX_DEGREES,
): AnkleRelief | null {
  const joints = skin.listJoints();
  const legs: Leg[] = [];
  for (const side of ['Left', 'Right']) {
    const ankle = byName.get(`${side}Foot`);
    if (!ankle) continue;
    // Limited to the ankle's subtree, so this sampler sees one foot and nothing else.
    const sampler = createGroundSampler(document, skin, ankle);
    if (!sampler) continue;
    legs.push({ ankle, toe: byName.get(`${side}ToeBase`), lowestY: sampler.lowestY });
  }
  if (legs.length === 0) return null;
  const limit = (maxDegrees * Math.PI) / 180;

  const settle = (pose: Map<Node, Pose>, groundY: number): number => {
    let worst = 0;
    for (const leg of legs) {
      const entry = pose.get(leg.ankle);
      if (!entry) continue;
      const posed = entry.r;
      const world = worldMatrices(pose);
      const ankleWorld = world(leg.ankle);
      // Toes up is a turn around the foot's own lateral axis: across its forward direction and the world up.
      const forward = leg.toe
        ? sub3(position(world(leg.toe)), position(ankleWorld))
        : ([0, 0, 1] as Vec3);
      // cross(forward, up), not the other way round: a positive turn around it carries the toe up, not down.
      const axis = normalize3(cross(forward, [0, 1, 0]));
      if (!Number.isFinite(axis[0])) continue;
      const parent = leg.ankle.getParentNode();
      const toLocal = parent ? quatInvert(rotationOf(world(parent)).q) : ([0, 0, 0, 1] as Quat);
      const worldRotation = rotationOf(ankleWorld).q;

      const lowestAt = (angle: number): number => {
        entry.r =
          angle <= 0
            ? posed
            : quatMultiply(
                toLocal,
                quatMultiply(quatFromAxisAngle(axis, angle), worldRotation),
              );
        return leg.lowestY(joints.map(worldMatrices(pose)));
      };
      const base = lowestAt(0);
      if (base >= groundY) continue;
      // Turning the toe up presses the heel down, so the foot's lowest point rises to a peak and then falls again.
      // Find that peak first (ternary search over a single-peaked curve) instead of assuming more is always better.
      let low = 0;
      let high = limit;
      for (let i = 0; i < PEAK_STEPS; i++) {
        const a = low + (high - low) / 3;
        const b = high - (high - low) / 3;
        if (lowestAt(a) < lowestAt(b)) low = a;
        else high = b;
      }
      let best = (low + high) / 2;
      const peak = lowestAt(best);
      if (peak <= base) {
        // The foot is not what is below the floor (a kneeling shin, a fallen hip): leave the clip alone.
        lowestAt(0);
        continue;
      }
      if (peak >= groundY) {
        // It clears well before the peak; take the smallest turn that does, so the pose changes as little as it can.
        let clear = best;
        let through = 0;
        for (let i = 0; i < STEPS; i++) {
          const middle = (through + clear) / 2;
          if (lowestAt(middle) >= groundY) clear = middle;
          else through = middle;
        }
        best = clear;
      }
      lowestAt(best);
      worst = Math.max(worst, (best * 180) / Math.PI);
    }
    return worst;
  };

  return { bones: legs.map((leg) => leg.ankle), settle };
}

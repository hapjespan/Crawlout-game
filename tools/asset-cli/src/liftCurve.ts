// Turns the per-frame root lift the ground constraint asks for into a curve a body can actually travel along.
//
// The raw ask is spiky. Measured on the heavy power armour's `walk` after the ankle relief: 0 mm over most of the
// cycle, a broad 29 mm hill around each rear swing, and a single frame at 43.3 mm where one boot corner still
// catches. Feeding that straight to the root is what made the character limp: the hips jumped 43 mm between two
// frames, and the two mirrored steps were asked for 43 mm and 29 mm, so one leg pushed the body higher than the
// other.
//
// The fix is not to cap the lift - a cap leaves `build` 228 mm in the floor - but to limit how fast it may change.
// `rateLimited` returns the smallest curve that still covers every frame and never changes by more than `slope`
// between neighbours. A narrow spike is therefore paid for by its neighbours as well, which both removes the jump
// and evens out the two steps; a slow, wide ask like the kneeling of `build` passes through almost untouched,
// because it never changes faster than the limit anyway. The price is hover: a frame that needed nothing is lifted
// along with its neighbours, by at most `slope` per frame of distance.
//
// Looping clips wrap, so the ramp around a spike near the end of the cycle continues at the start. The exported clip
// repeats frame 0 as its last keyframe, so the cycle is the first `n - 1` frames and the last one is a copy.

// Largest change in the lift between two neighbouring frames, in metres. Measured over the four local characters at
// 0.1, 0.5, 1 and 2 mm per frame: 0.5 mm (15 mm/s at 30 fps, a twentieth of the 9.8 mm per frame the heavy power
// armour's hips already travel on their own) costs 5 mm of extra hip travel on the two heavy bodies and nothing on
// the two light ones, while 2 mm costs 7 mm on the power armour and 18 mm on the warlord and buys only 1.6 mm less
// bob. Below 0.5 mm the lift is in effect one constant per cycle and the bob stops improving.
export const DEFAULT_SLOPE = 0.0005;

/**
 * Smallest curve `out >= required` whose neighbouring values differ by at most `slope`. With `loop`, frame 0 and
 * frame n-2 count as neighbours and the last frame is kept equal to the first.
 */
export function rateLimited(
  required: readonly number[],
  slope: number,
  loop: boolean,
): number[] {
  const out = [...required];
  const n = out.length;
  if (n === 0 || !(slope > 0)) return out;
  // A cycle is the first n-1 frames; the duplicate last frame follows frame 0 at the end.
  const last = loop && n > 2 ? n - 1 : n;
  // Two sweeps each way: with a wrap a ramp can travel once around the cycle before everything has settled.
  for (let pass = 0; pass < (loop ? 2 : 1); pass++) {
    for (let i = 1; i < last; i++) out[i] = Math.max(out[i]!, out[i - 1]! - slope);
    if (loop && last > 1) out[0] = Math.max(out[0]!, out[last - 1]! - slope);
    for (let i = last - 2; i >= 0; i--) out[i] = Math.max(out[i]!, out[i + 1]! - slope);
    if (loop && last > 1) out[last - 1] = Math.max(out[last - 1]!, out[0]! - slope);
  }
  if (last < n) for (let i = last; i < n; i++) out[i] = out[0]!;
  return out;
}

/** Whether the first and last keyframe hold the same pose, within `epsilon` per component. */
export function isLoop(channels: Iterable<readonly number[]>, epsilon = 1e-3): boolean {
  let seen = false;
  for (const values of channels) {
    if (values.length < 8) continue;
    seen = true;
    for (let i = 0; i < 4; i++)
      if (Math.abs(values[i]! - values[values.length - 4 + i]!) > epsilon) return false;
  }
  return seen;
}

// Expands the `repeat` and `mirror` fields of generator parts into plain parts, so a config states a wheel, a rivet row or
// a symmetric arm once. Pure and deterministic: copy i of a repeat sits at position + i * step, the mirror copy of a part
// is the same part reflected in the plane x = 0 (position, rotation, and the asymmetric parts: a prism profile, a tube,
// the open end of a track).
import type { VariantPart } from './variants.js';

type Plain = VariantPart;

/** The part reflected in x = 0. A reflection of R = Ry Rx Rz is Ry(-y) Rx(x) Rz(-z). */
function mirrored(part: Plain): Plain {
  const out = {
    ...part,
    position: [-part.position[0], part.position[1], part.position[2]] as [number, number, number],
  } as Plain;
  if (part.rotation)
    out.rotation = [part.rotation[0], -part.rotation[1], -part.rotation[2]] as [
      number,
      number,
      number,
    ];
  if (out.type === 'prism') {
    // Profile (x, z) of axis y and (x, y) of axis z flip in their first coordinate; axis x has (z, y): unchanged, but
    // its extrusion runs along x, so the near and far ends swap.
    const axis = out.axis ?? 'y';
    if (axis !== 'x') out.profile = out.profile.map(([a, b]) => [-a, b] as [number, number]);
    else out.caps = swapCaps(out.caps);
  } else if (out.type === 'track') out.caps = swapCaps(out.caps);
  else if (out.type === 'tube')
    out.points = out.points.map(([x, y, z]) => [-x, y, z] as [number, number, number]);
  return out;
}

function swapCaps(caps: 'both' | 'start' | 'end' | 'none' | undefined): typeof caps {
  if (caps === 'start') return 'end';
  if (caps === 'end') return 'start';
  return caps;
}

/** Resolves `repeat` first (copies along `step`), then `mirror` on every copy; the helper fields are dropped. */
export function expandParts(parts: readonly VariantPart[]): VariantPart[] {
  const result: VariantPart[] = [];
  for (const part of parts) {
    const { repeat, mirror, ...rest } = part;
    const count = repeat?.count ?? 1;
    for (let i = 0; i < count; i++) {
      const step = repeat?.step ?? [0, 0, 0];
      const copy = {
        ...rest,
        position: [
          part.position[0] + step[0] * i,
          part.position[1] + step[1] * i,
          part.position[2] + step[2] * i,
        ] as [number, number, number],
      } as Plain;
      result.push(copy);
      if (mirror && Math.abs(copy.position[0]) > 1e-9) result.push(mirrored(copy));
    }
  }
  return result;
}

// ?lodpx=trees:280,100;props:120,50;units:72,30;buildings:140,60: screen-size LOD thresholds per layer (projected height in
// device px under which LOD 1 and LOD 2 draw) for tuning and measuring; layers left out keep their defaults.
import type { CreateRendererOptions } from '@crawlout/render';

type LodPixels = NonNullable<CreateRendererOptions['lodPixels']>;
const LAYERS = ['units', 'buildings', 'props', 'trees'] as const;

/** The `lodPixels` renderer option from the URL, or undefined without (or with only malformed) ?lodpx. */
export function lodPixelsParam(params: URLSearchParams): LodPixels | undefined {
  const raw = params.get('lodpx');
  if (!raw) return undefined;
  const out: LodPixels = {};
  for (const part of raw.split(';')) {
    const [layer, values] = part.split(':');
    const [lod1, lod2] = (values ?? '').split(',').map(Number);
    if (!(LAYERS as readonly string[]).includes(layer ?? '')) continue;
    if (!Number.isFinite(lod1) || !Number.isFinite(lod2)) continue;
    out[layer as (typeof LAYERS)[number]] = { lod1: lod1!, lod2: lod2! };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

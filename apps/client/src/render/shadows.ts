// Sun shadow quality from the URL: ?shadows=0 turns the real shadow off (blob decals only), ?shadows=high or ?shadows=low
// pick a quality, and ?detail=1 (the cheaper path) goes without shadows. Anything else leaves it to the renderer, which
// takes high on WebGPU and low on the WebGL2 fallback (defaultShadowQuality). The render demo's older ?noshadow still works.
import type { ShadowQuality } from '@crawlout/render';

export function shadowOption(params: URLSearchParams): boolean | ShadowQuality {
  const s = params.get('shadows');
  if (s === '0' || s === 'off' || params.has('noshadow')) return false;
  if (s === 'low' || s === 'high') return s;
  if (params.get('detail') === '1') return false;
  return true;
}

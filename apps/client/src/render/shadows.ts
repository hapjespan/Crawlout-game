// Sun shadow quality from the URL: ?shadows=0 turns the real shadow off (blob decals only), ?shadows=low or ?detail=1
// takes the low setting (2048 map, shorter distance, small props do not cast), anything else the default (high).
// The render demo's older ?noshadow still works.
import type { ShadowQuality } from '@crawlout/render';

export function shadowOption(params: URLSearchParams): false | ShadowQuality {
  const s = params.get('shadows');
  if (s === '0' || s === 'off' || params.has('noshadow')) return false;
  if (s === 'low' || params.get('detail') === '1') return 'low';
  return 'high';
}

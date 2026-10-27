// How the page starts: with the splash and menu, or straight into a match from URL parameters (the shortcuts that the
// browser tests in tools/replay and the earlier links use). Pure, so the rules are tested without a browser.

/** Parameters that name a match and so bypass the menu: `?relay=` (ws lobby), `?ai=1`, `?faction=`, `?aifaction=`. */
const MATCH_PARAMS = ['relay', 'ai', 'faction', 'aifaction'] as const;

export type StartMode =
  /** Splash, then the main menu (the normal start). */
  | 'splash'
  /** The main menu without the splash (`?menu=1`, `?splash=0`, and "Terug naar menu" after a match). */
  | 'menu'
  /** No menu: the match starts from the URL, as before the menu existed. */
  | 'match';

/**
 * `?skip=1` or `?play=ai` start a loopback match at once (`?play=` with any other value is ignored); any match parameter
 * does too. `?menu=1` or `?splash=0` open the main menu directly. Otherwise the splash comes first.
 */
export function startMode(params: URLSearchParams): StartMode {
  if (params.get('skip') === '1' || params.get('play') === 'ai') return 'match';
  if (MATCH_PARAMS.some((k) => params.has(k))) return 'match';
  if (params.get('menu') === '1' || params.get('splash') === '0') return 'menu';
  return 'splash';
}

/** The URL of the menu for "Terug naar menu": this page, no parameters except the ones that are not about a match. */
export function menuUrl(location: { pathname: string; search: string }): string {
  const keep = new URLSearchParams();
  const old = new URLSearchParams(location.search);
  // Presentation options survive; everything about the match itself does not.
  for (const k of [
    'webgl',
    'warmdraw',
    'noskin',
    'shadows',
    'noshadow',
    'detail',
    'lodpx',
    'hudscale',
    'fog',
    'unit',
  ])
    if (old.has(k)) keep.set(k, old.get(k)!);
  keep.set('menu', '1');
  return `${location.pathname}?${keep.toString()}`;
}

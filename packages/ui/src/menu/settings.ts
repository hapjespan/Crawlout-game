/**
 * Menu settings (Instellingen): shadow quality, detail, HUD size, HUD skin and a sound placeholder. They live in
 * localStorage and turn into the URL options the client already reads (`?shadows=`, `?lodpx=`, `?noskin`, `?hudscale=`):
 * an option that is in the URL always wins, so a link like `?shadows=0` keeps working as a shortcut for tests and
 * measurements. Pure functions only; the store takes a minimal Storage so tests need no DOM.
 */

export const SHADOW_CHOICES = ['auto', 'high', 'low', 'off'] as const;
export type ShadowSetting = (typeof SHADOW_CHOICES)[number];
export const DETAIL_CHOICES = ['high', 'normal', 'low'] as const;
export type DetailSetting = (typeof DETAIL_CHOICES)[number];
export const HUD_SCALE_CHOICES = ['small', 'normal', 'large', 'xlarge'] as const;
export type HudScaleSetting = (typeof HUD_SCALE_CHOICES)[number];

export interface MenuSettings {
  shadows: ShadowSetting;
  detail: DetailSetting;
  hudScale: HudScaleSetting;
  /** The dev-only bitmap skin; without local art this has no effect (production always has the CSS look). */
  hudSkin: boolean;
  /** Placeholder: the game has no audio yet, the choice is only kept. */
  sound: boolean;
}

export const DEFAULT_SETTINGS: Readonly<MenuSettings> = {
  shadows: 'auto',
  detail: 'normal',
  hudScale: 'normal',
  hudSkin: true,
  sound: true,
};

/** HUD_SCALE of units.ts per choice: "normal" is the 0.64 the HUD was tuned for. */
export const HUD_SCALE_VALUE: Readonly<Record<HudScaleSetting, number>> = {
  small: 0.52,
  normal: 0.64,
  large: 0.8,
  xlarge: 0.96,
};

/** Screen-size LOD thresholds (renderer defaults: units 72/30, buildings 140/60, props 120/50, trees 280/100) times a factor. */
const LOD_DEFAULTS = {
  trees: [280, 100],
  props: [120, 50],
  units: [72, 30],
  buildings: [140, 60],
} as const;
const DETAIL_FACTOR: Readonly<Record<DetailSetting, number>> = { high: 0.65, normal: 1, low: 1.6 };

export const SETTINGS_KEY = 'crawlout.settings.v1';

const oneOf = <T extends string>(list: readonly T[], value: unknown, fallback: T): T =>
  typeof value === 'string' && (list as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

/** Anything that is not a valid settings object (missing, old or hand-edited storage) falls back per field. */
export function normalizeSettings(raw: unknown): MenuSettings {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    shadows: oneOf(SHADOW_CHOICES, o['shadows'], DEFAULT_SETTINGS.shadows),
    detail: oneOf(DETAIL_CHOICES, o['detail'], DEFAULT_SETTINGS.detail),
    hudScale: oneOf(HUD_SCALE_CHOICES, o['hudScale'], DEFAULT_SETTINGS.hudScale),
    hudSkin: typeof o['hudSkin'] === 'boolean' ? o['hudSkin'] : DEFAULT_SETTINGS.hudSkin,
    sound: typeof o['sound'] === 'boolean' ? o['sound'] : DEFAULT_SETTINGS.sound,
  };
}

/** Minimal Storage shape (localStorage fits). */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadSettings(storage: SettingsStorage | null): MenuSettings {
  try {
    const text = storage?.getItem(SETTINGS_KEY);
    return normalizeSettings(text ? JSON.parse(text) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Returns false when the storage refused (private window, quota); the settings then only last for this page. */
export function saveSettings(storage: SettingsStorage | null, settings: MenuSettings): boolean {
  try {
    if (!storage) return false;
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

/** `?lodpx=` value for a detail choice; null for "normal" (the renderer's own defaults). */
export function lodPixelsFor(detail: DetailSetting): string | null {
  if (detail === 'normal') return null;
  const f = DETAIL_FACTOR[detail];
  return Object.entries(LOD_DEFAULTS)
    .map(([layer, [a, b]]) => `${layer}:${Math.round(a * f)},${Math.round(b * f)}`)
    .join(';');
}

/**
 * The URL options the client reads, with the settings filled in for everything the URL does not say itself.
 * Returns a new URLSearchParams; the URL's own options are never overridden.
 */
export function effectiveParams(url: URLSearchParams, settings: MenuSettings): URLSearchParams {
  const out = new URLSearchParams(url);
  const fill = (key: string, value: string | null): void => {
    if (value !== null && !out.has(key)) out.set(key, value);
  };
  if (settings.shadows !== 'auto')
    fill('shadows', settings.shadows === 'off' ? '0' : settings.shadows);
  fill('lodpx', lodPixelsFor(settings.detail));
  if (!settings.hudSkin) fill('noskin', '1');
  if (settings.hudScale !== 'normal') fill('hudscale', String(HUD_SCALE_VALUE[settings.hudScale]));
  return out;
}

/** The HUD size from `?hudscale=` (0.4 to 1.2), or null for the default. */
export function hudScaleFromParams(params: URLSearchParams): number | null {
  const raw = params.get('hudscale');
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0.4 && n <= 1.2 ? n : null;
}

/** Dutch labels for the settings screen. */
export const SETTING_LABELS = {
  shadows: { auto: 'Automatisch', high: 'Hoog', low: 'Laag', off: 'Uit' },
  detail: { high: 'Hoog', normal: 'Normaal', low: 'Zuinig' },
  hudScale: { small: 'Klein', normal: 'Normaal', large: 'Groot', xlarge: 'Extra groot' },
} as const;

/** Which settings need a fresh page to take effect (the renderer reads them once at start). */
export function needsReload(a: MenuSettings, b: MenuSettings): boolean {
  return a.shadows !== b.shadows || a.detail !== b.detail;
}

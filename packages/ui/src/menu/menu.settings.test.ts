import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  effectiveParams,
  hudScaleFromParams,
  loadSettings,
  lodPixelsFor,
  needsReload,
  normalizeSettings,
  saveSettings,
  type SettingsStorage,
} from './settings.js';

const memory = (
  initial: Record<string, string> = {},
): SettingsStorage & { data: Record<string, string> } => {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
};

describe('menu settings', () => {
  it('falls back to the defaults for missing, broken or old storage', () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(memory())).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(memory({ [SETTINGS_KEY]: '{not json' }))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(memory({ [SETTINGS_KEY]: '[1,2]' }))).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid fields and drops invalid ones per field', () => {
    const s = normalizeSettings({
      shadows: 'off',
      detail: 'ultra',
      hudScale: 'large',
      hudSkin: 'ja',
      sound: false,
    });
    expect(s).toEqual({ ...DEFAULT_SETTINGS, shadows: 'off', hudScale: 'large', sound: false });
  });

  it('saves and loads what was chosen', () => {
    const store = memory();
    const chosen = { ...DEFAULT_SETTINGS, shadows: 'low', detail: 'low', hudSkin: false } as const;
    expect(saveSettings(store, chosen)).toBe(true);
    expect(loadSettings(store)).toEqual(chosen);
  });

  it('survives storage that throws or is missing', () => {
    const broken: SettingsStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(broken, DEFAULT_SETTINGS)).toBe(false);
    expect(saveSettings(null, DEFAULT_SETTINGS)).toBe(false);
  });

  it('leaves the URL alone for the defaults', () => {
    expect(effectiveParams(new URLSearchParams('?webgl=1'), DEFAULT_SETTINGS).toString()).toBe(
      'webgl=1',
    );
  });

  it('turns settings into the options the client already reads', () => {
    const p = effectiveParams(new URLSearchParams(), {
      shadows: 'off',
      detail: 'low',
      hudScale: 'large',
      hudSkin: false,
      sound: true,
    });
    expect(p.get('shadows')).toBe('0');
    expect(p.get('lodpx')).toBe('trees:448,160;props:192,80;units:115,48;buildings:224,96');
    expect(p.get('noskin')).toBe('1');
    expect(p.get('hudscale')).toBe('0.8');
    expect(
      effectiveParams(new URLSearchParams(), { ...DEFAULT_SETTINGS, shadows: 'high' }).get(
        'shadows',
      ),
    ).toBe('high');
  });

  it('never overrides an option that is in the URL', () => {
    const p = effectiveParams(
      new URLSearchParams('?shadows=low&noskin=0&lodpx=units:1,1&hudscale=1'),
      {
        shadows: 'off',
        detail: 'low',
        hudScale: 'small',
        hudSkin: false,
        sound: true,
      },
    );
    expect(p.get('shadows')).toBe('low');
    expect(p.get('noskin')).toBe('0');
    expect(p.get('lodpx')).toBe('units:1,1');
    expect(p.get('hudscale')).toBe('1');
  });

  it('detail "normal" is the renderer default, and high keeps more detail than low', () => {
    expect(lodPixelsFor('normal')).toBeNull();
    expect(lodPixelsFor('high')).toBe('trees:182,65;props:78,33;units:47,20;buildings:91,39');
  });

  it('reads and bounds ?hudscale', () => {
    expect(hudScaleFromParams(new URLSearchParams('hudscale=0.8'))).toBe(0.8);
    expect(hudScaleFromParams(new URLSearchParams('hudscale=9'))).toBeNull();
    expect(hudScaleFromParams(new URLSearchParams('hudscale=x'))).toBeNull();
    expect(hudScaleFromParams(new URLSearchParams())).toBeNull();
  });

  it('asks for a reload only for what the renderer reads once', () => {
    expect(needsReload(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, shadows: 'off' })).toBe(true);
    expect(needsReload(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, detail: 'low' })).toBe(true);
    expect(
      needsReload(DEFAULT_SETTINGS, {
        ...DEFAULT_SETTINGS,
        hudScale: 'large',
        hudSkin: false,
        sound: false,
      }),
    ).toBe(false);
  });
});

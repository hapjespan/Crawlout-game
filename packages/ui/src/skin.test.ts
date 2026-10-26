import { afterEach, describe, expect, it } from 'vitest';
import { mountHud } from './index.js';
import { HUD_LOOK_CSS, HUD_TOKENS_CSS } from './look.js';
import { hudSkinCss, skinComplete } from './skin.js';
import type { HudSkin } from './skin.js';
import { HUD_CSS } from './styles.js';
import type { HudDeps } from './index.js';

const frame = (file: string) => ({ file, w: 60, h: 60, slice: [28, 28, 28, 28] as const });
const skin = (omitFile?: string): HudSkin => {
  const frames = {
    'frame-plate': frame('frame-plate.png'),
    'btn-normal': frame('btn-normal.png'),
  };
  const tiles = { 'plate-rust': { file: 'plate-rust.png', w: 770, h: 300 } };
  const urls: Record<string, string> = {};
  for (const f of [...Object.values(frames), ...Object.values(tiles)]) {
    if (f.file !== omitFile) urls[f.file] = `/@fs/local/${f.file}`;
  }
  return { manifest: { version: 1, frames, tiles }, urls };
};

const deps: HudDeps = {
  sendCommand: () => undefined,
  getStatus: () => null,
  getSelection: () => [],
  beginTargeting: () => undefined,
  startCard: () => undefined,
};

describe('HUD look (committed, bitmap-free)', () => {
  it('defines the Roest en Fosfor tokens under .co-hud', () => {
    for (const t of [
      '--plate-900',
      '--plate-600',
      '--edge-dark',
      '--ink',
      '--phos-500',
      '--amber-500',
      '--amber-780',
    ]) {
      expect(HUD_TOKENS_CSS).toContain(`${t}:`);
    }
    expect(HUD_CSS).toContain(HUD_TOKENS_CSS);
    expect(HUD_CSS).toContain(HUD_LOOK_CSS);
  });

  it('draws the fallback without any bitmap', () => {
    expect(HUD_CSS).not.toMatch(/url\(/);
    expect(HUD_CSS).toContain('repeating-linear-gradient');
  });

  it('keeps text at 11px or larger', () => {
    // Every font size is either a fixed size of 11px or more, or a unit size under a max(11px, ...) floor.
    const sizes = [
      ...HUD_CSS.matchAll(/font(?:-size)?:\s*(?:[a-z0-9 ]+ )?(max\(11px|\d+(?:\.\d+)?px)/g),
    ].map((m) => (m[1] === 'max(11px' ? 11 : Number(m[1]?.replace('px', ''))));
    expect(sizes.length).toBeGreaterThan(10);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(11);
    // No bare font-size in px that could go under the floor.
    expect(HUD_CSS).not.toMatch(/font-size:\s*(?:[1-9]|10)(?:\.\d+)?px/);
  });

  it('never blinks faster than 3 Hz', () => {
    const durations = [...HUD_CSS.matchAll(/animation:[^;}]*?(\d*\.?\d+)s/g)].map((m) =>
      Number(m[1]),
    );
    expect(durations.length).toBeGreaterThan(0);
    for (const d of durations) expect(1 / d).toBeLessThanOrEqual(3);
  });
});

describe('HUD bitmap skin (dev only)', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('builds 9-slice border-image CSS scoped to the skin attribute', () => {
    const css = hudSkinCss(skin());
    expect(css).toContain('[data-co-skin="bitmap"] .co-hud .co-commands');
    expect(css).toContain(
      'border-image:url("/@fs/local/frame-plate.png") 28 28 28 28/calc(var(--u) * 8)/0 stretch',
    );
    expect(css).toContain('url("/@fs/local/plate-rust.png")');
  });

  it('lays the console regions, portraits and icons over the layout boxes', () => {
    const full = skin();
    const images = {
      'region-console': { file: 'region-console.png', w: 668, h: 248 },
      'portrait-4': { file: 'portrait-4.png', w: 123, h: 126 },
      'icon-move': { file: 'icon-move.png', w: 105, h: 60 },
      'icon-build': { file: 'icon-build.png', w: 116, h: 116 },
    };
    const urls = { ...full.urls };
    for (const i of Object.values(images)) urls[i.file] = `/@fs/local/${i.file}`;
    const css = hudSkinCss({ manifest: { ...full.manifest, images }, urls });
    expect(css).toContain('.co-console{background-image:url("/@fs/local/region-console.png")');
    expect(css).toContain('[data-portrait="4"]{background-image:url("/@fs/local/portrait-4.png")');
    expect(css).toContain(
      '[data-action="move"] .co-btn-icon{background-image:url("/@fs/local/icon-move.png")',
    );
    // A picture the manifest names but the page cannot load makes the skin incomplete: the CSS look stays.
    const missing = { ...urls };
    delete missing['portrait-4.png'];
    expect(hudSkinCss({ manifest: { ...full.manifest, images }, urls: missing })).toBe('');
  });

  it('gives an empty skin when a crop is missing, so the CSS look stays', () => {
    expect(skinComplete(skin())).toBe(true);
    expect(skinComplete(skin('btn-normal.png'))).toBe(false);
    expect(hudSkinCss(skin('btn-normal.png'))).toBe('');
  });

  it('mountHud sets the skin attribute and style only when it is given a skin', () => {
    const plain = document.createElement('div');
    document.body.appendChild(plain);
    const h1 = mountHud(plain, deps);
    expect(plain.hasAttribute('data-co-skin')).toBe(false);
    expect(document.getElementById('co-hud-skin-style')).toBeNull();
    h1.unmount();

    const skinned = document.createElement('div');
    document.body.appendChild(skinned);
    const h2 = mountHud(skinned, deps, { skin: skin() });
    expect(skinned.getAttribute('data-co-skin')).toBe('bitmap');
    expect(document.getElementById('co-hud-skin-style')?.textContent).toContain('border-image');
    h2.unmount();
    expect(skinned.hasAttribute('data-co-skin')).toBe(false);
  });
});

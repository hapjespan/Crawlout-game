import { m } from './menu/styles.js';
import { px, u } from './units.js';

/**
 * Optional bitmap skin (dev only). The client hands over the manifest and the served URLs of the local HUD crops
 * (apps/client/src/ui/hudSkin.ts, which only exists in dev); this turns them into CSS that lays the designer's console art
 * over the committed fallback look (look.ts): the console regions of the mockup as backgrounds of the boxes the layout
 * already has, 9-slice frames for the panels, portraits and drawings as images. Without a skin nothing here runs and the
 * HUD keeps the CSS-only look.
 *
 * The art is a local-only asset (see tools/hud-art/crop.mjs): nothing in this file names or embeds a bitmap, and the
 * selectors only apply below `[data-co-skin="bitmap"]`, which `mountHud` sets when it is given a skin.
 */

export type SliceInsets = readonly [number, number, number, number];

export interface HudSkinFrame {
  file: string;
  w: number;
  h: number;
  /** 9-slice insets in image pixels: top, right, bottom, left. */
  slice: SliceInsets;
}

export interface HudSkinTile {
  file: string;
  w: number;
  h: number;
  /** Repeat period in px for stripe tiles. */
  period?: number;
}

/** A plain picture (console region, portrait, icon). */
export interface HudSkinImage {
  file: string;
  w: number;
  h: number;
}

export interface HudSkinManifest {
  version: number;
  frames: Record<string, HudSkinFrame>;
  tiles: Record<string, HudSkinTile>;
  /** Console regions (`region-*`), portraits (`portrait-*`), icons (`icon-*`) and the like; absent in older manifests. */
  images?: Record<string, HudSkinImage>;
}

export interface HudSkin {
  manifest: HudSkinManifest;
  /** Crop file name (`frame-plate.png`) to the URL the page can load it from. */
  urls: Readonly<Record<string, string>>;
}

export const SKIN_ATTR = 'data-co-skin';
export const SKIN_VALUE = 'bitmap';

const SCOPE = `[${SKIN_ATTR}="${SKIN_VALUE}"] .co-hud`;

/** True when every crop the CSS needs is present. A partial folder falls back to the CSS look instead of breaking. */
export function skinComplete(skin: HudSkin): boolean {
  const need = [
    ...Object.values(skin.manifest.frames),
    ...Object.values(skin.manifest.tiles),
    ...Object.values(skin.manifest.images ?? {}),
  ];
  return need.length > 0 && need.every((f) => typeof skin.urls[f.file] === 'string');
}

/** Portraits cut from the Recruits sheet: `portrait-1` .. `portrait-11`, plus `portrait-robot`. */
const PORTRAIT_IDS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', 'robot'] as const;

/** Which command action shows which drawing (the green icons of the command sheet). */
const ACTION_ICONS: Record<string, string> = {
  move: 'icon-move',
  stop: 'icon-stop',
  attackMove: 'icon-attack',
  gather: 'icon-gather',
  build: 'icon-build',
  roleScavenger: 'portrait-4',
  roleBuilder: 'portrait-3',
  roleMilitia: 'portrait-5',
};

/** Which build option shows which drawing; see `buildingIcon` in view.ts. */
const BUILD_ICONS: Record<string, string> = {
  home: 'icon-home',
  turret: 'icon-turret',
  factory: 'icon-factory',
  build: 'icon-build',
};

/** The small helpers both the HUD skin and the menu skin build their CSS from. */
function skinTools(skin: HudSkin) {
  const { frames, tiles } = skin.manifest;
  const images = skin.manifest.images ?? {};
  const url = (file: string): string => `url("${skin.urls[file] ?? ''}")`;
  /** border + border-image for a 9-slice frame drawn `w` thick (a number is an old px size, scaled like the rest of the HUD; a string a CSS length). */
  const frame = (name: string, w: number | string): string => {
    const f = frames[name];
    if (!f) return '';
    const width = typeof w === 'number' ? px(w) : w;
    return `border:${width} solid transparent;border-radius:0;border-image:${url(f.file)} ${f.slice.join(' ')}/${width}/0 stretch;`;
  };
  const tile = (name: string): string => {
    const t = tiles[name];
    return t ? url(t.file) : 'none';
  };
  /** A picture stretched over the whole box (a console region). */
  const region = (name: string): string => {
    const i = images[name];
    return i
      ? `background-image:${url(i.file)};background-size:100% 100%;background-repeat:no-repeat;background-position:0 0;`
      : '';
  };
  const img = (name: string): string => {
    const i = images[name];
    return i ? url(i.file) : 'none';
  };
  return { frames, tiles, images, url, frame, tile, region, img };
}

/** The CSS for the bitmap skin; an empty string when the skin is incomplete. */
export function hudSkinCss(skin: HudSkin): string {
  if (!skinComplete(skin)) return '';
  const { tiles, images, url, frame, tile, region, img } = skinTools(skin);
  const hazard = tiles['hazard'];
  const hazardBg = hazard
    ? `background:${url(hazard.file)} 0 0/${px(hazard.w)} 100% repeat-x;`
    : '';
  const s = SCOPE;

  // Portraits (and the robot icon) as the background of the CRT boxes.
  const portraits = PORTRAIT_IDS.filter((id) => images[`portrait-${id}`])
    .map(
      (id) =>
        `${s} [data-portrait="${id}"]{background-image:${img(`portrait-${id}`)},linear-gradient(180deg,#0f2a14,#071509);background-size:cover,100% 100%;background-position:center 8%,0 0;background-repeat:no-repeat}`,
    )
    .join('\n');
  const building = images['icon-build']
    ? `${s} [data-portrait="building"]{background-image:${img('icon-build')},linear-gradient(180deg,#0f2a14,#071509);background-size:58%,100% 100%;background-position:center,0 0;background-repeat:no-repeat}`
    : '';
  const actionIcons = Object.entries(ACTION_ICONS)
    .filter(([, name]) => images[name])
    .map(
      ([action, name]) =>
        `${s} [data-action="${action}"] .co-btn-icon{background-image:${img(name)}}`,
    )
    .join('\n');
  const buildIcons = Object.entries(BUILD_ICONS)
    .filter(([, name]) => images[name])
    .map(([key, name]) => `${s} [data-building-icon="${key}"]{background-image:${img(name)}}`)
    .join('\n');

  return `
${s} .co-commands,${s} .co-cards,${s} .co-dialog,${s} .co-lobby{${frame('frame-plate', 10)}background:linear-gradient(rgba(10,12,8,.5),rgba(10,12,8,.5)),${tile('plate-rust')} 0 0/${px(385)} auto;background-color:#14170f;padding:4px;box-shadow:0 3px 8px rgba(0,0,0,.55)}
${s} .co-commands,${s} .co-cards{padding:${u(5)} ${u(7)}}
${s} .co-commands h2,${s} .co-cards h2{${frame('frame-header', u(7))}background:linear-gradient(180deg,#4b4a2b,#2f2e1b);margin:0 0 ${u(4)};padding:${u(1)} ${u(5)};color:#e6d48a}
${s} .co-emblem{${images['emblem'] ? `background:${img('emblem')} center/cover;` : ''}border-radius:2px}

/* The console art: each region of the mockup is the background of the box the layout placed for it. */
${s} .co-counters{${region('region-resources')}background-color:transparent;border:0;box-shadow:none}
${s} .co-counter{background:none;box-shadow:none}
${s} .co-gauge{background:none;box-shadow:none}
${s} .co-sidebar{${region('region-sidebar')}background-color:transparent;border:0;box-shadow:none}
${s} .co-side-tab{background:none;box-shadow:none}
${s} .co-side-btn{background:none;border:0;box-shadow:none;color:#e8d68e}
${s} .co-side-btn:hover{background:rgba(255,236,160,.1)}
${s} .co-side-lamp{background:none;box-shadow:none}
${s} .co-side-btn:not(.co-quick-off) .co-side-lamp{box-shadow:0 0 9px rgba(255,70,50,.6)}
${s} .co-side-btn.co-quick-off::before,${s} .co-round-btn.co-quick-off::before,${s} .co-key-plate.co-quick-off::before{content:"";position:absolute;inset:0;background:rgba(12,12,8,.38);pointer-events:none}
${s} .co-quick-off{filter:none}
${s} .co-selection{${region('region-selection')}background-color:transparent;border:0;box-shadow:none}
${s} .co-sel-glass{border:0;border-radius:${u(4)};box-shadow:inset 0 0 18px rgba(0,0,0,.85)}
${s} .co-roster{${region('region-roster')}background-color:transparent;border:0;box-shadow:none}
${s} .co-roster-title{color:#ecdc98}
${s} .co-console{${region('region-console')}background-color:transparent;border:0;box-shadow:none}
${s} .co-con-tab,${s} .co-con-status{background:none;box-shadow:none}
${s} .co-con-status{color:#8dff6f}
${s} .co-round-btn,${s} .co-key-plate{background:none;border:0;box-shadow:none}
${s} .co-key-plate{color:#e4ffe0}
${s} .co-round-btn:hover,${s} .co-key-plate:hover{background:rgba(255,255,255,.14)}
${s} .co-key-plate[aria-pressed="true"]{color:#ffd27a}
${s} .co-con-weapon,${s} .co-con-slot{background:linear-gradient(180deg,#625d4b,#48442f);box-shadow:inset 0 0 12px rgba(0,0,0,.55)}
${images['weapon-gun'] ? `${s} .co-con-gun[data-weapon="gun"]{background:${img('weapon-gun')} center/contain no-repeat;opacity:.95}` : ''}
${portraits}
${building}
${actionIcons}
${buildIcons}
${s} .co-hero::after{content:"";position:absolute;right:${u(6)};top:${u(6)};width:${u(34)};height:${u(34)};${images['emblem'] ? `background:${img('emblem')} center/cover;` : ''}opacity:.16;mix-blend-mode:screen;pointer-events:none}
${s} .co-counter-robots{background:linear-gradient(180deg,#2a2410,#141510);box-shadow:inset 0 0 6px #000}

${s} .co-dominance{border-radius:${u(3)}}
${s} .co-minimap{${frame('frame-minimap', u(9))}padding:0;background:#07090a;box-shadow:none}
${s} .co-perk-panel{${frame('frame-bezel', 14)}box-shadow:none}
${s} .co-card{${frame('frame-card', 5)}background-image:none;box-shadow:none}
${s} .co-card-main{padding:2px 3px}
${s} .co-card-run{padding:0 3px 3px}
${s} .co-btn,${s} .co-perk-close,${s} .co-toast-close,${s} .co-card-cancel{${frame('btn-normal', 7)}background:linear-gradient(180deg,#323829,#262b1f);padding:3px 4px;box-shadow:0 2px 3px rgba(0,0,0,.5)}
${s} .co-roster-group{border:0;border-image:none;background:none;padding:0;box-shadow:none}
${s} .co-btn:hover:not(:disabled){background:linear-gradient(180deg,#3c4431,#2c3324)}
${s} .co-btn[aria-pressed="true"]{${frame('btn-amber', 7)}background:linear-gradient(180deg,#4a3a18,#2b2210);box-shadow:0 0 8px rgba(244,166,42,.35)}
${s} .co-btn:disabled,${s} .co-btn[aria-disabled="true"]{${frame('btn-rust', 7)}background:linear-gradient(180deg,#2e2c25,#222019);box-shadow:none}
${s} .co-btn.co-danger{background:linear-gradient(180deg,#7a2a22,#4a1410)}
${s} .co-top-right .co-btn{border:1px solid rgba(255,255,255,.12);border-image:none;border-radius:4px;background:rgba(13,15,17,.82);box-shadow:none;padding:0}
${s} .co-perk-badge{background:linear-gradient(180deg,#d9951c,#8a6410);color:#1c1810}
${s} .co-buttons .co-btn{padding:${u(22)} 1px ${u(4)}}
${s} .co-btn.co-build-option{${frame('frame-card', 6)}background:linear-gradient(180deg,#232a1d,#161b12);padding:${u(3)} ${u(18)} ${u(3)} ${u(5)}}
${s} .co-btn.co-build-option[aria-disabled="true"],${s} .co-btn.co-build-option:disabled{opacity:.6}
${s} .co-targeting,${s} .co-banner,${s} .co-toast{${frame('frame-strip', 9)}box-shadow:none}
${s} .co-toast{padding:3px ${px(12)}}
${images['paper-strip'] ? `${s} .co-hint,${s} .co-commands-hint{${region('paper-strip')}border:0;border-radius:0;box-shadow:none;color:#1c1810;text-shadow:none;padding:${u(5)} ${u(12)}}` : ''}
${s} .co-key{${frame('badge-key', 4)}padding:0 2px;line-height:1.1;background:#1c150a}
${s} .co-building-btn{${frame('frame-chip', u(4))}padding:0 ${u(2)};box-shadow:none}
${s} .co-building-btn.co-ready,${s} .co-building-btn.co-busy{border-color:transparent}
${s} .co-building-badge{${frame('badge-chip', 5)}min-width:0;height:auto;padding:0 2px;line-height:1.1;background:#2a1d08}
${s} .co-building-progress{left:0;right:0;bottom:0;height:${u(3)};border:0}
${s} .co-building-progress>span,${s} .co-card-progress>span,${s} .co-dom-warn .co-dom-bar>span{${hazardBg}}
${s} .co-placement-reason{${frame('chip-paper', 5)}padding:0 ${px(5)};background:linear-gradient(180deg,#e6dcbc,#c9bd96);box-shadow:none}
`;
}

/**
 * The menu's plates, buttons and screens in the designer's art, on top of the CSS look (menu/styles.ts): the same 9-slice
 * frames and rust tile as the HUD panels, drawn in menu units (`--m`). Dev only, like the rest of the skin; an
 * incomplete skin gives an empty string.
 */
export function menuSkinCss(skin: HudSkin): string {
  if (!skinComplete(skin)) return '';
  const { tiles, images, url, frame, tile, img } = skinTools(skin);
  const hazard = tiles['hazard'];
  const s = SCOPE;
  // Hero portraits on the choice cards (`portrait-hero-<id>`, cut from the sheet by tools/hud-art/heroes.mjs). A hero
  // without a picture keeps the empty panel from styles.controls.ts, so a half-filled sheet still lays out.
  const heroPortraits = Object.keys(images)
    .filter((name) => name.startsWith('portrait-hero-'))
    .map(
      (name) =>
        `${s} [data-portrait="hero-${name.slice('portrait-hero-'.length)}"]{background-image:${img(name)};background-size:cover;background-position:center top;background-repeat:no-repeat}`,
    )
    .join('\n');
  return `
${heroPortraits}
${s} .co-m-plate{${frame('frame-plate', m(12))}background:linear-gradient(rgba(10,12,8,.5),rgba(10,12,8,.5)),${tile('plate-rust')} 0 0/${m(385)} auto;background-color:#14170f;padding:${m(18)} ${m(26)};box-shadow:0 3px 8px rgba(0,0,0,.55)}
${s} .co-m-titleplate{padding:${m(22)} ${m(60)} ${m(16)}}
${s} .co-m-hazard{${hazard ? `background:${url(hazard.file)} 0 0/${m(hazard.w)} 100% repeat-x;border:0;` : ''}}
${s} .co-m-tab{${frame('frame-header', m(8))}height:auto;padding:${m(2)} ${m(10)};background:linear-gradient(180deg,#4b4a2b,#2f2e1b);color:#e6d48a;text-shadow:none;box-shadow:none}
${s} .co-m-crt{${frame('frame-bezel', m(14))}padding:${m(8)} ${m(14)};box-shadow:none}
${s} .co-btn.co-m-btn,${s} .co-m-press{${frame('btn-normal', m(9))}padding:${m(6)} ${m(16)};background:linear-gradient(180deg,#323829,#262b1f);box-shadow:0 2px 3px rgba(0,0,0,.5)}
${s} .co-m-press{background:rgba(244,166,42,.06);box-shadow:none}
${s} .co-btn.co-m-btn:hover:not(:disabled){background:linear-gradient(180deg,#3c4431,#2c3324)}
${s} .co-btn.co-m-primary{${frame('btn-amber', m(9))}background:linear-gradient(180deg,#ffd27a,#d9951c)}
${s} .co-btn.co-m-primary:disabled{${frame('btn-rust', m(9))}background:linear-gradient(180deg,#2e2c25,#222019)}
${s} .co-m-item{${frame('btn-normal', m(11))}padding:${m(6)} ${m(16)};background:linear-gradient(180deg,#323829,#262b1f);box-shadow:0 2px 3px rgba(0,0,0,.5)}
${s} .co-m-item:hover,${s} .co-m-item:focus-visible{${frame('btn-amber', m(11))}background:linear-gradient(180deg,#4a3a18,#2b2210);box-shadow:0 0 12px rgba(244,166,42,.4)}
${s} .co-btn.co-m-choice,${s} .co-m-player,${s} .co-m-mapcard{${frame('frame-card', m(7))}background-image:none;box-shadow:none}
${s} .co-btn.co-m-choice{padding:${m(8)} ${m(10)};background:linear-gradient(180deg,#232a1d,#161b12)}
${s} .co-btn.co-m-choice[aria-checked=true]{${frame('btn-amber', m(8))}background:linear-gradient(180deg,#4a3a18,#2b2210);box-shadow:0 0 8px rgba(244,166,42,.3)}
${s} .co-btn.co-m-choice[aria-disabled=true]{${frame('btn-rust', m(8))}background:linear-gradient(180deg,#2e2c25,#222019);box-shadow:none}
${s} .co-m-player{padding:${m(6)} ${m(10)};background:linear-gradient(180deg,#232a1d,#161b12)}
${s} .co-m-mapcard{padding:${m(8)};background:linear-gradient(180deg,#171a14,#0e100c)}
${s} .co-m-field{${frame('frame-well', m(9))}padding:${m(2)} ${m(8)};background:linear-gradient(180deg,#06140a,#040d07);box-shadow:none}
${s} .co-m-status{${frame('frame-strip', m(11))}padding:${m(2)} ${m(8)};box-shadow:none}
${s} .co-m-reload{${frame('frame-strip', m(11))}padding:${m(2)} ${m(8)}}
${s} .co-m-minimap{${frame('frame-minimap', m(8))}box-shadow:none}
${s} .co-key.co-m-key{${frame('badge-key', m(5))}padding:0 ${m(5)};line-height:1.1;background:#1c150a}
`;
}

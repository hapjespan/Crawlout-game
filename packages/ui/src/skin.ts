/**
 * Optional bitmap skin (dev only). The client hands over the 9-slice manifest and the served URLs of the local HUD
 * crops (apps/client/src/ui/hudSkin.ts, which only exists in dev); this turns them into CSS that lays the art over the
 * committed fallback look (look.ts). Without a skin nothing here runs and the HUD keeps the CSS-only look.
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

export interface HudSkinManifest {
  version: number;
  frames: Record<string, HudSkinFrame>;
  tiles: Record<string, HudSkinTile>;
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
  const need = [...Object.values(skin.manifest.frames), ...Object.values(skin.manifest.tiles)];
  return need.length > 0 && need.every((f) => typeof skin.urls[f.file] === 'string');
}

/** The CSS for the bitmap skin; an empty string when the skin is incomplete. */
export function hudSkinCss(skin: HudSkin): string {
  if (!skinComplete(skin)) return '';
  const { frames, tiles } = skin.manifest;
  const url = (file: string): string => `url("${skin.urls[file] ?? ''}")`;
  /** border + border-image for a 9-slice frame drawn `w` px thick. */
  const frame = (name: string, w: number): string => {
    const f = frames[name];
    if (!f) return '';
    return `border:${w}px solid transparent;border-radius:0;border-image:${url(f.file)} ${f.slice.join(' ')}/${w}px/0 stretch;`;
  };
  const tile = (name: string): string => {
    const t = tiles[name];
    return t ? url(t.file) : 'none';
  };
  const hazard = tiles['hazard'];
  const hazardBg = hazard ? `background:${url(hazard.file)} 0 0/${hazard.w}px 100% repeat-x;` : '';
  const s = SCOPE;
  return `
${s} .co-panel{${frame('frame-plate', 10)}background:linear-gradient(rgba(10,12,8,.5),rgba(10,12,8,.5)),${tile('plate-rust')} 0 0/385px auto;background-color:#14170f;padding:4px;box-shadow:0 3px 8px rgba(0,0,0,.55)}
${s} .co-cards,${s} .co-commands{${frame('frame-plate', 8)}}
${s} .co-counters{padding:2px 4px}
${s} .co-counter{${frame('frame-well', 4)}padding:0 6px;box-shadow:none}
${s} .co-dominance{${frame('frame-strip', 9)}padding:3px 8px;box-shadow:none}
${s} .co-selection{${frame('frame-bezel', 14)}padding:5px 8px;box-shadow:none}
${s} .co-minimap{${frame('frame-minimap', 8)}padding:0;background:#07090a;box-shadow:none}
${s} .co-perk-panel{${frame('frame-bezel', 14)}box-shadow:none}
${s} .co-card{${frame('frame-card', 5)}background-image:none;box-shadow:none}
${s} .co-card-main{padding:2px 3px}
${s} .co-card-run{padding:0 3px 3px}
${s} .co-btn,${s} .co-roster-group,${s} .co-perk-close,${s} .co-toast-close,${s} .co-card-cancel{${frame('btn-normal', 7)}background:linear-gradient(180deg,#323829,#262b1f);padding:3px 4px;box-shadow:0 2px 3px rgba(0,0,0,.5)}
${s} .co-btn:hover:not(:disabled),${s} .co-roster-group:hover:not(:disabled){background:linear-gradient(180deg,#3c4431,#2c3324)}
${s} .co-btn[aria-pressed="true"],${s} .co-roster-group.co-selected{${frame('btn-amber', 7)}background:linear-gradient(180deg,#4a3a18,#2b2210);box-shadow:0 0 8px rgba(244,166,42,.35)}
${s} .co-btn:disabled,${s} .co-btn[aria-disabled="true"],${s} .co-roster-group:disabled{${frame('btn-rust', 7)}background:linear-gradient(180deg,#2e2c25,#222019);box-shadow:none}
${s} .co-btn.co-danger{background:linear-gradient(180deg,#7a2a22,#4a1410)}
${s} .co-perk-badge{background:linear-gradient(180deg,#d9951c,#8a6410);color:#1c1810}
${s} .co-buttons .co-btn{padding:13px 0 3px}
${s} .co-build-option{padding:4px 20px 4px 5px}
${s} .co-targeting,${s} .co-hint,${s} .co-banner,${s} .co-toast{${frame('frame-strip', 9)}box-shadow:none}
${s} .co-toast{padding:3px 12px}
${s} .co-key{${frame('badge-key', 4)}padding:0 2px;line-height:11px;background:#1c150a}
${s} .co-building-btn{${frame('frame-chip', 10)}padding:2px 6px 10px;box-shadow:none}
${s} .co-building-btn.co-ready,${s} .co-building-btn.co-busy{border-color:transparent}
${s} .co-building-badge{${frame('badge-chip', 5)}min-width:0;height:auto;padding:0 2px;line-height:12px;background:#2a1d08}
${s} .co-building-progress{left:6px;right:6px;bottom:2px;height:6px;border:1px solid #0b2a14}
${s} .co-building-progress>span,${s} .co-card-progress>span,${s} .co-dom-warn .co-dom-bar>span{${hazardBg}}
${s} .co-placement-reason{${frame('chip-paper', 5)}padding:0 5px;background:linear-gradient(180deg,#e6dcbc,#c9bd96);box-shadow:none}
`;
}

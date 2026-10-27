import { font, fpx, px, u } from './units.js';

/** HUD layout, part 3 (concatenated in styles.ts): the card window, build menu, cards, toasts, dialogs and lobby. */
export const HUD_LAYOUT_CARDS_CSS = `/* Above the console: the card window directly above the commands, both as wide as the console. */
.co-right-col{position:absolute;right:0;bottom:${u(122)};width:${u(334)};max-height:calc(100% - ${u(278)});display:flex;flex-direction:column;gap:${u(5)};pointer-events:none}
.co-commands{flex:0 1 auto;min-height:${u(60)};overflow:auto;padding:${u(8)} ${u(10)}}
.co-commands-hint{font-size:${font(11)}}
.co-cmd-title{display:flex;align-items:center;gap:${u(5)}}
.co-emblem{flex:none;display:block;width:${u(14)};height:${u(14)}}
.co-buttons{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:${u(5)}}
.co-btn{pointer-events:auto;font:inherit;color:inherit;background:#2f353b;border:1px solid #4a5159;border-radius:4px;padding:${px(6)} 4px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px}
.co-btn:hover:not(:disabled){background:#3b434b}
.co-btn:disabled{opacity:.4;cursor:default}
.co-btn[aria-pressed="true"]{background:#4a6572;border-color:#8fb8cc}
.co-key{font-size:${fpx(11)};color:#9aa0a6;border:1px solid #4a5159;border-radius:3px;padding:0 4px}
.co-btn:focus-visible{outline:3px solid #ffd54f;outline-offset:2px}
.co-buttons .co-btn{position:relative;min-height:${u(46)};justify-content:flex-end;padding:${u(22)} 1px ${u(4)}}
.co-btn-icon{position:absolute;left:50%;top:${u(5)};width:${u(34)};height:${u(20)};transform:translateX(-50%);background-repeat:no-repeat;background-position:center;background-size:contain}
.co-btn-label{font-size:${font(11)};font-weight:600;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.co-buttons .co-key{position:absolute;top:${u(3)};right:${u(3)}}
.co-menu{margin-top:${u(8)};border-top:1px solid #3a3f44;padding-top:${u(8)};color:#c4c7ca}
.co-targeting{position:absolute;left:50%;bottom:${u(240)};transform:translateX(-50%);color:#ffd54f}
.co-placement-reason{color:#ff8a80;font-weight:600}
.co-hint{position:absolute;left:50%;bottom:${u(240)};transform:translateX(-50%);color:#ff8a80;font-weight:600;pointer-events:none}
.co-banner{position:absolute;left:50%;top:max(${u(86)}, 80px);transform:translateX(-50%);max-width:80%;text-align:center;font-weight:600}
.co-banner.co-desync{background:rgba(120,20,20,.95);border-color:#ff5252}
.co-banner.co-stall{background:rgba(90,70,10,.95);border-color:#ffd54f}
.co-dialog{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:${px(320)};text-align:center}
.co-dialog p{margin:0 0 ${px(12)}}
.co-dialog .co-actions{display:flex;gap:${px(8)};justify-content:center}
.co-dialog .co-btn{flex-direction:row;padding:${px(6)} ${px(16)}}
.co-btn.co-danger{background:#7a2323;border-color:#ff5252}
.co-btn.co-danger:hover:not(:disabled){background:#9a2d2d}

/* Build menu: one column of option cards (icon, name, cost, key). */
.co-build-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:${u(4)}}
.co-build-option{width:100%;position:relative}
.co-cost{font-size:${font(10)};color:#9aa0a6}
.co-cost.co-full{color:#ff8a65}
.co-buttons .co-btn.co-build-option{min-height:0}
.co-btn.co-build-option{display:grid;grid-template-columns:${u(24)} minmax(0,1fr);grid-template-rows:auto auto;column-gap:${u(5)};align-items:center;justify-items:start;padding:${u(4)} ${u(20)} ${u(4)} ${u(5)};text-align:left}
.co-build-icon{grid-row:1 / span 2;width:${u(26)};height:${u(24)};background-repeat:no-repeat;background-position:center;background-size:contain}
.co-build-name{font-size:${font(12)};font-weight:700;line-height:1.1;min-width:0;overflow-wrap:anywhere}
.co-build-option .co-key{position:absolute;top:${u(4)};right:${u(4)}}

/* Cards: as wide as the console, two columns that stay wide enough for a whole name (the cards get tall on a small window,
   where 11 px text wraps; the window scrolls). */
.co-cards{flex:0 1 auto;min-height:0;overflow:auto;padding:${u(8)} ${u(10)}}
.co-card-notice{margin:0 0 ${px(6)};padding:4px ${px(6)};border-radius:4px;background:#4a2a1a;color:#ffcc80;font-size:${fpx(12)}}
.co-cards h2{margin:0 0 ${u(4)};font-size:${font(10)};text-transform:uppercase;letter-spacing:.05em;color:#9aa0a6}
.co-cards-hint{font-size:${fpx(12)};margin:0 0 ${px(6)}}
.co-card-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(${u(145)},1fr));gap:${u(5)}}
.co-card{display:flex;flex-direction:column;background:#24282c;border:1px solid #3a4046;border-radius:${px(6)};overflow:hidden}
.co-card-main{display:grid;grid-template-columns:${px(26)} minmax(0,1fr) auto;column-gap:${px(6)};row-gap:2px;align-items:center;align-content:start;width:100%;flex:1;padding:${px(6)};background:none;border:0;color:inherit;font:${fpx(12)}/1.25 system-ui,sans-serif;text-align:left;cursor:pointer}
.co-card-main:hover:not([aria-disabled=true]){background:#2f353b}
.co-card-main:focus-visible,.co-card-cancel:focus-visible{outline:3px solid #ffd54f;outline-offset:-2px}
.co-card-main[aria-disabled=true]{cursor:not-allowed}
.co-card-main[aria-disabled=true] .co-card-name,.co-card-main[aria-disabled=true] .co-card-icon{color:#9aa0a6}
.co-card-running .co-card-main,.co-card-done .co-card-main{cursor:default}
.co-card-icon{grid-row:1 / span 2;width:${px(26)};height:${px(26)};color:#c4c7ca}
.co-card-name{font-weight:600;font-size:${fpx(13)};min-width:0;overflow-wrap:break-word;hyphens:none}
.co-card-meta{grid-column:2 / span 2;display:flex;gap:${px(8)};color:#c4c7ca}
.co-card-cost.co-full{color:#ff8a65;font-weight:600}
.co-card-effects,.co-card-unlocks,.co-card-status{grid-column:1 / span 3;color:#c4c7ca;min-width:0;overflow-wrap:anywhere}
.co-card-unlocks{color:#9aa0a6}
.co-card-status{display:flex;align-items:center;gap:4px;font-size:${fpx(11)};text-transform:uppercase;letter-spacing:.04em;margin-top:2px}
.co-card-glyph{flex:none}
.co-card-locked{opacity:.6;border-style:dashed}
.co-card-busy{opacity:.75;border-style:dashed;border-color:#8a7a3a}
.co-card-busy .co-card-status{color:#ffcc80}
.co-card-available{border-color:#5d8a3a}
.co-card-tooExpensive{border-color:#8a4a3a}
.co-card-tooExpensive .co-card-status{color:#ff8a65}
.co-card-running{border-color:#64b5f6}
.co-card-running .co-card-status{color:#90caf9}
.co-card-done{border-color:#558b2f}
.co-card-done .co-card-status{color:#aed581}
.co-card-available .co-card-status{color:#e6e6e6}
.co-card-run{display:flex;align-items:center;gap:${px(6)};padding:0 ${px(6)} ${px(6)}}
.co-card-progress{flex:1;height:${px(6)};background:#2b2f33;border-radius:3px;overflow:hidden}
.co-card-progress>span{display:block;height:100%;background:#42a5f5}
.co-card-cancel{font:inherit;font-size:${fpx(11)};color:inherit;background:#2f353b;border:1px solid #4a5159;border-radius:4px;padding:1px ${px(6)};cursor:pointer}
.co-card-cancel:hover{background:#3b434b}

.co-toast-dominance{background:#7a4a12;border-color:#ff8a65}
.co-toasts{position:absolute;left:50%;top:max(${u(86)}, 80px);transform:translateX(-50%);display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none;pointer-events:none}
.co-toasts li{display:flex;gap:2px;pointer-events:auto}
.co-toast{flex-direction:row;padding:${px(6)} ${px(14)};font-weight:600}
.co-toast-attack{background:#7a2323;border-color:#ff5252}
.co-toast-settlerLost{background:#6a4a12;border-color:#ffb74d}
.co-toast-claimLost{background:#4a2a6a;border-color:#ba68c8}
.co-toast-noBeds{background:#5a4a12;border-color:#ffd54f}
.co-toast-close{font:inherit;color:inherit;background:#2f353b;border:1px solid #4a5159;border-radius:4px;cursor:pointer;padding:0 ${px(8)}}
.co-lobby{position:absolute;left:50%;top:30%;transform:translateX(-50%);width:${px(300)}}
.co-lobby h2{margin:0 0 ${px(6)};font-size:${fpx(12)};text-transform:uppercase;color:#9aa0a6}
.co-lobby-list{list-style:none;margin:0 0 ${px(8)};padding:0}
.co-lobby-list li{display:flex;gap:${px(8)};align-items:center;padding:2px 0}
.co-lobby-list li>span:first-child{flex:1}
.co-tag{font-size:${fpx(11)};border:1px solid #4a5159;border-radius:3px;padding:0 4px;color:#9aa0a6}
.co-ready{color:#7cb342}.co-notready{color:#9aa0a6}
.co-lobby .co-actions{display:flex;gap:${px(8)}}
`;

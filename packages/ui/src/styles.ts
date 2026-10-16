import { HUD_LOOK_CSS, HUD_TOKENS_CSS } from './look.js';

/** Indeling en basisstijl van de HUD. Alles onder .co-hud zodat er niets lekt; het uiterlijk (kleur, vorm) staat in look.ts. */
const HUD_LAYOUT_CSS = `
.co-hud{--co-right-w:320px;position:absolute;inset:0;pointer-events:none;font:14px/1.3 system-ui,sans-serif;color:#e6e6e6}
.co-hud *{box-sizing:border-box}
.co-panel{pointer-events:auto;background:rgba(20,22,24,.88);border:1px solid #3a3f44;border-radius:6px;padding:8px}
.co-counters{position:absolute;top:8px;left:8px;display:flex;gap:16px;margin:0;list-style:none}
.co-counter{display:flex;flex-direction:column;min-width:64px}
.co-counter-label{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#9aa0a6}
.co-counter-value{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
.co-counter-value.co-full{color:#ff8a65}
.co-selection{position:absolute;left:8px;bottom:8px;width:260px;max-height:220px;overflow:auto}
.co-selection h2,.co-commands h2{margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#9aa0a6}
.co-empty{color:#9aa0a6;margin:0}
.co-unit-name{font-weight:600;margin:0 0 4px}
.co-unit-meta{margin:0 0 6px;color:#c4c7ca}
.co-unit-note{margin:0 0 6px;color:#ffd54f}
.co-unit-detail{margin:0 0 6px;color:#c4c7ca;font-size:12px}
.co-selection-enemy{border-color:#c0392b}
.co-selection-enemy h2{color:#ff8a80}
.co-selection-enemy .co-hp>span{background:#e57373}
.co-hp{height:6px;background:#2b2f33;border-radius:3px;overflow:hidden}
.co-hp>span{display:block;height:100%;background:#7cb342}
.co-hp.co-low>span{background:#e53935}
.co-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(44px,1fr));gap:4px;margin:0;padding:0;list-style:none}
.co-grid>li{display:flex}
.co-cell{width:100%;background:#2b2f33;border:1px solid transparent;border-radius:4px;padding:4px;color:inherit;font:11px/1.3 system-ui,sans-serif;text-align:center;cursor:pointer}
.co-cell:hover{background:#3b434b;border-color:#4a5159}
.co-cell:focus-visible{outline:3px solid #ffd54f;outline-offset:1px}
.co-cell b{display:block;font-size:13px}
.co-roster{position:absolute;left:calc(8px + 260px + 12px);right:calc(8px + var(--co-right-w) + 12px);bottom:8px;display:flex;flex-direction:column;gap:6px;padding:6px}
.co-roster-row{display:flex;flex-wrap:wrap;align-items:flex-start;gap:6px 14px}
.co-roster-groups,.co-building-buttons{display:flex;flex-wrap:wrap;gap:6px}
.co-building-buttons{padding-left:14px;border-left:1px solid #3a3f44}
.co-roster-row>.co-building-buttons:first-child{padding-left:0;border-left:0}
.co-building-btn{position:relative;display:flex;align-items:center;gap:8px;padding:6px 10px 9px;background:#24282c;border:1px solid #3a4046;border-radius:4px;color:inherit;font:inherit;cursor:pointer;overflow:hidden}
.co-building-btn:hover{background:#2f353b}
.co-building-btn.co-ready{border-color:#ffd54f}
.co-building-btn.co-busy{border-color:#64b5f6}
.co-building-btn.co-selected{outline:2px solid #7dff7d;outline-offset:-2px}
.co-building-btn:focus-visible{outline:3px solid #ffd54f;outline-offset:1px}
.co-building-label{align-self:center;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#9aa0a6}
.co-building-count{font-size:12px;color:#c4c7ca}
.co-building-badge{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#ffd54f;color:#1a1a1a;font-size:12px;font-weight:700;line-height:18px;text-align:center}
.co-building-badge.co-building-busy{background:#64b5f6}
.co-building-progress{position:absolute;left:0;right:0;bottom:0;height:4px;background:#2b2f33}
.co-building-progress>span{display:block;height:100%;background:#42a5f5}
.co-roster-group{display:flex;align-items:baseline;gap:6px;padding:6px 10px;background:#24282c;border:1px solid #3a4046;border-radius:4px;color:inherit;font:inherit;cursor:pointer}
.co-roster-group:disabled{opacity:.45;cursor:default}
.co-roster-count{font-weight:700}
.co-roster-idle{font-size:12px;color:#ffd54f}
.co-roster-group.co-selected{border-color:#7dff7d}
.co-roster-list{display:flex;flex-wrap:wrap;gap:3px;max-height:70px;overflow:auto;margin:0;padding:2px;list-style:none}
.co-roster-list>li{flex:1 1 0;min-width:8px;max-width:72px}
.co-roster-unit{position:relative;display:block;width:100%;height:24px;padding:0;overflow:hidden;border:0;border-radius:3px;color:inherit;cursor:pointer}
.co-roster-unit[data-state=available]{background:#2e9a45}
.co-roster-unit[data-state=working]{background:#e08a12}
.co-roster-unit[data-state=busy]{background:#d33a35}
.co-roster-unit.co-selected{box-shadow:0 0 0 2px #fff}
.co-roster-fill{position:absolute;left:0;top:0;bottom:0;background:#ffd699;opacity:.9}
.co-roster-hp{position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(0,0,0,.5)}
.co-roster-hp>span{display:block;height:100%;background:rgba(255,255,255,.9)}
.co-roster-group:focus-visible,.co-roster-unit:focus-visible{outline:2px solid #ffd54f;outline-offset:1px}
.co-right-col{position:absolute;right:8px;bottom:8px;width:var(--co-right-w);max-height:calc(100% - 236px);display:flex;flex-direction:column;gap:8px;pointer-events:none}
.co-commands{flex:none}
.co-commands-hint{font-size:13px}
.co-buttons{display:grid;grid-template-columns:repeat(auto-fill,minmax(68px,1fr));gap:6px}
.co-btn{pointer-events:auto;font:inherit;color:inherit;background:#2f353b;border:1px solid #4a5159;border-radius:4px;padding:6px 4px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px}
.co-btn:hover:not(:disabled){background:#3b434b}
.co-btn:disabled{opacity:.4;cursor:default}
.co-btn[aria-pressed="true"]{background:#4a6572;border-color:#8fb8cc}
.co-key{font-size:11px;color:#9aa0a6;border:1px solid #4a5159;border-radius:3px;padding:0 4px}
.co-btn:focus-visible{outline:3px solid #ffd54f;outline-offset:2px}
.co-menu{margin-top:8px;border-top:1px solid #3a3f44;padding-top:8px;color:#c4c7ca}
.co-targeting{position:absolute;left:50%;bottom:260px;transform:translateX(-50%);color:#ffd54f}
.co-placement-reason{color:#ff8a80;font-weight:600}
.co-hint{position:absolute;left:50%;bottom:300px;transform:translateX(-50%);color:#ff8a80;font-weight:600;pointer-events:none}
.co-top-right{position:absolute;top:8px;right:8px;display:flex;gap:8px;align-items:center}
.co-banner{position:absolute;left:50%;top:56px;transform:translateX(-50%);max-width:80%;text-align:center;font-weight:600}
.co-banner.co-desync{background:rgba(120,20,20,.95);border-color:#ff5252}
.co-banner.co-stall{background:rgba(90,70,10,.95);border-color:#ffd54f}
.co-dialog{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:320px;text-align:center}
.co-dialog p{margin:0 0 12px}
.co-dialog .co-actions{display:flex;gap:8px;justify-content:center}
.co-dialog .co-btn{flex-direction:row;padding:6px 16px}
.co-btn.co-danger{background:#7a2323;border-color:#ff5252}
.co-btn.co-danger:hover:not(:disabled){background:#9a2d2d}
.co-minimap{position:absolute;right:8px;top:48px;padding:4px}
.co-minimap-canvas{display:block;width:160px;height:160px;cursor:pointer;image-rendering:pixelated}
.co-build-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:6px}
.co-build-option{width:100%}
.co-cost{font-size:11px;color:#9aa0a6}
.co-cost.co-full{color:#ff8a65}
.co-hero{position:absolute;left:8px;top:64px;width:240px}
.co-hero h2{margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#9aa0a6}
.co-xp{height:6px;background:#2b2f33;border-radius:3px;overflow:hidden;margin-bottom:6px}
.co-xp>span{display:block;height:100%;background:#42a5f5}
.co-special{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin:0 0 6px;padding:0;list-style:none;text-align:center}
.co-special b{display:block;font-size:11px;color:#9aa0a6}
.co-perk-badge{flex-direction:row;justify-content:space-between;width:100%;margin-bottom:6px;background:#8a6d12;border-color:#ffd54f;color:#fff;font-weight:700;animation:co-perk-pulse 1.6s ease-in-out infinite}
.co-perk-badge:hover:not(:disabled){background:#a07f16}
@keyframes co-perk-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,213,79,.55)}50%{box-shadow:0 0 0 4px rgba(255,213,79,0)}}
@media (prefers-reduced-motion:reduce){.co-perk-badge{animation:none}}
.co-perk-panel{position:absolute;left:calc(100% + 8px);top:0;width:260px;max-height:60vh;overflow:auto;padding:8px;background:rgba(20,22,24,.96);border:1px solid #ffd54f;border-radius:6px}
.co-perk-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.co-perk-title{margin:0;color:#ffd54f;font-weight:600}
.co-perk-close{font:inherit;color:inherit;background:#2f353b;border:1px solid #4a5159;border-radius:4px;cursor:pointer;padding:0 8px}
.co-perk-close:focus-visible{outline:3px solid #ffd54f;outline-offset:1px}
.co-perk-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.co-perk{width:100%;align-items:stretch;gap:3px;padding:6px 8px;text-align:left;border-color:#5d8a3a}
.co-perk-top{display:flex;justify-content:space-between;align-items:center;gap:6px}
.co-perk-name{font-weight:700;font-size:13px}
.co-perk-effect{font-size:12px;color:#e6e6e6}
.co-perk-req{font-size:11px;color:#aed581}
.co-perk-unmet{color:#ff8a65}
.co-btn.co-perk-locked{opacity:.6;cursor:not-allowed;border-style:dashed;border-color:#8a4a3a}
.co-btn.co-perk-locked:hover{background:#2f353b}
.co-revives{margin:0 0 6px;color:#c4c7ca;font-size:12px}
.co-revive{flex-direction:row;justify-content:space-between;width:100%;margin-bottom:6px;background:#2e5a2e;border-color:#7cb342}
.co-abilities{display:flex;flex-direction:column;gap:4px;margin-bottom:6px}
.co-ability{position:relative;flex-direction:row;justify-content:space-between;padding:6px 8px;overflow:hidden}
.co-cooldown{position:absolute;left:0;bottom:0;height:3px;background:#ffb74d}
.co-cards{flex:0 1 auto;min-height:0;overflow:auto}
.co-card-notice{margin:0 0 6px;padding:4px 6px;border-radius:4px;background:#4a2a1a;color:#ffcc80;font-size:12px}
.co-cards h2{margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#9aa0a6}
.co-cards-hint{font-size:12px;margin:0 0 6px}
.co-card-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
.co-card{display:flex;flex-direction:column;background:#24282c;border:1px solid #3a4046;border-radius:6px;overflow:hidden}
.co-card-main{display:grid;grid-template-columns:28px minmax(0,1fr) auto;column-gap:6px;row-gap:2px;align-items:center;align-content:start;width:100%;flex:1;padding:6px;background:none;border:0;color:inherit;font:12px/1.25 system-ui,sans-serif;text-align:left;cursor:pointer}
.co-card-main:hover:not([aria-disabled=true]){background:#2f353b}
.co-card-main:focus-visible,.co-card-cancel:focus-visible{outline:3px solid #ffd54f;outline-offset:-2px}
.co-card-main[aria-disabled=true]{cursor:not-allowed}
.co-card-main[aria-disabled=true] .co-card-name,.co-card-main[aria-disabled=true] .co-card-icon{color:#9aa0a6}
.co-card-running .co-card-main,.co-card-done .co-card-main{cursor:default}
.co-card-icon{grid-row:1 / span 2;color:#c4c7ca}
.co-card-name{font-weight:600;font-size:13px;min-width:0;overflow-wrap:break-word;hyphens:auto}
.co-card-meta{grid-column:2 / span 2;display:flex;gap:8px;color:#c4c7ca}
.co-card-cost.co-full{color:#ff8a65;font-weight:600}
.co-card-effects,.co-card-unlocks,.co-card-status{grid-column:1 / span 3;color:#c4c7ca;min-width:0;overflow-wrap:anywhere}
.co-card-unlocks{color:#9aa0a6}
.co-card-status{display:flex;align-items:center;gap:4px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-top:2px}
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
.co-card-run{display:flex;align-items:center;gap:6px;padding:0 6px 6px}
.co-card-progress{flex:1;height:6px;background:#2b2f33;border-radius:3px;overflow:hidden}
.co-card-progress>span{display:block;height:100%;background:#42a5f5}
.co-card-cancel{font:inherit;font-size:11px;color:inherit;background:#2f353b;border:1px solid #4a5159;border-radius:4px;padding:1px 6px;cursor:pointer}
.co-card-cancel:hover{background:#3b434b}
.co-dominance{position:absolute;top:8px;left:50%;transform:translateX(-50%);width:300px;display:flex;flex-direction:column;gap:6px}
.co-dom-row{display:flex;flex-direction:column;gap:3px}
.co-dom-text{font-size:12px;font-variant-numeric:tabular-nums}
.co-dom-bar{height:6px;background:#2b2f33;border-radius:3px;overflow:hidden}
.co-dom-bar>span{display:block;height:100%;background:#64b5f6}
.co-dom-warn .co-dom-text{color:#ffb74d;font-weight:700}
.co-dom-warn .co-dom-bar>span{background:repeating-linear-gradient(45deg,#ff8a65 0 6px,#ffb74d 6px 12px)}
.co-toast-dominance{background:#7a4a12;border-color:#ff8a65}
.co-toasts{position:absolute;left:50%;top:104px;transform:translateX(-50%);display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none;pointer-events:none}
.co-toasts li{display:flex;gap:2px;pointer-events:auto}
.co-toast{flex-direction:row;padding:6px 14px;font-weight:600}
.co-toast-attack{background:#7a2323;border-color:#ff5252}
.co-toast-settlerLost{background:#6a4a12;border-color:#ffb74d}
.co-toast-claimLost{background:#4a2a6a;border-color:#ba68c8}
.co-toast-close{font:inherit;color:inherit;background:#2f353b;border:1px solid #4a5159;border-radius:4px;cursor:pointer;padding:0 8px}
.co-lobby{position:absolute;left:50%;top:30%;transform:translateX(-50%);width:300px}
.co-lobby h2{margin:0 0 6px;font-size:12px;text-transform:uppercase;color:#9aa0a6}
.co-lobby-list{list-style:none;margin:0 0 8px;padding:0}
.co-lobby-list li{display:flex;gap:8px;align-items:center;padding:2px 0}
.co-lobby-list li>span:first-child{flex:1}
.co-tag{font-size:11px;border:1px solid #4a5159;border-radius:3px;padding:0 4px;color:#9aa0a6}
.co-ready{color:#7cb342}.co-notready{color:#9aa0a6}
.co-lobby .co-actions{display:flex;gap:8px}
`;

/** Indeling plus het bitmap-vrije "Roest en Fosfor"-uiterlijk (tokens en fallback). */
export const HUD_CSS = HUD_LAYOUT_CSS + HUD_TOKENS_CSS + HUD_LOOK_CSS;

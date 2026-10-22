import { BAR_UNIT_CSS, UNIT_CSS, font, fpx, px, u } from './units.js';

/** HUD layout, part 1 (concatenated in styles.ts): base rules, the resource bar, hero, dominance, minimap, side console and selection screen. */
export const HUD_LAYOUT_PANELS_CSS = `
.co-hud{--u:${UNIT_CSS};--ub:${BAR_UNIT_CSS};position:absolute;inset:0;pointer-events:none;font:${fpx(14)}/1.3 system-ui,sans-serif;color:#e6e6e6}
.co-hud *{box-sizing:border-box}
.co-panel{pointer-events:auto;background:rgba(20,22,24,.88);border:1px solid #3a3f44;border-radius:${px(6)};padding:${px(8)}}
.co-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

/* Top left: the brass resource bar (322 x 50 units): four windows, a gauge between the second and the third. Its labels are
   11 px text in 50 unit windows, so on small windows the bar keeps a larger unit (--ub) instead of cutting the words. */
.co-counters{--u:var(--ub);position:absolute;left:0;top:0;width:${u(322)};height:${u(50)};margin:0;padding:0;list-style:none}
.co-counter{position:absolute;top:${u(9)};height:${u(31)};display:flex;flex-direction:column;justify-content:center;padding:0 ${u(3)};overflow:hidden}
.co-counter-scrap{left:${u(12)};width:${u(50)}}
.co-counter-settlers{left:${u(69)};width:${u(56)}}
.co-counter-pop{left:${u(177)};width:${u(64)}}
.co-counter-beds{left:${u(248)};width:${u(55)}}
.co-counter-robots{left:${u(177)};top:${u(52)};width:${u(64)};height:${u(18)};flex-direction:row;align-items:center;justify-content:space-between}
.co-raiders{position:absolute;left:50%;transform:translateX(-50%);top:${u(46)};display:flex;gap:${u(6)};margin:0;padding:${u(2)} ${u(6)};list-style:none;font-size:${font(11)};white-space:nowrap}
.co-raider-item{display:flex;align-items:baseline;gap:${u(3)}}
.co-raider-label{text-transform:uppercase;letter-spacing:.04em;font-size:${font(9)};color:#9aa0a6}
.co-raider-sub{color:#9aa0a6;font-size:${font(10)}}
.co-raider-warn b,.co-raider-warn .co-raider-sub{color:#ff8a65}
.co-counter-label{font-size:${font(8)};text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;color:#9aa0a6}
.co-counter-value{font-size:${font(16)};line-height:1.1;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.co-counter-value.co-full{color:#ff8a65}
.co-gauge{position:absolute;left:${u(138.5)};top:${u(11.5)};width:${u(28)};height:${u(28)};border-radius:50%}
.co-gauge-needle{position:absolute;left:calc(50% - ${u(0.8)});top:calc(50% - ${u(11)});width:${u(1.6)};height:${u(11)};transform-origin:50% 100%;transform:rotate(var(--co-needle,0deg));background:#ff6a4a;border-radius:1px}

/* Left: the hero panel under the bar, a dark glass note. */
.co-hero{position:absolute;left:${u(8)};top:calc(var(--ub) * 50 + var(--u) * 7);width:${u(160)}}
.co-hero h2{margin:0 0 ${u(4)};font-size:${font(9)};text-transform:uppercase;letter-spacing:.05em;color:#9aa0a6}
.co-xp{height:${u(5)};background:#2b2f33;border-radius:3px;overflow:hidden;margin-bottom:${u(5)}}
.co-xp>span{display:block;height:100%;background:#42a5f5}
.co-special{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin:0 0 ${u(5)};padding:0;list-style:none;text-align:center}
.co-special b{display:block;font-size:${font(9)};color:#9aa0a6}
.co-special span{font-size:${font(11)};font-weight:700}
.co-revives{margin:0 0 ${u(5)};color:#c4c7ca;font-size:${font(9)}}
.co-btn.co-perk-badge{flex-direction:row;justify-content:space-between;width:100%;margin-bottom:${px(6)};background:#8a6d12;border-color:#ffd54f;color:#fff;font-weight:700;animation:co-perk-pulse 1.6s ease-in-out infinite}
.co-perk-badge:hover:not(:disabled){background:#a07f16}
@keyframes co-perk-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,213,79,.55)}50%{box-shadow:0 0 0 4px rgba(255,213,79,0)}}
@media (prefers-reduced-motion:reduce){.co-perk-badge{animation:none}}
.co-perk-panel{position:absolute;left:calc(100% + ${px(8)});top:calc(var(--ub) * 20 - var(--u) * 4);width:${px(260)};max-height:60vh;overflow:auto;padding:${px(8)};background:rgba(20,22,24,.96);border:1px solid #ffd54f;border-radius:${px(6)}}
.co-perk-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:${px(6)}}
.co-perk-title{margin:0;color:#ffd54f;font-weight:600}
.co-perk-close{font:inherit;color:inherit;background:#2f353b;border:1px solid #4a5159;border-radius:4px;cursor:pointer;padding:0 ${px(8)}}
.co-perk-close:focus-visible{outline:3px solid #ffd54f;outline-offset:1px}
.co-perk-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:${px(6)}}
.co-perk{width:100%;align-items:stretch;gap:3px;padding:${px(6)} ${px(8)};text-align:left;border-color:#5d8a3a}
.co-perk-top{display:flex;justify-content:space-between;align-items:center;gap:${px(6)}}
.co-perk-name{font-weight:700;font-size:${fpx(13)}}
.co-perk-effect{font-size:${fpx(12)};color:#e6e6e6}
.co-perk-req{font-size:${fpx(11)};color:#aed581}
.co-perk-unmet{color:#ff8a65}
.co-btn.co-perk-locked{opacity:.6;cursor:not-allowed;border-style:dashed;border-color:#8a4a3a}
.co-btn.co-perk-locked:hover{background:#2f353b}
.co-btn.co-revive{flex-direction:row;justify-content:space-between;width:100%;margin-bottom:${px(6)};background:#2e5a2e;border-color:#7cb342}
.co-abilities{display:flex;flex-direction:column;gap:4px;margin-bottom:${px(6)}}
.co-btn.co-ability{position:relative;flex-direction:row;justify-content:space-between;padding:${px(6)} ${px(8)};overflow:hidden}
.co-cooldown{position:absolute;left:0;bottom:0;height:3px;background:#ffb74d}

/* Dominance: a dark glass strip top centre (216 units wide, at least 250 px so a long warning wraps in two lines), text and a thin bar. */
.co-dominance{position:absolute;top:${u(6)};left:50%;transform:translateX(-50%);width:max(${u(216)}, 250px);min-height:${u(26)};display:flex;flex-direction:column;justify-content:center;gap:${u(2)};padding:${u(3)} ${u(8)}}
.co-dom-row{display:flex;flex-direction:column;gap:${u(2)}}
.co-dom-text{font-size:${font(11.5)};font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.co-dom-bar{height:${u(3.5)};background:#2b2f33;border-radius:3px;overflow:hidden}
.co-dom-bar>span{display:block;height:100%;background:#64b5f6}
.co-dom-warn .co-dom-text{color:#ffb74d;font-weight:700}
.co-dom-warn .co-dom-bar>span{background:repeating-linear-gradient(45deg,#ff8a65 0 6px,#ffb74d 6px 12px)}

/* Top right: Opgeven next to the frame stats (#perf, which sits left of it), the minimap in its frame below. */
.co-top-right{position:absolute;top:${u(4)};right:${u(4)};height:${u(20)};display:flex;gap:${px(8)};align-items:center}
.co-top-right .co-btn{width:${u(48)};height:100%;padding:0;flex-direction:row;justify-content:center;font-size:${font(10)}}
.co-minimap{position:absolute;right:${u(4)};top:${u(27)};width:${u(124)};height:${u(124)};padding:0;border:${u(9)} solid #3b3d30}
.co-minimap-canvas{display:block;width:100%;height:100%;cursor:pointer;image-rendering:pixelated}

/* Left: the riveted side console (196 x 182 units), five plates with a round lamp. */
.co-sidebar{position:absolute;left:0;bottom:${u(132)};width:${u(196)};height:${u(182)};pointer-events:auto;clip-path:polygon(0 0,${u(164)} 0,${u(164)} ${u(165)},100% ${u(165)},100% 100%,0 100%)}
.co-side-tab{position:absolute;left:${u(25)};top:${u(5)};width:${u(41)};height:${u(13)};display:flex;align-items:center;justify-content:center;font-size:${font(9)};line-height:1}
.co-side-btn{position:absolute;left:${u(22)};width:${u(112)};height:${u(21)};display:flex;align-items:center;padding:0 ${u(4)} 0 ${u(28)};cursor:pointer;font:inherit;text-align:left}
.co-side-btn:nth-of-type(1){top:${u(29)}}
.co-side-btn:nth-of-type(2){top:${u(56)}}
.co-side-btn:nth-of-type(3){top:${u(83)}}
.co-side-btn:nth-of-type(4){top:${u(110)}}
.co-side-btn:nth-of-type(5){top:${u(137)}}
.co-side-lamp{position:absolute;left:${u(9)};top:${u(3)};width:${u(15)};height:${u(15)};border-radius:50%}
.co-side-label{font-size:${font(13)};font-weight:700;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* Bottom left: the selection screen (283 x 120 units), glass 231 x 106 inside the frame. */
.co-selection{position:absolute;left:0;bottom:0;width:${u(283)};height:${u(120)};padding:${u(9)} ${u(36)} ${u(5)} ${u(16)};overflow:visible}
.co-sel-glass{position:relative;height:100%;overflow:auto;padding:${u(5)} ${u(8)}}
.co-selection h2,.co-commands h2{margin:0 0 ${u(2)};font-size:${font(10)};text-transform:uppercase;letter-spacing:.05em;color:#9aa0a6}
.co-empty{color:#9aa0a6;margin:0}
.co-unit-name{font-weight:600;margin:0 0 ${u(2)};font-size:${font(13)}}
.co-unit-meta{margin:0 0 ${u(3)};color:#c4c7ca;font-size:${font(11)}}
.co-unit-note{margin:0 0 ${u(3)};color:#ffd54f;font-size:${font(10)}}
.co-unit-detail{margin:0 0 ${u(3)};color:#c4c7ca;font-size:${font(10)}}
.co-term-line{margin:${u(3)} 0 0;font-size:${font(12)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.co-cursor{display:inline-block;width:.6em;height:3px;margin-left:2px;vertical-align:baseline;background:currentColor;animation:co-cursor 1s steps(1) infinite}
@keyframes co-cursor{0%,100%{opacity:1}50%{opacity:0}}
@media (prefers-reduced-motion:reduce){.co-cursor{animation:none}}
.co-selection-enemy h2{color:#ff8a80}
.co-selection-enemy .co-hp>span{background:#e57373}
.co-hp{height:${u(6)};background:#2b2f33;border-radius:3px;overflow:hidden}
.co-hp>span{display:block;height:100%;background:#7cb342}
.co-hp.co-low>span{background:#e53935}
.co-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(${u(27)},1fr));gap:${u(2)};margin:0;padding:0;list-style:none}
.co-grid>li{display:flex}
.co-cell{width:100%;display:flex;align-items:center;gap:${u(2)};background:#2b2f33;border:1px solid transparent;border-radius:4px;padding:1px ${u(2)};color:inherit;font:${fpx(11)}/1.3 system-ui,sans-serif;text-align:center;cursor:pointer}
.co-cell:hover{background:#3b434b;border-color:#4a5159}
.co-cell:focus-visible{outline:3px solid #ffd54f;outline-offset:1px}
.co-cell b{flex:none;display:block;font-size:${fpx(12)}}
.co-cell .co-hp{flex:1;min-width:0}

`;

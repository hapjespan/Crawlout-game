import { HUD_LOOK_CSS, HUD_TOKENS_CSS } from './look.js';
import { BAR_UNIT_CSS, UNIT_CSS, font, fpx, px, u } from './units.js';

/** Indeling en basisstijl van de HUD. Alles onder .co-hud zodat er niets lekt; het uiterlijk (kleur, vorm) staat in look.ts. */
const HUD_LAYOUT_CSS = `
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

/* Bottom centre: the unit bar (407 x 134 units): header with the title, a dark well with one tile per unit type and,
   below the tiles, the buildings. The list of one opened type is a tray on top of the bar. */
.co-roster{position:absolute;left:${u(283)};bottom:0;width:${u(407)};height:${u(134)};padding:${u(36)} ${u(27)} ${u(6)} ${u(20)}}
.co-roster-title{position:absolute;left:${u(109)};top:${u(4)};width:${u(174)};height:${u(24)};margin:0;display:flex;align-items:center;justify-content:center;font-size:${font(15)};letter-spacing:.03em}
.co-roster-row{display:flex;flex-direction:column;gap:${u(3)};height:100%;min-height:0;padding:${u(4)} ${u(6)}}
.co-roster-groups{flex:1;min-height:0;display:flex;gap:${u(3)};align-items:stretch}
.co-building-buttons{position:absolute;left:${u(20)};bottom:calc(100% - ${u(2)});height:${u(30)};max-width:${u(367)};display:flex;gap:${u(4)};padding:${u(3)} ${u(5)} ${u(2)};min-width:0;pointer-events:auto}
.co-building-btn{position:relative;flex:0 1 auto;min-width:0;display:flex;align-items:center;gap:${u(4)};padding:0 ${u(6)};font:inherit;cursor:pointer;overflow:hidden}
.co-building-btn:focus-visible{outline:3px solid #ffd54f;outline-offset:1px}
.co-building-label{display:none}
.co-building-name{min-width:0;font-size:${font(10)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.co-building-count{font-size:${font(10)};color:#c4c7ca}
.co-building-badge{min-width:${u(14)};height:${u(14)};padding:0 ${u(3)};border-radius:2px;background:#ffd54f;color:#1a1a1a;font-size:${font(10)};font-weight:700;line-height:${u(14)};text-align:center}
.co-building-progress{position:absolute;left:0;right:0;bottom:0;height:${u(3)};background:#2b2f33}
.co-building-progress>span{display:block;height:100%;background:#42a5f5}
.co-roster-group{position:relative;flex:1 1 0;min-width:0;max-width:${u(64)};display:flex;flex-direction:column;padding:0;font:inherit;color:inherit;cursor:pointer;overflow:hidden;text-align:left}
.co-roster-group:disabled{opacity:.45;cursor:default}
.co-tile-portrait{flex:1 1 0;min-height:0;display:block;width:100%}
.co-tile-label{flex:none;display:block}
.co-tile-bar{flex:none;display:flex;height:${u(3)};background:#0b0d0a}
.co-tile-bar>i{display:block;min-width:2px}
.co-tile-bar>i[data-state=available]{background:#2e9a45}
.co-tile-bar>i[data-state=working]{background:#e08a12}
.co-tile-bar>i[data-state=busy]{background:#d33a35}
.co-roster-name{flex:none;display:block;padding:${u(2)} ${u(2)} 0;font-size:${font(11)};letter-spacing:-.02em;font-weight:700;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.co-tile-line{flex:none;display:flex;justify-content:space-between;gap:${u(3)};padding:0 ${u(4)} ${u(2)};font-size:${font(11)};line-height:1.15;white-space:nowrap}
.co-roster-count{font-weight:700}
.co-roster-idle{margin-left:auto;font-size:${font(11)};color:#ffd54f}
.co-roster-group.co-selected{outline:2px solid #7dff7d;outline-offset:-2px}
.co-roster-list{position:absolute;left:${u(20)};right:${u(27)};bottom:calc(100% + ${u(3)});z-index:1;display:flex;flex-wrap:wrap;gap:3px;max-height:${u(64)};overflow:auto;margin:0;padding:${u(4)};list-style:none}
.co-roster-list>li{flex:1 1 0;min-width:${px(8)};max-width:${px(72)}}
.co-roster-has-buildings .co-roster-list{bottom:calc(100% + ${u(32)})}
.co-roster-unit{position:relative;display:block;width:100%;height:${px(24)};padding:0;overflow:hidden;border:0;border-radius:3px;color:inherit;cursor:pointer}
.co-roster-unit[data-state=available]{background:#2e9a45}
.co-roster-unit[data-state=working]{background:#e08a12}
.co-roster-unit[data-state=busy]{background:#d33a35}
.co-roster-unit.co-selected{box-shadow:0 0 0 2px #fff}
.co-roster-fill{position:absolute;left:0;top:0;bottom:0;background:#ffd699;opacity:.9}
.co-roster-hp{position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(0,0,0,.5)}
.co-roster-hp>span{display:block;height:100%;background:rgba(255,255,255,.9)}
.co-roster-group:focus-visible,.co-roster-unit:focus-visible{outline:2px solid #ffd54f;outline-offset:1px}

/* Bottom right: the unit console (334 x 124 units). Everything inside sits at the spots of the art. */
.co-console{position:absolute;right:0;bottom:0;width:${u(334)};height:${u(124)};pointer-events:auto}
.co-console>*{position:absolute}
.co-con-tab{left:${u(14)};top:${u(7)};width:${u(56)};height:${u(21)};padding:${u(3)} ${u(2)} 0 ${u(3)}}
.co-con-name{display:block;font-size:${font(10.5)};font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.co-con-bar{position:absolute;left:${u(3)};right:${u(3)};bottom:${u(3)};height:${u(4)};background:#0b0d0a}
.co-con-bar>span{display:block;height:100%;background:#35b848}
.co-con-status{left:${u(74)};top:${u(7)};width:${u(196)};height:${u(21)};display:flex;align-items:center;padding:0 ${u(6)};font-size:${font(10)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.co-con-dots{left:${u(77)};top:${u(32)};width:${u(59)};height:${u(8)};display:flex;gap:${u(1.5)}}
.co-con-dots>i{flex:1;display:block;border-radius:50%;background:#1a2a1a}
.co-con-dots>i.co-lit{background:#35e048}
.co-con-portrait{left:${u(39)};top:${u(44)};width:${u(49)};height:${u(73)};overflow:hidden}
.co-con-hp{position:absolute;left:${u(3)};bottom:${u(2)};font-size:${font(9)};line-height:1.05;text-transform:uppercase}
.co-con-hp b{display:block;font-size:${font(11)}}
.co-con-weapon{left:${u(100)};top:${u(50)};width:${u(72)};height:${u(69)};overflow:hidden}
.co-con-slot{left:${u(182)};top:${u(50)};width:${u(66)};height:${u(69)};overflow:hidden}
.co-con-title{position:absolute;right:${u(5)};top:${u(4)};font-size:${font(10)};font-weight:700;text-transform:uppercase;letter-spacing:.03em;max-width:90%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.co-con-gun{position:absolute;left:${u(4)};top:${u(14)};width:${u(64)};height:${u(34)}}
.co-con-big{position:absolute;left:${u(4)};bottom:${u(3)};font-size:${font(9)};line-height:1.05;text-transform:uppercase}
.co-con-big b{display:block;font-size:${font(14)}}
.co-con-gauge{position:absolute;right:${u(3)};top:${u(16)};bottom:${u(5)};width:${u(4)};background:#0b0d0a}
.co-con-gauge>span{position:absolute;left:0;right:0;bottom:0;display:block;background:#35e048}
.co-con-gauge.co-low>span{background:#ff6a5a}
.co-con-text{position:absolute;left:${u(5)};right:${u(5)};top:${u(26)};font-size:${font(11)};font-weight:700;text-align:center;word-break:break-word}
.co-con-abilities{position:absolute;left:${u(4)};right:${u(4)};top:${u(18)};margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:${u(4)}}
.co-con-abilities li{position:relative;font-size:${font(10)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-bottom:${u(4)}}
.co-con-abilities b{margin-right:${u(3)}}
.co-con-abilities li>span{position:absolute;left:0;bottom:0;height:${u(2.5)};background:#35e048}
.co-con-abilities li.co-cooling>span{background:#f4a62a}
.co-con-round{left:${u(253)};top:${u(45)};width:${u(21)};height:${u(72)}}
.co-round-btn{position:absolute;left:0;width:100%;padding:0;border:0;background:transparent;cursor:pointer;font:inherit}
.co-round-btn:nth-child(1){top:0;height:${u(22)}}
.co-round-btn:nth-child(2){top:${u(24)};height:${u(23)}}
.co-round-btn:nth-child(3){top:${u(50)};height:${u(22)}}
.co-con-keys{left:${u(291)};top:${u(11)};width:${u(36)};height:${u(108)}}
.co-key-plate{position:absolute;left:0;width:100%;height:${u(19)};padding:0;font:inherit;font-size:${font(11)};font-weight:700;letter-spacing:.03em;cursor:pointer}
.co-key-plate:nth-child(1){top:0}
.co-key-plate:nth-child(2){top:${u(22)}}
.co-key-plate:nth-child(3){top:${u(44)}}
.co-key-plate:nth-child(4){top:${u(67)}}
.co-key-plate:nth-child(5){top:${u(89)}}
.co-side-btn:focus-visible,.co-round-btn:focus-visible,.co-key-plate:focus-visible{outline:3px solid #ffd54f;outline-offset:1px}

/* Above the console: the card window directly above the commands, both as wide as the console. */
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

/** Indeling plus het bitmap-vrije "Roest en Fosfor"-uiterlijk (tokens en fallback). */
export const HUD_CSS = HUD_LAYOUT_CSS + HUD_TOKENS_CSS + HUD_LOOK_CSS;

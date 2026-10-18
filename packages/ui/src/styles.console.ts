import { font, px, u } from './units.js';

/** HUD layout, part 2 (concatenated in styles.ts): the unit bar with its buildings and the unit console. */
export const HUD_LAYOUT_CONSOLE_CSS = `/* Bottom centre: the unit bar (407 x 134 units): header with the title, a dark well with one tile per unit type and,
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

`;

import { u, font, fpx, px } from './units.js';

/** HUD look, part 1 (concatenated in look.ts): plates, consoles, glass, the top bar, hero, dominance, minimap, side console and selection. */
export const HUD_LOOK_PANELS_CSS = `
.co-hud{font-family:var(--font-ui);font-size:${fpx(15)};color:var(--ink)}

/* Plates: dark, bevelled, four rivets as corner dots. */
.co-hud .co-panel{
background:
radial-gradient(circle,#8a8c74 0 1.2px,#24261d 1.9px,transparent 2.6px) left 4px top 4px/8px 8px no-repeat,
radial-gradient(circle,#8a8c74 0 1.2px,#24261d 1.9px,transparent 2.6px) right 4px top 4px/8px 8px no-repeat,
radial-gradient(circle,#8a8c74 0 1.2px,#24261d 1.9px,transparent 2.6px) left 4px bottom 4px/8px 8px no-repeat,
radial-gradient(circle,#8a8c74 0 1.2px,#24261d 1.9px,transparent 2.6px) right 4px bottom 4px/8px 8px no-repeat,
radial-gradient(120% 80% at 20% 0%,rgba(150,80,30,.10),transparent 60%),
linear-gradient(180deg,var(--plate-700),var(--plate-800));
border:1px solid var(--edge-dark);border-radius:3px;padding:${px(10)};color:var(--ink);
box-shadow:inset 0 1px 0 rgba(255,255,255,.07),inset 0 -2px 0 rgba(0,0,0,.45),0 3px 8px rgba(0,0,0,.55)}
.co-hud h2{font-family:var(--font-ui);font-weight:700;font-size:${fpx(13)};letter-spacing:.08em;color:var(--act-dim)}
.co-hud .co-empty{color:var(--locked-text)}

/* The consoles are cases of riveted metal; the lit parts (windows, screens, key plates) sit in them. */
.co-hud .co-counters,.co-hud .co-sidebar,.co-hud .co-roster,.co-hud .co-console,.co-hud .co-selection{
background:linear-gradient(180deg,#4a4a35,#2d2d20);border:1px solid #14150d;border-radius:3px;
box-shadow:inset 0 1px 0 rgba(255,255,255,.14),inset 0 -2px 0 rgba(0,0,0,.5),0 3px 8px rgba(0,0,0,.55)}
.co-hud .co-counters{background:linear-gradient(180deg,var(--brass),var(--brass-lo));border-color:#2a2410;border-radius:4px;padding:0}
.co-hud .co-selection{padding:${u(9)} ${u(36)} ${u(5)} ${u(16)}}
.co-hud .co-roster{background:linear-gradient(180deg,var(--olive),var(--olive-lo));padding:${u(36)} ${u(27)} ${u(6)} ${u(20)}}
.co-hud .co-sidebar{padding:0;background:linear-gradient(90deg,#3c3d33,#22231c);border-radius:2px}
.co-hud .co-console{padding:0}

/* Windows and screens (glass): data in phosphor, scanlines and a vignette over it. */
.co-hud .co-sel-glass,.co-hud .co-dominance,.co-hud .co-con-status,.co-hud .co-con-tab,
.co-hud .co-con-portrait,.co-hud .co-con-weapon,.co-hud .co-con-slot{
background:var(--vignette),linear-gradient(180deg,var(--glass-top),var(--glass-bottom));
box-shadow:inset 0 0 14px rgba(0,0,0,.8),0 1px 0 rgba(255,255,255,.1)}
.co-hud .co-counter{background:linear-gradient(180deg,#1e1f1d,#141514);box-shadow:inset 0 0 8px #000,0 1px 0 rgba(205,187,122,.6)}
.co-hud .co-roster-row{background:linear-gradient(180deg,#25282a,#14171a);border-radius:${u(3)};box-shadow:inset 0 0 10px rgba(0,0,0,.7)}
.co-hud .co-con-tab{background:linear-gradient(180deg,#2a2c26,#1c1d19)}
.co-hud .co-con-weapon,.co-hud .co-con-slot{background:linear-gradient(180deg,#34332b,#211f19);color:var(--gold)}
.co-hud .co-sel-glass,.co-hud .co-dominance,.co-hud .co-con-status,.co-hud .co-con-portrait{color:var(--phos-500);text-shadow:0 0 5px var(--phos-glow)}
.co-hud .co-sel-glass::after,.co-hud .co-con-portrait::after,.co-hud .co-dominance::after{
content:"";position:absolute;inset:0;pointer-events:none;border-radius:inherit;background:var(--vignette),var(--scanlines)}
.co-hud .co-dominance{border:1px solid #05070a;border-radius:3px;background:var(--vignette),linear-gradient(180deg,#2a2c2b,#1a1c1b);color:#dcd8cb;text-shadow:none;box-shadow:inset 0 0 12px rgba(0,0,0,.7),0 2px 6px rgba(0,0,0,.5)}
.co-hud .co-dom-num{color:var(--phos-500);text-shadow:0 0 5px var(--phos-glow)}
.co-hud .co-con-portrait{background:radial-gradient(circle at 50% 36%,#2f8a3a 0 18%,transparent 19%),radial-gradient(ellipse at 50% 100%,#2f8a3a 0 42%,transparent 43%),linear-gradient(180deg,#0f2a14,#071509)}
.co-hud .co-con-portrait[data-portrait=none]{background:linear-gradient(180deg,#0b1a0e,#050d07)}

/* Top bar: counters in windows on a brass plate; the gauge is a dial. */
.co-hud .co-counter-label{color:#a8a592;text-shadow:none}
.co-hud .co-counter-value{color:var(--ink);text-shadow:0 0 5px rgba(232,228,212,.35)}
.co-hud .co-counter-value.co-full{color:var(--danger-text);text-shadow:0 0 5px rgba(255,120,100,.5)}
.co-hud .co-counter-robots{border-radius:0 0 3px 3px}
.co-hud .co-gauge{background:radial-gradient(circle,#181a19 0 62%,#0b0c0b 64%,#6c6038 66%,#2a2410 100%);box-shadow:0 1px 2px rgba(0,0,0,.6)}

/* Hero: a dark glass note under the bar (as in the mockup). */
.co-hud .co-hero{background:rgba(13,15,17,.84);border:1px solid rgba(255,255,255,.08);border-radius:${px(5)};padding:${u(6)} ${u(8)};box-shadow:0 3px 8px rgba(0,0,0,.5)}
.co-hud .co-hero h2{font-weight:600}
.co-hud .co-special{background:none;box-shadow:none;text-shadow:none;padding:0;border:0}
.co-hud .co-special b{color:var(--locked-text);text-shadow:none}
.co-hud .co-special span{color:#fff}
.co-hud .co-xp{background:#04100a;border:1px solid #2a2010;border-radius:1px}
.co-hud .co-xp>span{background:linear-gradient(180deg,var(--amber-700),var(--amber-500))}
.co-hud .co-revives{color:var(--act-dim)}

/* Dominance: terminal line on glass. */
.co-hud .co-dom-text{font-family:var(--font-term);font-weight:700;letter-spacing:.02em}
.co-hud .co-dom-bar{background:#04100a;border:1px solid #0b2a14;border-radius:1px}
.co-hud .co-dom-bar>span{background:linear-gradient(180deg,#a8ff90,#35b848);box-shadow:0 0 6px var(--phos-glow)}
.co-hud .co-dom-warn .co-dom-text,.co-hud .co-dom-warn .co-dom-num{color:var(--amber-700);text-shadow:0 0 5px var(--amber-glow)}
.co-hud .co-dom-warn .co-dom-bar>span{background:var(--hazard);box-shadow:none}

/* Top right: Opgeven is a dark glass chip, the minimap sits in a stone frame. */
.co-hud .co-top-right .co-btn{background:rgba(13,15,17,.82);border:1px solid rgba(255,255,255,.1);color:var(--ink);text-shadow:none;box-shadow:none;font-weight:500}
.co-hud .co-minimap{border-color:#4b4a3a;border-radius:3px;background:#07090a;box-shadow:inset 0 0 0 1px #05070a,0 3px 8px rgba(0,0,0,.6)}
.co-hud .co-minimap-canvas{box-shadow:0 0 0 1px #05070a}

/* Side console: dark steel case, five plates each with a red lamp and a gold label. */
.co-hud .co-side-tab{background:linear-gradient(180deg,#0c2610,#06160a);color:var(--phos-500);text-shadow:0 0 5px var(--phos-glow);font-family:var(--font-term);text-transform:uppercase;letter-spacing:.1em}
.co-hud .co-side-btn{background:linear-gradient(180deg,#7b7658,#4d4a35);border:1px solid #14150d;border-radius:2px;color:var(--gold);text-shadow:0 1px 0 rgba(0,0,0,.5);box-shadow:inset 0 1px 0 rgba(255,255,255,.25),0 2px 3px rgba(0,0,0,.5)}
.co-hud .co-side-btn:hover{background:linear-gradient(180deg,#8a8564,#59553c)}
.co-hud .co-side-btn:active{transform:translateY(1px)}
.co-hud .co-side-btn[aria-pressed="true"]{color:var(--amber-700);text-shadow:0 0 6px var(--amber-glow)}
.co-hud .co-side-lamp{background:radial-gradient(circle at 40% 35%,#ff7a6a,#b02820 55%,#4a0e0a);box-shadow:0 0 0 2px #3a2a22,0 0 6px rgba(255,70,50,.5)}
.co-hud .co-quick-off{filter:brightness(.7) saturate(.75)}
.co-hud .co-quick-off .co-side-lamp{box-shadow:0 0 0 2px #3a2a22}

/* Selection: CRT with terminal text; an enemy turns the glass red. */
.co-hud .co-sel-glass{border:1px solid #05070a;border-radius:${px(6)};box-shadow:inset 0 0 18px rgba(0,0,0,.85),0 0 0 3px #2a2d21}
.co-hud .co-selection h2{font-family:var(--font-term);letter-spacing:.2em;color:var(--phos-500);font-size:${font(11)}}
.co-hud .co-unit-name{font-family:var(--font-term);font-weight:700;letter-spacing:.02em}
.co-hud .co-unit-meta,.co-hud .co-unit-detail{font-family:var(--font-term);color:var(--phos-500);opacity:.82}
.co-hud .co-unit-note{font-family:var(--font-term);color:var(--amber-700);text-shadow:0 0 5px var(--amber-glow)}
.co-hud .co-selection .co-empty{font-family:var(--font-term);font-size:${font(11)};color:var(--phos-500);opacity:.7}
.co-hud .co-term-line{font-family:var(--font-term);font-weight:700}
.co-hud .co-selection .co-hp,.co-hud .co-selection .co-xp{background:#04100a;border:1px solid #0b2a14;border-radius:1px}
.co-hud .co-hp>span{background:repeating-linear-gradient(90deg,#7dff6a 0 5px,#04100a 5px 6px);box-shadow:0 0 6px var(--phos-glow)}
.co-hud .co-hp.co-low>span{background:repeating-linear-gradient(90deg,#ff6a5a 0 5px,#2a0a08 5px 6px)}
.co-hud .co-cell{background:linear-gradient(180deg,#0e1f12,#08140b);border:1px solid #0b2a14;border-radius:2px;color:var(--phos-500);font:${fpx(11)}/1.3 var(--font-term)}
.co-hud .co-cell:hover{background:#12301a;border-color:var(--phos-700)}
.co-hud .co-selection-enemy .co-sel-glass{color:#ff8f85;text-shadow:0 0 5px rgba(255,90,70,.55);background:var(--vignette),linear-gradient(180deg,#2a0d0a,#150504)}
.co-hud .co-selection-enemy h2,.co-hud .co-selection-enemy .co-unit-meta,.co-hud .co-selection-enemy .co-unit-detail{color:#ff8f85}
.co-hud .co-selection-enemy .co-hp>span{background:repeating-linear-gradient(90deg,#ff6a5a 0 5px,#2a0a08 5px 6px);box-shadow:0 0 6px rgba(255,90,70,.5)}
.co-hud .co-selection-enemy .co-hp{border-color:#4a1612;background:#150504}

`;

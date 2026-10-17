/**
 * The look of the screens before the match: the committed, bitmap-free "Roest en Fosfor" (riveted rusty plates, a CRT
 * console with phosphor text, amber for action, scanlines and a vignette) built on the HUD tokens (look.ts), so the menu
 * and the HUD cannot drift apart. The dev-only bitmap skin lays the designer's art over the same class names
 * (`menuSkinCss` in skin.ts).
 *
 * Everything is sized in `--m`, one pixel of a 1280x720 window, growing with the window up to 4K (and never below 0.8,
 * so text stays readable on small windows: every font size here is `max(11px, ...)`). Nothing blinks faster than 3 Hz:
 * the flicker is a faint overlay with two short dips every 3.7 s, the cursor blinks at 1 Hz, and
 * `prefers-reduced-motion` turns the motion off.
 */

/** A length in menu units. */
export const m = (n: number): string => `calc(var(--m) * ${n})`;
/** A font size in menu units, never under 11 px. */
export const mf = (n: number): string => `max(11px, ${m(n)})`;

export const MENU_CSS = `
.co-hud.co-menu,.co-hud.co-m-endroot{--m:max(0.8px,min(calc(100vw / 1280),calc(100vh / 720)))}
.co-hud.co-menu{position:fixed;inset:0;z-index:30;pointer-events:auto;
display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:auto;padding:${m(24)};
font:${mf(16)}/1.3 var(--font-ui);color:var(--ink);overscroll-behavior:contain}
.co-menu *{box-sizing:border-box}
.co-menu[hidden]{display:none}

/* The scene behind: haze, scanlines, a vignette and a faint flicker. Plain gradients, no bitmaps. */
.co-m-fx{position:fixed;inset:0;pointer-events:none}
.co-m-haze{background:
radial-gradient(80% 60% at 50% 38%,rgba(244,166,42,.12),rgba(244,166,42,0) 70%),
radial-gradient(120% 90% at 50% 100%,rgba(120,70,20,.35),rgba(120,70,20,0) 60%),
linear-gradient(180deg,rgba(6,8,5,.5),rgba(6,8,5,.72) 60%,rgba(6,8,5,.9))}
.co-m-haze[data-still]{background:
radial-gradient(70% 45% at 50% 62%,rgba(244,166,42,.22),rgba(244,166,42,0) 70%),
linear-gradient(180deg,#171a12 0%,#241d12 52%,#3a2a14 58%,#1a140a 59%,#0b0d08 100%)}
.co-m-scan{background:var(--scanlines),radial-gradient(130% 120% at 50% 45%,rgba(0,0,0,0) 45%,rgba(0,0,0,.62) 100%)}
.co-m-flicker{background:#cfffc0;opacity:0;animation:co-m-flicker 3.7s steps(1) infinite}
@keyframes co-m-flicker{0%,100%{opacity:0}91%{opacity:.045}93%{opacity:0}96%{opacity:.03}97%{opacity:0}}
.co-m-screen-root{position:relative;z-index:1;width:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;margin:auto 0}
@media (prefers-reduced-motion:reduce){.co-m-flicker{animation:none}.co-m-type{animation:none!important;width:auto!important}}

/* Plates: the HUD plate (rivets, bevel) a bit larger; panels hold the content of a screen. */
.co-hud .co-m-plate{position:relative;padding:${m(28)} ${m(34)};border-radius:${m(4)};width:100%;
background:
radial-gradient(circle at 36% 32%,#d6d2b6 0,#8e9078 26%,#3a3c2c 56%,rgba(0,0,0,0) 64%) left ${m(8)} top ${m(8)}/${m(15)} ${m(15)} no-repeat,
radial-gradient(circle at 36% 32%,#d6d2b6 0,#8e9078 26%,#3a3c2c 56%,rgba(0,0,0,0) 64%) right ${m(8)} top ${m(8)}/${m(15)} ${m(15)} no-repeat,
radial-gradient(circle at 36% 32%,#d6d2b6 0,#8e9078 26%,#3a3c2c 56%,rgba(0,0,0,0) 64%) left ${m(8)} bottom ${m(8)}/${m(15)} ${m(15)} no-repeat,
radial-gradient(circle at 36% 32%,#d6d2b6 0,#8e9078 26%,#3a3c2c 56%,rgba(0,0,0,0) 64%) right ${m(8)} bottom ${m(8)}/${m(15)} ${m(15)} no-repeat,
radial-gradient(55% 45% at 12% 0%,rgba(170,80,25,.2),rgba(170,80,25,0) 70%),
radial-gradient(45% 40% at 92% 100%,rgba(130,60,15,.18),rgba(130,60,15,0) 70%),
radial-gradient(30% 25% at 70% 10%,rgba(150,70,20,.1),rgba(150,70,20,0) 70%),
linear-gradient(180deg,var(--plate-700),var(--plate-800))}
.co-m-headrow{display:flex;flex-wrap:wrap;align-items:center;gap:${m(8)} ${m(20)};margin:0 0 ${m(14)}}
.co-m-headrow>.co-m-tab{margin:0}
.co-m-headrow>.co-m-heading{margin:0;font-size:${mf(26)}}
.co-m-tab{display:inline-flex;align-items:center;height:${m(26)};padding:0 ${m(14)};margin:0 0 ${m(16)};
font:700 ${mf(14)}/1 var(--font-term);letter-spacing:.22em;text-transform:uppercase;color:var(--phos-500);text-shadow:0 0 6px var(--phos-glow);
background:linear-gradient(180deg,#0c2610,#06160a);border:1px solid #05070a;box-shadow:inset 0 0 8px rgba(0,0,0,.8),0 0 0 2px #2a2d21}
.co-m-heading{margin:0 0 ${m(18)};font-weight:800;font-size:${mf(34)};letter-spacing:.1em;text-transform:uppercase;color:var(--amber-700);text-shadow:0 0 10px var(--amber-glow),0 2px 0 rgba(0,0,0,.6)}
.co-m-inline-label{font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--act-dim);margin-right:${m(8)}}
.co-m-sub{margin:0 0 ${m(14)};font:${mf(15)}/1.35 var(--font-term);color:var(--phos-500);opacity:.88}
.co-m-section{margin:0 0 ${m(12)}}
.co-m-section>h2,.co-m-label{display:block;margin:0 0 ${m(8)};font:700 ${mf(14)}/1.2 var(--font-term);letter-spacing:.2em;text-transform:uppercase;color:var(--act-dim)}

/* Title: stamped on a rusty plate, amber with a phosphor glow. */
.co-m-titleplate{display:flex;flex-direction:column;align-items:center;text-align:center;gap:${m(10)};padding:${m(34)} ${m(70)} ${m(26)};overflow:hidden}
.co-m-titleplate::after{content:"";position:absolute;inset:0;pointer-events:none;border-radius:inherit;background:var(--scanlines),radial-gradient(120% 120% at 50% 40%,rgba(0,0,0,0) 55%,rgba(0,0,0,.5) 100%)}
.co-m-title{margin:0;font-weight:800;font-size:max(44px,${m(150)});line-height:.95;letter-spacing:.16em;padding-left:.16em;text-transform:uppercase;
background:linear-gradient(180deg,#ffe3a0 0%,#f4a62a 48%,#9a6a14 100%);-webkit-background-clip:text;background-clip:text;color:transparent;
filter:drop-shadow(0 0 ${m(14)} rgba(244,166,42,.5)) drop-shadow(0 ${m(3)} 0 #2a1a04)}
.co-m-title-small{font-size:max(36px,${m(76)})}
.co-m-tagline{margin:0;font:700 ${mf(16)}/1.2 var(--font-term);letter-spacing:.34em;padding-left:.34em;text-transform:uppercase;color:var(--phos-500);text-shadow:0 0 6px var(--phos-glow)}
.co-m-hazard{align-self:stretch;height:${m(12)};background:var(--hazard);border-top:1px solid #05070a;border-bottom:1px solid #05070a;opacity:.9}

/* The CRT console: dark glass, phosphor text, a typing terminal line. */
.co-m-crt{position:relative;width:100%;padding:${m(18)} ${m(24)};background:var(--vignette),linear-gradient(180deg,var(--glass-top),var(--glass-bottom));
border:1px solid #05070a;border-radius:${m(6)};box-shadow:inset 0 0 ${m(24)} rgba(0,0,0,.85),0 0 0 ${m(3)} #2a2d21;color:var(--phos-500);text-shadow:0 0 6px var(--phos-glow);font-family:var(--font-term)}
.co-m-crt::after{content:"";position:absolute;inset:0;pointer-events:none;border-radius:inherit;background:var(--vignette),var(--scanlines)}
.co-m-line{margin:${m(4)} 0;font-size:${mf(17)};font-weight:700;letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.co-m-type{display:inline-block;max-width:100%;overflow:hidden;white-space:nowrap;vertical-align:bottom;width:calc(var(--n) * (1ch + .04em) + .1em);animation:co-m-type calc(var(--n) * 30ms) steps(var(--n)) both}
@keyframes co-m-type{from{width:0}to{width:calc(var(--n) * (1ch + .04em) + .1em)}}
.co-m-bar{height:${m(20)};margin:${m(10)} 0 ${m(4)};padding:${m(3)};background:#04100a;border:1px solid #0b2a14;border-radius:1px}
.co-m-bar>span{display:block;height:100%;width:var(--p);transition:width .25s linear;
background:repeating-linear-gradient(90deg,#8dff6f 0 ${m(10)},#04100a ${m(10)} ${m(12)});box-shadow:0 0 8px var(--phos-glow)}
.co-m-pct{display:flex;justify-content:space-between;font-size:${mf(14)};letter-spacing:.12em;text-transform:uppercase;opacity:.9}
.co-m-cursor{display:inline-block;width:.6em;height:${m(3)};margin-left:2px;vertical-align:baseline;background:currentColor;animation:co-cursor 1s steps(1) infinite}
@media (prefers-reduced-motion:reduce){.co-m-cursor{animation:none}}
.co-menu .co-m-press{display:block;width:100%;margin:${m(10)} 0 0;padding:${m(14)} ${m(10)};cursor:pointer;font:800 ${mf(26)}/1 var(--font-ui);letter-spacing:.2em;text-transform:uppercase;text-align:center;
color:var(--amber-700);text-shadow:0 0 10px var(--amber-glow);background:rgba(244,166,42,.06);border:1px solid rgba(244,166,42,.55);border-radius:2px}
.co-menu .co-m-press:hover,.co-menu .co-m-press:focus-visible{background:rgba(244,166,42,.16)}
.co-m-press-hint{display:block;margin-top:${m(6)};font:700 ${mf(13)}/1.2 var(--font-term);letter-spacing:.16em;color:var(--phos-500);opacity:.8}
.co-m-loading-note{margin:${m(10)} 0 0;font-size:${mf(14)};letter-spacing:.14em;text-transform:uppercase;opacity:.8}
.co-m-version{margin:${m(14)} 0 0;font:${mf(12)}/1.2 var(--font-term);letter-spacing:.14em;color:var(--locked-text);text-align:center}

/* Buttons. Menu items are big phosphor-green keys that turn amber on hover and focus. */
.co-menu .co-btn{padding:${m(8)} ${m(18)}}
.co-menu .co-m-btn{flex-direction:row;justify-content:center;min-height:${m(46)};font-size:${mf(20)};font-weight:700;letter-spacing:.08em;text-transform:uppercase;gap:${m(10)}}
.co-menu .co-m-btn:focus-visible,.co-menu .co-m-item:focus-visible,.co-menu .co-m-choice:focus-visible,.co-menu .co-m-press:focus-visible,.co-menu .co-m-field:focus-visible{outline:3px solid var(--amber-700);outline-offset:${m(3)}}
.co-menu .co-m-btn:focus-visible,.co-menu .co-m-item:hover,.co-menu .co-m-item:focus-visible{color:var(--amber-700);border-color:var(--amber-500);text-shadow:0 0 6px var(--amber-glow)}
.co-menu .co-btn.co-m-primary{color:#1c1810;text-shadow:none;background:linear-gradient(180deg,#ffd27a,#d9951c);border-color:#fff1c2}
.co-menu .co-btn.co-m-primary:hover:not(:disabled){background:linear-gradient(180deg,#ffe0a0,#e6a424)}
.co-menu .co-btn.co-m-primary:disabled{color:var(--locked-text);background:linear-gradient(180deg,#34332b,#25241e);border-color:#0d100a}
.co-m-actions{display:flex;flex-wrap:wrap;gap:${m(14)};align-items:center;justify-content:space-between;margin-top:${m(18)}}
.co-m-actions-end{display:flex;flex-wrap:wrap;gap:${m(14)};align-items:center;margin-left:auto}

.co-m-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:${m(14)}}
.co-menu .co-m-item{display:grid;grid-template-columns:${m(44)} minmax(0,1fr) ${m(24)};align-items:center;column-gap:${m(16)};width:100%;min-height:${m(78)};padding:${m(10)} ${m(22)};text-align:left;
font-family:var(--font-ui);cursor:pointer;color:var(--phos-500);text-shadow:0 0 6px var(--phos-glow);
background:linear-gradient(180deg,#3a4132,#252b1e);border:1px solid #0d100a;border-radius:4px;
box-shadow:inset 0 1px 0 rgba(255,255,255,.12),inset 0 -2px 0 rgba(0,0,0,.4),0 2px 3px rgba(0,0,0,.5)}
.co-menu .co-m-item:hover,.co-menu .co-m-item:focus-visible{background:linear-gradient(180deg,#4a3a18,#2b2210);box-shadow:inset 0 0 12px rgba(244,166,42,.35),0 0 14px rgba(244,166,42,.3)}
.co-menu .co-m-item:active{transform:translateY(1px)}
.co-m-item-label{display:block;font-size:${mf(32)};font-weight:800;letter-spacing:.08em;text-transform:uppercase;line-height:1.05}
.co-m-item-sub{display:block;margin-top:${m(3)};font:${mf(14)}/1.2 var(--font-term);letter-spacing:.04em;text-transform:none;color:var(--act-dim);text-shadow:none}
.co-m-caret{font-size:${mf(30)};font-weight:800;opacity:0;text-align:right}
.co-menu .co-m-item:hover .co-m-caret,.co-menu .co-m-item:focus-visible .co-m-caret{opacity:1}
.co-menu .co-key.co-m-key{justify-self:center;padding:${m(2)} ${m(9)};font-size:${mf(18)};min-width:${m(34)}}
.co-m-hints{margin:${m(18)} 0 0;font:${mf(13)}/1.3 var(--font-term);letter-spacing:.12em;text-transform:uppercase;color:var(--locked-text);text-align:center}
.co-m-hints kbd{font:inherit;color:var(--amber-700);border:1px solid #5a4318;border-radius:2px;padding:0 ${m(5)};background:#1c150a}

/* Choices: cards (game type, faction) and segmented buttons (AI faction, settings). Radio groups: arrows move, Tab leaves. */
.co-m-cards{display:grid;gap:${m(12)};margin:0;padding:0;border:0}
.co-m-cards[data-cols="2"]{grid-template-columns:repeat(2,minmax(0,1fr))}
.co-m-cards[data-cols="3"]{grid-template-columns:repeat(3,minmax(0,1fr))}
.co-menu .co-m-choice{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:${m(3)};min-width:0;padding:${m(9)} ${m(12)};text-align:left;cursor:pointer;font-family:var(--font-ui);
color:var(--ink);background:linear-gradient(180deg,#232a1d,#161b12);border:1px solid #0d100a;border-radius:3px;box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 2px 3px rgba(0,0,0,.45)}
.co-menu .co-m-choice:hover:not([aria-disabled=true]){background:linear-gradient(180deg,#2c3524,#1b2116);border-color:var(--phos-700)}
.co-menu .co-m-choice[aria-checked=true]{color:var(--amber-700);border-color:var(--amber-500);background:linear-gradient(180deg,#4a3a18,#2b2210);box-shadow:inset 0 0 10px rgba(244,166,42,.35),0 0 10px rgba(244,166,42,.28)}
.co-menu .co-m-choice[aria-disabled=true]{cursor:not-allowed;opacity:.62;border-style:dashed;border-color:#6b6e58}
.co-m-choice-name{font-size:${mf(20)};font-weight:800;letter-spacing:.06em;text-transform:uppercase;line-height:1.1}
.co-m-choice-tag{font:700 ${mf(12)}/1 var(--font-term);letter-spacing:.14em;text-transform:uppercase;color:var(--phos-500);text-shadow:none}
.co-menu .co-m-choice[aria-checked=true] .co-m-choice-tag{color:var(--amber-700)}
.co-m-choice-text{font-size:${mf(14)};line-height:1.25;color:var(--act-dim);text-shadow:none}
.co-menu .co-m-choice[aria-checked=true] .co-m-choice-text{color:var(--ink)}
.co-m-soon{display:inline-block;padding:${m(1)} ${m(7)};font:700 ${mf(12)}/1.3 var(--font-term);letter-spacing:.14em;text-transform:uppercase;color:var(--amber-700);background:#1c150a;border:1px solid #5a4318;border-radius:2px;text-shadow:none}
.co-m-seg{display:flex;flex-wrap:wrap;gap:${m(8)}}
.co-menu .co-m-seg .co-m-choice{flex:1 1 0;align-items:center;justify-content:center;min-width:${m(96)};padding:${m(9)} ${m(12)}}
.co-menu .co-m-seg .co-m-choice-name{font-size:${mf(18)}}

/* Two columns: the setup on the left, the map on the right. */
.co-m-split{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:${m(26)};align-items:start}
.co-m-mapcard{padding:${m(14)};background:linear-gradient(180deg,#171a14,#0e100c);border:1px solid #05070a;border-radius:3px;box-shadow:inset 0 0 12px rgba(0,0,0,.7)}
.co-m-mapname{margin:0 0 ${m(8)};font-size:${mf(26)};font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--gold)}
.co-m-minimap{display:block;width:100%;aspect-ratio:1;max-height:${m(270)};max-width:${m(270)};margin:0 auto ${m(10)};image-rendering:pixelated;background:#07090a;border:${m(5)} solid #3b3d30;box-shadow:0 0 0 1px #05070a,0 3px 8px rgba(0,0,0,.6)}
.co-m-facts{margin:0;padding:0;list-style:none;font:${mf(14)}/1.4 var(--font-term);color:var(--phos-500);text-shadow:0 0 5px var(--phos-glow)}
.co-m-facts li{display:flex;justify-content:space-between;gap:${m(10)};padding:${m(2)} 0;border-bottom:1px dotted #0b2a14}
.co-m-facts b{color:var(--act-dim);font-weight:700;text-shadow:none}
.co-m-legend{display:flex;gap:${m(14)};margin:0 0 ${m(8)};font:${mf(12)}/1.2 var(--font-term);color:var(--act-dim);justify-content:center;flex-wrap:wrap}
.co-m-dot{display:inline-block;width:${m(9)};height:${m(9)};margin-right:${m(5)};vertical-align:baseline}
.co-m-note{margin:${m(8)} 0 0;font:${mf(13)}/1.35 var(--font-term);color:var(--act-dim)}

/* Form fields: terminal lines. */
.co-m-form{display:grid;grid-template-columns:minmax(0,1fr);gap:${m(14)};max-width:${m(700)}}
.co-m-row{display:flex;flex-direction:column;gap:${m(6)}}
.co-m-row-help{margin:0;font:${mf(13)}/1.3 var(--font-term);color:var(--locked-text)}
.co-menu .co-m-field{width:100%;min-height:${m(46)};padding:${m(8)} ${m(14)};font:700 ${mf(20)}/1.2 var(--font-term);letter-spacing:.06em;color:var(--phos-500);text-shadow:0 0 5px var(--phos-glow);
background:linear-gradient(180deg,#06140a,#040d07);border:1px solid #0b2a14;border-radius:2px;box-shadow:inset 0 0 12px rgba(0,0,0,.8);caret-color:var(--amber-700)}
.co-menu .co-m-field::placeholder{color:#3d7a3a;text-shadow:none}
.co-menu .co-m-field:focus-visible{border-color:var(--amber-500)}
.co-m-status{display:flex;align-items:center;gap:${m(10)};margin:${m(14)} 0 0;padding:${m(8)} ${m(12)};font:700 ${mf(15)}/1.3 var(--font-term);letter-spacing:.04em;
background:linear-gradient(180deg,#171815,#0e0f0d);border:1px solid #05070a;color:var(--phos-500);text-shadow:0 0 5px var(--phos-glow);box-shadow:inset 0 0 10px rgba(0,0,0,.7)}
.co-m-status[data-tone=warn]{color:var(--amber-700);text-shadow:0 0 5px var(--amber-glow)}
.co-m-status[data-tone=bad]{color:var(--danger-text);text-shadow:0 0 5px rgba(255,90,70,.5)}
.co-m-lamp{flex:none;width:${m(12)};height:${m(12)};border-radius:50%;background:currentColor;box-shadow:0 0 6px currentColor}

/* Lobby. */
.co-m-roomhead{display:flex;flex-wrap:wrap;gap:${m(18)};align-items:center;justify-content:space-between;margin:0 0 ${m(14)}}
.co-m-roomcode{font:800 ${mf(34)}/1 var(--font-term);letter-spacing:.18em;color:var(--amber-700);text-shadow:0 0 8px var(--amber-glow);user-select:all}
.co-m-roomlabel{display:block;font:700 ${mf(12)}/1.2 var(--font-term);letter-spacing:.2em;color:var(--act-dim);text-transform:uppercase}
.co-m-players{list-style:none;margin:0 0 ${m(10)};padding:0;display:flex;flex-direction:column;gap:${m(8)}}
.co-m-player{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1.3fr) ${m(130)};gap:${m(14)};align-items:center;padding:${m(10)} ${m(14)};
background:linear-gradient(180deg,#232a1d,#161b12);border:1px solid #0d100a;border-radius:3px}
.co-m-player[data-you]{border-color:var(--phos-700)}
.co-m-pname{display:flex;flex-wrap:wrap;gap:${m(8)};align-items:center;min-width:0;font-size:${mf(22)};font-weight:700;color:var(--ink);overflow-wrap:anywhere}
.co-menu .co-tag{font:700 ${mf(12)}/1.4 var(--font-term);letter-spacing:.1em;text-transform:uppercase;padding:0 ${m(6)}}
.co-m-pstate{display:inline-flex;align-items:center;gap:${m(8)};justify-self:end;font:700 ${mf(15)}/1 var(--font-term);letter-spacing:.08em;text-transform:uppercase}
.co-m-pstate[data-ready]{color:var(--phos-500);text-shadow:0 0 5px var(--phos-glow)}
.co-m-pstate[data-wait]{color:var(--locked-text)}
.co-m-pfaction{font:${mf(16)}/1.2 var(--font-term);color:var(--act-dim)}
.co-menu .co-m-player .co-m-seg{flex-wrap:nowrap}
.co-menu .co-m-player .co-m-seg .co-m-choice{min-width:0;padding:${m(6)} ${m(8)}}
.co-menu .co-m-player .co-m-seg .co-m-choice-name{font-size:${mf(15)}}

/* Settings rows. */
.co-m-setrow{display:grid;grid-template-columns:minmax(${m(190)},.7fr) minmax(0,2fr);gap:${m(16)};align-items:center;padding:${m(10)} 0;border-bottom:1px dotted #2a2d21}
.co-m-setrow>.co-m-label{margin:0}
.co-m-setnote{grid-column:2;margin:${m(-4)} 0 0;font:${mf(13)}/1.35 var(--font-term);color:var(--locked-text)}
.co-m-reload{display:flex;flex-wrap:wrap;gap:${m(14)};align-items:center;margin-top:${m(14)};padding:${m(10)} ${m(14)};font:700 ${mf(15)}/1.3 var(--font-term);color:var(--amber-700);background:#1c150a;border:1px solid #5a4318}

/* In the match: the end overlay (Gewonnen / Verloren) with the way back to the menu. */
.co-hud.co-m-endroot{display:grid;place-items:center;background:rgba(6,8,5,.62);font:${mf(16)}/1.3 var(--font-ui)}
.co-hud .co-m-endplate{width:min(${m(620)},92vw);text-align:center;display:flex;flex-direction:column;align-items:center}
.co-m-endplate .co-m-title{font-size:max(44px,${m(110)})}
.co-m-endplate .co-m-title[data-lost]{background:linear-gradient(180deg,#ffc2b8 0%,#e0503c 50%,#7a1a12 100%);-webkit-background-clip:text;background-clip:text;filter:drop-shadow(0 0 ${m(14)} rgba(255,90,70,.45)) drop-shadow(0 ${m(3)} 0 #2a0a06)}
.co-m-end-actions{display:flex;flex-wrap:wrap;gap:${m(14)};justify-content:center;margin-top:${m(20)}}

@media (max-width:900px){
.co-m-split{grid-template-columns:minmax(0,1fr)}
.co-m-cards[data-cols="3"]{grid-template-columns:minmax(0,1fr)}
.co-m-player{grid-template-columns:minmax(0,1fr);gap:${m(6)}}
.co-m-pstate{justify-self:start}
.co-m-setrow{grid-template-columns:minmax(0,1fr)}
.co-m-setnote{grid-column:1}
}
`;

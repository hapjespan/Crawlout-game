import { m, mf } from './units.js';

/** Menu look, part 1 (concatenated in styles.ts): the root, the scene behind, plates, the title and the CRT console. */
export const MENU_SCREEN_CSS = `
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

`;

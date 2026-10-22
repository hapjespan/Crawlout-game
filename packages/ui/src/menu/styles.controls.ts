import { m, mf } from './units.js';

/** Menu look, part 2 (concatenated in styles.ts): buttons, choices, columns, form fields, lobby, settings and the end overlay. */
export const MENU_CONTROLS_CSS = `/* Buttons. Menu items are big phosphor-green keys that turn amber on hover and focus. */
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
/* Hero portrait on a card. Without a skin it stays an empty CRT panel, so the card keeps its shape either way. */
.co-m-choice-portrait{display:block;width:100%;aspect-ratio:321/456;margin-bottom:${m(8)};border:1px solid #05070a;border-radius:2px;background:linear-gradient(180deg,#0f2a14,#071509);box-shadow:inset 0 0 ${m(10)} rgba(0,0,0,.65)}
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

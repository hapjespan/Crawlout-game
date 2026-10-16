import { u, font } from './units.js';

/**
 * "Roest en Fosfor": the committed, bitmap-free look of the HUD. Plates are dark and riveted, text on a screen is
 * phosphor green (data) or amber (action), the screens carry scanlines and a vignette. Layout stays in styles.ts;
 * this file only changes colour, type and surface, so it is safe to swap or drop. The dev-only bitmap skin (skin.ts)
 * builds on the same tokens and class names, and lays the designer's console art over exactly these boxes.
 *
 * Readability rules from the design sheets: text 11px or larger, text never directly on a texture (always on a plate
 * colour or a glass), nothing blinks faster than 3 Hz (the only animations are the perk badge, 0.6 Hz, and the terminal
 * cursor, 1 Hz).
 */

/** Colour and type tokens. Values follow the token sheet; phosphor is the designer's #8dff6f. */
export const HUD_TOKENS_CSS = `
.co-hud{
--plate-900:#0b0d0a;--plate-800:#14170f;--plate-700:#1e2218;--plate-600:#2b3022;--edge-dark:#46493a;--edge-light:#6b6e58;
--ink:#e8e4d4;--act-dim:#c3bfac;--danger-text:#ff8f85;--locked-text:#a9a795;--paper:#d9cfae;--paper-ink:#1c1810;
--phos-500:#8dff6f;--phos-700:#2fa84a;--phos-glow:rgba(90,255,90,.55);--glass-top:#0f2412;--glass-bottom:#07120a;
--amber-700:#ffd27a;--amber-500:#f4a62a;--amber-780:#8a6410;--amber-glow:rgba(244,166,42,.55);
--font-ui:'Barlow Condensed','Arial Narrow','Roboto Condensed',system-ui,sans-serif;
--font-term:'Courier New',ui-monospace,Menlo,Consolas,monospace;
--scanlines:repeating-linear-gradient(0deg,rgba(0,0,0,.2) 0 1px,rgba(0,0,0,0) 1px 3px);
--vignette:radial-gradient(120% 120% at 50% 45%,rgba(0,0,0,0) 55%,rgba(0,0,0,.45) 100%);
--hazard:repeating-linear-gradient(-45deg,var(--amber-500) 0 6px,#17130a 6px 12px);
--gold:#e6d48a;--brass-hi:#cdbb7a;--brass:#8a7a42;--brass-lo:#4d4322;--olive:#4b4a2b;--olive-lo:#2f2e1b;
--key-green:#2f9a33;--key-green-lo:#1c6a22;
}
`;

/** The fallback look: gradients and borders only. */
export const HUD_LOOK_CSS = `
.co-hud{font-family:var(--font-ui);font-size:15px;color:var(--ink)}

/* Plates: dark, bevelled, four rivets as corner dots. */
.co-hud .co-panel{
background:
radial-gradient(circle,#8a8c74 0 1.2px,#24261d 1.9px,transparent 2.6px) left 4px top 4px/8px 8px no-repeat,
radial-gradient(circle,#8a8c74 0 1.2px,#24261d 1.9px,transparent 2.6px) right 4px top 4px/8px 8px no-repeat,
radial-gradient(circle,#8a8c74 0 1.2px,#24261d 1.9px,transparent 2.6px) left 4px bottom 4px/8px 8px no-repeat,
radial-gradient(circle,#8a8c74 0 1.2px,#24261d 1.9px,transparent 2.6px) right 4px bottom 4px/8px 8px no-repeat,
radial-gradient(120% 80% at 20% 0%,rgba(150,80,30,.10),transparent 60%),
linear-gradient(180deg,var(--plate-700),var(--plate-800));
border:1px solid var(--edge-dark);border-radius:3px;padding:10px;color:var(--ink);
box-shadow:inset 0 1px 0 rgba(255,255,255,.07),inset 0 -2px 0 rgba(0,0,0,.45),0 3px 8px rgba(0,0,0,.55)}
.co-hud h2{font-family:var(--font-ui);font-weight:700;font-size:13px;letter-spacing:.08em;color:var(--act-dim)}
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
.co-hud .co-hero{background:rgba(13,15,17,.84);border:1px solid rgba(255,255,255,.08);border-radius:5px;padding:${u(6)} ${u(8)};box-shadow:0 3px 8px rgba(0,0,0,.5)}
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
.co-hud .co-sel-glass{border:1px solid #05070a;border-radius:6px;box-shadow:inset 0 0 18px rgba(0,0,0,.85),0 0 0 3px #2a2d21}
.co-hud .co-selection h2{font-family:var(--font-term);letter-spacing:.2em;color:var(--phos-500);font-size:${font(13)}}
.co-hud .co-unit-name{font-family:var(--font-term);font-weight:700;letter-spacing:.02em}
.co-hud .co-unit-meta,.co-hud .co-unit-detail{font-family:var(--font-term);color:var(--phos-500);opacity:.82}
.co-hud .co-unit-note{font-family:var(--font-term);color:var(--amber-700);text-shadow:0 0 5px var(--amber-glow)}
.co-hud .co-selection .co-empty{font-family:var(--font-term);font-size:${font(11)};color:var(--phos-500);opacity:.7}
.co-hud .co-term-line{font-family:var(--font-term);font-weight:700}
.co-hud .co-selection .co-hp,.co-hud .co-selection .co-xp{background:#04100a;border:1px solid #0b2a14;border-radius:1px}
.co-hud .co-hp>span{background:repeating-linear-gradient(90deg,#7dff6a 0 5px,#04100a 5px 6px);box-shadow:0 0 6px var(--phos-glow)}
.co-hud .co-hp.co-low>span{background:repeating-linear-gradient(90deg,#ff6a5a 0 5px,#2a0a08 5px 6px)}
.co-hud .co-cell{background:linear-gradient(180deg,#0e1f12,#08140b);border:1px solid #0b2a14;border-radius:2px;color:var(--phos-500);font:11px/1.3 var(--font-term)}
.co-hud .co-cell:hover{background:#12301a;border-color:var(--phos-700)}
.co-hud .co-selection-enemy .co-sel-glass{color:#ff8f85;text-shadow:0 0 5px rgba(255,90,70,.55);background:var(--vignette),linear-gradient(180deg,#2a0d0a,#150504)}
.co-hud .co-selection-enemy h2,.co-hud .co-selection-enemy .co-unit-meta,.co-hud .co-selection-enemy .co-unit-detail{color:#ff8f85}
.co-hud .co-selection-enemy .co-hp>span{background:repeating-linear-gradient(90deg,#ff6a5a 0 5px,#2a0a08 5px 6px);box-shadow:0 0 6px rgba(255,90,70,.5)}
.co-hud .co-selection-enemy .co-hp{border-color:#4a1612;background:#150504}

/* Unit bar: olive header plate with the title, a dark well, tiles with a CRT portrait and a label. */
.co-hud .co-roster-title{font-size:${font(15)};font-weight:600;letter-spacing:.03em;color:var(--gold);text-shadow:0 1px 0 rgba(0,0,0,.6)}
.co-hud .co-roster-group{background:none;border:0;border-radius:2px;color:var(--ink)}
.co-hud .co-tile-portrait{border:1px solid #1f4a26;border-radius:2px}
.co-hud .co-tile-label{background:linear-gradient(180deg,#262a28,#181b1a);border:1px solid #3a3f38;border-radius:${u(3)};margin-top:${u(2)}}
.co-hud .co-roster-group:hover:not(:disabled) .co-tile-portrait{border-color:var(--phos-700)}
.co-hud .co-roster-group.co-selected .co-tile-portrait{border-color:var(--amber-500);box-shadow:0 0 0 1px var(--amber-500)}
.co-hud .co-roster-group.co-selected{outline:0}
.co-hud .co-tile-portrait{background:radial-gradient(circle at 50% 38%,#2f8a3a 0 20%,transparent 21%),radial-gradient(ellipse at 50% 105%,#2f8a3a 0 46%,transparent 47%),linear-gradient(180deg,#0f2a14,#071509)}
.co-hud .co-roster-count{color:var(--ink)}
.co-hud .co-roster-idle{color:var(--gold)}
.co-hud .co-roster-unit{box-shadow:inset 0 1px 0 rgba(255,255,255,.25),inset 0 -2px 0 rgba(0,0,0,.35)}
.co-hud .co-roster-unit.co-selected{box-shadow:0 0 0 2px var(--amber-700)}
.co-hud .co-roster-list{background:linear-gradient(180deg,var(--olive),var(--olive-lo));border:1px solid #14150d;border-radius:3px;box-shadow:0 3px 8px rgba(0,0,0,.55)}
.co-hud .co-building-buttons{background:linear-gradient(180deg,var(--olive),var(--olive-lo));border:1px solid #14150d;border-bottom:0;border-radius:4px 4px 0 0}
.co-hud .co-building-btn{font-family:var(--font-ui);color:var(--phos-500);text-shadow:0 0 4px var(--phos-glow);
background:var(--vignette),linear-gradient(180deg,#123a1a,#082410);border:2px solid #3b3f2f;border-radius:6px;box-shadow:inset 0 0 8px rgba(0,0,0,.7)}
.co-hud .co-building-btn:hover{background:var(--vignette),linear-gradient(180deg,#184a22,#0b2e14)}
.co-hud .co-building-btn.co-ready{border-color:var(--amber-500)}
.co-hud .co-building-btn.co-busy{border-color:#6b6e58}
.co-hud .co-building-btn.co-selected{outline:2px solid var(--amber-700);outline-offset:-3px}
.co-hud .co-building-count{color:var(--act-dim)}
.co-hud .co-building-badge{border:1px solid var(--amber-500);border-radius:2px;background:#2a1d08;color:var(--amber-700);text-shadow:none}
.co-hud .co-building-badge.co-building-busy{background:#241a08}
.co-hud .co-building-progress{background:#04100a}
.co-hud .co-building-progress>span{background:var(--hazard)}

/* Right console: name tab, status line, hit-point lamps, portrait, weapon, slot, round buttons and key plates. */
.co-hud .co-con-name{color:var(--gold);text-shadow:0 1px 0 rgba(0,0,0,.6)}
.co-hud .co-con-status{font-family:var(--font-term);font-weight:700;background:linear-gradient(180deg,#171815,#0e0f0d)}
.co-hud .co-con-dots>i.co-lit{box-shadow:0 0 5px rgba(60,255,80,.7)}
.co-hud .co-con-hp{color:var(--phos-500);text-shadow:0 0 5px var(--phos-glow);z-index:1}
.co-hud .co-con-title,.co-hud .co-con-big,.co-hud .co-con-text,.co-hud .co-con-abilities li{color:var(--gold)}
.co-hud .co-con-gun{background:linear-gradient(135deg,transparent 0 40%,#1a1812 41% 46%,transparent 47%),linear-gradient(180deg,transparent 0 60%,#1a1812 61% 80%,transparent 81%);opacity:.8}
.co-hud .co-console-enemy .co-con-portrait{filter:hue-rotate(-100deg) saturate(1.2)}
.co-hud .co-round-btn{background:radial-gradient(circle,#4a4a40,#26271f);border-radius:2px;box-shadow:inset 0 0 0 1px #14150d}
.co-hud .co-round-btn:hover{background:radial-gradient(circle,#6a6a58,#33342a)}
.co-hud .co-round-btn:nth-child(2){background:radial-gradient(circle,#c8641a,#6a2c08)}
.co-hud .co-key-plate{color:#d8ffd8;text-shadow:0 0 4px rgba(120,255,120,.6);background:linear-gradient(180deg,var(--key-green),var(--key-green-lo));border:1px solid #0b2a0d;border-radius:2px;box-shadow:inset 0 1px 0 rgba(255,255,255,.25),0 1px 2px rgba(0,0,0,.5)}
.co-hud .co-key-plate:hover{background:linear-gradient(180deg,#3cb441,#237a2a)}
.co-hud .co-key-plate[aria-pressed="true"]{color:var(--amber-700);text-shadow:0 0 5px var(--amber-glow);border-color:var(--amber-500)}

/* Buttons: green phosphor label, amber when active, dim when disabled. */
.co-hud .co-btn{position:relative;font-family:var(--font-ui);font-size:13px;font-weight:600;letter-spacing:.02em;color:var(--phos-500);
background:linear-gradient(180deg,#3a4132,#252b1e);border:1px solid #0d100a;border-radius:4px;text-shadow:0 0 4px var(--phos-glow);
box-shadow:inset 0 1px 0 rgba(255,255,255,.12),inset 0 -2px 0 rgba(0,0,0,.4),0 2px 3px rgba(0,0,0,.5)}
.co-hud .co-btn:hover:not(:disabled){background:linear-gradient(180deg,#465039,#2e3625)}
.co-hud .co-btn:active:not(:disabled){transform:translateY(1px);box-shadow:inset 0 2px 5px rgba(0,0,0,.6)}
.co-hud .co-btn[aria-pressed="true"]{color:var(--amber-700);border-color:var(--amber-500);text-shadow:0 0 5px var(--amber-glow);
background:linear-gradient(180deg,#4a3a18,#2b2210);box-shadow:inset 0 0 8px rgba(244,166,42,.35),0 0 8px rgba(244,166,42,.35)}
.co-hud .co-btn:disabled{color:var(--locked-text);text-shadow:none;opacity:.55;background:linear-gradient(180deg,#34332b,#25241e)}
.co-hud .co-key{font:700 11px/15px var(--font-ui);color:var(--amber-700);background:#1c150a;border:1px solid #5a4318;border-radius:2px;padding:0 4px;min-width:17px;text-align:center;text-shadow:none}
.co-hud .co-btn.co-danger{color:var(--ink);text-shadow:none;background:linear-gradient(180deg,#8a2a22,#561612);border-color:#ff7a6a}
.co-hud .co-btn.co-danger:hover:not(:disabled){background:linear-gradient(180deg,#a3342b,#681a15)}
.co-hud .co-top-right .co-btn{background:rgba(13,15,17,.82);border:1px solid rgba(255,255,255,.1);color:var(--ink);text-shadow:none;box-shadow:none;font-weight:500}

/* Commands: a fixed grid of four columns, key badge in the corner. */
.co-hud .co-commands h2,.co-hud .co-cards h2,.co-hud .co-hero h2{color:var(--act-dim)}
.co-hud .co-buttons .co-btn{letter-spacing:0}
.co-hud .co-commands-hint{color:var(--act-dim)}
.co-hud .co-menu{border-top:1px solid var(--edge-dark);color:var(--act-dim)}
.co-hud .co-build-option{text-align:left}
.co-hud .co-build-name{color:var(--phos-500)}
.co-hud .co-cost{font-weight:600;color:var(--amber-700);text-shadow:none}
.co-hud .co-cost.co-full{color:var(--danger-text)}

/* Targeting and placement strip, with the reason as a paper chip. */
.co-hud .co-targeting,.co-hud .co-hint{border-radius:3px;font-weight:600;font-size:15px;
background:linear-gradient(180deg,#16140a,#0b0a05);border:1px solid #5a4318;color:var(--amber-700);text-shadow:0 0 6px var(--amber-glow)}
.co-hud .co-hint{color:var(--danger-text);border-color:#6a2a22;text-shadow:0 0 6px rgba(255,90,70,.5)}
.co-hud .co-placement-reason{display:inline-block;margin-left:4px;padding:0 8px;border-radius:2px;background:linear-gradient(180deg,#e6dcbc,#c9bd96);
color:var(--paper-ink);font-weight:700;text-shadow:none;box-shadow:0 1px 2px rgba(0,0,0,.6)}

/* Perk panel and the perk badge. */
.co-hud .co-perk-badge{color:#1c1810;background:linear-gradient(180deg,#ffd27a,#d9951c);border-color:#fff1c2;text-shadow:none}
.co-hud .co-perk-badge:hover:not(:disabled){background:linear-gradient(180deg,#ffe0a0,#e6a424)}
.co-hud .co-revive{background:linear-gradient(180deg,#2e6a3a,#1a3d22)}
.co-hud .co-perk-panel{background:linear-gradient(180deg,var(--plate-700),var(--plate-900));border:2px solid var(--amber-500);border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,.7)}
.co-hud .co-perk-title{color:var(--amber-700);font-size:15px;text-shadow:0 0 5px var(--amber-glow)}
.co-hud .co-perk-name{color:var(--phos-500)}
.co-hud .co-perk-effect{color:var(--ink)}
.co-hud .co-perk-req{color:var(--phos-500)}
.co-hud .co-perk-unmet{color:var(--danger-text)}
.co-hud .co-perk-close,.co-hud .co-toast-close,.co-hud .co-card-cancel{font-family:var(--font-ui);color:var(--phos-500);background:linear-gradient(180deg,#3a4132,#252b1e);border:1px solid #0d100a;border-radius:3px}

/* Cards: dark tiles; the state also keeps its colour edge, plus text and symbol. */
.co-hud .co-card{background:linear-gradient(180deg,#232a1d,#161b12);border-radius:3px;box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}
.co-hud .co-card-main:hover:not([aria-disabled=true]){background:rgba(141,255,111,.08)}
.co-hud .co-card-name{color:var(--phos-500);text-shadow:0 0 4px var(--phos-glow)}
.co-hud .co-card-main[aria-disabled=true] .co-card-name,.co-hud .co-card-main[aria-disabled=true] .co-card-icon{color:var(--locked-text);text-shadow:none}
.co-hud .co-card-icon{color:var(--phos-500)}
.co-hud .co-card-cost{color:var(--amber-700)}
.co-hud .co-card-cost.co-full{color:var(--danger-text)}
.co-hud .co-card-effects{color:var(--act-dim)}
.co-hud .co-card-unlocks{color:var(--locked-text)}
.co-hud .co-card-progress{height:8px;background:#04100a;border:1px solid #2a2010}
.co-hud .co-card-progress>span{background:var(--hazard)}
.co-hud .co-card-notice{background:#2a1a0a;color:var(--amber-700);border:1px solid #5a4318}

/* Toasts, banners, dialog, lobby. */
.co-hud .co-toast{font-family:var(--font-ui);font-size:14px;letter-spacing:.03em;border-radius:3px;text-shadow:none;color:var(--ink)}
.co-hud .co-toast-attack{background:linear-gradient(180deg,#8a2a22,#4a1410);border-color:#ff7a6a}
.co-hud .co-toast-settlerLost{background:linear-gradient(180deg,#7a5412,#43300a);border-color:var(--amber-500)}
.co-hud .co-toast-claimLost{background:linear-gradient(180deg,#5a3a7a,#32204a);border-color:#ba68c8}
.co-hud .co-toast-dominance{background:linear-gradient(180deg,#7a4a12,#43280a);border-color:#ff8a65}
.co-hud .co-banner{font-size:15px}
.co-hud .co-banner.co-desync{background:linear-gradient(180deg,#6a1a14,#3a0d0a);border-color:#ff5252}
.co-hud .co-banner.co-stall{background:linear-gradient(180deg,#5a4510,#33270a);border-color:var(--amber-500)}
.co-hud .co-dialog{font-size:16px}
.co-hud .co-lobby h2{color:var(--act-dim)}
.co-hud .co-tag{color:var(--locked-text);border-color:var(--edge-dark)}
.co-hud .co-ready{color:var(--phos-500)}
`;

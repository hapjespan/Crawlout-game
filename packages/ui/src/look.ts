/**
 * "Roest en Fosfor": the committed, bitmap-free look of the HUD. Plates are dark and riveted, text on a screen is
 * phosphor green (data) or amber (action), the screens carry scanlines and a vignette. Layout stays in styles.ts;
 * this file only changes colour, type and surface, so it is safe to swap or drop. The dev-only bitmap skin (skin.ts)
 * builds on the same tokens and class names.
 *
 * Readability rules from the design sheets: text 11px or larger, text never directly on a texture (always on a plate
 * colour or a glass), nothing blinks faster than 3 Hz (the only animation, the perk badge, is 0.6 Hz).
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

/* Screens (glass): data in phosphor, scanlines and vignette over it. */
.co-hud .co-selection,.co-hud .co-counter,.co-hud .co-dominance,.co-hud .co-special{
background:var(--vignette),linear-gradient(180deg,var(--glass-top),var(--glass-bottom));
color:var(--phos-500);text-shadow:0 0 5px var(--phos-glow)}
.co-hud .co-selection::after,.co-hud .co-counter::after,.co-hud .co-dominance::after{
content:"";position:absolute;inset:0;pointer-events:none;border-radius:inherit;background:var(--vignette),var(--scanlines)}

/* Top bar: counters in glass cells on a plate. */
.co-hud .co-counters{gap:10px;padding:8px 12px}
.co-hud .co-counter{position:relative;min-width:66px;padding:3px 8px 2px;border:1px solid #05070a;border-radius:2px;box-shadow:inset 0 0 12px rgba(0,0,0,.8),0 1px 0 rgba(255,255,255,.07)}
.co-hud .co-counter-label{font-size:11px;font-weight:700;color:var(--locked-text);text-shadow:none}
.co-hud .co-counter-value{font-size:20px;font-weight:700;color:var(--ink);text-shadow:0 0 5px rgba(232,228,212,.35)}
.co-hud .co-counter-value.co-full{color:var(--danger-text);text-shadow:0 0 5px rgba(255,120,100,.5)}

/* Dominance: terminal line on glass. */
.co-hud .co-dominance{padding:7px 10px;border:1px solid #05070a;border-radius:3px;box-shadow:inset 0 0 14px rgba(0,0,0,.8),0 2px 6px rgba(0,0,0,.55)}
.co-hud .co-dom-text{font-family:var(--font-term);font-size:12px;font-weight:700;letter-spacing:.02em}
.co-hud .co-dom-bar{height:7px;background:#04100a;border:1px solid #0b2a14;border-radius:1px}
.co-hud .co-dom-bar>span{background:linear-gradient(180deg,#a8ff90,#35b848);box-shadow:0 0 6px var(--phos-glow)}
.co-hud .co-dom-warn .co-dom-text{color:var(--amber-700);text-shadow:0 0 5px var(--amber-glow)}
.co-hud .co-dom-warn .co-dom-bar>span{background:var(--hazard);box-shadow:none}

/* Selection: CRT with terminal text; an enemy turns the glass red. */
.co-hud .co-selection{border:5px solid #2a2d21;border-radius:8px;padding:8px 10px;box-shadow:inset 0 0 18px rgba(0,0,0,.85),0 0 0 1px #05070a,0 3px 8px rgba(0,0,0,.6)}
.co-hud .co-selection h2{font-family:var(--font-term);font-size:13px;letter-spacing:.2em;color:var(--phos-500)}
.co-hud .co-unit-name{font-family:var(--font-term);font-size:14px;font-weight:700;letter-spacing:.02em}
.co-hud .co-unit-meta,.co-hud .co-unit-detail{font-family:var(--font-term);font-size:12px;color:var(--phos-500);opacity:.82}
.co-hud .co-unit-note{font-family:var(--font-term);font-size:12px;color:var(--amber-700);text-shadow:0 0 5px var(--amber-glow)}
.co-hud .co-selection .co-empty{font-family:var(--font-term);font-size:12px;color:var(--phos-500);opacity:.7}
.co-hud .co-selection .co-hp,.co-hud .co-selection .co-xp{height:8px;background:#04100a;border:1px solid #0b2a14;border-radius:1px}
.co-hud .co-hp>span{background:repeating-linear-gradient(90deg,#7dff6a 0 5px,#04100a 5px 6px);box-shadow:0 0 6px var(--phos-glow)}
.co-hud .co-hp.co-low>span{background:repeating-linear-gradient(90deg,#ff6a5a 0 5px,#2a0a08 5px 6px)}
.co-hud .co-cell{background:linear-gradient(180deg,#0e1f12,#08140b);border:1px solid #0b2a14;border-radius:2px;color:var(--phos-500);font:11px/1.3 var(--font-term)}
.co-hud .co-cell:hover{background:#12301a;border-color:var(--phos-700)}
.co-hud .co-cell b{font-size:13px}
.co-hud .co-selection-enemy{color:#ff8f85;text-shadow:0 0 5px rgba(255,90,70,.55);border-color:#4a2a22;
background:var(--vignette),linear-gradient(180deg,#2a0d0a,#150504)}
.co-hud .co-selection-enemy h2,.co-hud .co-selection-enemy .co-unit-meta,.co-hud .co-selection-enemy .co-unit-detail{color:#ff8f85}
.co-hud .co-selection-enemy .co-hp>span{background:repeating-linear-gradient(90deg,#ff6a5a 0 5px,#2a0a08 5px 6px);box-shadow:0 0 6px rgba(255,90,70,.5)}
.co-hud .co-selection-enemy .co-hp{border-color:#4a1612;background:#150504}

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

/* Commands: a fixed grid of four columns, key badge in the corner. */
.co-hud .co-commands h2,.co-hud .co-cards h2,.co-hud .co-hero h2{color:var(--act-dim)}
.co-hud .co-buttons{grid-template-columns:repeat(4,minmax(0,1fr));gap:5px}
.co-hud .co-buttons .co-btn{min-height:50px;justify-content:flex-end;padding:14px 1px 6px;font-size:12px;letter-spacing:0}
.co-hud .co-buttons .co-key{position:absolute;top:2px;right:2px}
.co-hud .co-commands-hint{font-size:14px;color:var(--act-dim)}
.co-hud .co-menu{border-top:1px solid var(--edge-dark);color:var(--act-dim)}
.co-hud .co-build-option{align-items:flex-start;gap:1px;padding:5px 22px 5px 7px;text-align:left}
.co-hud .co-build-option .co-key{position:absolute;top:3px;right:3px}
.co-hud .co-cost{font-size:12px;font-weight:600;color:var(--amber-700);text-shadow:none}
.co-hud .co-cost.co-full{color:var(--danger-text)}

/* Targeting and placement strip, with the reason as a paper chip. */
.co-hud .co-targeting,.co-hud .co-hint{border-radius:3px;font-weight:600;font-size:15px;
background:linear-gradient(180deg,#16140a,#0b0a05);border:1px solid #5a4318;color:var(--amber-700);text-shadow:0 0 6px var(--amber-glow)}
.co-hud .co-hint{color:var(--danger-text);border-color:#6a2a22;text-shadow:0 0 6px rgba(255,90,70,.5)}
.co-hud .co-placement-reason{display:inline-block;margin-left:4px;padding:0 8px;border-radius:2px;background:linear-gradient(180deg,#e6dcbc,#c9bd96);
color:var(--paper-ink);font-weight:700;text-shadow:none;box-shadow:0 1px 2px rgba(0,0,0,.6)}

/* Unit bar and buildings bar. */
.co-hud .co-roster-group{font-family:var(--font-ui);font-weight:600;color:var(--phos-500);text-shadow:0 0 4px var(--phos-glow);
background:linear-gradient(180deg,#3a4132,#252b1e);border:1px solid #0d100a;border-radius:4px;box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 2px 3px rgba(0,0,0,.5)}
.co-hud .co-roster-group.co-selected{color:var(--amber-700);border-color:var(--amber-500);text-shadow:0 0 5px var(--amber-glow)}
.co-hud .co-roster-group:disabled{opacity:.5;color:var(--locked-text);text-shadow:none}
.co-hud .co-roster-idle{color:var(--amber-700);font-size:12px}
.co-hud .co-roster-unit{box-shadow:inset 0 1px 0 rgba(255,255,255,.25),inset 0 -2px 0 rgba(0,0,0,.35)}
.co-hud .co-roster-unit.co-selected{box-shadow:0 0 0 2px var(--amber-700)}
.co-hud .co-building-label{font-weight:700;color:var(--act-dim)}
.co-hud .co-building-btn{font-family:var(--font-ui);font-size:14px;color:var(--phos-500);text-shadow:0 0 4px var(--phos-glow);
background:var(--vignette),linear-gradient(180deg,#123a1a,#082410);border:2px solid #3b3f2f;border-radius:6px;box-shadow:inset 0 0 10px rgba(0,0,0,.7),0 2px 3px rgba(0,0,0,.5)}
.co-hud .co-building-btn:hover{background:var(--vignette),linear-gradient(180deg,#184a22,#0b2e14)}
.co-hud .co-building-btn.co-ready{border-color:var(--amber-500)}
.co-hud .co-building-btn.co-busy{border-color:#6b6e58}
.co-hud .co-building-btn.co-selected{outline:2px solid var(--amber-700);outline-offset:-3px}
.co-hud .co-building-count{color:var(--act-dim)}
.co-hud .co-building-badge{min-width:18px;height:18px;border:1px solid var(--amber-500);border-radius:2px;background:#2a1d08;color:var(--amber-700);text-shadow:none;font-size:12px;line-height:16px}
.co-hud .co-building-badge.co-building-busy{background:#241a08}
.co-hud .co-building-progress{height:6px;left:6px;right:6px;bottom:3px;background:#04100a;border:1px solid #0b2a14}
.co-hud .co-building-progress>span{background:var(--hazard)}

/* Hero: below the (taller) top bar. */
.co-hud .co-hero{top:84px}
.co-hud .co-special b{color:var(--locked-text);text-shadow:none}
.co-hud .co-special{padding:3px 2px;border:1px solid #05070a;border-radius:2px;font-family:var(--font-term);font-size:12px}
.co-hud .co-xp{height:6px;background:#04100a;border:1px solid #2a2010;border-radius:1px}
.co-hud .co-xp>span{background:linear-gradient(180deg,var(--amber-700),var(--amber-500))}
.co-hud .co-revives{color:var(--act-dim)}
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

/* Toasts, banners, dialog, lobby, minimap. */
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
.co-hud .co-minimap{padding:5px;border:3px solid #3b3d30;border-radius:3px;background:#07090a;
box-shadow:inset 0 0 0 1px #05070a,0 3px 8px rgba(0,0,0,.6)}
.co-hud .co-minimap-canvas{box-shadow:0 0 0 1px #05070a}
`;

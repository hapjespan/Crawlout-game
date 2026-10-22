import { u, font, fpx, px } from './units.js';

/** HUD look, part 2 (concatenated in look.ts): unit bar, unit console, buttons, commands, targeting, perks, cards, toasts and lobby. */
export const HUD_LOOK_CONSOLE_CSS = `/* Unit bar: olive header plate with the title, a dark well, tiles with a CRT portrait and a label. */
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

/* Control groups: little glass chips on the same olive plate as the buildings strip; amber while the group is the selection. */
.co-hud .co-groups{background:linear-gradient(180deg,var(--olive),var(--olive-lo));border:1px solid #14150d;border-bottom:0;border-radius:4px 4px 0 0}
.co-hud .co-group{font-family:var(--font-term);color:var(--phos-500);text-shadow:0 0 4px var(--phos-glow);
background:var(--vignette),linear-gradient(180deg,#123a1a,#082410);border:1px solid #0b2a14;border-radius:2px;box-shadow:inset 0 0 6px rgba(0,0,0,.7)}
.co-hud .co-group:hover{background:var(--vignette),linear-gradient(180deg,#184a22,#0b2e14)}
.co-hud .co-group-count{color:var(--act-dim)}
.co-hud .co-group.co-active{color:var(--amber-700);border-color:var(--amber-500);text-shadow:0 0 5px var(--amber-glow);box-shadow:inset 0 0 8px rgba(244,166,42,.3)}
.co-hud .co-group.co-active .co-group-count{color:var(--amber-700)}
.co-hud .co-building-btn{font-family:var(--font-ui);color:var(--phos-500);text-shadow:0 0 4px var(--phos-glow);
background:var(--vignette),linear-gradient(180deg,#123a1a,#082410);border:2px solid #3b3f2f;border-radius:${px(6)};box-shadow:inset 0 0 8px rgba(0,0,0,.7)}
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
.co-hud .co-btn{position:relative;font-family:var(--font-ui);font-size:${fpx(13)};font-weight:600;letter-spacing:.02em;color:var(--phos-500);
background:linear-gradient(180deg,#3a4132,#252b1e);border:1px solid #0d100a;border-radius:4px;text-shadow:0 0 4px var(--phos-glow);
box-shadow:inset 0 1px 0 rgba(255,255,255,.12),inset 0 -2px 0 rgba(0,0,0,.4),0 2px 3px rgba(0,0,0,.5)}
.co-hud .co-btn:hover:not(:disabled){background:linear-gradient(180deg,#465039,#2e3625)}
.co-hud .co-btn:active:not(:disabled){transform:translateY(1px);box-shadow:inset 0 2px 5px rgba(0,0,0,.6)}
.co-hud .co-btn[aria-pressed="true"]{color:var(--amber-700);border-color:var(--amber-500);text-shadow:0 0 5px var(--amber-glow);
background:linear-gradient(180deg,#4a3a18,#2b2210);box-shadow:inset 0 0 8px rgba(244,166,42,.35),0 0 8px rgba(244,166,42,.35)}
.co-hud .co-btn:disabled{color:var(--locked-text);text-shadow:none;opacity:.55;background:linear-gradient(180deg,#34332b,#25241e)}
.co-hud .co-key{font:700 ${fpx(11)}/1.35 var(--font-ui);color:var(--amber-700);background:#1c150a;border:1px solid #5a4318;border-radius:2px;padding:0 4px;min-width:${px(17)};text-align:center;text-shadow:none}
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
.co-hud .co-targeting,.co-hud .co-hint{border-radius:3px;font-weight:600;font-size:${fpx(15)};
background:linear-gradient(180deg,#16140a,#0b0a05);border:1px solid #5a4318;color:var(--amber-700);text-shadow:0 0 6px var(--amber-glow)}
.co-hud .co-hint{color:var(--danger-text);border-color:#6a2a22;text-shadow:0 0 6px rgba(255,90,70,.5)}
.co-hud .co-placement-reason{display:inline-block;margin-left:4px;padding:0 ${px(8)};border-radius:2px;background:linear-gradient(180deg,#e6dcbc,#c9bd96);
color:var(--paper-ink);font-weight:700;text-shadow:none;box-shadow:0 1px 2px rgba(0,0,0,.6)}

/* Perk panel and the perk badge. */
.co-hud .co-perk-badge{color:#1c1810;background:linear-gradient(180deg,#ffd27a,#d9951c);border-color:#fff1c2;text-shadow:none}
.co-hud .co-perk-badge:hover:not(:disabled){background:linear-gradient(180deg,#ffe0a0,#e6a424)}
.co-hud .co-revive{background:linear-gradient(180deg,#2e6a3a,#1a3d22)}
.co-hud .co-perk-panel{background:linear-gradient(180deg,var(--plate-700),var(--plate-900));border:2px solid var(--amber-500);border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,.7)}
.co-hud .co-perk-title{color:var(--amber-700);font-size:${fpx(15)};text-shadow:0 0 5px var(--amber-glow)}
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
.co-hud .co-card-progress{height:${px(8)};background:#04100a;border:1px solid #2a2010}
.co-hud .co-card-progress>span{background:var(--hazard)}
.co-hud .co-card-notice{background:#2a1a0a;color:var(--amber-700);border:1px solid #5a4318}

/* Toasts, banners, dialog, lobby. */
.co-hud .co-toast{font-family:var(--font-ui);font-size:${fpx(14)};letter-spacing:.03em;border-radius:3px;text-shadow:none;color:var(--ink)}
.co-hud .co-toast-attack{background:linear-gradient(180deg,#8a2a22,#4a1410);border-color:#ff7a6a}
.co-hud .co-toast-settlerLost{background:linear-gradient(180deg,#7a5412,#43300a);border-color:var(--amber-500)}
.co-hud .co-toast-claimLost{background:linear-gradient(180deg,#5a3a7a,#32204a);border-color:#ba68c8}
.co-hud .co-toast-dominance{background:linear-gradient(180deg,#7a4a12,#43280a);border-color:#ff8a65}
.co-hud .co-toast-noBeds{background:linear-gradient(180deg,#4a5418,#2a300c);border-color:var(--amber-500)}
.co-hud .co-banner{font-size:${fpx(15)}}
.co-hud .co-banner.co-desync{background:linear-gradient(180deg,#6a1a14,#3a0d0a);border-color:#ff5252}
.co-hud .co-banner.co-stall{background:linear-gradient(180deg,#5a4510,#33270a);border-color:var(--amber-500)}
.co-hud .co-dialog{font-size:${fpx(16)}}
.co-hud .co-lobby h2{color:var(--act-dim)}
.co-hud .co-tag{color:var(--locked-text);border-color:var(--edge-dark)}
.co-hud .co-ready{color:var(--phos-500)}
`;

/** Neutrale HUD-stijl tot de stijlbijbel er is. Alles onder .co-hud zodat er niets lekt. */
export const HUD_CSS = `
.co-hud{position:absolute;inset:0;pointer-events:none;font:14px/1.3 system-ui,sans-serif;color:#e6e6e6}
.co-hud *{box-sizing:border-box}
.co-panel{pointer-events:auto;background:rgba(20,22,24,.88);border:1px solid #3a3f44;border-radius:6px;padding:8px}
.co-counters{position:absolute;top:8px;left:8px;display:flex;gap:16px;margin:0;list-style:none}
.co-counter{display:flex;flex-direction:column;min-width:64px}
.co-counter-label{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#9aa0a6}
.co-counter-value{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
.co-counter-value.co-full{color:#ff8a65}
.co-selection{position:absolute;left:8px;bottom:8px;width:260px;max-height:220px;overflow:auto}
.co-selection h2,.co-commands h2{margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#9aa0a6}
.co-empty{color:#9aa0a6;margin:0}
.co-unit-name{font-weight:600;margin:0 0 4px}
.co-unit-meta{margin:0 0 6px;color:#c4c7ca}
.co-hp{height:6px;background:#2b2f33;border-radius:3px;overflow:hidden}
.co-hp>span{display:block;height:100%;background:#7cb342}
.co-hp.co-low>span{background:#e53935}
.co-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(44px,1fr));gap:4px;margin:0;padding:0;list-style:none}
.co-cell{background:#2b2f33;border-radius:4px;padding:4px;font-size:11px;text-align:center}
.co-cell b{display:block;font-size:13px}
.co-commands{position:absolute;right:8px;bottom:8px;width:300px}
.co-buttons{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.co-btn{pointer-events:auto;font:inherit;color:inherit;background:#2f353b;border:1px solid #4a5159;border-radius:4px;padding:6px 4px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px}
.co-btn:hover:not(:disabled){background:#3b434b}
.co-btn:disabled{opacity:.4;cursor:default}
.co-btn[aria-pressed="true"]{background:#4a6572;border-color:#8fb8cc}
.co-key{font-size:11px;color:#9aa0a6;border:1px solid #4a5159;border-radius:3px;padding:0 4px}
.co-btn:focus-visible{outline:3px solid #ffd54f;outline-offset:2px}
.co-menu{margin-top:8px;border-top:1px solid #3a3f44;padding-top:8px;color:#c4c7ca}
.co-targeting{position:absolute;left:50%;bottom:260px;transform:translateX(-50%);color:#ffd54f}
.co-top-right{position:absolute;top:8px;right:8px;display:flex;gap:8px;align-items:center}
.co-banner{position:absolute;left:50%;top:56px;transform:translateX(-50%);max-width:80%;text-align:center;font-weight:600}
.co-banner.co-desync{background:rgba(120,20,20,.95);border-color:#ff5252}
.co-banner.co-stall{background:rgba(90,70,10,.95);border-color:#ffd54f}
.co-dialog{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:320px;text-align:center}
.co-dialog p{margin:0 0 12px}
.co-dialog .co-actions{display:flex;gap:8px;justify-content:center}
.co-dialog .co-btn{flex-direction:row;padding:6px 16px}
.co-btn.co-danger{background:#7a2323;border-color:#ff5252}
.co-btn.co-danger:hover:not(:disabled){background:#9a2d2d}
.co-minimap{position:absolute;right:8px;top:48px;padding:4px}
.co-minimap-canvas{display:block;width:160px;height:160px;cursor:pointer;image-rendering:pixelated}
.co-build-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:6px}
.co-build-option{width:100%}
.co-cost{font-size:11px;color:#9aa0a6}
.co-cost.co-full{color:#ff8a65}
.co-hero{position:absolute;left:8px;top:64px;width:240px}
.co-hero h2{margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#9aa0a6}
.co-xp{height:6px;background:#2b2f33;border-radius:3px;overflow:hidden;margin-bottom:6px}
.co-xp>span{display:block;height:100%;background:#42a5f5}
.co-special{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin:0 0 6px;padding:0;list-style:none;text-align:center}
.co-special b{display:block;font-size:11px;color:#9aa0a6}
.co-perks{display:flex;flex-direction:column;gap:4px}
.co-perk-title{margin:0;color:#ffd54f;font-weight:600}
.co-perk{flex-direction:row;justify-content:space-between;padding:6px 8px}
.co-toasts{position:absolute;left:50%;top:104px;transform:translateX(-50%);display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none;pointer-events:none}
.co-toasts li{display:flex;gap:2px;pointer-events:auto}
.co-toast{flex-direction:row;padding:6px 14px;font-weight:600}
.co-toast-attack{background:#7a2323;border-color:#ff5252}
.co-toast-settlerLost{background:#6a4a12;border-color:#ffb74d}
.co-toast-claimLost{background:#4a2a6a;border-color:#ba68c8}
.co-toast-close{font:inherit;color:inherit;background:#2f353b;border:1px solid #4a5159;border-radius:4px;cursor:pointer;padding:0 8px}
.co-lobby{position:absolute;left:50%;top:30%;transform:translateX(-50%);width:300px}
.co-lobby h2{margin:0 0 6px;font-size:12px;text-transform:uppercase;color:#9aa0a6}
.co-lobby-list{list-style:none;margin:0 0 8px;padding:0}
.co-lobby-list li{display:flex;gap:8px;align-items:center;padding:2px 0}
.co-lobby-list li>span:first-child{flex:1}
.co-tag{font-size:10px;border:1px solid #4a5159;border-radius:3px;padding:0 4px;color:#9aa0a6}
.co-ready{color:#7cb342}.co-notready{color:#9aa0a6}
.co-lobby .co-actions{display:flex;gap:8px}
`;

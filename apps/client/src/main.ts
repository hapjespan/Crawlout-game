// Samenstelling: sim-worker (packages/sim) + renderer (packages/render) + HUD (packages/ui) + loopback- of ws-relay.
// Render-pipeline en hud bouwen hier samen; relay levert de loopback. Nu alleen een placeholder.
const app = document.getElementById('app');
if (app) app.textContent = 'Crawlout: fase 0, nog geen client. Zie CLAUDE.md.';

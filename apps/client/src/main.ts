// Composition: sim worker (packages/sim) + renderer (packages/render) + HUD (packages/ui) + loopback relay.
// Local skirmish against the scripted AI on the slice map; the same session code drives the ws relay later.
// main() runs the stages below in order; they share one ClientContext (main.context.ts) instead of closure variables.
import { bootClient } from './main.boot.js';
import type { ClientContext } from './main.context.js';
import { exposeDevApi } from './main.devApi.js';
import { wireHud } from './main.hud.js';
import { wireInput } from './main.input.js';
import { wireOrders } from './main.orders.js';
import { wirePlacement } from './main.placement.js';
import { wireMatchState } from './main.state.js';

function showError(message: string): void {
  const el = document.getElementById('error');
  if (!el) return;
  el.textContent = message;
  el.style.display = 'grid';
}

async function main(): Promise<void> {
  // Filled stage by stage; every callback reads it when it runs, as it read main()'s closure variables before.
  const ctx = {} as ClientContext;
  await bootClient(ctx);
  wireMatchState(ctx);
  wireOrders(ctx);
  wirePlacement(ctx);
  wireHud(ctx);
  wireInput(ctx);
  exposeDevApi(ctx);
}

main().catch((err: unknown) => {
  console.error(err);
  showError(`Crawlout kon niet starten: ${err instanceof Error ? err.message : String(err)}`);
});

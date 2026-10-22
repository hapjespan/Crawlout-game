// Split from hud-clicks.ts to stay under the 5,000-token file limit: one sequential stage of runIn(), sharing the
// run context. Stage: the buildings bar, role buttons, camera moves, card layout, cards and clearing the selection.
import { check, wait, QUEUE, CAMERA, rectOf, textOf, overlaps } from './hud-clicks-common.js';
import type { Pt, Box, HudRunState } from './hud-clicks-common.js';

export async function runBarStage(ctx: HudRunState): Promise<void> {
  const { page, width, shot, ev, click, center, selection, cardsOpen, groundSpot, hqRow, sites } =
    ctx;
  // --- The buildings bar: all built buildings, with a badge for what can be started.
  const bar = await ev<string>(textOf('.co-building-buttons'));
  check(
    /Werkplaats/.test(bar) && /Lab/.test(bar) && !/Basis/.test(bar),
    'the bar lists Werkplaats and Lab, not the Basis',
    bar,
  );

  // --- With a finished workshop the role buttons are back for settlers.
  await click(await center('.co-roster-groups button:has-text("Plunderaar")'));
  const roles = await ev<string[]>(
    `[...document.querySelectorAll('.co-buttons [data-action]')].map((b) => b.getAttribute('data-action'))`,
  );
  check(
    roles.includes('roleBuilder') && roles.includes('roleMilitia'),
    'role buttons appear once the workshop is finished',
    roles.join(','),
  );
  await shot('03b-roles-after-workshop');
  // The roster group click puts the camera on the centroid of the group; clicking it again leaves the camera alone.
  const unitIds = await ev<number[]>(
    `[...document.querySelectorAll('.co-selection [data-unit]')].map((b) => Number(b.getAttribute('data-unit')))`,
  );
  if (unitIds.length > 0) {
    const centroid = await ev<{ x: number; z: number }>(`(() => {
      const es = window.crawlout.entities(); const ids = ${JSON.stringify(unitIds)};
      const ps = ids.map((i) => es.get(i)).filter(Boolean);
      return { x: ps.reduce((a, e) => a + e.x, 0) / ps.length / 256, z: ps.reduce((a, e) => a + e.y, 0) / ps.length / 256 };
    })()`);
    await wait(500);
    const cam = await ev<{ x: number; z: number }>(CAMERA);
    check(
      Math.hypot(cam.x - centroid.x, cam.z - centroid.z) < 10,
      'a roster group click puts the camera on the group',
      JSON.stringify({ cam, centroid }),
    );
    // A unit card in the selection panel selects that unit and puts the camera on it.
    await ev(`window.crawlout.renderer.focus(${hqRow.x}, ${hqRow.y})`);
    await wait(400);
    const cardId = unitIds[unitIds.length - 1]!;
    await click(await center(`.co-selection [data-unit="${cardId}"]`));
    await wait(400);
    const unitAt = await ev<{ x: number; z: number }>(
      `(() => { const e = window.crawlout.entities().get(${cardId}); return { x: e.x / 256, z: e.y / 256 }; })()`,
    );
    const cam2 = await ev<{ x: number; z: number }>(CAMERA);
    check(
      Math.hypot(cam2.x - unitAt.x, cam2.z - unitAt.z) < 10 &&
        !(await ev<string>(textOf('.co-selection'))).includes('Selectie ('),
      'a unit card in the selection panel selects that unit and moves the camera to it',
      JSON.stringify({ cam2, unitAt }),
    );
  }
  await page.keyboard.press('Escape');
  await wait(300);
  const badge = await ev<string>(textOf('[data-building="werkplaats"] .co-building-badge'));
  check(Number(badge) > 0, 'the workshop shows a badge for the research it can start', badge);

  // --- Click the workshop in the bar: it is selected, its cards open above the commands, the camera goes to it.
  await ev(`window.crawlout.renderer.focus(${hqRow.x}, ${hqRow.y})`);
  await wait(500);
  const camHome = await ev<{ x: number; z: number }>(CAMERA);
  await click(await center('[data-building="werkplaats"]'));
  await wait(500);
  const camShop = await ev<{ x: number; z: number }>(CAMERA);
  const shopSite = sites.find((x) => x.name === 'Werkplaats')!;
  check(
    Math.hypot(camShop.x - shopSite.x / 256, camShop.z - shopSite.y / 256) < 3 &&
      Math.hypot(camShop.x - camHome.x, camShop.z - camHome.z) > 3,
    'a single bar click moves the camera to the workshop',
    JSON.stringify({ camHome, camShop }),
  );
  check(
    (await selection()).includes('Werkplaats'),
    'bar click selects the workshop',
    await selection(),
  );
  check(await cardsOpen(), 'the card window opens');
  const cards = await ev<Box>(rectOf('.co-cards'));
  const cmds = await ev<Box>(rectOf('.co-commands'));
  const mini = await ev<Box>(rectOf('.co-minimap'));
  const roster = await ev<Box>(rectOf('.co-roster'));
  check(
    cards.y + cards.h <= cmds.y + 1 && Math.abs(cards.x - cmds.x) < 2,
    'cards sit directly above the commands',
    JSON.stringify({ cards, cmds }),
  );
  check(
    !overlaps(cards, mini),
    'cards do not overlap the minimap',
    JSON.stringify({ cards, mini }),
  );
  check(
    !overlaps(cards, roster) && !overlaps(cmds, roster),
    'cards and commands do not overlap the roster bar',
  );
  check(cards.x >= 0 && cards.x + cards.w <= width && cards.y >= 0, 'cards stay on screen');
  const perf = await ev<Box | null>(rectOf('#perf'));
  const giveUp = await ev<Box>(rectOf('.co-top-right'));
  check(
    perf !== null && perf.y < 40 && perf.x + perf.w <= giveUp.x && !overlaps(perf, mini),
    'frame stats sit top right next to Opgeven, clear of the minimap',
    JSON.stringify({ perf, giveUp }),
  );
  await shot('04-workshop-selected');

  // Locked card shows its reason; clicking it does nothing but explain.
  const lockedText = await ev<string>(textOf('.co-card-locked, .co-card[data-state="locked"]'));
  check(/Vereist/.test(lockedText), 'a locked card shows what it requires', lockedText);
  const lockedBefore = (await ev<unknown[]>(QUEUE)).length;
  const locked = await ev<Pt | null>(
    `(() => { const b = document.querySelector('.co-card[data-state="locked"] button'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );
  if (locked) {
    await click(locked);
    check(
      (await ev<unknown[]>(QUEUE)).length === lockedBefore,
      'clicking a locked card starts nothing',
    );
    check(
      (await ev<string>(textOf('.co-card-notice'))).includes('Vergrendeld'),
      'clicking a locked card says why',
    );
  }

  // Click an available card: the research starts.
  const avail = await ev<Pt | null>(
    `(() => { const b = document.querySelector('.co-card[data-state="available"] button'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );
  check(avail !== null, 'an available card exists');
  if (avail) {
    await click(avail);
    await wait(1200);
    const q = await ev<{ kind: string }[]>(QUEUE);
    check(
      q.some((i) => i.kind === 'research'),
      'clicking an available card starts the research',
      JSON.stringify(q),
    );
  }
  await page.clock.runFor(4000);
  await wait(500);
  const prog = await ev<string>(
    `(() => document.querySelector('[data-building="werkplaats"] [role="progressbar"]')?.getAttribute('aria-valuenow') ?? '')()`,
  );
  check(prog !== '', 'the bar shows progress while the workshop researches', prog);
  await shot('05-research-running');

  // --- Clear by clicking empty ground; Escape clears too.
  await click(await groundSpot());
  check(
    (await selection()).includes('Niets geselecteerd'),
    'a click on empty ground clears the selection',
  );
  check(!(await cardsOpen()), '... and closes the card panel');
  check(
    (await ev<string>(textOf('.co-commands'))).includes('Selecteer een eenheid of gebouw'),
    '... and resets the commands panel',
  );
  await click(await center('[data-building="lab"]'));
  check((await selection()).includes('Lab'), 'select the lab from the bar');
  await page.keyboard.press('Escape');
  await wait(300);
  check((await selection()).includes('Niets geselecteerd'), 'Escape clears the selection');
  check(!(await cardsOpen()), '... and closes the card panel');
}

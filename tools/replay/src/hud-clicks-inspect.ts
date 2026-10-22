// Split from hud-clicks.ts to stay under the 5,000-token file limit: one sequential stage of runIn(), sharing the
// run context. Stage: inspecting an enemy building and a bandit, and the final Ctrl+click.
import { HQ_TOP, check, wait, project, CAMERA, onCanvas } from './hud-clicks-common.js';
import type { Pt, HudRunState } from './hud-clicks-common.js';

export async function runInspectStage(ctx: HudRunState): Promise<void> {
  const { browser, page, shot, ev, click, center, selection, groundSpot, hqTypeId, hqRow } = ctx;
  // --- An enemy building or unit can be clicked to inspect it: type, owner and hp in the selection panel, no commands,
  // no camera move, and a right click afterwards sends nothing. A click on an own unit replaces it again.
  await page.keyboard.press('Escape');
  // fog of war: the enemy base lies in the fog at the start (the client gets only what the player sees), so reveal
  // everything for this part (dev hook)
  const foeHidden = await ev<boolean>(
    `(() => { const c = window.crawlout; return ![...c.entities().values()].some((e) => e.typeId === ${hqTypeId} && e.owner !== c.session.playerId && e.owner !== 255); })()`,
  );
  check(foeHidden, 'fog of war: the enemy Basis is not in the snapshot before it is seen');
  await ev(`window.crawlout.revealAll(true)`);
  await wait(500);
  const foeHq = await ev<{ id: number; x: number; y: number } | null>(
    `(() => { const c = window.crawlout; const e = [...c.entities().values()].find((e) => e.typeId === ${hqTypeId} && e.owner !== c.session.playerId && e.owner !== 255); return e ? { id: e.id, x: e.x, y: e.y } : null; })()`,
  );
  check(foeHq !== null, 'an enemy Basis exists to inspect');
  if (foeHq) {
    await ev(`window.crawlout.renderer.focus(${foeHq.x}, ${foeHq.y})`);
    await wait(1500);
    await ev(
      `(() => { window.__cmds = 0; const s = window.crawlout.session; const o = s.sendCommand.bind(s); s.sendCommand = (...a) => { window.__cmds++; return o(...a); }; })()`,
    );
    const roof = await ev<Pt | null>(project(foeHq.x / 256, HQ_TOP * 0.9, foeHq.y / 256));
    const clickable = roof !== null && (await ev<boolean>(onCanvas(roof.x, roof.y)));
    check(clickable, 'the enemy Basis roof is on the canvas');
    if (roof && clickable) {
      const camBefore = await ev<{ x: number; z: number }>(CAMERA);
      await click(roof);
      const panel = await selection();
      check(
        panel.includes('Vijand') && panel.includes('Basis') && panel.includes('Gebouw'),
        'clicking an enemy building shows what it is and that it is an enemy',
        panel.replace(/\s+/g, ' ').slice(0, 80),
      );
      const camAfter = await ev<{ x: number; z: number }>(CAMERA);
      check(
        Math.hypot(camAfter.x - camBefore.x, camAfter.z - camBefore.z) < 0.5,
        'an enemy click does not move the camera',
      );
      const foeActions = await ev<string[]>(
        `[...document.querySelectorAll('.co-buttons [data-action]')].map((b) => b.getAttribute('data-action'))`,
      );
      check(
        foeActions.length === 0,
        'an enemy selection has no command buttons',
        foeActions.join(','),
      );
      await shot('08-enemy-inspect');
      for (const key of ['m', 's', 'a', 'g', 't', 'b']) await page.keyboard.press(key);
      const ground = await groundSpot();
      await click(ground, { button: 'right' });
      await wait(400);
      check(
        (await ev<number>(`window.__cmds`)) === 0,
        'hotkeys and a right click with an enemy selected send no command',
        String(await ev<number>(`window.__cmds`)),
      );
      // A left click on an own unit replaces the enemy selection and gives commands again.
      await ev(`window.crawlout.renderer.focus(${hqRow.x}, ${hqRow.y})`);
      await wait(800);
      await click(await center('.co-roster-groups button:has-text("Militie")'));
      const after = await selection();
      check(
        !after.includes('Vijand') && after.includes('Selectie'),
        'selecting own units replaces the inspected enemy',
        after.replace(/\s+/g, ' ').slice(0, 60),
      );
      check(
        (
          await ev<string[]>(
            `[...document.querySelectorAll('.co-buttons [data-action]')].map((b) => b.getAttribute('data-action'))`,
          )
        ).includes('move'),
        '... and the commands are back',
      );
    }
    // (Enemy units stand behind the pick volume of the enemy buildings at the default camera, so the browser run clicks
    // the building; the unit case is covered by the unit tests of the selection panel and game/inspect.ts.)
  }

  // --- Creep camps (sim 0.20.0): a bandit is a neutral unit, drawn in the neutral team colour and clickable; the
  // selection panel reads "Neutraal · Bandiet". (The fog is revealed above.)
  const bandit = await ev<{ id: number; x: number; y: number } | null>(
    `(() => { const c = window.crawlout; const e = [...c.entities().values()].find((e) => e.owner === 255 && e.typeId > 0 && e.typeId < 1000); return e ? { id: e.id, x: e.x, y: e.y } : null; })()`,
  );
  check(bandit !== null, 'a bandit of a creep camp is in the snapshot');
  if (bandit) {
    await ev(`window.crawlout.renderer.focus(${bandit.x}, ${bandit.y})`);
    await wait(800);
    let picked = false;
    for (const h of [0.9, 1.2, 0.6, 1.5]) {
      const p = await ev<Pt | null>(project(bandit.x / 256, h, bandit.y / 256));
      if (!p || !(await ev<boolean>(onCanvas(p.x, p.y)))) continue;
      const id = await ev<number | null>(
        `window.crawlout.renderer.pickAt(${p.x}, ${p.y}).entityId`,
      );
      if (id !== bandit.id) continue;
      await click(p);
      picked = true;
      break;
    }
    check(picked, 'a bandit can be picked on the canvas');
    const panel = await selection();
    check(
      panel.includes('Neutraal · Bandiet'),
      'clicking a bandit shows it as "Neutraal · Bandiet"',
      panel.replace(/\s+/g, ' ').slice(0, 80),
    );
    await shot('09-bandit');
  }

  await ev(`window.crawlout.revealAll(false)`);

  // --- Ctrl+click (macOS right click) on the HUD must not open the browser menu or start anything.
  await click(await center('[data-building="werkplaats"]'), { modifiers: ['Control'] });
  await wait(300);
  await shot('07-final');
  await browser.close();
}

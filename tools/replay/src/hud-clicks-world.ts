// Split from hud-clicks.ts to stay under the 5,000-token file limit: one sequential stage of runIn(), sharing the
// run context. Stage: world clicks on every building and building/unit selection after targeting.
import {
  HQ_KEY,
  HQ_NAME,
  HQ_TOP,
  check,
  wait,
  OWN,
  project,
  CAMERA,
  onCanvas,
} from './hud-clicks-common.js';
import type { Site, Pt, HudRunState } from './hud-clicks-common.js';

export async function runWorldStage(ctx: HudRunState): Promise<void> {
  const {
    page,
    width,
    height,
    shot,
    ev,
    click,
    center,
    selection,
    cardsOpen,
    groundSpot,
    hqTypeId,
    hqRow,
    sites,
  } = ctx;
  // --- World clicks on every building: roof and walls, default and far zoom.
  const own = await ev<{ id: number; t: number; x: number; y: number }[]>(OWN);
  const hqFoot = await ev<{ w: number; h: number }>(
    `window.crawlout.placement.footprint(${JSON.stringify(HQ_KEY)})`,
  );
  const all: Site[] = [
    { name: HQ_NAME, typeId: hqTypeId, x: hqRow.x, y: hqRow.y, ...hqFoot, top: HQ_TOP },
    ...sites,
  ];
  for (const zoom of ['default', 'far'] as const) {
    if (zoom === 'default') {
      for (let i = 0; i < 6; i++) {
        await page.mouse.move(width / 2, height / 2);
        await page.mouse.wheel(0, -240);
        await wait(60);
      }
    } else {
      for (let i = 0; i < 14; i++) {
        await page.mouse.move(width / 2, height / 2);
        await page.mouse.wheel(0, 240);
        await wait(60);
      }
    }
    await wait(1200);
    for (const b of all) {
      await ev(`window.crawlout.renderer.focus(${b.x}, ${b.y})`);
      await wait(1400);
      const cx = b.x / 256;
      const cz = b.y / 256;
      const dx = (b.w / 2) * 0.8;
      const dz = (b.h / 2) * 0.8;
      const probes: [string, number, number, number][] = [
        ['roof centre', cx, b.top * 0.9, cz],
        ['roof near corner', cx - dx, b.top * 0.9, cz + dz],
        ['roof far corner', cx + dx, b.top * 0.9, cz - dz],
        ['front wall', cx, 2.5, cz + dz],
        ['side wall', cx + dx, 2.5, cz],
      ];
      let tried = 0;
      for (const [label, x, y, z] of probes) {
        const p = await ev<Pt | null>(project(x, y, z));
        if (!p || p.x < 4 || p.y < 4 || p.x > width - 4 || p.y > height - 4) continue;
        if (!(await ev<boolean>(onCanvas(p.x, p.y)))) continue; // behind a HUD panel
        const near = await ev<{ entityId: number | null }>(
          `window.crawlout.renderer.pickAt(${p.x}, ${p.y})`,
        );
        // another entity standing there (a unit at the wall) legitimately wins
        if (near.entityId !== null && !own.some((e) => e.id === near.entityId && e.t === b.typeId))
          continue;
        tried++;
        await click({ x: width * 0.5, y: height * 0.15 }); // clear first
        await click(p);
        const sel = await selection();
        check(
          sel.includes(b.name) || (b.name === 'Basis' && sel.includes('Basis')),
          `${zoom} zoom: click on the ${label} of the ${b.name} selects it`,
          sel.replace(/\s+/g, ' ').slice(0, 60),
        );
      }
      check(
        tried >= 2,
        `${zoom} zoom: at least two probe points of the ${b.name} were clickable`,
        String(tried),
      );
    }
  }
  await shot('06-far-zoom');
  for (let i = 0; i < 14; i++) {
    await page.mouse.move(width / 2, height / 2);
    await page.mouse.wheel(0, -240);
    await wait(60);
  }
  await wait(800);

  // --- A building click replaces a unit selection; a unit click replaces a building selection.
  const lab = own.find((e) => e.t === sites[0]!.typeId);
  if (!lab) throw new Error('lab missing');
  await ev(`window.crawlout.renderer.focus(${lab.x}, ${lab.y})`);
  await wait(1200);
  await click(await center('.co-roster-groups button:has-text("Plunderaar")'));
  check((await selection()).includes('Selectie ('), 'units are selected from the roster');
  const labPt = await ev<Pt | null>(project(lab.x / 256, 2.5, lab.y / 256 + 6));
  if (labPt && (await ev<boolean>(onCanvas(labPt.x, labPt.y)))) {
    const camBefore = await ev<{ x: number; z: number }>(CAMERA);
    await click(labPt);
    const camAfter = await ev<{ x: number; z: number }>(CAMERA);
    check(
      Math.hypot(camAfter.x - camBefore.x, camAfter.z - camBefore.z) < 0.5,
      'a world click on a building does not move the camera',
      JSON.stringify({ camBefore, camAfter }),
    );
    check(
      (await selection()).includes('Lab'),
      'clicking a building while units are selected selects the building',
      await selection(),
    );
    check(await cardsOpen(), '... and opens its cards');
  }

  // Zoom out a little so there is empty ground around the buildings to click.
  for (let i = 0; i < 5; i++) {
    await page.mouse.move(width / 2, height / 2);
    await page.mouse.wheel(0, 240);
    await wait(60);
  }
  await wait(1000);

  // --- A finished Move target must not leave the click handler in target mode (the old bug): select, Move, click on.
  await click(await center('.co-roster-groups button:has-text("Militie")'));
  await page.keyboard.press('m');
  const spot = await groundSpot();
  await click(spot);
  const labPt2 = await ev<Pt | null>(project(lab.x / 256, 2.5, lab.y / 256 + 6));
  if (labPt2 && (await ev<boolean>(onCanvas(labPt2.x, labPt2.y)))) {
    await click(labPt2);
    check(
      (await selection()).includes('Lab'),
      'after a finished Move target a building click still selects it',
      await selection(),
    );
  }
  // ... and while a target is pending, a click on a building leaves the mode and selects it
  await click(await center('.co-roster-groups button:has-text("Militie")'));
  await page.keyboard.press('a');
  if (labPt2 && (await ev<boolean>(onCanvas(labPt2.x, labPt2.y)))) {
    await click(labPt2);
    check(
      (await selection()).includes('Lab'),
      'a building click during Val aan targeting selects it',
      await selection(),
    );
  }
  await click(await groundSpot());
  check((await selection()).includes('Niets geselecteerd'), 'then empty ground clears again');
}

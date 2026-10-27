// Split from hud-clicks.ts to stay under the 5,000-token file limit: one sequential stage of runIn(), sharing the
// run context. Stage: zoom out, the first selection checks and building the lab and the workshop.
import { SITE_KEYS, HQ_KEY, check, wait, OWN, textOf, findSite } from './hud-clicks-common.js';
import type { Site, HudRun, HudRunState } from './hud-clicks-common.js';

export async function runBuildStage(ctx: HudRun): Promise<HudRunState> {
  const { page, width, height, shot, ev, click, center, selection } = ctx;
  const hqTypeId = await ev<number>(`window.crawlout.placement.typeId(${JSON.stringify(HQ_KEY)})`);
  // --- Zoom out and build a lab and a workshop with the one builder (sim time runs on the fake clock).
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(width / 2, height / 2);
    await page.mouse.wheel(0, 240);
    await wait(60);
  }
  await wait(600);
  await shot('00-no-selection');
  const noSel = await selection();
  check(noSel.includes('Niets geselecteerd'), 'no selection at the start');
  check(
    (await ev<string>(textOf('.co-commands'))).includes('Selecteer een eenheid of gebouw'),
    'commands panel only hints when nothing is selected',
  );
  const bar0 = await ev<string>(textOf('.co-building-buttons'));
  check(
    !bar0.includes('Basis') && !bar0.includes('Woning'),
    'the buildings bar does not list buildings without an action at the start',
    bar0,
  );

  // Builder selected: Verplaats, Stop, Bouw (no Val aan).
  await click(await center('.co-roster-groups button:has-text("Bouwer")'));
  const builderActions = await ev<string[]>(
    `[...document.querySelectorAll('.co-buttons [data-action]')].map((b) => b.getAttribute('data-action'))`,
  );
  check(
    builderActions.includes('build') &&
      builderActions.includes('move') &&
      !builderActions.includes('attackMove'),
    'builder gets Verplaats, Stop and Bouw but no Val aan',
    builderActions.join(','),
  );
  check(
    !builderActions.some((a) => a.startsWith('role')),
    'no role buttons before a workshop stands',
    builderActions.join(','),
  );
  await shot('01-builder-selected');
  await click(await center('.co-roster-groups button:has-text("Militie")'));
  const militiaActions = await ev<string[]>(
    `[...document.querySelectorAll('.co-buttons [data-action]')].map((b) => b.getAttribute('data-action'))`,
  );
  check(
    militiaActions.includes('attackMove') &&
      !militiaActions.includes('build') &&
      !militiaActions.includes('gather'),
    'militia gets Val aan but no Bouw or Verzamel',
    militiaActions.join(','),
  );
  await shot('02-militia-selected');
  for (const gone of ['hero', 'craft', 'minimap'])
    check(
      !(await ev<boolean>(`!!document.querySelector('[data-action="${gone}"]')`)),
      `no ${gone} button`,
    );
  check(
    await ev<boolean>(`!!document.querySelector('.co-minimap canvas')`),
    'minimap is always shown',
  );
  check(await ev<boolean>(`!!document.querySelector('.co-hero')`), 'hero panel is always shown');

  // Sites: the nearest spots to the HQ where the sim's placement rule accepts the building (a site already ordered
  // counts as a building for the next search, so the two never crowd each other).
  const hqRow = (await ev<{ t: number; x: number; y: number }[]>(OWN)).find(
    (e) => e.t === hqTypeId,
  );
  if (!hqRow) throw new Error('no own HQ found');
  const sites: Site[] = [];
  for (const s of SITE_KEYS) {
    const spot = await ev<{ typeId: number; x: number; y: number; w: number; h: number } | null>(
      findSite(s.key, hqRow.x, hqRow.y),
    );
    check(spot !== null, `a valid site for the ${s.name} exists near the HQ`);
    if (!spot) throw new Error(`no valid site for ${s.key}`);
    sites.push({ ...s, ...spot });
    console.log(`     ${s.name} site at ${spot.x},${spot.y} (typeId ${spot.typeId})`);
    await ev(`(() => {
      const c = window.crawlout; const es = [...c.entities().values()].filter((e) => e.owner === c.session.playerId);
      const builder = es.find((e) => e.typeId === c.unitTypeId('bouwer'))?.id;
      c.session.sendCommand('Build', { ids: [builder], typeId: ${spot.typeId}, x: ${spot.x}, y: ${spot.y} });
    })()`);
    await page.clock.runFor(1000);
  }
  // The scavengers collect scrap meanwhile, so a card is affordable once the buildings stand.
  await ev(`(() => {
    const c = window.crawlout; const es = [...c.entities().values()];
    const mine = es.filter((e) => e.owner === c.session.playerId);
    const scav = mine.filter((e) => e.typeId === c.unitTypeId('scavenger')).map((e) => e.id);
    const node = es.filter((e) => e.typeId === 2048).sort((a, b) => Math.hypot(a.x - mine[0].x, a.y - mine[0].y) - Math.hypot(b.x - mine[0].x, b.y - mine[0].y))[0];
    if (node && scav.length) c.session.sendCommand('Gather', { ids: scav, nodeId: node.id });
  })()`);
  await page.clock.runFor(2000);
  const finishAll = `(() => {
    const c = window.crawlout; const es = [...c.entities().values()].filter((e) => e.owner === c.session.playerId);
    const builder = es.find((e) => e.typeId === c.unitTypeId('bouwer'))?.id;
    for (const e of es) if (e.typeId >= 1024 && e.typeId < 2048 && e.anim === 6 && builder) c.session.sendCommand('Build', { ids: [builder], typeId: e.typeId, x: e.x, y: e.y });
  })()`;
  for (let i = 0; i < 14; i++) {
    await ev(finishAll);
    await page.clock.runFor(15000);
    await wait(500);
    const b = (await ev<{ t: number; anim: number }[]>(OWN)).filter(
      (e) => e.t >= 1024 && e.t < 2048,
    );
    if (b.length >= 3 && b.every((e) => e.anim === 0)) break;
  }
  const built = (await ev<{ t: number; anim: number }[]>(OWN)).filter(
    (e) => e.t >= 1024 && e.t < 2048,
  );
  check(
    built.length === 3 && built.every((e) => e.anim === 0),
    'lab and workshop are built',
    JSON.stringify(built),
  );
  for (let i = 0; i < 20 && (await ev<number>(`window.crawlout.status().scrap`)) < 220; i++) {
    await page.clock.runFor(15000);
    await wait(300);
  }
  check(
    (await ev<number>(`window.crawlout.status().scrap`)) >= 220,
    'scrap income pays for a card',
  );
  await page.keyboard.press('Escape');
  await wait(500);
  await shot('03-built');
  return { ...ctx, hqTypeId, hqRow, sites };
}

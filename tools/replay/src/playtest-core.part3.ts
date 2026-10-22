// Split from playtest-core.ts to stay under the 5,000-token file limit; playtest-core.ts re-exports the public surface.
// Holds: placeBuilding, untilBuilt.
import { Bot } from './playtest-core.part2.js';
import { ANIM_BUILD, DUTCH, wait } from './playtest-core.part1.js';
import type { Ent } from './playtest-core.part1.js';

/** Places a building through the B menu on free ground: tries candidate spots near the base until one is accepted. */
export async function placeBuilding(
  bot: Bot,
  naam: string,
  builderGroup = 'Bouwer',
  nearMin = 24,
  /** Sort the candidates by the distance to the nearest own building (the build range is short); false: by distance to the HQ. */
  byNear = false,
): Promise<Ent | null> {
  const before = await bot.buildings();
  const hq = before[0];
  if (!(await bot.rosterGroup(builderGroup))) {
    bot.finding('hoog', `geen ${builderGroup}-knop in de roster om ${naam} te bouwen`);
    return null;
  }
  const nameNow = await bot.selection();
  bot.expect(
    /bouwer/i.test(nameNow),
    'bouwer geselecteerd via de roster',
    'midden',
    nameNow.slice(0, 40),
  );
  await bot.key('b');
  const opt = bot.page
    .locator(
      `.co-build-option[aria-label^="${naam}," i], .co-build-option[aria-label^="${DUTCH[naam] ?? naam},"]`,
    )
    .first();
  if (!(await opt.count())) {
    bot.finding('hoog', `bouwmenu toont "${naam}" niet`);
    await bot.key('Escape');
    return null;
  }
  if (await opt.isDisabled()) {
    bot.finding(
      'laag',
      `bouwoptie "${naam}" is uitgeschakeld (te duur?) terwijl de bot hem wil kiezen`,
    );
    await bot.key('Escape');
    return null;
  }
  const optLabel = (await opt.getAttribute('aria-label')) ?? '';
  if (/^[a-z_]/.test(optLabel))
    bot.finding(
      'laag',
      `bouwmenu toont de ruwe datasleutel "${optLabel.split(',')[0]}" in plaats van de Nederlandse naam (getBuildOptions gebruikt b.key, niet buildingName)`,
    );
  const box = await opt.boundingBox();
  if (box) await bot.click({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  bot.expect(
    /Plaats/.test(await bot.text('.co-targeting')),
    `na de keuze staat de plaatsbalk er ("Plaats ${naam}")`,
    'hoog',
    optLabel,
  );
  if (!/Plaats/.test(await bot.text('.co-targeting'))) {
    bot.say(
      `  geen plaatsbalk; hint "${(await bot.text('.co-hint')).replace(/\s+/g, ' ').trim().slice(0, 100)}"; selectie "${(await bot.selection()).slice(0, 60)}"; menu open: ${await bot.ev<boolean>(`!!document.querySelector('.co-menu')`)}`,
    );
    await bot.shot(`geen-plaatsbalk-${naam}`);
  }
  // The roster click centred the camera on the builder, who may be far away (at a claim post): look at the base.
  if (hq) await bot.panTo(hq.x, hq.y);
  // Candidate spots: visible ground free of entities, near the base, away from every building.
  const grid = (await bot.groundGrid(34))
    .filter((g) => g.eid === null)
    .map((g) => ({
      ...g,
      d: hq ? Math.hypot(g.gx - hq.x, g.gy - hq.y) / 256 : 0,
      near: Math.min(...before.map((b) => Math.hypot(g.gx - b.x, g.gy - b.y) / 256)),
    }))
    .filter((g) => g.near > nearMin)
    .sort((a, b) => (byNear ? a.near - b.near : a.d - b.d));
  const tried: string[] = [];
  const candidates = grid.filter((_, i) => i % 3 === 0).slice(0, 40);
  for (const c of candidates) {
    await bot.move({ x: c.px, y: c.py }, 10);
    await wait(150);
    await bot.click({ x: c.px, y: c.py }, { settle: 500 });
    const stillPlacing = /Plaats/.test(await bot.text('.co-targeting'));
    if (!stillPlacing) {
      // the click was accepted: a new site should appear
      await bot.advance(1);
      await wait(300);
      const after = await bot.buildings();
      const added = after.filter((a) => !before.some((b) => b.id === a.id));
      bot.expect(
        added.length > 0,
        `na plaatsen verschijnt een bouwplaats voor ${naam}`,
        'hoog',
        `${tried.length} geweigerde plekken`,
      );
      bot.refused[naam] = tried.length;
      if (tried.length >= 12)
        bot.finding(
          'midden',
          `plaatsing van ${naam}: ${tried.length} zichtbaar vrije plekken geweigerd voor er een werd geaccepteerd (de preview is rood, maar de speler zoekt zo lang)`,
        );
      return added[0] ?? null;
    }
    if (tried.length < 2) {
      bot.say(
        `  geweigerd op ${Math.round(c.gx / 256)},${Math.round(c.gy / 256)}: "${(await bot.text('.co-targeting')).replace(/\s+/g, ' ').trim().slice(0, 140)}"`,
      );
      if (tried.length === 0) await bot.shot(`placement-refused-${naam}`);
    }
    tried.push(`${Math.round(c.gx / 256)},${Math.round(c.gy / 256)}`);
  }
  bot.finding(
    'hoog',
    `plaatsing van ${naam}: alle ${tried.length} plekken geweigerd (altijd rood?) ${tried.join(' ')}`,
  );
  await bot.key('Escape');
  return null;
}

/** Waits until a new building of this site is finished (anim not build). */
export async function untilBuilt(
  bot: Bot,
  site: Ent | null,
  naam: string,
  maxS = 240,
): Promise<boolean> {
  if (!site) return false;
  return bot.until(
    `${naam} klaar`,
    async () => {
      const e = (await bot.own()).find((x) => x.id === site.id);
      return !!e && e.anim !== ANIM_BUILD;
    },
    maxS,
  );
}

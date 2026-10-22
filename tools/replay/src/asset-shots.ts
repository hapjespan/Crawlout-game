// Review images of the delivered assets (assets/dist-local) beside a standard Dweller for scale, from the render demo.
// Not part of `pnpm test`; needs the client's dev server and Chromium.
//
//   ASSET_URL=http://localhost:5299/ ASSET_SHOTS=/some/dir node --import tsx src/asset-shots.ts
//
// The local bitmap assets only load in dev, so these images never come from a production build.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import console from 'node:console';

const URL = process.env.ASSET_URL ?? 'http://localhost:5299/';
const SHOTS = process.env.ASSET_SHOTS ?? '/tmp/asset-shots';

/** One image per subject: the units are drawn with these loadouts in turn, so a Dweller stands beside the new model. */
const SHOTS_LIST: readonly { name: string; loadouts: string; note: string }[] = [
  { name: '1-krachtpantser', loadouts: 'scavenger,krachtpantser', note: 'power armour naast dweller' },
  { name: '2-plasmaridder', loadouts: 'scavenger,plasmaridder', note: 'power armour frame naast dweller' },
  { name: '3-klerk', loadouts: 'scavenger,klerk', note: 'Klerk naast dweller' },
  { name: '4-vertibird', loadouts: 'scavenger,vertibird', note: 'Vertibird naast dweller' },
  { name: '5-alles', loadouts: 'scavenger,krachtpantser,plasmaridder,klerk', note: 'alles naast elkaar' },
];

async function main(): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log(`  pagina-fout: ${e.message.slice(0, 120)}`));
  for (const shot of SHOTS_LIST) {
    const url = `${URL}render-demo.html?loadouts=${shot.loadouts}&hold=idle&units=24&props=0&shadows=low`;
    await page.goto(url, { waitUntil: 'load' });
    // The renderer needs a few frames before the assets are in; the demo ticks at 20 Hz.
    await page.waitForTimeout(6000);
    const file = join(SHOTS, `${shot.name}.png`);
    await page.screenshot({ path: file });
    console.log(`${shot.name.padEnd(18)} ${shot.note}`);
  }
  await browser.close();
  console.log(`\nklaar: ${SHOTS}`);
}

await main();

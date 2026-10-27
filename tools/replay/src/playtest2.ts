// Speeltest 2: the same human-speed bot as playtest.ts (mouse and keyboard through the REAL HUD, no sendCommand), but it
// starts through the real front end (splash -> menu -> Tegen AI -> choose faction and AI faction -> Start) and plays about
// 15 in-game minutes against the scripted AI. It covers what playtest.ts does not: fog of war (scouting reveals, ghost
// buildings, attacking only visible targets), creep camps (tier 1 with hero and militia, loot and hero XP), the perk panel
// (P) after a level-up, claim posts (build menu and hero claim), the Raiders (Slaver Vang on an enemy settler, slaves to the
// Kooi, SetRole on slaves, tents and Produce, chems through the Chem-dealer, Warlord Raid, the revolt warning), the Dwellers
// (Bevrijd an enemy-held slave when one is visible, robots, training), the Gebouwen bar, cards, deselect and select rules,
// and "Terug naar menu" after Opgeven.
//
// Plan: PLAYTEST2_PLAN=dw-ra@1600x900,ra-dw@1600x900,dw-dw@1600x900,dw-ra@1280x720  (own faction - AI faction @ size)
//   PLAYTEST_URL=http://localhost:5215/ PLAYTEST_SHOTS=/some/dir PLAYTEST_MINUTES=15 node --import tsx src/playtest2.ts
// Sim time runs on Playwright's fake clock (runFor); every input is still real-time human speed. Needs a running client
// and Chrome; not part of `pnpm test`. Reads the map file (spawns, claim points, camps) as the map knowledge a player has.
import { SHOTS, ALL_FINDINGS } from './playtest-core.js';
import type { Bot, Severity } from './playtest-core.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PLAN } from './playtest2-base.js';
import { mainRun } from './playtest2-main.js';

if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const bots: Bot[] = [];
for (const cfg of PLAN) bots.push(await mainRun(cfg));

console.log('\n===== PERF =====');
for (const b of bots) {
  if (b.perf.length === 0) continue;
  const fps = b.perf.map((p) => p.fps);
  const worst = Math.max(...b.perf.map((p) => p.worst));
  const dc = Math.max(...b.perf.map((p) => p.dc));
  console.log(
    `${b.tag}${b.size}: ${b.perf.length} metingen, fps min ${Math.min(...fps)} gem ${(fps.reduce((a, x) => a + x, 0) / fps.length).toFixed(0)}, slechtste frame ${worst} ms, max ${dc} draw calls`,
  );
}

console.log('\n===== BEVINDINGEN =====');
const order: Severity[] = ['hoog', 'midden', 'laag'];
for (const sev of order)
  for (const f of ALL_FINDINGS.filter((x) => x.severity === sev))
    console.log(`[${sev}] (${f.size}, ${f.step}) ${f.text}`);
if (ALL_FINDINGS.length === 0) console.log('geen bevindingen');
if (SHOTS)
  writeFileSync(
    `${SHOTS}/findings2-${bots.map((b) => b.tag + b.size).join('+')}.json`,
    JSON.stringify(
      { findings: ALL_FINDINGS, perf: bots.map((b) => ({ run: b.tag + b.size, perf: b.perf })) },
      null,
      1,
    ),
  );
process.exit(0);

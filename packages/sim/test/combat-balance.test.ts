import { describe, expect, it } from 'vitest';
import { LAYOUTS, duel, formatSweep, sweep } from './combat.js';
import type { SweepResult } from './combat.js';

// Combat balance (data 0.19.0, feedback Martien 16 oktober): "robots en tanks mogen wel langer leven. bij 5 poppetjes
// die schieten: 5 units tegen sentinel moet gelijk op gaan. bij 4 wint tank, bij 6 wint vijand. bij een normale robot
// is het 1-3." The basic shooting human is the militie loadout (pipe pistol, light armour): the standard, cheap core
// of the army. The fights run in the harness of combat.ts over 24 layouts (three distances, two lateral offsets, line
// or block, and both sides of the map); there is no rng in these fights, so a layout gives one fixed outcome.
//
// Bands: "even" is a mean margin (remaining hp fraction of the robot side minus that of the humans) within 0.2 of
// zero; a clear win is every layout won with a mean margin of at least 0.25. Measured with data 0.19.0: sentinel vs
// 4 / 5 / 6 militie margin +0.44 / +0.02 / -0.41; beveiligingsrobot vs 2 / 3 / 4 militie +0.55 / +0.08 / -0.54.
// With data 0.18.0 (sentinel 220 hp, robot 450 hp and 0.8 s cooldown; now 520 hp and 3.5 s) the sentinel lost to 5 (-0.29) and the robot
// beat 5 militie (+0.35).

const HUMAN = 'militie';
const EVEN = 0.2;
const CLEAR = 0.25;

const show = (label: string, s: SweepResult): string => formatSweep(label, s);

function expectRobotWins(label: string, s: SweepResult): void {
  expect(s.robotWins, show(label, s)).toBe(s.runs);
  expect(s.meanMargin, show(label, s)).toBeGreaterThanOrEqual(CLEAR);
}
function expectHumansWin(label: string, s: SweepResult): void {
  expect(s.humanWins, show(label, s)).toBe(s.runs);
  expect(s.meanMargin, show(label, s)).toBeLessThanOrEqual(-CLEAR);
}
function expectEven(label: string, s: SweepResult): void {
  expect(s.draws, show(label, s)).toBe(0);
  expect(Math.abs(s.meanMargin), show(label, s)).toBeLessThanOrEqual(EVEN);
}

describe('combat balance: sentinel against militie (5 is even)', () => {
  it('4 militie: the sentinel wins', () => {
    expectRobotWins('sentinel vs 4', sweep('sentinel', HUMAN, 4));
  });
  it('5 militie: even', () => {
    expectEven('sentinel vs 5', sweep('sentinel', HUMAN, 5));
  });
  it('6 militie: the humans win', () => {
    expectHumansWin('sentinel vs 6', sweep('sentinel', HUMAN, 6));
  });
});

describe('combat balance: beveiligingsrobot against militie (1 robot is 3 humans)', () => {
  it('2 militie: the robot wins', () => {
    expectRobotWins('beveiligingsrobot vs 2', sweep('beveiligingsrobot', HUMAN, 2));
  });
  it('3 militie: even', () => {
    expectEven('beveiligingsrobot vs 3', sweep('beveiligingsrobot', HUMAN, 3));
  });
  it('4 militie: the humans win', () => {
    expectHumansWin('beveiligingsrobot vs 4', sweep('beveiligingsrobot', HUMAN, 4));
  });
  it('robots live longer: one robot against three militie lasts more than half a minute', () => {
    expect(sweep('beveiligingsrobot', HUMAN, 3).meanSeconds).toBeGreaterThan(30);
  });
});

describe('combat harness', () => {
  it('is fair: the mirrored layout (robot on the other side) gives the same outcome', () => {
    for (const robot of ['sentinel', 'beveiligingsrobot'])
      for (const humans of [3, 5]) {
        for (const layout of LAYOUTS.filter((l) => l.robotPlayer === 0)) {
          const a = duel({ robot, human: HUMAN, humans, layout });
          const b = duel({ robot, human: HUMAN, humans, layout: { ...layout, robotPlayer: 1 } });
          const label = `${robot} vs ${humans} ${JSON.stringify(layout)}`;
          expect(b.winner, label).toBe(a.winner);
          expect(Math.abs(b.margin - a.margin), label).toBeLessThanOrEqual(0.1);
        }
      }
  });

  it('the reparatiedrone stays fragile: one militie kills it', () => {
    const s = sweep('reparatiedrone', HUMAN, 1);
    expect(s.humanWins, show('reparatiedrone vs 1', s)).toBe(s.runs);
  });

  // COMBAT_REPORT=1 npx vitest run test/combat-balance.test.ts: the full table, also against patrol and geweer_leer.
  it.runIf(process.env.COMBAT_REPORT === '1')(
    'report',
    () => {
      const lines: string[] = [];
      for (const human of ['militie', 'patrol', 'geweer_leer']) {
        for (const n of [3, 4, 5, 6, 7])
          lines.push(formatSweep(`sentinel vs ${human}`, sweep('sentinel', human, n)));
        for (const n of [1, 2, 3, 4, 5])
          lines.push(
            formatSweep(`beveiligingsrobot vs ${human}`, sweep('beveiligingsrobot', human, n)),
          );
      }
      console.log(lines.join('\n'));
    },
    120_000,
  );
});

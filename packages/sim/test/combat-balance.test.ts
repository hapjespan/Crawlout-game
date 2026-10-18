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

// Raider lines (data 0.24.0): the faction identity of Spelfundament 4, "cheap, fragile, hard-hitting early", against
// the Dwellers' early militie, their workers and a robot. The Raider group is the first side of the harness (`robots`
// is its size). Costs: plunderaar 25, knuppelaar 35, molotovgooier 42, hond 28, buggy 90; militie 30, scavenger 0,
// beveiligingsrobot 150. Measured with data 0.24.0 (unchanged loadouts since 0.21.0), mean margin of the Raider side:
// 6 plunderaar vs 5 militie +0.24 and 5 vs 5 -0.39; 4 knuppelaar vs 4 militie +0.56 and 3 vs 4 +0.15; 4 molotovgooier
// vs 4 militie +0.49; 3 hond vs 4 scavenger +0.62 and vs 3 militie -0.77; 1 buggy vs 2 militie +0.30 and vs 3 -0.45;
// 3 plunderaar vs 1 beveiligingsrobot +0.67 in 49 s. A plain plunderaar loses to the patrol rifle at equal cost (3 vs 2
// patrol -0.53): early pipe guns, not a late army.
const raiders = (unit: string, n: number, dweller: string, m: number): SweepResult =>
  sweep(unit, dweller, m, { robots: n });

describe('combat balance: Raiders are cheap, fragile and hit hard early', () => {
  it('cheap: 6 plunderaar beat 5 militie (equal cost) in every layout, by a smaller margin', () => {
    const s = raiders('plunderaar', 6, HUMAN, 5);
    expect(s.robotWins, show('6 plunderaar vs 5 militie', s)).toBe(s.runs);
    expect(s.meanMargin, show('6 plunderaar vs 5 militie', s)).toBeGreaterThanOrEqual(0.1);
  });
  it('fragile: 5 plunderaar lose to 5 militie (equal numbers)', () => {
    expectHumansWin('5 plunderaar vs 5 militie', raiders('plunderaar', 5, HUMAN, 5));
  });
  it('early only: 3 plunderaar lose to 2 patrol (equal cost, the Dwellers after geweerrek)', () => {
    expectHumansWin('3 plunderaar vs 2 patrol', raiders('plunderaar', 3, 'patrol', 2));
  });
  it('hard-hitting: 4 knuppelaar beat 4 militie clearly, 3 against 4 is even (equal cost)', () => {
    expectRobotWins('4 knuppelaar vs 4 militie', raiders('knuppelaar', 4, HUMAN, 4));
    expectEven('3 knuppelaar vs 4 militie', raiders('knuppelaar', 3, HUMAN, 4));
  });
  it('the molotovgooier outranges militie: 4 against 4 win clearly', () => {
    expectRobotWins('4 molotovgooier vs 4 militie', raiders('molotovgooier', 4, HUMAN, 4));
  });
  it('the hond hunts workers and dies to soldiers', () => {
    expectRobotWins('3 hond vs 4 scavenger', raiders('hond', 3, 'scavenger', 4));
    expectHumansWin('3 hond vs 3 militie', raiders('hond', 3, HUMAN, 3));
  });
  it('the buggy harasses: it beats 2 militie and loses to 3 (equal cost)', () => {
    expectRobotWins('buggy vs 2 militie', raiders('buggy', 1, HUMAN, 2));
    expectHumansWin('buggy vs 3 militie', raiders('buggy', 1, HUMAN, 3));
  });
  it('a robot outlasts Raiders: 3 plunderaar need more than half a minute for a beveiligingsrobot', () => {
    const s = raiders('plunderaar', 3, 'beveiligingsrobot', 1);
    expectRobotWins('3 plunderaar vs beveiligingsrobot', s);
    expect(s.meanSeconds, show('3 plunderaar vs beveiligingsrobot', s)).toBeGreaterThan(30);
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

  // data 0.26.0 (voorstel, ter bevestiging door de architect): the bouwrobot does not fight (damage 0) but is sturdier
  // than a bouwer: one militie needs more than half a minute for it
  it('the bouwrobot never fights: one militie kills it, but not quickly', () => {
    const s = sweep('bouwrobot', HUMAN, 1);
    expect(s.humanWins, show('bouwrobot vs 1', s)).toBe(s.runs);
    expect(s.meanSeconds, show('bouwrobot vs 1', s)).toBeGreaterThan(30);
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

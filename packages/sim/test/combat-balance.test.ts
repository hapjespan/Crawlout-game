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

// Raider lines (data 0.27.0; voorstel, ter bevestiging door de architect en content). Martien, 18 oktober: "raiders
// moeten wel vanaf het begin een camp over kunnen nemen, die moeten niet direct sterker zijn, die zijn zwakker dan
// bouwers. nu is de raider faction dus de moeilijk om te spelen." Read as: a Raider fighter is weaker than his Dweller
// counterpart one on one ("bouwers" = the Dwellers, the faction that builds), and the Raiders make up for it with
// numbers, the creep camps they take over (data/creeps.json takeover) and slaves; the harder faction to play. Not read
// as "weaker than the Dweller worker": a plunderaar still beats a bouwer, a fighter that loses to a hammer is no fighter.
// The Raider group is the first side of the harness (`robots` is its size). Costs: plunderaar 25, knuppelaar 35,
// molotovgooier 42, hond 28, buggy 90; militie 30, slagwapen_leer 40, scavenger and bouwer 0 and 10,
// beveiligingsrobot 150. Measured with data 0.27.0 (plunderaar 46 hp and 6 damage, was 55 and 7; plunderaar_staal 51
// hp and 6, was 60 and 7; knuppelaar 61 hp, 10 damage and light armour, was 70, 14 and medium; molotovgooier 45 hp and
// 11, was 50 and 13), mean margin of the Raider side: 1 plunderaar vs 1 militie -0.40 (was -0.18), vs 1 bouwer +0.61;
// 2 vs 1 militie +0.57; 5 vs 5 -0.61 (was -0.39); 6 vs 5 -0.35 (was +0.24); 7 vs 5 +0.24; 1 knuppelaar vs 1
// slagwapen_leer -0.25 and 4 vs 4 -0.44 (was +0.36); 4 knuppelaar vs 4 militie -0.38 (was +0.56) and 5 vs 4 +0.26;
// 4 molotovgooier vs 4 militie -0.19 (was +0.49) and 5 vs 4 +0.49; 3 plunderaar vs 2 patrol -0.63; 3 hond vs 4
// scavenger +0.62 and vs 3 militie -0.77; 1 buggy vs 2 militie +0.30 and vs 3 -0.45; 3 plunderaar vs 1
// beveiligingsrobot +0.38 in 73 s.
const raiders = (unit: string, n: number, dweller: string, m: number): SweepResult =>
  sweep(unit, dweller, m, { robots: n });

describe('combat balance: a Raider is weaker than a Dweller, the Raiders win on numbers', () => {
  it('one on one: a plunderaar loses to a militie, a knuppelaar to a slagwapen_leer', () => {
    expectHumansWin('1 plunderaar vs 1 militie', raiders('plunderaar', 1, HUMAN, 1));
    const s = raiders('knuppelaar', 1, 'slagwapen_leer', 1);
    expect(s.robotWins, show('1 knuppelaar vs 1 slagwapen_leer', s)).toBe(0);
    expect(s.meanMargin, show('1 knuppelaar vs 1 slagwapen_leer', s)).toBeLessThanOrEqual(-0.2);
  });
  it('but a fighter is a fighter: a plunderaar beats a Dweller bouwer', () => {
    expectRobotWins('1 plunderaar vs 1 bouwer', raiders('plunderaar', 1, 'bouwer', 1));
  });
  it('equal numbers: 5 plunderaar, 4 knuppelaar and 4 molotovgooier lose to as many militie', () => {
    expectHumansWin('5 plunderaar vs 5 militie', raiders('plunderaar', 5, HUMAN, 5));
    expectHumansWin('4 knuppelaar vs 4 militie', raiders('knuppelaar', 4, HUMAN, 4));
    const s = raiders('molotovgooier', 4, HUMAN, 4);
    expect(s.humanWins, show('4 molotovgooier vs 4 militie', s)).toBe(s.runs);
  });
  it('equal cost is not enough either: 6 plunderaar lose to 5 militie', () => {
    expectHumansWin('6 plunderaar vs 5 militie', raiders('plunderaar', 6, HUMAN, 5));
  });
  it('numbers win: 2 plunderaar beat 1 militie, 7 beat 5, 5 knuppelaar or molotovgooier beat 4', () => {
    expectRobotWins('2 plunderaar vs 1 militie', raiders('plunderaar', 2, HUMAN, 1));
    const seven = raiders('plunderaar', 7, HUMAN, 5);
    expect(seven.robotWins, show('7 plunderaar vs 5 militie', seven)).toBe(seven.runs);
    expect(seven.meanMargin, show('7 plunderaar vs 5 militie', seven)).toBeGreaterThanOrEqual(0.1);
    expectRobotWins('5 knuppelaar vs 4 militie', raiders('knuppelaar', 5, HUMAN, 4));
    expectRobotWins('5 molotovgooier vs 4 militie', raiders('molotovgooier', 5, HUMAN, 4));
  });
  it('early only: 3 plunderaar lose to 2 patrol (equal cost, the Dwellers after geweerrek)', () => {
    expectHumansWin('3 plunderaar vs 2 patrol', raiders('plunderaar', 3, 'patrol', 2));
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

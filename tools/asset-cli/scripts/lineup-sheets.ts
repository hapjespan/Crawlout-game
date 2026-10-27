// Drives lineup.ts: one sheet per faction, heroes and creatures, props and buildings, plus the RTS-zoom sheet.
//   npx -y pnpm@9 --filter @crawlout/asset-cli exec tsx scripts/lineup-sheets.ts <outDir> [clip] [phase]
import {
  assets,
  BACK,
  FRONT,
  loadouts,
  RTS_A,
  RTS_B,
  sheet,
  SIDE,
  type Subject,
} from './lineup.js';

const KLERK: Subject = { label: 'REF Klerk 1,8 m', body: 'garde_body_clerk' };
const all = loadouts().filter((l) => assets.has(l.slots.body ?? ''));
const humanoid = (id: string): boolean => assets.get(id)?.kind === 'character';
const units = (faction: string): Subject[] =>
  all
    .filter((l) => l.faction === faction && humanoid(l.slots.body!))
    .map((l) => ({ label: `${l.id} (${l.role})`, body: l.slots.body!, slots: l.slots }));
const ids = [...assets.keys()];

// --ids a,b: one sheet with each asset in its bind pose and its idle pose, nothing else.
const only = process.argv.indexOf('--ids');
if (only > 0) {
  const subs = process.argv[only + 1]!.split(',').flatMap((id): Subject[] => [
    { label: `${id} bind`, body: id, clip: 'bind', lift: true },
    { label: `${id} idle`, body: id, lift: true },
  ]);
  await sheet(
    process.argv[only + 2] ?? 'ids',
    [KLERK, ...subs],
    [FRONT, SIDE],
    Number(process.argv[only + 3] ?? 60),
  );
  process.exit(0);
}

// The scavenger's bag on its back (local asset dweller_gear_scrapbag), as the loadout would show it with `gear_back`.
const bagOnBack: Subject[] = assets.has('dweller_gear_scrapbag')
  ? [
      {
        label: 'scavenger, bag on back',
        body: 'dweller_body_human',
        slots: { body: 'dweller_body_human', gear_back: 'dweller_gear_scrapbag' },
      },
    ]
  : [];
await sheet('1-dwellers', [KLERK, ...bagOnBack, ...units('dwellers')], [FRONT, SIDE, BACK], 110);
await sheet('2-raiders', [KLERK, ...units('raiders')], [FRONT, SIDE, BACK], 110);
await sheet('3-garde', [KLERK, ...units('garde')], [FRONT, SIDE, BACK], 110);
await sheet(
  '4-heroes-survival',
  [
    KLERK,
    ...ids
      .filter((i) => humanoid(i) && /^(hero_|survival_)/.test(i))
      .map((i) => ({ label: i, body: i })),
  ],
  [FRONT, SIDE],
  110,
);
await sheet(
  '5-rigid-units',
  [
    KLERK,
    ...ids.filter((i) => assets.get(i)!.kind === 'rigid-unit').map((i) => ({ label: i, body: i })),
  ],
  [FRONT, SIDE],
  40,
);
const props = ids.filter(
  (i) => assets.get(i)!.kind === 'prop' && /_(weapon|tool|gear|armor)_/.test(i),
);
await sheet(
  '6-props',
  [KLERK, ...props.map((i) => ({ label: i, body: i, lift: true }))],
  [FRONT, SIDE],
  160,
);
for (const f of ['dweller', 'raider', 'garde', 'site'])
  await sheet(
    `7-buildings-${f}`,
    [
      KLERK,
      ...ids
        .filter((i) => assets.get(i)!.kind === 'building' && i.startsWith(f))
        .map((i) => ({ label: i, body: i })),
    ],
    [FRONT, SIDE],
    14,
  );
// RTS zoom per faction, at the game's pixel size (about 40 px for a 1,8 m figure) on a terrain-coloured ground.
for (const f of ['dwellers', 'raiders', 'garde']) {
  const rts: Subject[] = [...bagOnBack.filter(() => f === 'dwellers'), ...units(f)].map((u) => ({
    ...u,
    label: u.label.split(' ')[0]!,
  }));
  if (f === 'garde')
    rts.push(...ids.filter((i) => i.startsWith('hero_')).map((i) => ({ label: i, body: i })));
  await sheet(`8-rts-${f}`, rts, [RTS_A, RTS_B], 30, { pixel: 3, bg: [92, 86, 64] });
}

// The bag on the back through the main clips: does it clip the body?
if (bagOnBack.length) {
  const poses = ['idle', 'walk', 'run', 'gather', 'build', 'attack1'].flatMap((clip) =>
    [0, 0.5].map((phase): Subject => ({
      ...bagOnBack[0]!,
      label: `${clip} ${phase}`,
      clip,
      phase,
    })),
  );
  await sheet(
    '9-backpack-clips',
    poses,
    [SIDE, BACK, { name: 'back', yaw: Math.PI, pitch: 0 }],
    160,
  );
}

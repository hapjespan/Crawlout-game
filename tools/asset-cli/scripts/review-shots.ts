// Review sheets for the 17 new assets: silhouette (without texture) and textured preview.
// Weapons shown alone and also beside the Klerk at the right scale.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { silhouetteSheet, type Subject } from '../src/silhouette.js';
import { previewSheet, type PreviewSubject } from '../src/preview.js';
import sharp from 'sharp';

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../../../assets/dist-local');
const OUT = '/tmp/asset-review';
mkdirSync(OUT, { recursive: true });

const groups: { name: string; ids: string[] }[] = [
  { name: '1-characters-humans', ids: ['garde_body_power_armor','garde_body_power_armor_heavy','survival_ghoul','survival_ghoul_runner','survival_mutant','survival_mutant_brute'] },
  { name: '2-creatures-and-buggy', ids: ['raider_body_hound','survival_klauwbeest','raider_vehicle_buggy'] },
  { name: '3-buildings', ids: ['garde_building_dormitory','dweller_building_turret_laser','garde_building_turret_laser'] },
  { name: '4-weapons', ids: ['dweller_weapon_pipe_pistol','garde_weapon_laser_pistol','garde_weapon_laser_carbine','garde_weapon_plasma_caster','garde_weapon_vertibird_gun'] },
];

async function writePng(name: string, img: { data: Uint8Array; width: number; height: number }): Promise<void> {
  const file = join(OUT, name + '.png');
  await sharp(Buffer.from(img.data), { raw: { width: img.width, height: img.height, channels: 4 } })
    .png().toFile(file);
  console.log(`  ${file}`);
}

for (const g of groups) {
  const subs: Subject[] = g.ids.map(id => ({ label: id, file: join(DIST, id, 'lod0.glb') }));
  const previewSubs: PreviewSubject[] = g.ids.map(id => ({ label: id, file: join(DIST, id, 'lod0.glb') }));
  console.log(g.name);
  await writePng(`${g.name}-silhouette`, await silhouetteSheet(subs,  { width: 1800, height: 820 }));
  await writePng(`${g.name}-textured`,   await previewSheet(previewSubs, { width: 1800, height: 820 }));
}

// Weapons beside the Klerk for scale.
const klerk = { label: 'Klerk (1,8 m)', file: join(DIST, 'garde_body_clerk', 'lod0.glb') };
const weapons = ['dweller_weapon_pipe_pistol','garde_weapon_laser_pistol','garde_weapon_laser_carbine','garde_weapon_plasma_caster','garde_weapon_vertibird_gun'];
const withKlerk: Subject[] = [klerk, ...weapons.map(id => ({ label: id, file: join(DIST, id, 'lod0.glb') }))];
console.log('5-weapons-vs-klerk');
await writePng('5-weapons-vs-klerk-silhouette', await silhouetteSheet(withKlerk, { width: 2200, height: 900 }));
await writePng('5-weapons-vs-klerk-textured',   await previewSheet(withKlerk as PreviewSubject[], { width: 2200, height: 900 }));

console.log(`klaar: ${OUT}`);

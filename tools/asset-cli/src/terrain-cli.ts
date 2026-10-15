// `pnpm --filter @crawlout/asset-cli run terrain`: hoogteveld en albedo uit assets/local/rock_terrain_4.glb naar
// assets/dist/terrain (`--albedo-size <px>` voor een albedo van een andere maat dan 1024). Zonder bronbestand (het zit niet in git) meldt de CLI dat en stopt hij met exit 0.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTerrain } from './terrain.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

// assets/local is gitignored en staat dus alleen in de hoofdcheckout; vanuit een worktree zoeken we daar ook.
function defaultSource(): string {
  const local = `${repoRoot}assets/local/rock_terrain_4.glb`;
  if (existsSync(local)) return local;
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    return resolve(dirname(resolve(repoRoot, common)), 'assets/local/rock_terrain_4.glb');
  } catch {
    return local;
  }
}

const source = argValue('--src') ?? defaultSource();
const outDir = argValue('--out') ?? `${repoRoot}assets/dist/terrain`;
const cropArg = argValue('--crop-size');
const rotationArg = argValue('--rotation');
// --albedo-size 2048: albedo op 2048 x 2048 (16 px per meter op de map) in plaats van 1024; het hoogteveld blijft gelijk.
const albedoSizeArg = argValue('--albedo-size');

if (!existsSync(source)) {
  console.log(`terrain: bron ${source} ontbreekt (staat niet in git); de gecommitte afgeleide data in ${outDir} blijft ongewijzigd.`);
  process.exit(0);
}

const started = Date.now();
const result = await buildTerrain({
  source,
  outDir,
  id: 'rock_terrain_4',
  attribution:
    '"Rock Terrain 4" by Lassi Kaukonen (https://sketchfab.com/thesidekick), CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). Source: https://sketchfab.com/3d-models/rock-terrain-4-3a0e4dec66154901bf905384622183dd',
  cropSizeM: cropArg ? Number(cropArg) : undefined,
  rotationsDeg: rotationArg ? [Number(rotationArg)] : undefined,
  albedoSize: albedoSizeArg ? Number(albedoSizeArg) : undefined,
});

const { crop, field } = result;
console.log(
  `uitsnede ${crop.sizeM} m, draaiing ${crop.rotationDeg} graden, vanaf x=${crop.minX}, z=${crop.minZ} (reliefscore ${crop.score.toFixed(2)}), schaal ${result.manifest.crop.scale}, ${result.removedTriangles} zwevende driehoeken verwijderd`,
);
console.log(`hoogteveld ${field.w}x${field.h}, ${field.minM} tot ${field.maxM} m, ${result.filledCells} cellen opgevuld`);
console.log(`albedo-dekking ${(result.coveredFraction * 100).toFixed(1)}%, rockTint ${result.manifest.rockTint}, groundTint ${result.manifest.groundTint}`);
for (const file of result.files) console.log(`  ${file.path}  ${(file.bytes / 1024).toFixed(1)} kB`);
console.log(`klaar in ${((Date.now() - started) / 1000).toFixed(1)} s`);

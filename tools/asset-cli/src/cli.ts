import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAssets } from './build.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

function hasGlb(dir: string): boolean {
  try {
    return readdirSync(dir, { withFileTypes: true }).some((e) =>
      e.isDirectory() ? hasGlb(join(dir, e.name)) : e.name.toLowerCase().endsWith('.glb'),
    );
  } catch {
    return false;
  }
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

// --local: bronnen buiten git (assets/local, bijvoorbeeld fanart) naar assets/dist-local, met eigen rigmap en clipmap
// in assets/local. Ontbreekt de map of staat er geen GLB in, dan gebeurt er niets (CI blijft groen).
const local = process.argv.includes('--local');
const srcDir = argValue('--src') ?? `${repoRoot}assets/${local ? 'local' : 'src'}`;
const distDir = argValue('--dist') ?? `${repoRoot}assets/${local ? 'dist-local' : 'dist'}`;

if (local && !hasGlb(srcDir)) {
  console.log(`geen lokale assets in ${srcDir}; niets gedaan.`);
  process.exit(0);
}

// The delivered models (assets/local/delivered.json, art in assets/local/delivered; both gitignored) only go through the local pipeline.
// Its default follows --src, so a worktree building the main checkout's assets/local keeps the delivered models.
const deliveredPath = argValue('--delivered') ?? join(srcDir, 'delivered.json');
const result = await buildAssets({
  srcDir,
  distDir,
  ...(local ? { onlyConfigured: true, deliveredPath } : {}),
});

for (const notice of result.notices) console.warn(`waarschuwing: ${notice}`);

if (result.reports.length === 0) {
  console.log(`geen assets in ${srcDir}; lege manifest.json geschreven.`);
  process.exit(0);
}

for (const report of result.reports) {
  const status = report.errors.length > 0 ? 'FOUT' : 'ok';
  console.log(`${status}  ${report.id} (${report.source})`);
  for (const error of report.errors) console.error(`  fout: ${error}`);
  for (const warning of report.warnings) console.warn(`  waarschuwing: ${warning}`);
}

if (!result.ok) {
  console.error(`\nassets voldoen niet aan de brief; er is niets naar ${distDir} geschreven.`);
  process.exit(1);
}
console.log(`\n${result.manifest?.assets.length ?? 0} assets naar ${distDir}`);

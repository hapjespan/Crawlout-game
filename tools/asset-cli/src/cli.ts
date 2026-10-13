import { fileURLToPath } from 'node:url';
import { buildAssets } from './build.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const srcDir = argValue('--src') ?? `${repoRoot}assets/src`;
const distDir = argValue('--dist') ?? `${repoRoot}assets/dist`;

const result = await buildAssets({ srcDir, distDir });

for (const notice of result.notices) console.warn(`waarschuwing: ${notice}`);

if (result.reports.length === 0) {
  console.log('geen assets in assets/src; lege manifest.json geschreven.');
  process.exit(0);
}

for (const report of result.reports) {
  const status = report.errors.length > 0 ? 'FOUT' : 'ok';
  console.log(`${status}  ${report.id} (${report.source})`);
  for (const error of report.errors) console.error(`  fout: ${error}`);
  for (const warning of report.warnings) console.warn(`  waarschuwing: ${warning}`);
}

if (!result.ok) {
  console.error('\nassets voldoen niet aan de brief; er is niets naar assets/dist geschreven.');
  process.exit(1);
}
console.log(`\n${result.manifest?.assets.length ?? 0} assets naar ${distDir}`);

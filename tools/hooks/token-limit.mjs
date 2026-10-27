// Pre-commit guard: no staged, agent-authored file may exceed MAX_TOKENS (tokens = bytes / 4). Large files cost every
// agent that reads them; split them instead. Only staged content is checked (`git show :path`), deleted files are
// skipped, and generated or third-party files (lockfiles, built assets, replay fixtures, map grids, binaries) are
// ignored. Usage: `node tools/hooks/token-limit.mjs` (the .githooks/pre-commit hook runs it).
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';

export const MAX_TOKENS = 5000;
export const BYTES_PER_TOKEN = 4;

/** Paths that are not authored by agents: generated, built, vendored or binary. */
export const IGNORED = [
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)yarn\.lock$/,
  /^assets\/dist(-local)?\//,
  /^assets\/local\//,
  /^tools\/replay\/fixtures\//,
  /^data\/maps\/.*\.(passability|heightmap|water|props)\.json$/,
  /(^|\/)(manifest|validation-report)\.json$/,
  /\.(glb|gltf|bin|f32|png|jpe?g|webp|ktx2|gif|ico|woff2?|ttf|mp4|zip)$/i,
  /(^|\/)__snapshots__\//,
  /\.snap$/,
];

/** A file that declares itself generated in its first lines is not agent-authored either. */
const GENERATED_MARKER = /@generated|do not edit|auto-generated/i;

export function isIgnored(path) {
  return IGNORED.some((re) => re.test(path));
}

export function tokensOf(bytes) {
  return Math.ceil(bytes / BYTES_PER_TOKEN);
}

function git(args, opts = {}) {
  return execFileSync('git', args, { maxBuffer: 1 << 30, ...opts });
}

function stagedPaths() {
  const out = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).toString();
  return out.split('\0').filter(Boolean);
}

function main() {
  const offenders = [];
  for (const path of stagedPaths()) {
    if (isIgnored(path)) continue;
    const blob = git(['show', `:${path}`]);
    if (blob.includes(0)) continue; // binary
    const head = blob.subarray(0, 400).toString('utf8');
    if (GENERATED_MARKER.test(head)) continue;
    const tokens = tokensOf(blob.length);
    if (tokens > MAX_TOKENS) offenders.push({ path, tokens });
  }
  if (offenders.length === 0) return 0;
  offenders.sort((a, b) => b.tokens - a.tokens);
  console.error(
    `\npre-commit: ${offenders.length} staged file(s) over ${MAX_TOKENS} tokens (bytes/4):`,
  );
  for (const o of offenders) console.error(`  ${String(o.tokens).padStart(7)}  ${o.path}`);
  console.error(
    '\nSplit them into smaller modules (or move history into an archive file) before committing.\n' +
      'Generated files belong in IGNORED in tools/hooks/token-limit.mjs or start with an @generated marker.\n',
  );
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());

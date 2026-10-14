// Headless replay-runner: speelt elke fixture (Replay uit @crawlout/protocol) af in Node en vergelijkt de hash per
// 20 frames met de opgeslagen hashes. Daarna nog een keer met serialize/deserialize halverwege.
// Exitcode 1 bij een afwijkende hash of een ongeldige fixture. Een lege fixtures-map is groen.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkReplay, parseReplay } from './run.js';

const dir = process.argv[2] ?? 'fixtures';
const files = existsSync(dir)
  ? readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
  : [];
if (files.length === 0) {
  console.log(`replay: geen fixtures in ${dir}; groen.`);
  process.exit(0);
}

const hex = (h: number): string => `0x${h.toString(16).padStart(8, '0')}`;
let failed = 0;
for (const f of files) {
  try {
    const r = parseReplay(JSON.parse(readFileSync(join(dir, f), 'utf8')));
    const plain = checkReplay(r);
    const mid = Math.floor((plain.frames - 1) / 2);
    const reloaded = plain.ok ? checkReplay(r, { reloadAfterFrame: mid }) : plain;
    const res = plain.ok ? reloaded : plain;
    if (res.ok) {
      console.log(
        `replay: ok   ${f}: ${res.frames} frames, ${res.checked} hashes, ook na serialize/deserialize op frame ${mid}`,
      );
    } else {
      failed++;
      const m = res.mismatch!;
      console.error(
        `replay: FOUT ${f}: frame ${m.frame} verwacht ${hex(m.expected)}, kreeg ${hex(m.actual)}${plain.ok ? ' (na serialize/deserialize)' : ''}`,
      );
    }
  } catch (e) {
    failed++;
    console.error(`replay: FOUT ${f}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
if (failed > 0) {
  console.error(`replay: ${failed} van ${files.length} fixtures wijken af.`);
  process.exit(1);
}
console.log(`replay: ${files.length} fixtures groen.`);

// Headless replay-runner: speelt elke fixture (Replay uit @crawlout/protocol) af in Node en vergelijkt de hash per 20 frames.
// Een lege fixtures-map is groen, zodat CI vanaf fase 0 werkt. Sim-core vult dit in zodra de tick-loop bestaat.
import { readdirSync } from 'node:fs';
const dir = process.argv[2] ?? 'fixtures';
const fixtures = readdirSync(dir).filter((f) => f.endsWith('.json'));
if (fixtures.length === 0) {
  console.log(`replay: geen fixtures in ${dir}; groen.`);
} else {
  console.error(`replay: ${fixtures.length} fixtures maar nog geen sim om ze af te spelen.`);
  process.exit(1);
}

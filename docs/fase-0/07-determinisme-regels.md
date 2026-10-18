## 7. Determinisme-regels

Deze regels gelden voor alles onder packages/sim en packages/map, en voor de loader in packages/data. Ze worden afgedwongen door lint en door de replay-test, niet door goede bedoelingen.

**Verboden in de sim**

1. Math.random, Math.sin, Math.cos, Math.tan, Math.sqrt, Math.pow, Math.exp, Math.log, Math.atan2, Math.hypot. Toegestaan: Math.trunc, Math.floor, Math.ceil, Math.abs, Math.min, Math.max, Math.imul, Math.clz32.
2. Date, performance.now, setTimeout, setInterval, Promise, async, await, fetch. De sim heeft geen klok en geen IO; de worker-schil roept tick() aan.
3. Floating-point waarden in componentarrays. Alleen Int8, Uint8, Int16, Uint16, Int32, Uint32. Float32Array en Float64Array zijn verboden.
4. Delen met / zonder Math.trunc eromheen. Modulo op negatieve getallen zonder expliciete correctie.
5. Array.prototype.sort zonder comparator die eindigt op een id-vergelijking. Object.keys, for...in en Map-iteratie als bron van volgorde voor spellogica.
6. Toegang tot window, document, globalThis-eigenschappen buiten de eigen module, en elke import uit three, render, ui of relay.

**Verplicht**

1. Elke bron van toeval via sim.rng.next(). Elke tabel (sinus, wortel) wordt bij module-load deterministisch opgebouwd uit integers.
2. Alle data komt via de loader uit packages/data, één keer, voor de eerste tick.
3. Elke tick eindigt met hash(). De worker-schil vergelijkt niets; dat doet de relay.
4. Elke pull request op de sim voegt bij nieuwe logica een replay toe aan tools/replay/fixtures met de verwachte hashes.
5. Een optimalisatie in de sim zonder gedragswijziging komt in een eigen commit vóór een gedragswijziging, met ongewijzigde fixtures en bench-eindhash als bewijs (besluit sectie 21). Een commit die beide doet is niet te reviewen.

**Afdwinging**

1. ESLint-regelset sim-determinism in packages/sim: no-restricted-globals en no-restricted-properties voor de lijst hierboven, no-floating-point-typed-arrays als eigen regel, no-restricted-imports voor three en DOM-packages.
2. CI: replay-set draaien in Node. Wekelijks dezelfde set in Chromium, Firefox en WebKit via Playwright op de GitHub-runner, plus handmatig in Chrome op Martiens MacBook voor de WebGPU-meting; afwijkende hashes zijn een P1.
   Sinds sprint 4: `pnpm --filter @crawlout/replay run replay:browsers` (tools/replay/src/browsers.ts: de runner gebundeld met esbuild, via Playwright in Chromium, Firefox en WebKit, ook na serialize/deserialize halverwege, eindhashes over de browsers vergeleken); .github/workflows/browsers.yml draait hem wekelijks met `playwright install --with-deps` en REPLAY\_BROWSERS\_STRICT=1. `--chrome` is de handmatige hash-test in de geïnstalleerde Chrome; de WebGPU-meting blijft de render-demo. Uitleg in tools/replay/README.md.
3. Benchmark in CI: 200 units, 10.000 ticks, gemiddelde tick onder 5 ms op de CI-runner. Boven budget blokkeert niet, maar meldt in de PR.

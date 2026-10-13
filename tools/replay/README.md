# @crawlout/replay

Headless replay-runner voor de lockstep-sim (werkstroom 1). Een replay is `{ dataVersion, seed, map, players, settings, bundles[], hashes[] }` (contract 2); de runner speelt hem af en vergelijkt de state-hash per 20 frames met de opgeslagen hashes, ook na serialize/deserialize halverwege.

## Commando's

```
pnpm replay                                        # de replay-set in Node (CI op elke PR)
pnpm --filter @crawlout/replay run record          # fixtures opnieuw opnemen (alleen bij een bewuste gedragswijziging)
pnpm --filter @crawlout/replay run replay:browsers # de replay-set in Chromium, Firefox en WebKit (Playwright)
```

De fixtures staan in `fixtures/`, hun definities in `src/fixtures-def.ts`. Fixtures die een speler nodig hebben die op de state reageert, worden opgenomen met de bot in `src/bot.ts`; die geeft alleen gewone commando's, en de fixture bevat de bundels die hij gaf. Afspelen gebeurt zonder bot.

## replay:browsers lokaal draaien

Het script bundelt de runner (`src/browser/entry.ts`: sim, data-loader en map-loader) met esbuild, opent per browser een lege pagina via Playwright, geeft de data, de maps en de fixtures als JSON mee en vergelijkt de hashes. Daarna vergelijkt het de eindhash van elke fixture over de browsers. Afwijkende hashes zijn een P1 (fase-0 sectie 7).

1. Eenmalig de browsers van Playwright installeren (dit downloadt Chromium, Firefox en WebKit naar `~/Library/Caches/ms-playwright`):

   ```
   pnpm --filter @crawlout/replay exec playwright install chromium firefox webkit
   ```

2. Draaien:

   ```
   pnpm --filter @crawlout/replay run replay:browsers
   ```

   Uitvoer per browser: `ok` per fixture met frames, aantal hashes, eindhash en duur, of `FOUT` met het eerste afwijkende frame. Exit 1 bij een afwijking.

Opties (na `--`, bijvoorbeeld `pnpm --filter @crawlout/replay run replay:browsers -- --chrome`):

- `--chrome`: ook in de geïnstalleerde Google Chrome (Playwright-channel `chrome`). Dit is de handmatige hash-test in Chrome op de MacBook uit fase-0 sectie 7 en 11; er hoeft niets gedownload te worden.
- `--browsers=chromium,webkit`: alleen deze browsers.
- `--strict` of `REPLAY_BROWSERS_STRICT=1`: een ontbrekende browser is een fout (exit 1). Zonder deze vlag meldt het script een ontbrekende browser en gaat door; zijn er helemaal geen browsers, dan meldt het dat en eindigt het met exit 0, zodat de workflow niet faalt op een machine zonder browsers.
- `REPLAY_CHROMIUM_PATH`, `REPLAY_FIREFOX_PATH`, `REPLAY_WEBKIT_PATH`: een eigen executable voor die browser, bijvoorbeeld een oudere Playwright-build die al in de cache staat.

De versie van de browsers hoort bij de versie van `@playwright/test` in `package.json`; na een update van dat pakket is stap 1 opnieuw nodig.

## In CI

`.github/workflows/browsers.yml` draait `replay:browsers` wekelijks. Zonder installatiestap meldt het script dat er geen browsers zijn en eindigt het groen. Om de matrix echt te draaien hoort er voor het script een stap `pnpm --filter @crawlout/replay exec playwright install --with-deps chromium firefox webkit` bij, en dan `REPLAY_BROWSERS_STRICT=1`, zodat een browser die toch ontbreekt opvalt.

# @crawlout/replay

Headless replay-runner voor de lockstep-sim (werkstroom 1). Een replay is `{ dataVersion, seed, map, players, settings, bundles[], hashes[] }` (contract 2); de runner speelt hem af en vergelijkt de state-hash per 20 frames met de opgeslagen hashes, ook na serialize/deserialize halverwege.

## Commando's

```
pnpm replay                                        # de replay-set in Node (CI op elke PR)
pnpm --filter @crawlout/replay run record          # fixtures opnieuw opnemen (alleen bij een bewuste gedragswijziging)
pnpm --filter @crawlout/replay run record -- fixtures s6-rustbelt-dominance   # alleen de genoemde fixtures
pnpm --filter @crawlout/replay run replay:browsers # de replay-set in Chromium, Firefox en WebKit (Playwright)
pnpm --filter @crawlout/replay run balance         # balansmeting: AI tegen AI over vijf seeds en een bot tegen de AI
```

## Menu in de browser

Met een eigen vite op een vrije poort (`cd apps/client && npx vite --port 5212 --strictPort`); de relay start het script zelf op een vrije poort, nooit op 8787:

```
MENU_URL=http://localhost:5212/ pnpm --filter @crawlout/replay menu-smoke   # splash, menu, Tegen AI, lobby met twee spelers, instellingen, URL-snelwegen
MENU_URL=http://localhost:5212/ MENU_SHOTS=/some/dir pnpm --filter @crawlout/replay menu-shots   # schermafbeeldingen, 1600x900 en 1280x720, met lokale kunst en met de CSS-fallback (?noskin=1)
```

De andere browserscripts (hud-clicks, hud-raiders, playtest) sturen `?skip=1`: dat slaat splash en menu over.

## Balansmeting

`pnpm --filter @crawlout/replay run balance [-- seed ...]` (src/balance-report.ts, meting in src/balance.ts) speelt de scripted AI tegen zichzelf op Rustbelt, standaard over de seeds 1, 5, 7, 42 en 99 (dezelfde als match-length.test.ts), en daarna een bot-speler (src/bot.ts) tegen de AI: passief (geeft na zijn plan niets meer uit) en actief (schoolt boven een drempel om tot patrol). Per potje: winnaar, reden en lengte in minuten, en per speler het scrap-verloop (bank per drie minuten, piek, inkomen en uitgaven), bewoners en pop-cap, militie, claimpunten, gebouwen, techs, verliezen en het level van de held. Alleen lezen wat de sim publiek laat zien; de meting zelf mag floats gebruiken. `src/match-length.test.ts` legt de uitkomst van de vijf seeds vast (25 tot 35 minuten, scrap die niet oploopt, de held die levelt) en eist dat beide winroutes voorkomen (vernietiging en dominantie, Spelfundament 12).

## Eerlijkheid en spiegel (fair-ronde)

Rustbelt XL is puntsymmetrisch (180 graden). Twee meetinstrumenten:

- `pnpm --filter @crawlout/replay mirror [-- seed]` (src/mirror-report.ts, meting in src/mirror.ts): AI tegen AI zonder toeval (geen golf-jitter, geen kritieke schoten) en elke tick de wereld van speler 0 tegen het spiegelbeeld van die van speler 1: gebouwen, units (positie, order, hp, vracht), spelerstate, claimpunten en nodes. Geeft het eerste frame waarop de spiegel breekt met de verschillen, en de eerste gebouwen per speler. `--rng` laat het toeval erin, `--full` speelt door en toont de economie per minuut, `--swap a b` is de verwisselproef (twee potjes zonder toeval waarin het midden bij de gelijke stand naar een andere speler ging: hoort met verwisselde spelers het spiegelbeeld te zijn). `src/mirror.test.ts` eist dat de spiegel houdt tot de gelijke stand bij het midden (minuut 18,5) en dat de verwisselproef de winnaar verwisselt. `--faction raiders` (data 0.24.0) spiegelt twee Raider-AI's; de spiegel houdt tot de twee Slavers elkaar in dezelfde tick vangen (5:52, een gelijke stand die sim.rng beslist; `src/raiders-balance.test.ts`).
- `pnpm --filter @crawlout/replay fairness [-- seed ...]` (src/fairness-report.ts, parallel in losse processen via src/fairness.ts): de 33 seeds van de eerlijkheidsmeting (1 tot 30, 42, 99, 123) met winnaar, reden, lengte en de verdeling over de spelers, in ongeveer 25 s. `src/match-length.test.ts` gebruikt dezelfde meting: vijf seeds vast, elke speler 12 tot 21 van de 33 (doel 40 tot 60 procent), beide winroutes in minstens een kwart, alles tussen 25 en 40 minuten en minstens 30 tussen 25 en 35.
- `node --import tsx src/raiders-report.ts [--detail] [seed ...]` (data 0.24.0): Raiders tegen Dwellers, elke seed aan beide kanten (66 potjes, ongeveer 50 s): per potje winnaar, reden en lengte, dan de tabel per factie en route in de minuutvakken 0-15, 15-22, 22-30, 30-38 en 38-60, de winsten per kant, gevangen en bevrijde eenheden. Meet een balanswijziging ook op de seeds 200 tot 232: de uitkomst per seed is bijna deterministisch en verschuift in groepen. `src/raiders-balance.test.ts` eist de doelen (40 tot 60 procent per factie, minstens 80 procent tussen 22 en 38 minuten, hoogstens 10 procent vernietiging voor minuut 15, de Dwellers winnen na minuut 30) plus de Raider-spiegel en de eerlijkheid van Raiders tegen Raiders.

Snelle lus: `REPLAY_FAST=1 pnpm test` slaat de langzame tests over (de 33 potjes van match-length.test.ts, ongeveer 25 s met parallelle processen; de verwisselproef in mirror.test.ts, ongeveer 15 s; het AI-tegen-AI-potje in slice.test.ts, ongeveer 9 s; de replay van s2-rustbelt-ai-vs-ai, ongeveer 25 s). Zonder de vlag, en dus in CI, draaien ze altijd. Een AI-tegen-AI-potje op Rustbelt XL van ruim 27 minuten kost 3 tot 4 s in Node, onder vitest met vijf workers naast elkaar 7 tot 9 s.

De fixtures staan in `fixtures/`, hun definities in `src/fixtures-def.ts`. Fixtures die een speler nodig hebben die op de state reageert, worden opgenomen met de bot in `src/bot.ts`; die geeft alleen gewone commando's, en de fixture bevat de bundels die hij gaf. Afspelen gebeurt zonder bot. Plekken en doelen op Rustbelt komen nooit uit vaste cellen: `SitePlanner` in `src/bot.ts` zoekt een vrije bouwplek bij een anker uit de map (het eigen hoofdgebouw, het eigen settlement-punt of het middenpunt), en `centrePoint`, `settlementPoint` en `toward` leveren claimpunten en looproutes. Een nieuwe Rustbelt vraagt dus alleen een nieuwe opname. `s6-rustbelt-dominance` is winroute B op de slice-map: een bot houdt zijn settlement-punt en het midden tegen de raids van de AI en wint op dominantie.

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

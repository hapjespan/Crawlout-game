# Gate-1-checklist

Oct 14, 2026 · architect, na de review van de gate-1-ronde (branch sprint-1, commit a1fcc3e; eerste versie na de slice-ronde, commit 6e198a0)

## Samenvatting: is dit een gate-1-kandidaat?

**Ja, technisch.** Alles wat in de repo groen kan zijn, is groen met bewijs: de slice speelt van begin tot winst tegen de AI op Rustbelt (beide winroutes), met held, claims die nodes exclusief maken, research, craft, oplappen en turrets die schieten; het brief-eindcriterium van sim-core (50 bewoners per kant, binnen de regels) staat als fixture; de netcode-eindcriteria (300 ms latency met adaptieve DELAY, 10 s wegval met resync) zijn reproduceerbare tests; `replay:browsers` is echt; de drie reviewgates van deze ronde zijn gepasseerd (fase-0 sectie 15). Lokaal op sprint-1: lint, typecheck, 404 tests, 6 fixtures en bench 0,287 ms per tick.

**Nee, nog niet als gate.** Gate 1 zelf (Spelfundament 12) valt pas als de renderbuis met placeholders bewezen is en de testgroep heeft gespeeld; dat kan geen agent doen. Verder zijn Firefox en WebKit nooit gedraaid (alleen Chrome en Chromium, lokaal) en heeft CI deze commits nooit gezien: de branch is niet gepusht.

**De drie dingen die Martien zelf moet doen:**

1. **Assets.** assets/src vullen met de Quaternius-placeholders en tien Gobkit-props, `pnpm assets` draaien en de render-demo openen met `?unit=<id>`. Dat bewijst de renderbuis (asset-cli naar manifest naar render) met echte bestanden; assets/dist/manifest.json is nu leeg.
2. **Browsers en meting.** Eenmalig `pnpm --filter @crawlout/replay exec playwright install chromium firefox webkit`, dan `pnpm --filter @crawlout/replay run replay:browsers -- --chrome` (de hash-test in drie browsers plus Chrome). En de render-demo (`?n=200&b=40`) op een laptop met geïntegreerde GPU: doel 60 fps, onder 150 draw calls, geen frame boven 20 ms bij een camera-draai. Na het pushen draait browsers.yml wekelijks.
3. **Testgroep.** Vijf tot acht mensen; eerste sessie met een potje tegen de AI vanuit de HUD zonder console, en één potje met twee browsers over `pnpm relay` met een reload halverwege (resync). De HUD-filters uit de vorige ronde zijn gebouwd maar nog niet door een mens gespeeld.

Gate 1 is de harde stop na fase 1 (Spelfundament sectie 12): de slice is 1 factie (Dwellers), 1 held (Krijger), 1 map (Rustbelt), 2 winroutes (vernietiging, dominantie), tegen AI; de renderbuis is bewezen met placeholders; de drie reviewgates (sim, netcode, shader) zijn gepasseerd; de testgroep heeft gespeeld. Status: groen (bewijs in de repo), deels (werkt, maar het criterium is niet volledig of niet reproduceerbaar aangetoond), open (ontbreekt). "Open, vraagt Martien" is wat alleen met echte assets, op een laptop met geïntegreerde GPU, met geïnstalleerde browsers of met de testgroep is af te vinken. Commando's lopen vanaf de repo-root.

## Slice-definitie (Spelfundament 12, 11, 7)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| Eén factie: Dwellers | groen | data/factions.json; render, HUD en sim lezen de factie uit start.players |
| Eén held: Krijger (Opziener) met 7 SPECIAL, xp, perks, Lockdown, oplappen | groen | packages/sim/src/systems/hero.ts, data/heroes.json; HeroStatus volledig (packages/sim/test/hero.test.ts "state, reviveTicksLeft, entityId en abilityCooldownTicks"); fixtures s3-rustbelt-hero-claims en s4-rustbelt-turrets (Lockdown, dood, oplappen); HUD held-paneel leest state en cooldowns |
| Eén map: Rustbelt, 128 bij 128 m, 2 spelers, 6 nodes, 3 claimpunten | groen | data/maps/rustbelt.json (0.7.0); laadt in sim (alle Rustbelt-fixtures) en render (client); packages/map/test/maps.test.ts |
| Winroute A, vernietiging | groen | packages/sim/src/systems/claims.ts winRoutes; gameplay-tests; fixture s4-rustbelt-turrets eindigt met een aanval op de basis |
| Winroute B, dominantie | groen | fixture s2-rustbelt-ai-vs-ai: speler 1 wint op dominantie in frame 13376 (`pnpm replay`; tools/replay/src/slice.test.ts "scripted AI tegen scripted AI levert een winnaar") |
| Skirmish tegen de scripted AI, lokaal via loopback | groen | apps/client/src/game/session.ts (LoopbackRelay); de AI bouwt, onderzoekt geweerrek, bouwt een turret, claimt, schoolt om, valt aan met held en Lockdown |
| Alles buiten de slice afgewezen (Raiders, Garde, winroute C, survival) | groen | niets daarvan in data of code; MatchSettings.mode 'survival' bestaat alleen als enum-waarde |
| Drie reviewgates: sim, netcode, shader | groen | architect-reviews sprint 1 tot 4 (docs/CHANGELOG.md, fase-0 sectie 12 tot 15); deze ronde: sim merge, netcode merge, shader merge (REVIEWGATE packages/render/src/units/unitMaterial.ts, sectie 15 besluit 10) |
| Elke sim-wijziging levert een replay met hashes; afwijking blokkeert | groen | tools/replay/fixtures (6 fixtures, alle opnieuw opgenomen op data 0.7.0); tools/replay/src/replay.test.ts (verse run gelijk aan de opgeslagen hashes, serialize/deserialize op frame 137 en halverwege); .github/workflows/ci.yml draait `pnpm replay` |
| Stats.js of eigen meting in elke build | groen | packages/render perf-overlay (fps, ms, draw calls) |
| Renderbuis bewezen met placeholders (voorwaarde voor de artistkeuze) | open, vraagt Martien | assets/dist/manifest.json is leeg (`"assets": []`), assets/src bevat alleen clipmap.json. De loader is bewezen met een synthetisch asset (packages/render/src/units/unitAssets.test.ts). Nodig: Quaternius- en Gobkit-bronbestanden in assets/src (de agents doen geen downloads), dan `pnpm assets` |
| Eerste sessie met de testgroep (integratiemoment 2) | open, vraagt Martien | testgroep van 5 tot 8 mensen is nog niet samengesteld (Spelfundament 13, open) |

## sim-core (fase-0 sectie 9, werkstroom 1)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| 50 bewoners per kant verzamelen, bouwen, wisselen van rol en vechten op de slice-map | groen | fixture s4-rustbelt-fifty (16976 frames, opgenomen met de bot in tools/replay/src/bot.ts, afgespeeld zonder bot): beide kanten halen 50 bewoners uit huisvestingsgroei binnen de pop-cap, scrap boven 1000, 24 of meer gebouwen af, 20 militie per kant, meer dan 200 schoten en 40 doden (tools/replay/src/slice.test.ts) |
| Replay-set draait identiek in Node en in drie browsers | deels | `replay:browsers` is echt (tools/replay/src/browsers.ts, README). Lokaal identiek in Chrome 155 en Chromium 147; Firefox en WebKit zijn niet geïnstalleerd en dus nooit gedraaid. .github/workflows/browsers.yml installeert ze en draait strict, maar de branch is niet gepusht. Vraagt Martien (samenvatting, punt 2) |
| Benchmark 200 units onder 5 ms per tick | groen | `pnpm bench`: 0,287 ms gemiddeld, max 3,56 ms (lokaal, arch-gate1; CI meldt) |
| Serialize en deserialize geven dezelfde hash | groen | elke fixture op frame 137 en halverwege (replay.test.ts), elke replay-run in `pnpm replay` halverwege; hero.test.ts midden in een Lockdown en een oplap-timer |
| Lint sim-determinism groen | groen | `pnpm lint` groen op sprint-1 en arch-gate1 |
| Winroutes vernietiging en dominantie | groen | zie slice-definitie |
| Scripted AI zonder cheats, via dezelfde validatie | groen | packages/sim/src/systems/ai.ts gebruikt applyCommand; onderzoekt de prereqTech van zijn bouworder (packages/sim/test/turret.test.ts "AI onderzoekt de prereqTech"; s2-rustbelt-ai-vs-ai: beide AI's geweerrek en een turret) |
| Turrets schieten (besluit 8) | groen | packages/sim/test/turret.test.ts (8 tests: doelkeuze, range, bouwplaats schiet niet, tech- en Lockdown-effecten, sneuvelt); fixture s4-rustbelt-turrets (beide turrets schieten) |
| Inhalen na resync zonder snapshot per tick | groen | packages/sim/src/worker.ts pump met tijdbudget en `hashes`-bericht; packages/sim/test/worker.test.ts (achterstand van 130 bundels, na load); session.ts stuurt de hashes door. Bekend: events van overgeslagen ticks vervallen (sectie 15, besluit 4) |

## render-pipeline (werkstroom 2)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| WebGPURenderer met WebGL2-fallback | groen | packages/render/src/renderer.ts; render-demo gemeten op beide |
| TSL toon-ramp met teammasker, instanced skinning via bone-matrix textures, 3 LODs, blob-schaduwen | groen | packages/render 0.1.0 en 0.2.0 (CHANGELOG), unitLayer, unitMaterial, bake.ts |
| RTS-camera (pan, zoom, rotatie, randscroll), selectie-highlight, snapshot-interpolatie | groen | rtsCamera.ts (panKeys sinds 0.3.0), decals, interpolate.ts |
| Vier effecten uit snapshot-events (mondingsvuur, inslag, bouwstof, dood) | groen | vfx/effects.ts volgens de event-semantiek van sprint 2; daarbij nu abilityZone als gronddecal (vfx/abilityZones.ts, abilityZones.test.ts, effects.test.ts) en het turretschot vanaf het dak (effects.test.ts "fires a turret from its roof") |
| De held is herkenbaar (besluit 5) | groen | held-vlag per instance in unitMaterial.ts (1,15 maal groter; pet, kraag en schouderstukken in de teamkleur op de placeholder; units.test.ts "hero parts of the placeholder"); geen extra draw call; shader-gate gepasseerd |
| 200 geanimeerde units plus 40 gebouwen op 60 fps, onder 150 draw calls, geen frame boven 20 ms bij een camera-draai | deels | Gemeten op de MacBook in Chrome via Playwright met held en turrets: WebGPU 15 draw calls, 120 fps, slechtste frame 10,5 ms; WebGL2 15 draw calls, 120 fps, 10,4 ms (render CHANGELOG 0.4.0). Op een laptop met geïntegreerde GPU: open, vraagt Martien |
| Een Quaternius-asset vervangen door een ander GLB uit het manifest kost nul regels code | deels | De keuze is data (loadout.visuals.meshSlots.body, `?unit=` in de demo) en de loader is getest met een synthetisch asset; met een echt asset nooit gedaan. Open, vraagt Martien (assets/src) |
| Bone-matrix-formaat uit sectie 12 wordt gelezen | groen | units/bakedManifest.ts valideert manifest tegen `ANIM_NAMES`, width, height en aaneengesloten clips |

## asset-cli (werkstroom 3)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| Alle Quaternius-placeholders en 10 Gobkit-props door de buis met één commando | open, vraagt Martien | assets/src bevat alleen clipmap.json; `pnpm assets` heeft niets te doen. Bronbestanden nodig |
| Een asset dat de norm schendt faalt met een leesbare reden | groen volgens de werkstroom | validatierapport en manifest-schema (tools/asset-cli, CHANGELOG sprint 1 en 2); niet door de architect getoetst (review door render-pipeline) |
| De uitvoer laadt in packages/render zonder handwerk | deels | loader en manifest-schema sluiten aan (synthetisch asset, meshopt, quantisatie); echte uitvoer nog niet gezien |

## content (werkstroom 4)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| Elk bestand valideert; onbekende velden geweigerd | groen | packages/data zod-schema's strict; `pnpm test` (game-data.test.ts) |
| De sim start op deze data | groen | alle fixtures en de client draaien op data 0.7.0 |
| Een nieuwe loadout toevoegen is alleen JSON | groen | typeIds uit packages/data, render en HUD lezen loadouts uit GameData |
| Elke waarde een regel commentaar met de bedoeling | groen | `_comment` per record (steekproef sim.json, heroes.json, buildings.json turret) |
| Factie, 1 body, 4 loadouts, 8 gebouwen, 6 upgrades, held met 7 SPECIAL en 6 perks, damage-matrix, AI-script | groen | geteld in data/: 4 loadouts, 8 gebouwen, 6 techs, 6 perks, 1 held met 1 ability, 1 AI-script |
| Turrets hebben schade en bereik (besluit 8) | groen | data/buildings.json turret: 12 ballistic per 1,0 s op 12 m (startwaarde); schema verplicht de velden bij provides turret (packages/data/src/game-data.test.ts "sprint 4: turrets in data") |

## hud (werkstroom 5)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| Een potje tegen de AI is volledig speelbaar zonder console | deels | De vier filters uit sectie 14 zijn gebouwd: bouwmenu, craft en research op PlayerStatus.techs, dood-zijn en cooldownPct uit HeroStatus (apps/client/src/main.ts). Martien speelde vóór die fixes; na de fixes heeft nog geen mens gespeeld. Vraagt Martien: een potje uit de HUD (testsessie) |
| Elke actie heeft een sneltoets | groen | packages/ui/src/controller.ts ACTIONS (1 tot 3, B, H, V, K, N, Spatie, L), perks F1 tot F3, abilities Z, X, C, cijfers in bouwmenu, craftmenu en gebouwpaneel |
| De HUD rendert onder 2 ms per frame | groen | packages/ui/src/hud.sprint2.test.ts: 50 geselecteerde units onder 2 ms |
| Minimap met fog en claims, bouwmenu met plaatsing, held-paneel, waarschuwingen, opgeven, desync-melding | groen | packages/ui 0.2.0 en 0.3.0 (CHANGELOG), hud.sprint2 en sprint3 tests (HeroStatus met de verplichte velden) |
| Stijl volgt de stijlbijbel, tot dan neutraal | groen | er is nog geen stijlbijbel (na gate 1); de HUD is neutraal |

## relay (werkstroom 6)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| Twee browsers op één machine spelen een potje via de relay zonder desync | deels | Reproduceerbaar in het klokvrije harnas met de echte Room, twee echte sims op Rustbelt en de echte BundleFeed (apps/client/test/support/lockstepNet.ts; latency.test.ts en reconnect.test.ts melden geen desync). De echte test met twee browsers over ws is gemeld door de relay-agent, maar nog geen script. Herhalen in de testsessie |
| De loopback geeft dezelfde hashes als de relay | groen | packages/relay/src/equivalence.test.ts |
| Een client die 10 seconden wegvalt komt terug via resync | groen | apps/client/test/reconnect.test.ts: 10 s wegval, tweede `start`, resync via peer A, hashes gelijk vanaf het geladen frame, commando's van B daarna uitgevoerd; relay-kern in sprint2.test.ts |
| Gesimuleerde latency van 300 ms blijft speelbaar met adaptieve DELAY | groen | apps/client/test/latency.test.ts: round-trip 300 ms, DELAY stijgt boven 4 binnen MIN..MAX, na de opwarming geen te laat commando, hashes van beide clients gelijk |
| Desync stopt het potje met een melding en een dump | groen | relay stopt bundels; client dumpt naar IndexedDB (apps/client/src/net/desyncDump.ts); HUD toont de melding |
| Bundels zonder gat, dataVersion over ws | groen | BundleFeed geeft alleen aaneengesloten frames vrij (apps/client/test/resync.test.ts "never skips a gap"); `pnpm relay` leest data/VERSION (packages/relay/src/reconnect.test.ts "dataVersion"), de client weigert elk verschil, ook '0' (apps/client/test/dataVersion.test.ts) |

## map (werkstroom 7)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| De map laadt in sim en render | groen | packages/map loader, simMapFromGrid, renderer.setTerrain |
| Passability klopt met wat je ziet | open, vraagt Martien | visuele controle in de client (greybox markeert nodes en claimpunten); niet door een test te vangen |
| Een tweede map toevoegen is alleen data | groen | testmap en rustbelt komen allebei uit data/maps via dezelfde generator en loader |
| Claimpunten liggen bij de nodes die exclusief moeten worden (besluit 9) | groen | settlement-punten (40,34) en (87,93), 4 m van de 2500-nodes binnen claimRadiusM 6 (packages/map/test/maps.test.ts: node binnen de straal, plek voor een claimpaal naast elk punt); in s2-rustbelt-ai-vs-ai maken beide AI's hun node exclusief |
| Scrap-nodes, claimpunten, spawns, creep-kampen; props via Three Scatter | deels | nodes, claimpunten en spawns werken; creep-kampen staan op de route in de data (maps.test.ts) maar niet in de sim; geen props. Na gate 1 (sectie 15, besluit 9) |

## Determinisme en CI (fase-0 sectie 7)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| CI draait lint, typecheck, tests en de replay-set op elke PR | groen in de repo, niet gedraaid | .github/workflows/ci.yml; deze commits zijn lokaal groen (lint, typecheck, 404 tests, 6 fixtures) maar nooit op GitHub gedraaid: sprint-1 is niet gepusht |
| Wekelijkse replay-set in Chromium, Firefox en WebKit | deels | browsers.yml installeert de browsers en draait `replay:browsers` strict; nooit gedraaid (niet gepusht). Lokaal alleen Chrome en Chromium |
| Handmatige hash-test en WebGPU-meting in Chrome op de MacBook | deels | hash-test: `replay:browsers -- --chrome`, door sim-core gedraaid in Chrome 155 (identiek). WebGPU-meting: render-demo door render-pipeline (120 fps, 15 draw calls). Martien hoeft alleen nog de geïntegreerde GPU te meten |
| Benchmark in CI meldt, blokkeert niet | groen | ci.yml stap "Benchmark (meldt, blokkeert niet)" |

## Open in de repo (mag, geen blokkade; zie fase-0 sectie 15)

| Werkstroom | Punt |
| --- | --- |
| sim-core | turretAim overschrijft het hele flags-byte van een gebouw (maskeren zodra gebouwen een tweede vlag krijgen); de AI laat zijn hele bouwvolgorde wachten op een onbetaalbare tech; events van overgeslagen ticks vervallen bij inhalen (meldingen ontbreken na een resync) |
| relay | het harnas tikt de sim direct, niet via SimWorkerCore.pump en session.ts (één test via createSimWorkerCore erbij); `startRelayServer` zonder dataVersion meldt '0', wat de client nu weigert; `BundleFeed.gapAt` is ongebruikt; de twee-browsers-test over ws als script |
| render-pipeline | de cull-bol van een held is niet met HERO_SCALE vergroot |
| hud | de entity-scan als terugval in heroAlive (apps/client/src/main.ts) is dode code sinds HeroStatus.state verplicht is |
| map | creep-kampen in de sim en props via Three Scatter (na gate 1) |

## Open, vraagt Martien

1. Assets in assets/src en `pnpm assets` (renderbuis met placeholders, artistkeuze).
2. `playwright install chromium firefox webkit` en `replay:browsers -- --chrome`; de render-demo op een laptop met geïntegreerde GPU; sprint-1 pushen zodat ci.yml en browsers.yml draaien.
3. De testgroep en de eerste sessie: potje tegen de AI uit de HUD, potje met twee browsers over `pnpm relay` met een reload, en de visuele passability-controle op Rustbelt.

# Gate-1-checklist

Oct 14, 2026 · architect, na de review van de slice-ronde (branch sprint-1, commit 6e198a0)

Gate 1 is de harde stop na fase 1 (Spelfundament sectie 12): de slice is 1 factie (Dwellers), 1 held (Krijger), 1 map (Rustbelt), 2 winroutes (vernietiging, dominantie), tegen AI; de renderbuis is bewezen met placeholders; de drie reviewgates (sim, netcode, shader) zijn gepasseerd; de testgroep heeft gespeeld. De criteria hieronder komen uit het Spelfundament (sectie 12 en 11), de briefs in fase-0 sectie 9 en het integratiemoment in sectie 10. Status: groen (bewijs in de repo), deels (werkt, maar het criterium is niet volledig of niet reproduceerbaar aangetoond), open (ontbreekt). "Open, vraagt Martien" is wat alleen met echte assets, op een laptop met geïntegreerde GPU, of met de testgroep is af te vinken.

## Slice-definitie (Spelfundament 12, 11, 7)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| Eén factie: Dwellers | groen | data/factions.json; render, HUD en sim lezen de factie uit start.players |
| Eén held: Krijger (Opziener) met 7 SPECIAL, xp, perks, Lockdown, oplappen | groen | packages/sim/src/systems/hero.ts, data/heroes.json; replay s3-rustbelt-hero-claims; HUD held-paneel |
| Eén map: Rustbelt, 128 bij 128 m, 2 spelers, 6 nodes, 3 claimpunten | groen | data/maps/rustbelt.json; laadt in sim (replay) en render (client) |
| Winroute A, vernietiging | groen | packages/sim/src/systems/claims.ts winRoutes; gameplay-tests; fixture s3 eindigt met een aanval op de basis |
| Winroute B, dominantie | groen | replay s2-rustbelt-ai-vs-ai: AI wint op dominantie rond frame 13766 |
| Skirmish tegen de scripted AI, lokaal via loopback | groen | apps/client/src/game/session.ts (LoopbackRelay); de AI bouwt, claimt, schoolt om, valt aan met held en Lockdown |
| Alles buiten de slice afgewezen (Raiders, Garde, winroute C, survival) | groen | niets daarvan in data of code; MatchSettings.mode 'survival' bestaat alleen als enum-waarde |
| Drie reviewgates: sim, netcode, shader | groen | architect-reviews sprint 1, 2 en 3 (docs/CHANGELOG.md, fase-0 sectie 12 tot 14); de sprint-3-bevindingen staan in sectie 14 en het reviewrapport |
| Elke sim-wijziging levert een replay met hashes; afwijking blokkeert | groen | tools/replay/fixtures (4 fixtures), .github/workflows/ci.yml draait `pnpm replay` |
| Stats.js of eigen meting in elke build | groen | packages/render perf-overlay (fps, ms, draw calls) |
| Renderbuis bewezen met placeholders (voorwaarde voor de artistkeuze) | open, vraagt Martien | assets/dist/manifest.json is leeg: geen Quaternius-asset en geen Gobkit-prop is door de buis gegaan. De loader is bewezen met een synthetisch asset (packages/render/src/units/unitAssets.test.ts). Nodig: Quaternius- en Gobkit-bronbestanden in assets/src (de agents doen geen downloads) |
| Eerste sessie met de testgroep (integratiemoment 2) | open, vraagt Martien | testgroep van 5 tot 8 mensen is nog niet samengesteld (Spelfundament 13, open) |

## sim-core (fase-0 sectie 9, werkstroom 1)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| 50 bewoners per kant verzamelen, bouwen, wisselen van rol en vechten op de slice-map | deels | Alle systemen werken (replays, gameplay-tests, bench met 200 units); een potje waarin beide kanten de pop-cap van 50 halen is niet vastgelegd. Toevoegen aan de testsessie |
| Replay-set draait identiek in Node en in drie browsers | open | `replay:browsers` is een echo (tools/replay/package.json:9); .github/workflows/browsers.yml draait die stub. Sim-core, sprint 4 |
| Benchmark 200 units onder 5 ms per tick | groen | `pnpm bench`: 0,290 ms gemiddeld, max 4,21 ms (lokaal; CI meldt) |
| Serialize en deserialize geven dezelfde hash | groen | elke replay controleert het halverwege ("ook na serialize/deserialize") |
| Lint sim-determinism groen | groen | `pnpm lint` groen op sprint-1 en arch-slice |
| Winroutes vernietiging en dominantie | groen | zie slice-definitie |
| Scripted AI zonder cheats, via dezelfde validatie | groen | packages/sim/src/systems/ai.ts gebruikt applyCommand; de AI onderzoekt nog niets (besluit 8: prereqTech van de bouworder) |

## render-pipeline (werkstroom 2)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| WebGPURenderer met WebGL2-fallback | groen | packages/render/src/renderer.ts; render-demo gemeten op beide |
| TSL toon-ramp met teammasker, instanced skinning via bone-matrix textures, 3 LODs, blob-schaduwen | groen | packages/render 0.1.0 en 0.2.0 (CHANGELOG), unitLayer, unitMaterial, bake.ts |
| RTS-camera (pan, zoom, rotatie, randscroll), selectie-highlight, snapshot-interpolatie | groen | rtsCamera.ts (panKeys sinds 0.3.0), decals, interpolate.ts |
| Vier effecten uit snapshot-events (mondingsvuur, inslag, bouwstof, dood) | groen | vfx/effects.ts, volgens de event-semantiek van sprint 2; abilityZone (besluit 3) volgt in sprint 4 |
| 200 geanimeerde units plus 40 gebouwen op 60 fps, onder 150 draw calls, geen frame boven 20 ms bij een camera-draai | deels | Gemeten op de MacBook in Chrome via Playwright: 15 draw calls, 120 fps, slechtste frame 10,7 ms (WebGPU en WebGL2). Op een laptop met geïntegreerde GPU: open, vraagt Martien |
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
| De sim start op deze data | groen | alle replays en de client draaien op data 0.6.0 |
| Een nieuwe loadout toevoegen is alleen JSON | groen | typeIds uit packages/data, render en HUD lezen loadouts uit GameData |
| Elke waarde een regel commentaar met de bedoeling | groen | `_comment` per record (steekproef sim.json, heroes.json, buildings.json) |
| Factie, 1 body, 4 loadouts, 8 gebouwen, 6 upgrades, held met 7 SPECIAL en 6 perks, damage-matrix, AI-script | groen | geteld in data/: 4 loadouts, 8 gebouwen, 6 techs, 6 perks, 1 held met 1 ability, 1 AI-script |
| Turrets hebben schade en bereik | open | buildings.json turret mist damage, damageType, rangeM, cooldownS (besluit 8); content en sim-core, sprint 4 |

## hud (werkstroom 5)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| Een potje tegen de AI is volledig speelbaar zonder console | deels | Martien speelde met held, Lockdown, bouwen, claimen en research. Niet speelbaar vanuit de HUD: gebouwen achter tech (turret, trainingsfaciliteit) staan nooit in het bouwmenu, craft-opties negeren prereqTech, research-lijst toont onderzochte techs opnieuw, "Oplappen" verschijnt tijdens het oplappen. Alle vier via PlayerStatus.techs en HeroStatus.state (sectie 14, sprint 4) |
| Elke actie heeft een sneltoets | groen | packages/ui/src/controller.ts ACTIONS (1 tot 3, B, H, V, K, N, Spatie, L), perks F1 tot F3, abilities Z, X, C, cijfers in bouwmenu, craftmenu en gebouwpaneel |
| De HUD rendert onder 2 ms per frame | groen | packages/ui/src/hud.sprint2.test.ts: 50 geselecteerde units onder 2 ms |
| Minimap met fog en claims, bouwmenu met plaatsing, held-paneel, waarschuwingen, opgeven, desync-melding | groen | packages/ui 0.2.0 en 0.3.0 (CHANGELOG), hud.sprint2 en sprint3 tests |
| Stijl volgt de stijlbijbel, tot dan neutraal | groen | er is nog geen stijlbijbel (na gate 1); de HUD is neutraal |

## relay (werkstroom 6)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| Twee browsers op één machine spelen een potje via de relay zonder desync | deels | De relay-agent meldt twee tabs over de ws-relay met resync na een reload. Niet als script vastgelegd; herhalen in de testsessie en als Playwright-test opnemen |
| De loopback geeft dezelfde hashes als de relay | groen | packages/relay/src/equivalence.test.ts |
| Een client die 10 seconden wegvalt komt terug via resync | deels | Relay-kern: sprint2.test.ts ("client van 10 s weg komt terug via resync"); client: reconnect en resync in apps/client/src/net, getest met unit-tests en handmatig na een reload. Een echte wegval van 10 s in twee browsers is niet vastgelegd |
| Gesimuleerde latency van 300 ms blijft speelbaar met adaptieve DELAY | open | adaptieve DELAY bestaat (packages/relay/src/core/delay.ts); een latency-simulatie ontbreekt in packages/relay. Relay, sprint 4 |
| Desync stopt het potje met een melding en een dump | groen | relay stopt bundels; client dumpt naar IndexedDB (apps/client/src/net/desyncDump.ts); HUD toont de melding |

## map (werkstroom 7)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| De map laadt in sim en render | groen | packages/map loader, simMapFromGrid, renderer.setTerrain |
| Passability klopt met wat je ziet | open, vraagt Martien | visuele controle in de client (greybox markeert nodes en claimpunten); niet door een test te vangen |
| Een tweede map toevoegen is alleen data | groen | testmap en rustbelt komen allebei uit data/maps via dezelfde generator en loader |
| Scrap-nodes, claimpunten, spawns, creep-kampen; props via Three Scatter | deels | nodes, claimpunten en spawns werken; creep-kampen staan in de data maar niet in de sim; geen props |
| Claimpunten liggen bij de nodes die exclusief moeten worden | open | op Rustbelt ligt geen node binnen claimRadiusM (6 m) van een claimpunt (sectie 14, besluit 9). Map, sprint 4; daarna fixtures opnieuw (sim-core) |

## Determinisme en CI (fase-0 sectie 7)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| CI draait lint, typecheck, tests en de replay-set op elke PR | groen | .github/workflows/ci.yml |
| Wekelijkse replay-set in Chromium, Firefox en WebKit | open | browsers.yml draait de echo-stub (zie sim-core) |
| Handmatige hash-test en WebGPU-meting in Chrome op de MacBook | open, vraagt Martien | fase-0 sectie 11 staat nog open |
| Benchmark in CI meldt, blokkeert niet | groen | ci.yml stap "Benchmark (meldt, blokkeert niet)" |

## Samenvatting

Groen: de slice speelt van begin tot winst tegen de AI op Rustbelt via loopback, met held, claims via het claimgebouw, research, craft en oplappen; replays, hash-consistentie, bench, lint en CI staan. Deels: de HUD-speelbaarheid (vier filters wachten op PlayerStatus.techs en HeroStatus.state), de reconnect-test met twee browsers en het 10-seconden-scenario (gemeld, niet vastgelegd), het prestatiedoel (gemeten op de MacBook, niet op een geïntegreerde GPU). Open in de repo: turrets die schieten, claimpunten bij de nodes, `replay:browsers`, latency-simulatie, creep-kampen en props. Open, vraagt Martien: de Quaternius- en Gobkit-bronbestanden voor de renderbuis, de meting op een laptop met geïntegreerde GPU, de WebGPU-hashtest in Chrome, de visuele passability-controle en de eerste sessie met de testgroep.

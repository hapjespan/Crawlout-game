# Gate-1-checklist

Oct 14, 2026 · architect, na de review van de dag-ronde en de balans-ronde na de speltest (branch sprint-1 tot en met commit bd4bbbb, de merge van `balance`, beoordeeld op arch-day; vorige versies na de gate-1-ronde, commit a1fcc3e, en de slice-ronde, commit 6e198a0).

## Samenvatting: is dit een gate-1-kandidaat?

**Ja, technisch.** Alles wat in de repo groen kan zijn, is groen met bewijs: de slice speelt van begin tot winst tegen de AI op Rustbelt (beide winroutes), met held, claims die nodes exclusief maken, research, craft, oplappen en turrets die schieten; het brief-eindcriterium van sim-core (50 bewoners per kant, binnen de regels) staat als fixture; de netcode-eindcriteria (300 ms latency met adaptieve DELAY, 10 s wegval met resync) zijn reproduceerbare tests; `replay:browsers` is echt; de drie reviewgates zijn in vier rondes gepasseerd (fase-0 sectie 12 tot 16). Nieuw sinds de gate-1-ronde: de renderbuis is met echte bestanden gelopen (de Quaternius-mannequin en tien Gobkit-props door `pnpm assets`, manifest met elf assets) en het echte karakter in teamkleur en de 200 props op Rustbelt zijn in Chrome gezien; de speltest van Martien leverde bouwers die hervatten en helpen, een gebouwpaneel met kaarten, een eenhedenbalk, randscroll over het hele venster en vergevende klikken; de balans-ronde leverde een AI die volledig uit data komt en bijbouwt, onderzoekt, claimt, verdedigt en in groeiende golven aanvalt, een economie waarin scrap niet meer oploopt, een held die levelt (ook via assists) en potjes van 28,1 tot 28,9 minuten over vijf seeds (Spelfundament 2.6: 25 tot 35). Lokaal op arch-day na de merge: lint, typecheck, 524 tests, 7 fixtures. Kanttekening: alle vijf potjes eindigen op vernietiging; dominantie beslist bij AI tegen AI nooit meer (fase-0 sectie 17, advies).

**Nee, nog niet als gate.** Gate 1 zelf (Spelfundament 12) valt pas als de testgroep heeft gespeeld; dat kan geen agent doen. Verder is alles wat met de GPU en de browser te maken heeft alleen op de MacBook in Chrome gezien: een laptop met geïntegreerde GPU, Firefox en WebKit hebben nog nooit een frame of een hash geproduceerd, en CI heeft deze commits nooit gezien: de branch is niet gepusht.

**De drie dingen die Martien zelf moet doen:**

1. **Geïntegreerde GPU.** De render-demo (`?n=200&b=40`, met de props) en de client op een laptop met geïntegreerde GPU: doel 60 fps, onder 150 draw calls, geen frame boven 20 ms bij een camera-draai. Op de MacBook is het 25 draw calls en nooit boven 6 ms.
2. **Browsers en CI.** Eenmalig `pnpm --filter @crawlout/replay exec playwright install chromium firefox webkit`, dan `pnpm --filter @crawlout/replay run replay:browsers -- --chrome` (de hash-test in drie browsers plus Chrome); sprint-1 pushen zodat ci.yml en browsers.yml draaien.
3. **Testgroep.** Vijf tot acht mensen; eerste sessie met een potje tegen de AI vanuit de HUD zonder console (met de kaarten en de eenhedenbalk), en één potje met twee browsers over `pnpm relay` met een reload halverwege (resync). Martien speelde op 14 oktober vóór de fixes van deze ronde; na de fixes heeft nog geen mens gespeeld.

Gate 1 is de harde stop na fase 1 (Spelfundament sectie 12): de slice is 1 factie (Dwellers), 1 held (Krijger), 1 map (Rustbelt), 2 winroutes (vernietiging, dominantie), tegen AI; de renderbuis is bewezen met placeholders; de drie reviewgates (sim, netcode, shader) zijn gepasseerd; de testgroep heeft gespeeld. Status: groen (bewijs in de repo), deels (werkt, maar het criterium is niet volledig of niet reproduceerbaar aangetoond), open (ontbreekt). "Open, vraagt Martien" is wat alleen op een laptop met geïntegreerde GPU, met geïnstalleerde browsers of met de testgroep is af te vinken. "Gezien in Chrome" betekent: door de hoofdsessie in Chrome op de MacBook, niet in een andere browser of op andere hardware. Commando's lopen vanaf de repo-root.

## Slice-definitie (Spelfundament 12, 11, 7)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| Eén factie: Dwellers | groen | data/factions.json; render, HUD en sim lezen de factie uit start.players |
| Eén held: Krijger (Opziener) met 7 SPECIAL, xp, perks, Lockdown, oplappen | groen | packages/sim/src/systems/hero.ts, data/heroes.json; HeroStatus volledig (packages/sim/test/hero.test.ts "state, reviveTicksLeft, entityId en abilityCooldownTicks"); fixtures s3-rustbelt-hero-claims en s4-rustbelt-turrets (Lockdown, dood, oplappen); HUD held-paneel leest state en cooldowns |
| Eén map: Rustbelt, 128 bij 128 m, 2 spelers, 6 nodes, 3 claimpunten | groen | data/maps/rustbelt.json (data 0.9.0, met props-ref; dominantie 2 van 3 punten gedurende 12 minuten sinds de balans-ronde); laadt in sim (alle Rustbelt-fixtures) en render (client); packages/map/test/maps.test.ts |
| Winroute A, vernietiging | groen | packages/sim/src/systems/claims.ts winRoutes; gameplay-tests; fixture s4-rustbelt-turrets eindigt met een aanval op de basis |
| Winroute B, dominantie | deels | De simregel is getest (packages/sim/test/gameplay.test.ts "winroute B: pointsRequired punten gedurende dominance.ticks geeft de winst", op de testmap). Op Rustbelt met data 0.9.0 is er geen bewijs meer: s2-rustbelt-ai-vs-ai eindigde tot de balans-ronde op dominantie (frame 13376) en nu op vernietiging (frame 33691), omdat de AI elke dominantie-poging raidt en het venster 12 minuten is; alle vijf seeds in match-length.test.ts eindigen op vernietiging. Advies en mapbesluit: fase-0 sectie 17 (venster 8 minuten als voorstel, PlayerStatus.dominance voor de HUD, een dominantie-fixture op Rustbelt). Vraagt Martien |
| Skirmish tegen de scripted AI, lokaal via loopback | groen | apps/client/src/game/session.ts (LoopbackRelay); de AI bouwt, onderzoekt geweerrek, bouwt een turret, claimt, schoolt om, valt aan met held en Lockdown; zijn vrije bouwers helpen nu vanzelf |
| Alles buiten de slice afgewezen (Raiders, Garde, winroute C, survival) | groen | niets daarvan in data of code; MatchSettings.mode 'survival' bestaat alleen als enum-waarde |
| Drie reviewgates: sim, netcode, shader | groen | architect-reviews sprint 1 tot 4 en de dag-ronde (docs/CHANGELOG.md, fase-0 sectie 12 tot 16); dag-ronde: sim merge, netcode merge na één fix in protocol (QueueItem.unitId, sectie 16 besluit 2), shader merge (unitMaterial.ts ongewijzigd, propMaterial.ts met map en grade, sectie 16 besluit 7) |
| Elke sim-wijziging levert een replay met hashes; afwijking blokkeert | groen | tools/replay/fixtures (7 fixtures, alle opnieuw opgenomen op data 0.9.0; s2-rustbelt-ai-vs-ai nu 33691 frames, s4-rustbelt-turrets 14000 met raid op het midden, s5-rustbelt-builder-resume sinds de dag-ronde); tools/replay/src/replay.test.ts (verse run gelijk aan de opgeslagen hashes, serialize/deserialize op frame 137 en halverwege); .github/workflows/ci.yml draait `pnpm replay` |
| Stats.js of eigen meting in elke build | groen | packages/render perf-overlay (fps, ms, draw calls) |
| Renderbuis bewezen met placeholders (voorwaarde voor de artistkeuze) | groen, gezien in Chrome | assets/src bevat de Quaternius UAL-mannequin en tien Gobkit-props (CC0, licenties in assets/src/licenses); `pnpm assets` levert assets/dist/manifest.json met elf assets en validation-report.json (mannequin 13.744 naar 3598, 1348 en 492 driehoeken, 53 naar 20 bones, 8 van 46 clips); render laadt dweller_body_human uit loadout.visuals.meshSlots.body als default-rig (packages/render/src/units/unitAssets.test.ts) en de props uit het manifest (props.test.ts). De hoofdsessie zag het karakter in teamkleur met de acht clips en de 200 props in de render-demo en in de client, in Chrome op de MacBook. Niet gezien: een geïntegreerde GPU, Firefox, WebKit |
| Eerste sessie met de testgroep (integratiemoment 2) | open, vraagt Martien | testgroep van 5 tot 8 mensen is nog niet samengesteld (Spelfundament 13, open) |

## sim-core (fase-0 sectie 9, werkstroom 1)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| 50 bewoners per kant verzamelen, bouwen, wisselen van rol en vechten op de slice-map | groen | fixture s4-rustbelt-fifty (16976 frames, opgenomen met de bot in tools/replay/src/bot.ts, afgespeeld zonder bot): beide kanten halen 50 bewoners uit huisvestingsgroei binnen de pop-cap, scrap boven 1000, 24 of meer gebouwen af, 20 militie per kant, meer dan 200 schoten en 40 doden (tools/replay/src/slice.test.ts) |
| Replay-set draait identiek in Node en in drie browsers | deels | `replay:browsers` is echt (tools/replay/src/browsers.ts, README). Lokaal identiek in Chrome 155 en Chromium 147 (gate-1-ronde; na de heropname op data 0.8.0 niet opnieuw in de browser gedraaid); Firefox en WebKit zijn niet geïnstalleerd en dus nooit gedraaid. .github/workflows/browsers.yml installeert ze en draait strict, maar de branch is niet gepusht. Vraagt Martien (samenvatting, punt 2) |
| Benchmark 200 units onder 5 ms per tick | groen | `pnpm bench`: 0,305 ms gemiddeld op sprint-1 na de balans-merge (hoofdsessie); op arch-day vóór de merge 0,309 ms met één uitschieter van 5,21 ms (arch-gate1: 0,287 en 3,56 ms; CI meldt). De AI scant per tick de dreiging bij eigen gebouwen (O(units × gebouwen)), nu goedkoop |
| Serialize en deserialize geven dezelfde hash | groen | elke fixture op frame 137 en halverwege (replay.test.ts), elke replay-run in `pnpm replay` halverwege; hero.test.ts midden in een Lockdown en een oplap-timer; builder.test.ts midden in een hervatting (resumeSite en buildHold in de hash, STATE_FORMAT_VERSION 4) |
| Lint sim-determinism groen | groen | `pnpm lint` groen op sprint-1 en arch-day |
| Winroutes vernietiging en dominantie | groen | zie slice-definitie |
| Scripted AI zonder cheats, via dezelfde validatie | groen | packages/sim/src/systems/ai.ts gebruikt applyCommand en ziet alleen eigen units en gebouwen, de map, de spawns, de eigenaar van claimpunten en vijanden bij eigen gebouwen; alle getallen uit ai/dwellers-basic.json (data 0.9.0, in de envHash), golf-jitter via sim.rng, `aiWaveAt` in de state (STATE_FORMAT_VERSION 5). packages/sim/test/ai.test.ts (6 tests: huisvesting, onderzoek, plunderaars per node met exclusieve nodes eerst, omscholen naar het beste loadout, raid en push, sparen voor het oplappen); turret.test.ts "AI onderzoekt de prereqTech"; s2-rustbelt-ai-vs-ai |
| Turrets schieten (besluit 8) | groen | packages/sim/test/turret.test.ts (8 tests: doelkeuze, range, bouwplaats schiet niet, tech- en Lockdown-effecten, sneuvelt); fixture s4-rustbelt-turrets (beide turrets schieten) |
| Inhalen na resync zonder snapshot per tick | groen | packages/sim/src/worker.ts pump met tijdbudget en `hashes`-bericht; packages/sim/test/worker.test.ts (achterstand van 130 bundels, na load); session.ts stuurt de hashes door. Bekend: events van overgeslagen ticks vervallen (sectie 15, besluit 4) |
| Bouwers hervatten en vrije bouwers helpen (speltest 14 oktober, sectie 16 besluit 1) | groen | packages/sim/test/builder.test.ts (14 tests: hervatten na Move, Attack en AttackMove; Stop en Cancel; nieuw bouwbevel; Cancel van de plaats; omscholen; helpen met afstand, tiebreak, straal, vijandelijke plaats, andere rollen en held; achter elkaar afbouwen; rechtsklik-Build op 2x2 en 3x3; hash en serialize); fixture s5-rustbelt-builder-resume met slice-test; builderAutoHelpRadiusM 12 in sim.json (data 0.8.0, in de envHash) |
| PlayerStatus.queue (sectie 16 besluit 2, verplicht sinds protocol 0.5.0) | groen | Sim.queue (packages/sim/src/sim.ts): onderzoek per gebouw, omscholing per bewoner met de werkplaats of ENTITY_NONE onderweg, oplopend op buildingId dan unitId (gameplay.test.ts "PlayerStatus.queue"); de client annuleert een craft op de bewoner (apps/client/src/main.ts cancelCard). Nog niet door een mens in de HUD gezien |
| Held-xp via assists (balans-ronde) | groen | combat.ts killXp: xpPerAssist binnen xpAssistRadiusM van de levende held, het eigen schot blijft xpPerKill (hero.test.ts "xp per assist"); AI tegen AI: de held van de winnaar haalt level 4 tot 6 |
| Potjelengte 25 tot 35 minuten (Spelfundament 2.6) | groen bij AI tegen AI | tools/replay/src/match-length.test.ts: vijf seeds, 28,1 tot 28,9 minuten, scrap-piek onder 600, held minstens level 2 (41 s testtijd); `pnpm --filter @crawlout/replay balance` voor de meting. Met een mens aan de knoppen nog niet gemeten |

## render-pipeline (werkstroom 2)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| WebGPURenderer met WebGL2-fallback | groen | packages/render/src/renderer.ts; render-demo gemeten op beide |
| TSL toon-ramp met teammasker, instanced skinning via bone-matrix textures, 3 LODs, blob-schaduwen | groen | packages/render 0.1.0 en 0.2.0 (CHANGELOG), unitLayer, unitMaterial, bake.ts; met het echte karakter: teammasker op M_Main als terugval (sectie 12 punt 6), drie LODs uit het manifest |
| RTS-camera (pan, zoom, rotatie, randscroll), selectie-highlight, snapshot-interpolatie | groen | rtsCamera.ts (panKeys sinds 0.3.0; randscroll over het hele venster en buiten het venster sinds 0.5.0, rtsCamera.test.ts), decals, interpolate.ts; klikmarge 16 px (picking/selection.ts pickNearestOnScreen, selection.test.ts) |
| Vier effecten uit snapshot-events (mondingsvuur, inslag, bouwstof, dood) | groen | vfx/effects.ts volgens de event-semantiek van sprint 2; daarbij abilityZone als gronddecal (vfx/abilityZones.ts) en het turretschot vanaf het dak (effects.test.ts "fires a turret from its roof") |
| De held is herkenbaar (besluit 5) | groen | held-vlag per instance in unitMaterial.ts (1,15 maal groter, ook op het echte karakter; pet, kraag en schouderstukken alleen op de placeholder); geen extra draw call; shader-gate gepasseerd |
| 200 geanimeerde units plus 40 gebouwen op 60 fps, onder 150 draw calls, geen frame boven 20 ms bij een camera-draai | deels | Gemeten op de MacBook in Chrome met het echte karakter, held, turrets en 200 props (render CHANGELOG 0.5.0): ongecapt WebGPU 25 draw calls, mediaan 0,6 ms, p99 1,3 ms, slechtste frame 4,5 ms; WebGL2 25 draw calls, mediaan 2,3 ms, slechtste frame 5,3 ms. Op een laptop met geïntegreerde GPU: open, vraagt Martien |
| Een Quaternius-asset vervangen door een ander GLB uit het manifest kost nul regels code | groen, gezien in Chrome | De keuze is data (loadout.visuals.meshSlots.body wijst naar dweller_body_human, `?unit=` in de demo); de eerste body uit de loadouts is de default-rig voor held en units zonder eigen body; met het echte asset gedaan en gezien. Kanttekening: de maat van een prop staat nog per asset-id in render (propFit.ts), zie sectie 16 besluit 6 |
| Bone-matrix-formaat uit sectie 12 wordt gelezen | groen | units/bakedManifest.ts valideert manifest tegen `ANIM_NAMES`, width, height en aaneengesloten clips; characterFit (1,2 tot 2,6 m blijft, anders 1,8 m, voeten op y = 0) in de skin-matrices; het echte `dweller_body_human.anim.f32` (20 bones, 8 clips) laadt |
| Decoratieve props uit de map (sectie 16 besluit 3 en 7) | groen, gezien in Chrome | props/propLayer.ts, propAssets.ts, propGeometry.ts, propFit.ts; props.test.ts (manifest, bron-GLB, placeholder, LOD en culling per chunk, fit); één instanced draw per prop-asset per LOD-geometrie, niet te picken; 200 props op Rustbelt gezien in de render-demo (`?props=0`, `src`, `ph`) en in de client |

## asset-cli (werkstroom 3)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| Alle Quaternius-placeholders en 10 Gobkit-props door de buis met één commando | groen | `pnpm assets` over assets/src: dweller_body_human (character) en bush001, bush002, grass001, reed001, rock001, rock002, rock003, treehigh001, treelow001, treemed001 (prop) in assets/dist/manifest.json, drie LOD-GLB's per asset, `dweller_body_human.anim.f32`, validation-report.json (deterministisch). Conform-stap uit assets/src/rigmap.json (bone-snoeien naar 20 bones, reductie naar 3598 driehoeken, props schaal 0,01) en clipmap per asset (8 van 46 clips, canonieke namen). De mannequin is één Quaternius-karakter; meer placeholders zijn een kwestie van bestanden in assets/src |
| Een asset dat de norm schendt faalt met een leesbare reden | groen | tools/asset-cli/test/conform.test.ts (bone-snoeien, rigmap-fouten, simplify met skinning, smoke-test op de echte UAL-GLB) en build.test.ts; de norm voor eindassets blijft (een asset zonder rigmap-entry krijgt de volle norm); gezicht naar +Z wordt nu aan de zolen gecontroleerd |
| De uitvoer laadt in packages/render zonder handwerk | groen, gezien in Chrome | het manifest, de LOD-GLB's en de bone-matrix-texture van de echte buis laden in render (unitAssets.test.ts met het manifest-formaat, de hoofdsessie in Chrome met de echte bestanden); props uit het manifest (props.test.ts) |

## content (werkstroom 4)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| Elk bestand valideert; onbekende velden geweigerd | groen | packages/data zod-schema's strict; `pnpm test` (game-data.test.ts, builderAutoHelpRadiusU 3072) |
| De sim start op deze data | groen | alle fixtures en de client draaien op data 0.9.0 |
| Balans na de speltest (scrap loopt niet op, legers groeien, de held levelt) | groen bij AI tegen AI | data 0.9.0: scavenger 6 per 13 s, woning 75, turret 120, militie 30, patrol 75, techs 25 procent duurder, startScrap 300, groei 2 per minuut, held-xp 80 tot 300 per stap met kill 25, assist 15 en ontdekking 50; elk record met de reden in `_comment` (packages/data/CHANGELOG.md 0.9.0). Rustbelt (11.000 scrap) is rond minuut 25 leeg: de natuurlijke klok van de slice (sectie 17) |
| Een nieuwe loadout toevoegen is alleen JSON | groen | typeIds uit packages/data, render en HUD lezen loadouts uit GameData; loadout.visuals.meshSlots.body kiest het asset |
| Elke waarde een regel commentaar met de bedoeling | groen | `_comment` per record (steekproef sim.json met builderAutoHelpRadiusM, heroes.json, buildings.json turret) |
| Factie, 1 body, 4 loadouts, 8 gebouwen, 6 upgrades, held met 7 SPECIAL en 6 perks, damage-matrix, AI-script | groen | geteld in data/: 4 loadouts, 8 gebouwen, 6 techs, 6 perks, 1 held met 1 ability, 1 AI-script; 1 body (dweller_body_human) nu echt in assets/dist |
| Turrets hebben schade en bereik (besluit 8) | groen | data/buildings.json turret: 12 ballistic per 1,0 s op 12 m (startwaarde); schema verplicht de velden bij provides turret (packages/data/src/game-data.test.ts "sprint 4: turrets in data") |

## hud (werkstroom 5)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| Een potje tegen de AI is volledig speelbaar zonder console | deels | Martien speelde op 14 oktober een potje uit de HUD; daaruit kwamen de punten van deze ronde (research en craft onduidelijk, klikken op een trackpad, bouwers die stoppen). Die zijn gebouwd: gebouwpaneel met kaarten (research, craft, oplappen; status, kosten, effecten, voortgang, annuleren), eenhedenbalk per type, rechtsklik op een bouwplaats = helpen, Ctrl+klik als rechtsklik, klikmarge. Na die fixes heeft nog geen mens gespeeld. Vraagt Martien: een potje uit de HUD (testsessie) |
| Elke actie heeft een sneltoets | groen | packages/ui/src/controller.ts ACTIONS (1 tot 3, B, H, V, K, N, Spatie, L), perks F1 tot F3, abilities Z, X, C, cijfers in bouwmenu en gebouwpaneel (kaarten 1 tot 9, K voor craft-kaarten) |
| De HUD rendert onder 2 ms per frame | groen | packages/ui/src/hud.sprint2.test.ts: 50 geselecteerde units onder 2 ms |
| Minimap met fog en claims, bouwmenu met plaatsing, held-paneel, waarschuwingen, opgeven, desync-melding | groen | packages/ui 0.2.0 en 0.3.0 (CHANGELOG), hud.sprint2 en sprint3 tests (HeroStatus met de verplichte velden) |
| Gebouwpaneel met kaarten en eenhedenbalk (speltest 14 oktober) | groen | packages/ui/src/cards.ts en view.ts (hud.cards.test.ts, hud.roster.test.ts: status nooit alleen kleur, aria-labels, sneltoetsen, voortgang, annuleren, selectie vanuit de balk); apps/client/src/game/cards.ts en roster.ts (cards.test.ts, roster.test.ts: teksten, status uit scrap, techs en queue). Voortgang en running-status verschijnen pas als de sim PlayerStatus.queue levert (balans-branch); het annuleren van een craft moet dan via QueueItem.unitId (sectie 16 besluit 2) |
| Stijl volgt de stijlbijbel, tot dan neutraal | groen | er is nog geen stijlbijbel (na gate 1); de HUD is neutraal |

## relay (werkstroom 6)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| Twee browsers op één machine spelen een potje via de relay zonder desync | deels | Reproduceerbaar in het klokvrije harnas met de echte Room, twee echte sims op Rustbelt en de echte BundleFeed (apps/client/test/support/lockstepNet.ts; latency.test.ts en reconnect.test.ts melden geen desync). De echte test met twee browsers over ws is gemeld door de relay-agent, maar nog geen script. Herhalen in de testsessie |
| De loopback geeft dezelfde hashes als de relay | groen | packages/relay/src/equivalence.test.ts |
| Een client die 10 seconden wegvalt komt terug via resync | groen | apps/client/test/reconnect.test.ts: 10 s wegval, tweede `start`, resync via peer A, hashes gelijk vanaf het geladen frame, commando's van B daarna uitgevoerd; relay-kern in sprint2.test.ts |
| Gesimuleerde latency van 300 ms blijft speelbaar met adaptieve DELAY | groen | apps/client/test/latency.test.ts: round-trip 300 ms, DELAY stijgt boven 4 binnen MIN..MAX, na de opwarming geen te laat commando, hashes van beide clients gelijk |
| Desync stopt het potje met een melding en een dump | groen | relay stopt bundels; client dumpt naar IndexedDB (apps/client/src/net/desyncDump.ts); HUD toont de melding |
| Bundels zonder gat, dataVersion over ws | groen | BundleFeed geeft alleen aaneengesloten frames vrij (apps/client/test/resync.test.ts "never skips a gap"); `pnpm relay` leest data/VERSION (packages/relay/src/reconnect.test.ts "dataVersion"), de client weigert elk verschil, ook '0' (apps/client/test/dataVersion.test.ts). In de dag-ronde alleen Prettier |

## map (werkstroom 7)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| De map laadt in sim en render | groen | packages/map loader, simMapFromGrid, renderer.setTerrain; props via loadProps naar renderer.setProps (alleen de client) |
| Passability klopt met wat je ziet | open, vraagt Martien | visuele controle in de client (greybox markeert nodes en claimpunten; de props staan op en langs onbegaanbare cellen en nooit op de pad-corridor, dus een boom op een pad is een fout); niet door een test te vangen |
| Een tweede map toevoegen is alleen data | groen | testmap en rustbelt komen allebei uit data/maps via dezelfde generator en loader; props zijn een optionele ref per map |
| Dominantie-venster van Rustbelt | open, vraagt Martien | 2 van 3 punten gedurende 12 minuten (balans-ronde, via de generator; door sim-core en content gezet, map is van werkstroom 7, eenmalig aanvaard). Met 3 minuten besliste het midden op minuut 11, met 12 nooit. Voorstel 8 minuten, of 12 laten staan en dominantie als druk benoemen (fase-0 sectie 17) |
| Claimpunten liggen bij de nodes die exclusief moeten worden (besluit 9) | groen | settlement-punten (40,34) en (87,93), 4 m van de 2500-nodes binnen claimRadiusM 6 (packages/map/test/maps.test.ts: node binnen de straal, plek voor een claimpaal naast elk punt); in s2-rustbelt-ai-vs-ai maken beide AI's hun node exclusief |
| Scrap-nodes, claimpunten, spawns, creep-kampen; decoratieve props | deels | nodes, claimpunten en spawns werken; props zijn af (data/maps/rustbelt.props.json, 200 stuks, deterministisch en puntsymmetrisch met een eigen integer-RNG, nooit binnen 3 m van spawns, nodes, claimpunten en kampen, pad-corridor vrij; packages/map/test/props.test.ts, de envHash is gelijk met en zonder props); creep-kampen staan op de route in de data (maps.test.ts) maar niet in de sim. Na gate 1 (sectie 15, besluit 9). Three Scatter vervalt (sectie 16, besluit 3) |

## Determinisme en CI (fase-0 sectie 7)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| CI draait lint, typecheck, tests en de replay-set op elke PR | groen in de repo, niet gedraaid | .github/workflows/ci.yml; deze commits zijn lokaal groen (lint, typecheck, 524 tests, 7 fixtures) maar nooit op GitHub gedraaid: sprint-1 is niet gepusht |
| Wekelijkse replay-set in Chromium, Firefox en WebKit | deels | browsers.yml installeert de browsers en draait `replay:browsers` strict; nooit gedraaid (niet gepusht). Lokaal alleen Chrome en Chromium, en dat vóór de heropname op data 0.8.0 |
| Handmatige hash-test en WebGPU-meting in Chrome op de MacBook | deels | hash-test: `replay:browsers -- --chrome`, door sim-core gedraaid in Chrome 155 (identiek, gate-1-ronde). WebGPU-meting: render-demo door render-pipeline met het echte karakter en de props (25 draw calls, slechtste frame 4,5 ms). Martien hoeft alleen nog de geïntegreerde GPU te meten |
| Benchmark in CI meldt, blokkeert niet | groen | ci.yml stap "Benchmark (meldt, blokkeert niet)" |
| Prettier | deels | de bulk-opmaak dekt client, ui, render, relay, map, protocol en asset-cli; packages/sim, packages/data, tools/replay, data/ en docs/ zijn nog niet door Prettier (99 bestanden volgens `prettier --check .`); lint is overal groen |

## Open in de repo (mag, geen blokkade; zie fase-0 sectie 15 en 16)

| Werkstroom | Punt |
| --- | --- |
| sim-core | een dominantie-fixture op Rustbelt-data (sectie 17, advies 3); `upgradeOne` trekt militie uit een lopende golf; `raidOver` herkent een raid aan het claimpunt-coördinaat; match-length.test.ts (41 s) buiten de snelle testlus; turretAim overschrijft het hele flags-byte van een gebouw (maskeren zodra gebouwen een tweede vlag krijgen); de AI laat zijn hele bouwvolgorde wachten op een onbetaalbare tech; events van overgeslagen ticks vervallen bij inhalen (meldingen ontbreken na een resync) |
| relay | het harnas tikt de sim direct, niet via SimWorkerCore.pump en session.ts (één test via createSimWorkerCore erbij); `startRelayServer` zonder dataVersion meldt '0', wat de client nu weigert; `BundleFeed.gapAt` is ongebruikt; de twee-browsers-test over ws als script |
| render-pipeline | de prop-blobs vallen stil weg als de decal-batch vol is (capaciteit entities + 64); de cull-bol van een held is niet met HERO_SCALE vergroot; de prop-maat per asset-id (propFit.ts) hoort op termijn in de asset-buis (sectie 16, besluit 6) |
| asset-cli | `scale` per prop in rigmap.json op de getekende maat zodra besluit 6 wordt uitgevoerd; de rigmap bevat DEF- en UE-namen in één rig |
| hud en client | randscroll op window scrollt mee bij een klik op een HUD-paneel in de randstrook; een dominantie-teller zodra PlayerStatus hem draagt (sectie 17, advies 2) |
| content | rallyPoint uit ai/*.json en het schema bij de volgende bump; meetresultaten uit de `_comment`-regels naar de CHANGELOG |
| map | creep-kampen in de sim (na gate 1); het dominantie-venster na het besluit van Martien |
| bulk | Prettier over sim, data, replay, data/ en docs/ |

## Open, vraagt Martien

1. De render-demo en de client op een laptop met geïntegreerde GPU (60 fps, onder 150 draw calls, geen frame boven 20 ms).
2. `playwright install chromium firefox webkit` en `replay:browsers -- --chrome`; sprint-1 pushen zodat ci.yml en browsers.yml draaien.
3. De testgroep en de eerste sessie: potje tegen de AI uit de HUD (met kaarten en eenhedenbalk), potje met twee browsers over `pnpm relay` met een reload, en de visuele passability-controle op Rustbelt met de props.
4. Het mapbesluit over dominantie (fase-0 sectie 17): venster 8 minuten als echte winroute, of 12 minuten als druk. Daarna PlayerStatus.dominance (architect, protocol 0.6.0) en een dominantie-fixture op Rustbelt (sim-core).

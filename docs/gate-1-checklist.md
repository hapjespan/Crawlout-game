# Gate-1-checklist

Oct 15, 2026 · architect, na de review van de XL-ronde (branch sprint-1 van commit c73940d, de review van de nachtronde, tot en met commit 24eb1c8, de merge van polish, beoordeeld op arch-xl met protocol 0.7.0 en data 0.14.0; vorige versies na de nachtronde, commit a4f0975, de balans-ronde, commit bd4bbbb, de gate-1-ronde, commit a1fcc3e, en de slice-ronde). Fase-0 sectie 19 bevat de besluiten van deze ronde.

## Samenvatting: is dit een gate-1-kandidaat?

**Ja, technisch.** Alles wat in de repo groen kan zijn, is groen met bewijs: lint, typecheck, 846 tests in 83 bestanden en 8 replay-fixtures op data 0.14.0, alle ook na serialize/deserialize halverwege. De slice speelt van begin tot winst tegen de AI op Rustbelt XL (384 x 384 m) over beide winroutes: over 33 seeds AI tegen AI 10 keer vernietiging en 23 keer dominantie, alle potjes tussen 25,5 en 30,6 minuten (Spelfundament 2.6), speler 0 wint 13 en speler 1 wint 20 (binnen de ruis op een puntsymmetrische map; de spiegeltest houdt tot de gelijke stand bij het midden). De drie gates staan op merge (sectie 19).

**Nee, nog niet als gate.** Gate 1 zelf (Spelfundament 12) valt pas als de testgroep heeft gespeeld; dat kan geen agent doen. Alles met GPU en browser is alleen op de MacBook in Chrome gezien, en de render is opnieuw zwaarder: 7904 props, chunked terrein met LOD, water en foliage met alpha-test, slechtste frame 17,6 ms bij 2080 zichtbare props (budget 20 ms). CI heeft nog nooit gedraaid (sprint-1 is niet naar main). Na de XL-map en de echte schaal heeft nog geen mens gespeeld.

**De vijf dingen die Martien zelf moet doen (volgorde van gewicht):**

1. **Geïntegreerde GPU.** De client en de render-demo op een laptop met geïntegreerde GPU, op netstroom: doel 60 fps, onder 150 draw calls, geen frame boven 20 ms bij een camera-draai over Rustbelt XL met alle props; de knoppen zijn `?detail=0`, het prop-budget en de wind. Dit is nu het belangrijkste open punt (sectie 19 besluit 10).
2. **Spelen op Rustbelt XL.** Een potje tegen de AI uit de HUD: de grote map, de rivier en de voordes, de schaal van gebouwen naast bewoners van 1,8 m, de dominantie-teller met 3 van 5, en de visuele passability-controle (een unit over een klifrand of door water is een mapfout).
3. **Browsers en CI.** sprint-1 pushen en de PR naar main openen zodat ci.yml en browsers.yml draaien; lokaal eenmalig `pnpm --filter @crawlout/replay exec playwright install chromium firefox webkit`, dan `pnpm --filter @crawlout/replay run replay:browsers -- --chrome` (de hash-test na de heropnames op data 0.14.0).
4. **Testgroep.** Vijf tot acht mensen; een potje tegen de AI en een potje met twee browsers over `pnpm relay` met een reload halverwege (resync).
5. **Mapkeuzes.** Het dominantie-venster van Rustbelt XL (8 minuten gepind; sim-core meet 50/50 met 9 minuten, sectie 19 besluit 12) en het tempo op de grote map (spawn tot spawn 2,5 minuut lopen). Ontwerpkeuzes na de testgroep, geen blokkade. De lokale buis is nu DEV-gated; alleen nog: geen screenshots met fanart delen.

Gate 1 is de harde stop na fase 1 (Spelfundament sectie 12): de slice is 1 factie (Dwellers), 1 held (Krijger), 1 map (Rustbelt), 2 winroutes (vernietiging, dominantie), tegen AI; de renderbuis is bewezen met placeholders; de drie reviewgates (sim, netcode, shader) zijn gepasseerd; de testgroep heeft gespeeld. Status: groen (bewijs in de repo), deels (werkt, maar het criterium is niet volledig of niet reproduceerbaar aangetoond), open (ontbreekt). "Open, vraagt Martien" is wat alleen op een laptop met geïntegreerde GPU, met geïnstalleerde browsers of met de testgroep is af te vinken. "Gezien in Chrome" betekent: door de hoofdsessie in Chrome op de MacBook, niet in een andere browser of op andere hardware. Commando's lopen vanaf de repo-root.

## Slice-definitie (Spelfundament 12, 11, 7)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| Eén factie: Dwellers | groen | data/factions.json; render, HUD en sim lezen de factie uit start.players |
| Eén held: Krijger (Opziener) met 7 SPECIAL, xp, perks, Lockdown, oplappen | groen | packages/sim/src/systems/hero.ts, data/heroes.json; HeroStatus volledig (packages/sim/test/hero.test.ts); fixtures s3-rustbelt-hero-claims en s4-rustbelt-turrets (Lockdown, dood, oplappen); HUD held-paneel leest state en cooldowns |
| Eén map: Rustbelt XL, 384 bij 384 m, 2 spelers, 5 claimpunten, rivier met voordes, bosrand | groen | data/maps/rustbelt.json (data 0.14.0): 3 x 3 tegels uit het hoogteveld van Rock Terrain 4, puntsymmetrisch en exact (packages/map/test/maps.test.ts, xl.test.ts), water als optionele ref (sectie 19 besluit 1), bouwvlakken van 30 m rond de spawns, 7904 props (scatter.ts). Dominantie 3 van 5 punten gedurende 8 minuten |
| Winroute A, vernietiging | groen | packages/sim/src/systems/claims.ts winRoutes; gameplay-tests; fixtures s2-rustbelt-ai-vs-ai en s4-rustbelt-turrets; 10 van de 33 seeds in match-length.test.ts |
| Winroute B, dominantie | groen | gameplay.test.ts "winroute B"; fixture s6-rustbelt-dominance (de bot claimt drie punten en wint in frame 13524); 23 van de 33 seeds in match-length.test.ts |
| Skirmish tegen de scripted AI, lokaal via loopback | groen | apps/client/src/game/session.ts (LoopbackRelay); de AI bouwt, onderzoekt, bouwt turrets, claimt eerst aan de eigen kant, verdedigt, raidt met een bouwer die claimt, valt aan met held en Lockdown |
| Alles buiten de slice afgewezen (Raiders, Garde, winroute C, survival) | groen | niets daarvan in data of code; MatchSettings.mode 'survival' bestaat alleen als enum-waarde |
| Drie reviewgates: sim, netcode, shader | groen | architect-reviews sprint 1 tot 4, de dag-, balans- en nachtronde (docs/CHANGELOG.md, fase-0 sectie 12 tot 18); nachtronde: sim merge, netcode merge (relay ongewijzigd, PlayerStatus.dominance verplicht in protocol 0.7.0), shader merge (texture-array voor de gebouwen, terreinmateriaal met verfijning; sectie 18 besluit 7) |
| Elke sim-wijziging levert een replay met hashes; afwijking blokkeert | groen | tools/replay/fixtures (8 fixtures, alle opnieuw opgenomen op data 0.14.0: s2-rustbelt-ai-vs-ai 32354 frames, s4-rustbelt-fifty 25845, s4-rustbelt-turrets 20000, s6-rustbelt-dominance 13524); `pnpm replay` groen op arch-xl, ook na serialize/deserialize halverwege |
| Stats.js of eigen meting in elke build | groen | packages/render perf-overlay (fps, ms, draw calls), in de client verplaatst zodat hij de dominantie-balk niet overlapt |
| Renderbuis bewezen met placeholders (voorwaarde voor de artistkeuze) | groen, gezien in Chrome | assets/src bevat de Quaternius-mannequin, tien Gobkit-props en het CC-BY-huisje (licenties in assets/src/licenses); `pnpm assets` levert assets/dist/manifest.json met 19 assets (1 character, 10 props, 8 buildings) en validation-report.json; render laadt het karakter uit loadout.visuals.meshSlots.body, de props uit de map en de gebouwen uit buildings.json visuals.mesh (packages/render/src/structures/buildingAssets.test.ts, structures.test.ts "draws a building type with its asset"); het terrein uit assets/dist/terrain/terrain.json (terrainTextures.test.ts). De hoofdsessie zag karakter, props, gebouwen en het terrein in de render-demo en de client, in Chrome op de MacBook. Niet gezien: een geïntegreerde GPU, Firefox, WebKit |
| Eerste sessie met de testgroep (integratiemoment 2) | open, vraagt Martien | testgroep van 5 tot 8 mensen is nog niet samengesteld (Spelfundament 13, open) |

## sim-core (fase-0 sectie 9, werkstroom 1)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| 50 bewoners per kant verzamelen, bouwen, wisselen van rol en vechten op de slice-map | groen | fixture s4-rustbelt-fifty (25002 frames op de nieuwe Rustbelt, opgenomen met de bot in tools/replay/src/bot.ts, afgespeeld zonder bot): beide kanten halen 50 bewoners uit huisvestingsgroei binnen de pop-cap (tools/replay/src/slice.test.ts) |
| Replay-set draait identiek in Node en in drie browsers | deels | `replay:browsers` is echt (tools/replay/src/browsers.ts); lokaal identiek in Chrome en Chromium in de gate-1-ronde, niet opnieuw na de heropnames (nu op data 0.14.0); Firefox en WebKit nooit gedraaid |
| Benchmark 200 units onder 5 ms per tick | groen, met een kanttekening | sim 0.11.0: 0,331 ms gemiddeld, max 7,2 ms in tick 0 (graafbouw en koude JIT; daarna onder 5 ms); `pnpm bench -- --xl` 0,27 tot 0,30 ms op de XL-testmap. Mag: tick 0 apart melden (sectie 19, open 5) |
| Serialize en deserialize geven dezelfde hash | groen | elke fixture op frame 137 en halverwege (replay.test.ts), elke replay-run in `pnpm replay` halverwege; hero.test.ts, builder.test.ts; STATE_FORMAT_VERSION 5 (ongewijzigd in de nachtronde) |
| Lint sim-determinism groen | groen | `pnpm lint` groen op sprint-1 en arch-night (de regelset dekt ook packages/map, inclusief de nieuwe terreingenerator) |
| Winroutes vernietiging en dominantie | groen | zie slice-definitie |
| Scripted AI zonder cheats, via dezelfde validatie | groen | packages/sim/src/systems/ai.ts gebruikt applyCommand en ziet alleen eigen units en gebouwen, de map, de spawns, de eigenaar van claimpunten en vijanden bij eigen gebouwen; alle getallen uit ai/dwellers-basic.json (data 0.10.0, in de envHash); nachtronde: claimt eerst aan de eigen kant, raid met een bouwer die claimt, wacht en spaart tot de claimpaal betaald is (packages/sim/test/ai.test.ts, 8 tests); s2-rustbelt-ai-vs-ai |
| Turrets schieten (besluit 8) | groen | packages/sim/test/turret.test.ts; fixtures s4-rustbelt-turrets en s6-rustbelt-dominance (twee turrets van de bot houden het midden) |
| Inhalen na resync zonder snapshot per tick | groen | packages/sim/src/worker.ts pump met tijdbudget en `hashes`-bericht; worker.test.ts. Bekend: events van overgeslagen ticks vervallen (sectie 15, besluit 4) |
| Bouwers hervatten en vrije bouwers helpen (sectie 16 besluit 1) | groen | packages/sim/test/builder.test.ts; fixture s5-rustbelt-builder-resume (plekken nu uit de map, niet uit vaste cellen) |
| PlayerStatus.queue (verplicht sinds protocol 0.5.0) | groen | Sim.queue (gameplay.test.ts "PlayerStatus.queue"); de client annuleert een craft op de bewoner. Nog niet door een mens in de HUD gezien |
| PlayerStatus.dominance (verplicht sinds protocol 0.7.0, sectie 18 besluit 1) | groen | Sim.dominance en claims.ts dominanceStatus (gameplay.test.ts "PlayerStatus.dominance": eigen stand, leider, klok 0 na opgeven, de query verandert de hash niet); slice.test.ts volgt de klok per tick in s6 (elke tick één verder of terug naar 0, ticksRequired = minutes · 1200) |
| Held-xp via assists (balans-ronde) | groen | combat.ts killXp (hero.test.ts "xp per assist"); AI tegen AI: de held van de winnaar haalt level 4 tot 6 |
| Potjelengte 25 tot 35 minuten (Spelfundament 2.6) | groen bij AI tegen AI | match-length.test.ts: 33 seeds op Rustbelt XL, 25,5 tot 30,6 minuten, beide winroutes, scrap-piek onder 600, speler 0 wint 13 en speler 1 wint 20 (fairness.ts); mirror.test.ts: de spiegel houdt tot de gelijke stand bij het midden. Met een mens aan de knoppen niet gemeten |

## render-pipeline (werkstroom 2)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| WebGPURenderer met WebGL2-fallback | groen | packages/render/src/renderer.ts; render-demo gemeten op beide (nachtronde: gelijk op 120 fps) |
| TSL toon-ramp met teammasker, instanced skinning via bone-matrix textures, 3 LODs, blob-schaduwen | groen | packages/render 0.1.0 tot 0.6.0 (CHANGELOG), unitLayer, unitMaterial, bake.ts; met het echte karakter: teammasker op M_Main als terugval, drie LODs uit het manifest; `UnitAssetConfig.bind` voor units zonder body-slot (de held) |
| RTS-camera (pan, zoom, rotatie, randscroll), selectie-highlight, snapshot-interpolatie | groen | rtsCamera.ts, decals, interpolate.ts; klikmarge 16 px (picking/selection.ts); picking van gebouwen op de modelhoogte van het asset |
| Vier effecten uit snapshot-events (mondingsvuur, inslag, bouwstof, dood) | groen | vfx/effects.ts; abilityZone als gronddecal; het turretschot vertrekt vanaf de top van het getekende model (`EffectContext.buildingTop`, effects.test.ts) |
| De held is herkenbaar (besluit 5) | groen | held-vlag per instance in unitMaterial.ts (1,15 maal groter); geen extra draw call; shader-gate gepasseerd |
| Gebouwen uit het manifest (sectie 12 punt 7, sectie 18 besluit 3 en 7) | groen, gezien in Chrome | structures/buildingAssets.ts, buildingGeometry.ts, textureArray.ts, structureLayer.ts: elk gebouwtype met een asset in het manifest als één instanced draw per asset per LOD, alle materialen via één texture-array (512 px, vier lagen voor acht gebouwen), teammasker uit teamMaterials, bouwvoortgang als afsnede in de vertexshader (propMaterial.ts `reveal`), echte schaduw, LOD 55 en 110 m; placeholder als terugval met status en reden (`renderer.buildingAssets()`); buildingAssets.test.ts, structures.test.ts (3 tests) |
| Terrein als rots en stof op de nieuwe Rustbelt (sectie 18 besluit 7) | groen, gezien in Chrome | terrain/terrainRefine.ts (render-only verfijning naar 0,5 m, Catmull-Rom geclampt, normalen, hemel-occlusie, celkleuren barycentrisch; terrainRefine.test.ts), terrainMaterial.ts (rots op helling, triplanair, gespiegelde tegeling met expliciete gradiënten, zachte toon-ramp), terrainTextures.ts (terrain.json via `@crawlout/asset-cli/heightfield`; terrainTextures.test.ts); units, props, decals en picking op het verfijnde oppervlak |
| 200 geanimeerde units plus 40 gebouwen op 60 fps, onder 150 draw calls, geen frame boven 20 ms bij een camera-draai | deels | Gemeten op de MacBook (M3 Pro, netstroom): op Rustbelt XL met 7904 props, chunked terrein, water en foliage tot 246k driehoeken, slechtste frame 17,6 ms (render 0.7.0 tot 0.9.1). Binnen budget, maar nooit op een geïntegreerde GPU |
| Een Quaternius-asset vervangen door een ander GLB uit het manifest kost nul regels code | groen, gezien in Chrome | Units: loadout.visuals.meshSlots.body (`?unit=` in de demo), bindingen via `assets.bind`. Gebouwen: buildings.json visuals.mesh wijst naar het manifest; een ander GLB is een andere variant in assets/src/buildings/variants.json. Kanttekening: de maat van een prop staat nog per asset-id in render (propFit.ts), sectie 16 besluit 6 |
| Bone-matrix-formaat uit sectie 12 wordt gelezen | groen | units/bakedManifest.ts valideert het manifest tegen `ANIM_NAMES`; characterFit in de skin-matrices; het echte `dweller_body_human.anim.f32` laadt |
| Decoratieve props uit de map (sectie 16 besluit 3 en 7, sectie 19 besluit 6 en 8) | groen, gezien in Chrome | props/propLayer.ts met categorie (wind, kleurvariatie, uitdunning, blob-schaduw), alpha-test voor blad en gras, LOD op schermgrootte; 7904 props op echte schaal (schaal 1 uit het manifest) |

## asset-cli (werkstroom 3)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| Alle placeholders en props door de buis met één commando | groen | `pnpm assets`: het karakter, acht gebouwen, tien Gobkit-props en veertig DJMaesen-props (CC-BY, bronnen in assets/src/packs buiten git, config assets/src/packs.json, sectie 19 besluit 9) in assets/dist/manifest.json met category, alpha en teamMask |
| Acht Dweller-gebouwen uit één CC-BY-bron (sectie 12 punt 7) | groen | assets/src/buildings/variants.json (alle vormgetallen als data) en src/buildings.ts, geometry.ts, variants.ts: niet-uniforme schaal op de footprint, delen van het huisje op materiaal en samenhang, toevoegingen (box, cylinder, cone), tint per materiaal in de basiskleurfactor, een team-materiaal per gebouw, LOD-reductie met meshopt, textures 512, 256 en 128; manifest kind 'building' met footprint en teamMaterials (schema in manifest.ts, verplicht bij een gebouw, verboden bij de rest); tools/asset-cli/test/buildings.test.ts; preview/buildings.html |
| Terrein uit Rock Terrain 4 (sectie 12 punt 8) | groen | `pnpm --filter @crawlout/asset-cli run terrain`: hoogteveld (crawlout-heightfield/1, 128 bij 128 m) en albedo in bovenaanzicht naar assets/dist/terrain, met terrain.json (crawlout-terrain/1, naamsvermelding CC-BY-4.0); byte-identiek over twee runs; de bron (47 MB) niet in git; `pnpm assets` laat assets/dist/terrain staan (PRESERVED_DIST_ENTRIES); test/terrain.test.ts |
| Lokale buis voor bronnen buiten git (sectie 18 besluit 4) | groen, alleen lokaal | `pnpm assets --local` van assets/local naar assets/dist-local (beide in .gitignore), met extractie, fit, retargeting van clips naar een ander skelet, atlas en teammasker (src/fit.ts, retarget.ts, textures.ts); zonder assets/local gebeurt er niets; test/local.test.ts en retarget.test.ts met synthetische skeletten. `git ls-files` bevat geen lokaal bestand. Nog te doen (client, moet vóór een build die het huis verlaat): de glob achter `import.meta.env.DEV` |
| Een asset dat de norm schendt faalt met een leesbare reden | groen | tools/asset-cli/test/conform.test.ts, build.test.ts, buildings.test.ts (ongeldige variants.json, ontbrekend team-materiaal); de norm voor eindassets blijft |
| De uitvoer laadt in packages/render zonder handwerk | groen, gezien in Chrome | manifest, LOD-GLB's, bone-matrix-texture, gebouwen (texture-array) en terrain.json laden in render (unitAssets.test.ts, props.test.ts, buildingAssets.test.ts, terrainTextures.test.ts; de hoofdsessie in Chrome) |

## content (werkstroom 4)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| Elk bestand valideert; onbekende velden geweigerd | groen | packages/data zod-schema's strict; `pnpm test` (game-data.test.ts, ook de AI-waarden van 0.10.0) |
| De sim start op deze data | groen | alle fixtures en de client draaien op data 0.10.0 |
| Balans na de speltest (scrap loopt niet op, legers groeien, de held levelt) | groen bij AI tegen AI | data 0.9.0 plus 0.10.0 (claimpaal 800 hp, rallySite hq, defendRadiusM 38, met de reden in `_comment` en packages/data/CHANGELOG.md): potjes van 30,2 tot 32,9 minuten, scrap-piek rond 240, held level 4 tot 6; dominantie beslist één van de vijf seeds |
| Een nieuwe loadout toevoegen is alleen JSON | groen | typeIds uit packages/data, render en HUD lezen loadouts uit GameData |
| Elke waarde een regel commentaar met de bedoeling | groen | `_comment` per record (0.10.0: claimpaal en het AI-script noemen de reden en de meting) |
| Factie, 1 body, 4 loadouts, 8 gebouwen, 6 upgrades, held met 7 SPECIAL en 6 perks, damage-matrix, AI-script | groen | geteld in data/; 1 body en 8 gebouwen nu echt in assets/dist (visuals.mesh naar het manifest) |
| Turrets hebben schade en bereik (besluit 8) | groen | data/buildings.json turret: 12 ballistic per 1,0 s op 12 m; schema verplicht de velden bij provides turret |

## hud (werkstroom 5)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| Een potje tegen de AI is volledig speelbaar zonder console | deels | Martien speelde op 14 oktober op de oude map; daarna zijn de kaarten, de eenhedenbalk, de klikmarge en nu de dominantie-teller gebouwd en is de map vervangen. Na die wijzigingen heeft nog geen mens gespeeld. Vraagt Martien: een potje uit de HUD (testsessie) |
| Elke actie heeft een sneltoets | groen | packages/ui/src/controller.ts ACTIONS, perks F1 tot F3, abilities Z, X, C, kaarten 1 tot 9 en K |
| De HUD rendert onder 2 ms per frame | groen | hud.sprint2.test.ts (50 geselecteerde units); hud.dominance.test.ts "rendert onder 2 ms per refresh" |
| Minimap met fog en claims, bouwmenu met plaatsing, held-paneel, waarschuwingen, opgeven, desync-melding | groen | packages/ui 0.2.0 en 0.3.0 (CHANGELOG), hud.sprint2 en sprint3 tests |
| Gebouwpaneel met kaarten en eenhedenbalk (speltest 14 oktober) | groen | packages/ui/src/cards.ts en view.ts (hud.cards.test.ts, hud.roster.test.ts); apps/client/src/game/cards.ts en roster.ts; voortgang uit PlayerStatus.queue |
| Dominantie-teller voor winroute B (sectie 17 advies 2, sectie 18 besluit 1) | groen | packages/ui 0.5.0: balk met punten, voortgang en resterende tijd (mm:ss) zodra je genoeg punten hebt; een tegenstander die telt krijgt een waarschuwingsregel met icoon en tekst (niet alleen kleur) en één toast per overgang (alert-soort `dominance`, zonder locatie); progressbar met aria-waarden (hud.dominance.test.ts, 10 tests); apps/client/src/game/dominance.ts vertaalt PlayerStatus.dominance naar seconden en namen en houdt het object stabiel; `T` in de HUD-demo. Nog niet door een mens gezien in een echt potje |
| Stijl volgt de stijlbijbel, tot dan neutraal | groen | er is nog geen stijlbijbel (na gate 1); de HUD is neutraal |

## relay (werkstroom 6)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| Twee browsers op één machine spelen een potje via de relay zonder desync | deels | Reproduceerbaar in het klokvrije harnas met de echte Room, twee echte sims op Rustbelt en de echte BundleFeed (apps/client/test/support/lockstepNet.ts; latency.test.ts en reconnect.test.ts). De echte test met twee browsers over ws is nog geen script. Herhalen in de testsessie, nu op de nieuwe map |
| De loopback geeft dezelfde hashes als de relay | groen | packages/relay/src/equivalence.test.ts |
| Een client die 10 seconden wegvalt komt terug via resync | groen | apps/client/test/reconnect.test.ts; relay-kern in sprint2.test.ts |
| Gesimuleerde latency van 300 ms blijft speelbaar met adaptieve DELAY | groen | apps/client/test/latency.test.ts |
| Desync stopt het potje met een melding en een dump | groen | relay stopt bundels; client dumpt naar IndexedDB; HUD toont de melding |
| Bundels zonder gat, dataVersion over ws | groen | BundleFeed geeft alleen aaneengesloten frames vrij; `pnpm relay` leest data/VERSION, de client weigert elk verschil. In de nachtronde ongewijzigd; PlayerStatus.dominance is een queryveld en raakt bundels en hashes niet |

## map (werkstroom 7)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| De map laadt in sim en render | groen | packages/map loader, simMapFromGrid, renderer.setTerrain (nu met verfijning); props via loadProps |
| Terrein uit een hoogteveld, puntsymmetrisch en deterministisch (sectie 18 besluit 5) | groen | packages/map/src/gen/terrain.ts (integers in centimeters: oriëntatie, naad met smoothstep, stuksgewijze hoogtecurve, klif uit de helling boven 32 graden, opschonen van spikkels, zakken en diagonale lekken), builder.ts (MapSpec.terrain, pads, ruines bovenop het terrein), node.ts (`@crawlout/map/node`); packages/map/test/terrain.test.ts en maps.test.ts (exacte symmetrie, verbondenheid, twee onafhankelijke routes); `pnpm --filter @crawlout/map gen` schrijft data/maps/rustbelt*.json |
| Passability klopt met wat je ziet | open, vraagt Martien | visuele controle in de client: kliffen komen nu uit de helling van het terrein en render tekent een verfijnd oppervlak, dus een unit die over een klifrand loopt of een pad dat dicht zit, is een mapfout; de greybox kleurt op helling en hoogte; niet door een test te vangen |
| Een tweede map toevoegen is alleen data | groen | testmap (ruis) en rustbelt (terrein) komen uit dezelfde generator en loader; een tweede terreinmap is een MapSpec plus een hoogteveld |
| Dominantie-venster van Rustbelt XL | groen, mapkeuze open | 3 van 5 punten gedurende 8 minuten (map 0.6.0, maps.test.ts); 23 van 33 potjes AI tegen AI beslissen erop; sim-core stelt 9 minuten voor (sectie 19 besluit 12, voor Martien) |
| Claimpunten liggen bij de nodes die exclusief moeten worden (besluit 9) | groen | settlement-punten (86,24) en (41,103), 4 m van de 2500-nodes (86,28) en (41,99), binnen claimRadiusM 6, met plek voor een claimpaal (maps.test.ts); in s2-rustbelt-ai-vs-ai claimen beide AI's hun eigen punt eerst. Kanttekening: het punt ligt 56 m van het hoofdgebouw (sectie 18 besluit 5, vraagt Martien na de testgroep) |
| Scrap-nodes, claimpunten, spawns, creep-kampen; decoratieve props | deels | nodes, claimpunten en spawns werken; 7904 props puntsymmetrisch met kits bij kampen en voordes en geen props op de bouwvlakken; creep-kampen staan in de data maar niet in de sim (na gate 1) |

## Determinisme en CI (fase-0 sectie 7)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| CI draait lint, typecheck, tests en de replay-set op elke PR | groen in de repo, niet gedraaid | .github/workflows/ci.yml; deze commits zijn lokaal groen (lint, typecheck, 628 tests, 8 fixtures) maar nooit op GitHub gedraaid: sprint-1 is niet gepusht |
| Wekelijkse replay-set in Chromium, Firefox en WebKit | deels | browsers.yml installeert de browsers en draait `replay:browsers` strict; nooit gedraaid (niet gepusht). Lokaal alleen Chrome en Chromium, en dat vóór de heropnames |
| Handmatige hash-test en WebGPU-meting in Chrome op de MacBook | deels | hash-test: `replay:browsers -- --chrome`, door sim-core gedraaid in de gate-1-ronde (identiek), niet opnieuw na de nieuwe map. WebGPU-meting: render-demo door render-pipeline met gebouwen en terrein (32 tot 42 draw calls, slechtste frame 10,4 ms). Martien hoeft alleen nog de geïntegreerde GPU te meten |
| Benchmark in CI meldt, blokkeert niet | groen | ci.yml stap "Benchmark (meldt, blokkeert niet)"; lokaal 0,267 ms |
| Prettier | deels | `prettier --check .` op arch-xl: 52 bestanden niet conform (was 53), vooral gegenereerde JSON (tools/replay/fixtures, data/maps), tsconfig, lockfile, READMEs en docs; lint is overal groen. Mag (bulk): een .prettierignore voor gegenereerde JSON, dan de rest opmaken |

## Open in de repo (mag, geen blokkade; zie fase-0 sectie 15 tot 18)

| Werkstroom | Punt |
| --- | --- |
| hud en client | het commentaar bij DominanceView.leader gelijktrekken met het protocol (packages/ui/src/types.ts); randscroll op window scrollt mee bij een klik op een HUD-paneel in de randstrook. De DEV-gating van assets/dist-local is gedaan |
| sim-core | `upgradeOne` trekt militie uit een lopende golf; `raidOver` herkent een raid aan het claimpunt-coördinaat; turretAim overschrijft het hele flags-byte; events van overgeslagen ticks vervallen; bench tick 0 apart melden |
| replay | match-length.test.ts (vijf potjes van ruim 30 minuten) buiten de snelle testlus |
| render-pipeline | `albedoGain` naar het manifest of weg; de no-op pow in teamAlbedo; rockTerrain.ts in de demo vervangen door de greybox van de map; de cull-bol van een held is niet met HERO_SCALE vergroot |
| asset-cli | `scale` per prop in rigmap.json; de rigmap bevat DEF- en UE-namen in één rig; `albedoGain` als manifest-veld als render het wil |
| map | gains van de hoogtecurve in promille (sectie 18 besluit 5); creep-kampen in de sim (na gate 1) |
| content | rallyPoint uit ai/*.json en het schema bij de volgende bump; meetresultaten uit de `_comment`-regels naar de CHANGELOG |
| relay | het harnas tikt de sim direct, niet via SimWorkerCore.pump; `startRelayServer` zonder dataVersion meldt '0'; `BundleFeed.gapAt` is ongebruikt; de twee-browsers-test over ws als script |
| bulk | .prettierignore voor gegenereerde JSON (fixtures, data/maps) en Prettier over de overige 52 bestanden |

## Open, vraagt Martien

1. De meting op een laptop met geïntegreerde GPU (60 fps, onder 150 draw calls, geen frame boven 20 ms) op Rustbelt XL met alle props; bij een tegenvaller `?detail=0` en het prop-budget.
2. Een potje tegen de AI op Rustbelt XL uit de HUD, met de visuele passability-controle (kliffen, water, voordes).
3. sprint-1 pushen en de PR naar main openen (ci.yml, browsers.yml); lokaal `playwright install` en `replay:browsers -- --chrome` op data 0.14.0.
4. De testgroep en de eerste sessie: potje tegen de AI, potje met twee browsers over `pnpm relay` met een reload.
5. Mapkeuzes na de testgroep: het dominantie-venster (8 of 9 minuten) en het tempo op de grote map. Geen screenshots met fanart delen.

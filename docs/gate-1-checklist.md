# Gate-1-checklist

Oct 15, 2026 · architect, na de review van de nachtronde (branch sprint-1 van de merge van arch-day, commit 53e025b, tot en met commit a4f0975, beoordeeld op arch-night met protocol 0.7.0; vorige versies na de balans-ronde, commit bd4bbbb, de gate-1-ronde, commit a1fcc3e, en de slice-ronde, commit 6e198a0).

## Samenvatting: is dit een gate-1-kandidaat?

**Ja, technisch.** Alles wat in de repo groen kan zijn, is groen met bewijs: de slice speelt van begin tot winst tegen de AI op Rustbelt over beide winroutes, nu allebei met bewijs op de slice-map (vernietiging in vier van de vijf seeds van match-length.test.ts en in s4-rustbelt-turrets; dominantie in seed 99 en in de fixture s6-rustbelt-dominance, waarin een bot het midden tegen de raids van de echte AI houdt), met held, claims die nodes exclusief maken, research, craft, oplappen en turrets die schieten; het brief-eindcriterium van sim-core (50 bewoners per kant) staat als fixture; de netcode-eindcriteria (300 ms latency met adaptieve DELAY, 10 s wegval met resync) zijn reproduceerbare tests; `replay:browsers` is echt; de drie reviewgates zijn in vijf rondes gepasseerd (fase-0 sectie 12 tot 18). Nieuw sinds de balans-ronde: Rustbelt is terrein uit Rock Terrain 4 (CC-BY, puntsymmetrisch gemaakt, tafelberg in het midden, dominantie 2 van 3 punten gedurende 8 minuten, het besluit van Martien); de acht Dweller-gebouwen zijn echte assets uit een CC-BY-huisje, getekend met één texture-array en een bouwvoortgang in de shader; het terrein heeft een rots-en-stofmateriaal met een render-only verfijning van 0,5 m; de HUD toont een dominantie-teller met een waarschuwing en toast zodra de tegenstander telt (PlayerStatus.dominance, protocol 0.7.0); de AI claimt eerst aan de eigen kant en raidt met een bouwer; potjes duren 30,2 tot 32,9 minuten over vijf seeds (Spelfundament 2.6: 25 tot 35). Lokaal op arch-night: lint, typecheck, 628 tests, 8 fixtures, bench 0,267 ms per tick. Daarnaast, buiten git: een lokale asset-buis voor fanart (assets/local naar assets/dist-local, met retargeting van de Quaternius-clips), alleen op de eigen machine.

**Nee, nog niet als gate.** Gate 1 zelf (Spelfundament 12) valt pas als de testgroep heeft gespeeld; dat kan geen agent doen. Alles wat met de GPU en de browser te maken heeft is alleen op de MacBook in Chrome gezien, en de render is zwaarder geworden (32 tot 42 draw calls en een slechtste frame van 10,4 ms, tegen 25 en 4,5 ms in de balans-ronde): een laptop met geïntegreerde GPU, Firefox en WebKit hebben nog nooit een frame of een hash geproduceerd, en CI heeft deze commits nooit gezien: de branch is niet gepusht.

**De vijf dingen die Martien zelf moet doen (volgorde van gewicht):**

1. **Lokale buis en IP.** Tot de glob op assets/dist-local achter `import.meta.env.DEV` staat (fase-0 sectie 18, besluit 4): bouwen en pushen alleen zonder assets/dist-local; nooit een screenshot met fanart delen. `git ls-files | grep -i "local\|fanart"` moet alleen tools/asset-cli/test/local.test.ts geven.
2. **Geïntegreerde GPU.** De render-demo (`?n=200&b=40`, met gebouwen als assets, 200 props en Rock Terrain 4) en de client op een laptop met geïntegreerde GPU, op netstroom: doel 60 fps, onder 150 draw calls, geen frame boven 20 ms bij een camera-draai. Op de MacBook is het 32 tot 42 draw calls en nooit boven 10,4 ms. Bij een tegenvaller: `?detail=1` (terreinverfijning uit) en `?buildings=ph` (placeholders) om te zien wat het kost.
3. **Browsers en CI.** Eenmalig `pnpm --filter @crawlout/replay exec playwright install chromium firefox webkit`, dan `pnpm --filter @crawlout/replay run replay:browsers -- --chrome` (de hash-test in drie browsers plus Chrome, nu met de nieuwe map en de 8 fixtures); sprint-1 pushen zodat ci.yml en browsers.yml draaien.
4. **Testgroep.** Vijf tot acht mensen; eerste sessie met een potje tegen de AI vanuit de HUD zonder console (met de dominantie-teller, de gebouwen en het terrein), één potje met twee browsers over `pnpm relay` met een reload halverwege (resync), en de visuele passability-controle op de nieuwe Rustbelt. Martien speelde op 14 oktober op de oude map; op de nieuwe heeft nog geen mens gespeeld.
5. **Mapgevoel.** Het settlement-punt ligt nu 56 m van het hoofdgebouw, even ver als het midden; de natuurlijke expansie op 16 m is niet claimbaar (fase-0 sectie 18, besluit 5). Een ontwerpkeuze na de testgroep, geen blokkade.

Gate 1 is de harde stop na fase 1 (Spelfundament sectie 12): de slice is 1 factie (Dwellers), 1 held (Krijger), 1 map (Rustbelt), 2 winroutes (vernietiging, dominantie), tegen AI; de renderbuis is bewezen met placeholders; de drie reviewgates (sim, netcode, shader) zijn gepasseerd; de testgroep heeft gespeeld. Status: groen (bewijs in de repo), deels (werkt, maar het criterium is niet volledig of niet reproduceerbaar aangetoond), open (ontbreekt). "Open, vraagt Martien" is wat alleen op een laptop met geïntegreerde GPU, met geïnstalleerde browsers of met de testgroep is af te vinken. "Gezien in Chrome" betekent: door de hoofdsessie in Chrome op de MacBook, niet in een andere browser of op andere hardware. Commando's lopen vanaf de repo-root.

## Slice-definitie (Spelfundament 12, 11, 7)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| Eén factie: Dwellers | groen | data/factions.json; render, HUD en sim lezen de factie uit start.players |
| Eén held: Krijger (Opziener) met 7 SPECIAL, xp, perks, Lockdown, oplappen | groen | packages/sim/src/systems/hero.ts, data/heroes.json; HeroStatus volledig (packages/sim/test/hero.test.ts); fixtures s3-rustbelt-hero-claims en s4-rustbelt-turrets (Lockdown, dood, oplappen); HUD held-paneel leest state en cooldowns |
| Eén map: Rustbelt, 128 bij 128 m, 2 spelers, 6 nodes, 3 claimpunten | groen | data/maps/rustbelt.json (data 0.10.0): terrein uit het hoogteveld van Rock Terrain 4 (assets/dist/terrain), puntsymmetrisch (180 graden, exact; packages/map/test/maps.test.ts), bases op een terras, tafelberg met het powerArmor-punt in het midden, drie routes; dominantie 2 van 3 punten gedurende 8 minuten; laadt in sim (alle Rustbelt-fixtures) en render (client) |
| Winroute A, vernietiging | groen | packages/sim/src/systems/claims.ts winRoutes; gameplay-tests; fixture s4-rustbelt-turrets eindigt met een aanval op het settlement-punt van de AI; vier van de vijf seeds in match-length.test.ts |
| Winroute B, dominantie | groen | Simregel: gameplay.test.ts "winroute B". Op de slice-map: fixture s6-rustbelt-dominance (bot tegen de echte AI, de bot houdt zijn settlement-punt en het midden met twee turrets, de AI raidt het midden en schiet, winst op dominantie in frame 12910; tools/replay/src/slice.test.ts controleert per tick ook PlayerStatus.dominance) en seed 99 in match-length.test.ts (dominantie op 32,7 minuten); de test eist beide winroutes met één of twee keer dominantie van de vijf |
| Skirmish tegen de scripted AI, lokaal via loopback | groen | apps/client/src/game/session.ts (LoopbackRelay); de AI bouwt, onderzoekt, bouwt turrets, claimt eerst aan de eigen kant, verdedigt, raidt met een bouwer die claimt, valt aan met held en Lockdown |
| Alles buiten de slice afgewezen (Raiders, Garde, winroute C, survival) | groen | niets daarvan in data of code; MatchSettings.mode 'survival' bestaat alleen als enum-waarde |
| Drie reviewgates: sim, netcode, shader | groen | architect-reviews sprint 1 tot 4, de dag-, balans- en nachtronde (docs/CHANGELOG.md, fase-0 sectie 12 tot 18); nachtronde: sim merge, netcode merge (relay ongewijzigd, PlayerStatus.dominance verplicht in protocol 0.7.0), shader merge (texture-array voor de gebouwen, terreinmateriaal met verfijning; sectie 18 besluit 7) |
| Elke sim-wijziging levert een replay met hashes; afwijking blokkeert | groen | tools/replay/fixtures (8 fixtures, alle opnieuw opgenomen op data 0.10.0: s2-rustbelt-ai-vs-ai 38427 frames, s4-rustbelt-fifty 25002, s4-rustbelt-turrets 20000, s6-rustbelt-dominance 12931 nieuw); tools/replay/src/replay.test.ts (verse run gelijk aan de opgeslagen hashes, serialize/deserialize op frame 137 en halverwege); .github/workflows/ci.yml draait `pnpm replay` |
| Stats.js of eigen meting in elke build | groen | packages/render perf-overlay (fps, ms, draw calls), in de client verplaatst zodat hij de dominantie-balk niet overlapt |
| Renderbuis bewezen met placeholders (voorwaarde voor de artistkeuze) | groen, gezien in Chrome | assets/src bevat de Quaternius-mannequin, tien Gobkit-props en het CC-BY-huisje (licenties in assets/src/licenses); `pnpm assets` levert assets/dist/manifest.json met 19 assets (1 character, 10 props, 8 buildings) en validation-report.json; render laadt het karakter uit loadout.visuals.meshSlots.body, de props uit de map en de gebouwen uit buildings.json visuals.mesh (packages/render/src/structures/buildingAssets.test.ts, structures.test.ts "draws a building type with its asset"); het terrein uit assets/dist/terrain/terrain.json (terrainTextures.test.ts). De hoofdsessie zag karakter, props, gebouwen en het terrein in de render-demo en de client, in Chrome op de MacBook. Niet gezien: een geïntegreerde GPU, Firefox, WebKit |
| Eerste sessie met de testgroep (integratiemoment 2) | open, vraagt Martien | testgroep van 5 tot 8 mensen is nog niet samengesteld (Spelfundament 13, open) |

## sim-core (fase-0 sectie 9, werkstroom 1)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| 50 bewoners per kant verzamelen, bouwen, wisselen van rol en vechten op de slice-map | groen | fixture s4-rustbelt-fifty (25002 frames op de nieuwe Rustbelt, opgenomen met de bot in tools/replay/src/bot.ts, afgespeeld zonder bot): beide kanten halen 50 bewoners uit huisvestingsgroei binnen de pop-cap (tools/replay/src/slice.test.ts) |
| Replay-set draait identiek in Node en in drie browsers | deels | `replay:browsers` is echt (tools/replay/src/browsers.ts). Lokaal identiek in Chrome 155 en Chromium 147 (gate-1-ronde; na de heropnames op data 0.8.0, 0.9.0 en 0.10.0 niet opnieuw in de browser gedraaid); Firefox en WebKit zijn niet geïnstalleerd en dus nooit gedraaid. browsers.yml draait strict, maar de branch is niet gepusht. Vraagt Martien (samenvatting, punt 3) |
| Benchmark 200 units onder 5 ms per tick | groen | `pnpm bench` op arch-night: 0,267 ms gemiddeld, 3,71 ms maximaal (balans-ronde 0,305; CI meldt) |
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
| Potjelengte 25 tot 35 minuten (Spelfundament 2.6) | groen bij AI tegen AI | tools/replay/src/match-length.test.ts: vijf seeds, 30,2 tot 32,9 minuten, scrap-piek onder 600, held minstens level 2, beide winroutes; `pnpm --filter @crawlout/replay balance` voor de meting. Met een mens aan de knoppen nog niet gemeten |

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
| 200 geanimeerde units plus 40 gebouwen op 60 fps, onder 150 draw calls, geen frame boven 20 ms bij een camera-draai | deels | Gemeten op de MacBook (M3 Pro, netstroom, 120 Hz) met het echte karakter, 40 gebouwen als assets, 200 props en Rock Terrain 4 verfijnd (131k driehoeken), camera-draai over 6 s (render CHANGELOG 0.6.0): WebGPU 32 tot 42 draw calls inclusief schaduwpass, 120 fps, mediaan 8,3 ms, slechtste frame 10,4 ms; WebGL2 gelijk, met één opwarm-hapering van 50 ms bij de eerste draai. Zwaarder dan de balans-ronde (25 draw calls, 4,5 ms). Op een laptop met geïntegreerde GPU: open, vraagt Martien (knoppen: `?detail=1`, `?buildings=ph`) |
| Een Quaternius-asset vervangen door een ander GLB uit het manifest kost nul regels code | groen, gezien in Chrome | Units: loadout.visuals.meshSlots.body (`?unit=` in de demo), bindingen via `assets.bind`. Gebouwen: buildings.json visuals.mesh wijst naar het manifest; een ander GLB is een andere variant in assets/src/buildings/variants.json. Kanttekening: de maat van een prop staat nog per asset-id in render (propFit.ts), sectie 16 besluit 6 |
| Bone-matrix-formaat uit sectie 12 wordt gelezen | groen | units/bakedManifest.ts valideert het manifest tegen `ANIM_NAMES`; characterFit in de skin-matrices; het echte `dweller_body_human.anim.f32` laadt |
| Decoratieve props uit de map (sectie 16 besluit 3 en 7) | groen, gezien in Chrome | props/propLayer.ts en verwanten; 200 props op de nieuwe Rustbelt (edgeMargin 3: bomen en rotsen op de kliffen en ruines, niet op de map-rand) |

## asset-cli (werkstroom 3)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| Alle Quaternius-placeholders en 10 Gobkit-props door de buis met één commando | groen | `pnpm assets` over assets/src: dweller_body_human (character), tien props en acht gebouwen in assets/dist/manifest.json (19 assets), drie LOD-GLB's per asset, `dweller_body_human.anim.f32`, validation-report.json (deterministisch). Conform-stap uit assets/src/rigmap.json en clipmap per asset |
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
| Dominantie-venster van Rustbelt | groen | 2 van 3 punten gedurende 8 minuten (besluit Martien, map 0.5.0, maps.test.ts); AI tegen AI beslist het in één van de vijf seeds, een bot die het midden houdt wint erop (s6) |
| Claimpunten liggen bij de nodes die exclusief moeten worden (besluit 9) | groen | settlement-punten (86,24) en (41,103), 4 m van de 2500-nodes (86,28) en (41,99), binnen claimRadiusM 6, met plek voor een claimpaal (maps.test.ts); in s2-rustbelt-ai-vs-ai claimen beide AI's hun eigen punt eerst. Kanttekening: het punt ligt 56 m van het hoofdgebouw (sectie 18 besluit 5, vraagt Martien na de testgroep) |
| Scrap-nodes, claimpunten, spawns, creep-kampen; decoratieve props | deels | nodes, claimpunten en spawns werken; props opnieuw verspreid op de nieuwe map (200, puntsymmetrisch, edgeMargin 3); creep-kampen staan op de route in de data (maps.test.ts) maar niet in de sim. Na gate 1 (sectie 15, besluit 9) |

## Determinisme en CI (fase-0 sectie 7)

| Criterium | Status | Bewijs of wat ontbreekt |
| --- | --- | --- |
| CI draait lint, typecheck, tests en de replay-set op elke PR | groen in de repo, niet gedraaid | .github/workflows/ci.yml; deze commits zijn lokaal groen (lint, typecheck, 628 tests, 8 fixtures) maar nooit op GitHub gedraaid: sprint-1 is niet gepusht |
| Wekelijkse replay-set in Chromium, Firefox en WebKit | deels | browsers.yml installeert de browsers en draait `replay:browsers` strict; nooit gedraaid (niet gepusht). Lokaal alleen Chrome en Chromium, en dat vóór de heropnames |
| Handmatige hash-test en WebGPU-meting in Chrome op de MacBook | deels | hash-test: `replay:browsers -- --chrome`, door sim-core gedraaid in de gate-1-ronde (identiek), niet opnieuw na de nieuwe map. WebGPU-meting: render-demo door render-pipeline met gebouwen en terrein (32 tot 42 draw calls, slechtste frame 10,4 ms). Martien hoeft alleen nog de geïntegreerde GPU te meten |
| Benchmark in CI meldt, blokkeert niet | groen | ci.yml stap "Benchmark (meldt, blokkeert niet)"; lokaal 0,267 ms |
| Prettier | deels | `prettier --check .` op arch-night: 53 bestanden niet opgemaakt (was 99 in de balans-ronde), vooral packages/sim, tools/replay, data/ en docs/; lint is overal groen |

## Open in de repo (mag, geen blokkade; zie fase-0 sectie 15 tot 18)

| Werkstroom | Punt |
| --- | --- |
| hud en client | (moet vóór een build die het huis verlaat) de glob op assets/dist-local achter `import.meta.env.DEV` (sectie 18 besluit 4); het commentaar bij DominanceView.leader gelijktrekken met het protocol; randscroll op window scrollt mee bij een klik op een HUD-paneel in de randstrook |
| sim-core | `upgradeOne` trekt militie uit een lopende golf; `raidOver` herkent een raid aan het claimpunt-coördinaat; `findThreat` O(units × gebouwen); turretAim overschrijft het hele flags-byte; de AI laat zijn bouwvolgorde wachten op een onbetaalbare tech; events van overgeslagen ticks vervallen bij inhalen |
| replay | match-length.test.ts (vijf potjes van ruim 30 minuten) buiten de snelle testlus |
| render-pipeline | apps/client/src/render/rockTerrain.ts vervangen door de greybox van de map; de prop-blobs vallen stil weg als de decal-batch vol is; de cull-bol van een held is niet met HERO_SCALE vergroot; prop-maat naar de asset-buis (sectie 16, besluit 6) |
| asset-cli | koptekst van heightfield.ts (map importeert het niet); PRESERVED_DIST_ENTRIES onder de imports in build.ts; `scale` per prop in rigmap.json; de rigmap bevat DEF- en UE-namen in één rig |
| map | gains van de hoogtecurve in promille (sectie 18 besluit 5); creep-kampen in de sim (na gate 1) |
| content | rallyPoint uit ai/*.json en het schema bij de volgende bump; meetresultaten uit de `_comment`-regels naar de CHANGELOG |
| relay | het harnas tikt de sim direct, niet via SimWorkerCore.pump; `startRelayServer` zonder dataVersion meldt '0'; `BundleFeed.gapAt` is ongebruikt; de twee-browsers-test over ws als script |
| bulk | Prettier over sim, replay, data/ en docs/ (53 bestanden) |

## Open, vraagt Martien

1. De lokale buis: bouwen en pushen alleen zonder assets/dist-local tot de DEV-gating er is; nooit een screenshot met fanart delen.
2. De render-demo en de client op een laptop met geïntegreerde GPU, op netstroom (60 fps, onder 150 draw calls, geen frame boven 20 ms); bij een tegenvaller `?detail=1` en `?buildings=ph`.
3. `playwright install chromium firefox webkit` en `replay:browsers -- --chrome`; sprint-1 pushen zodat ci.yml en browsers.yml draaien.
4. De testgroep en de eerste sessie: potje tegen de AI uit de HUD (met dominantie-teller, gebouwen en terrein), potje met twee browsers over `pnpm relay` met een reload, en de visuele passability-controle op de nieuwe Rustbelt.
5. Het mapgevoel van het settlement-punt op 56 m (sectie 18 besluit 5): een ontwerpkeuze na de testgroep.

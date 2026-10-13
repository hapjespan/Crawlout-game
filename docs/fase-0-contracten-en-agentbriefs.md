# Fase 0: Contracten en agentbriefs (Wasteland RTS)

Oct 13, 2026 · @Martien

## 1. Doel en gebruik

Dit document is het werkcontract voor Claude Code: drie vastgezette contracten plus een brief per werkstroom, zodat zeven subagents parallel kunnen bouwen zonder elkaar te blokkeren. Het ontwerp zelf staat in het [Spelfundament v0.1](https://claude.ai/code/artifact/9fc584bb-560f-4342-8a79-ef1c2d2d8097).

1. Elke agent leest sectie 1, 3, 7 en zijn eigen brief in sectie 9. De contracten (4 tot 6) leest hij alleen waar zijn brief ernaar verwijst.
2. De contracten zijn bevroren. Een wijziging aan een contract is een pull request op dit document met Fable-review, nooit een stille aanpassing in code.
3. Elke werkstroom levert in zijn eigen package en raakt geen ander package aan. Gedeelde types staan in packages/protocol en packages/data.
4. Fase 0 is klaar als: de repo staat, de drie contracten als TypeScript-types en JSON-schema's in packages/protocol en packages/data liggen, de lint-regels uit sectie 7 draaien, en de CI groen is op een lege simulatie.
5. Buiten fase 0: balans, art, netwerk-optimalisatie, Raiders en Garde. Alleen de Dwellers-slice.

## 2. Architectuur

Vier delen met drie contracten ertussen: de sim-worker rekent, de main thread toont en stuurt, de relay ordent, de data voedt.

&#91;embedded content: architectuur · sim-worker, main thread, relay, data\]

Commando's gaan van de HUD via het netwerk naar de relay en komen als frame-bundel terug bij elke speler; pas dan voert de sim ze uit. De renderer ziet alleen snapshots, nooit sim-state, zodat render en sim onafhankelijk van elkaar te vervangen zijn. Lokaal spelen vervangt de relay door een loopback in het geheugen, met dezelfde berichten.

## 3. Repo-structuur en stack

Eén pnpm-monorepo in TypeScript strict. De simulatie is een pure package zonder DOM of three.js, zodat hij in een Web Worker, in Node (tests, replays) en later op een server draait.

| Package | Inhoud | Mag importeren uit | Werkstroom |
| --- | --- | --- | --- |
| packages/sim | Lockstep-kern: ECS, fixed-point, flow fields, gevecht, economie, winroutes, hash, serialisatie | protocol, data | 1 |
| packages/protocol | Gedeelde types en zod-schema's: commando's, frames, snapshots, lobby-berichten | niets | 0 |
| packages/data | JSON-content (facties, loadouts, gebouwen, tech, helden, maps) plus zod-validatie en loader | niets | 4 |
| packages/render | three.js WebGPU-renderer, TSL-materialen, instanced skinning, LOD, camera, VFX-koppeling | protocol, data | 2 |
| packages/ui | HUD als Preact-overlay: minimap, tellers, selectiepaneel, commandokaart | protocol, data | 5 |
| packages/relay | Node-relay op ws: lobby, rooms, frame-bundeling, hash-vergelijking, resync | protocol | 6 |
| packages/map | Terreintegels, passability-bitmap, scrap-nodes, claimpunten, de slice-map | protocol, data | 7 |
| apps/client | Vite-app die sim-worker, render, ui en een loopback- of ws-relay samenbrengt | alles | 2 en 5 samen |
| tools/asset-cli | GLB in, meshopt plus KTX2 plus 3 LODs plus animatietextures plus manifest uit | niets | 3 |
| tools/replay | Headless replay-runner: speelt een command-log af en vergelijkt hashes | sim, protocol, data | 1 |

Stack en afspraken:

1. Node 22 LTS, pnpm, TypeScript strict, ESM overal. Versies gepind in package.json; three.js op de nieuwste stabiele release met WebGPURenderer, gepind bij de eerste commit.
2. Tests: vitest per package, Playwright voor de client vanaf sprint 2. CI op GitHub Actions met GitHub-hosted runners (ubuntu-latest); draait lint, typecheck, tests en de determinisme-replay op elke pull request.
3. Lint: ESLint met een eigen regelset voor packages/sim (sectie 7). Prettier voor opmaak.
4. Scripts op root: dev (client plus loopback), relay (Node-relay), replay (headless), assets (asset-cli over assets/src), bench (sim-benchmark 200 units, 10.000 ticks).
5. Mappen voor content: assets/src (bronbestanden, GLB en PNG), assets/dist (uitvoer van de asset-cli, gecommit), data/ (JSON, eigenaar werkstroom 4).
6. Branching: main is altijd groen en speelbaar. Een branch per werkstroom, pull requests klein, één onderwerp per PR.

## 4. Contract 1: simulatie en snapshotformaat

De sim is een pure functie van (seed, data, commando's per tick) naar state. Twee clients met dezelfde invoer produceren dezelfde state-hash op elke tick, in elke browser.

**Tijd en getallen**

1. Tick: 20 Hz, TICK\_MS = 50, één constante in packages/sim. De eerste benchmark bevestigt of dit blijft.
2. Fixed-point: alle wereldcoördinaten in integers, 1 meter = 256 eenheden (8 fractiebits). Snelheden in eenheden per tick, afstanden in eenheden, tijden in ticks. Nooit meters of seconden in de sim.
3. Rekenen: alleen integer-optellen, -aftrekken, -vermenigvuldigen en integer-delen via Math.trunc. Tussenresultaten blijven onder 2^53. Math.imul alleen waar 32-bit wrap bedoeld is (RNG, hash).
4. Hoeken: 0 tot 65535 (uint16). Sinus en cosinus uit een tabel van 1024 integers. Wortel via integer-Newton. Geen Math.sin, Math.sqrt, Math.pow.
5. RNG: xorshift32 met Math.imul, één stream per sim, seed uit de lobby. Nooit Math.random.

**ECS**

1. Entity-id: uint32 met generatie-bits, hergebruik via vrije lijst. Alle componenten als typed arrays (SoA), vooraf gealloceerd op MAX\_ENTITIES = 4096.
2. Componenten voor de slice: Transform (x, y, yaw), Movement (speed, flowFieldId), Health (hp, maxHp, armorType), Owner, Unit (bodyType, loadoutId, role), Orders (ringbuffer van 4), Target, Combat (cooldown, damage, damageType, range), Building (typeId, progress), ResourceNode (amount), Housing (beds), Claim (owner, progress), Hero (SPECIAL als 7 bytes, level, xp, perks als bitset).
3. Systeemvolgorde per tick, vast: 1 commando's van deze tick toepassen, 2 orders en AI, 3 flow fields (gebudgetteerd: maximaal N cellen per tick), 4 beweging plus separatie, 5 gevecht, 6 economie (verzamelen, bouwen, huisvestingsgroei, tribute), 7 claims en winroutes, 8 dood en opruimen, 9 hash.
4. Iteratie altijd op oplopende entity-id. Sorteren altijd met een tiebreak op id.
5. Volledige state is serialiseerbaar naar één ArrayBuffer en terug (nodig voor resync en replays). Serialize gevolgd door deserialize levert dezelfde hash.

**State-hash**

1. FNV-1a 32-bit over alle componentarrays in vaste volgorde, plus tick en RNG-state. Elke tick berekend, elke 20 ticks naar de relay gestuurd.

**Snapshot sim naar render**

1. Na elke tick post de worker één transferable ArrayBuffer. Header: tick (uint32), hash (uint32), entityCount (uint16), eventCount (uint16).
2. Per entity, SoA: id uint32, typeId uint16, owner uint8, x int32, y int32, yaw uint16, anim uint8, animT uint16 (0 tot 65535 is 0 tot 100% van de clip), hpPct uint8, flags uint8 (selected, dead, carrying, inCombat).
3. Events voor VFX en audio: type uint8, a uint32, b uint32, x int32, y int32. Types: spawn, death, shotFired (a is schutter, b is doel), hit, buildingPlaced, buildingDone, claimTaken, resourceDepleted, heroLevel.
4. De renderer interpoleert tussen de laatste twee snapshots en loopt één tick achter. De renderer leest nooit sim-state direct.
5. Spelerstatus (scrap, bewoners, pop, selectie-details, held-stats) gaat apart via een queryMessage op verzoek van de UI, niet in elke snapshot.

**AI in de slice**

1. Eén scripted tegenstander als Dwellers: bouwvolgorde uit een JSON-script, verzamelt, bouwt, valt aan op een timer. Geen leren, geen cheats. Goed genoeg om de loop te testen.

## 5. Contract 2: commandoprotocol

De relay simuleert niets. Hij ordent commando's in frames, verspreidt ze naar alle spelers en vergelijkt hashes. Lokaal skirmish gebruikt exact dezelfde weg via een loopback-relay in het geheugen.

**Commando**

1. Vorm: { frame, playerId, seq, type, payload }. Alle velden integers of korte strings, zod-schema in packages/protocol. JSON in fase 1, binair pas als het meetbaar nodig is.
2. Types in de slice: Move, AttackMove, Attack, Stop, Gather, Build (typeId, x, y), Cancel, SetRole (scavenger, builder, militia), Craft (loadoutId), Research (techId), Recruit, Claim, HeroAbility (abilityId, x, y, target), PickPerk (perkId), Surrender.
3. Elk commando bevat de entity-ids waarop het werkt, maximaal 64 per commando. De sim valideert elk commando (eigenaar, kosten, bereik) en negeert ongeldige stilzwijgend.

**Lockstep**

1. Frame = één tick. Een commando dat de speler geeft in frame f, voert de sim uit in frame f + DELAY. DELAY = 4 frames (200 ms) bij de start, later adaptief tussen 2 en 8 op basis van gemeten latency.
2. De relay bundelt per frame: { frame, commands: \[...\] } en stuurt de bundel naar alle spelers, ook een lege. Een client voert frame f pas uit als de bundel voor f binnen is.
3. Ontbreekt een bundel langer dan 2 seconden, dan pauzeert de sim en toont de UI wie er wacht. De relay stuurt bundels in volgorde, nooit met een gat.

**Hash en desync**

1. Elke client stuurt { frame, hash } elke 20 frames. De relay vergelijkt zodra alle spelers dezelfde frame gemeld hebben.
2. Bij afwijking stuurt de relay een desyncEvent met de frame. Elke client dumpt zijn state-serialisatie van die frame naar IndexedDB, zodat de oorzaak achteraf te vergelijken is.
3. In de slice stopt een desync het potje met een duidelijke melding. Later: automatische resync vanaf de meerderheid.

**Reconnect en resync**

1. Een terugkerende client vraagt resync. De relay wijst een peer aan (de speler met de laagste playerId die online is), die zijn volledige state-serialisatie van frame f stuurt plus alle bundels sinds f.
2. De client laadt de state, speelt de bundels versneld af tot hij bij is, en meldt zich weer. Resync in de slice alleen voor lokaal testen; de echte test komt in fase 2 met survival.

**Lobby**

1. Berichten: join (roomId, naam), leave, ready, setFaction, setMap, start (seed, map, players, settings), chat. De relay kiest de seed en stuurt die in start.
2. Rooms zijn in het geheugen van de relay. Geen accounts, geen matchmaking in de slice.

**Replay**

1. Een replay is { dataVersion, seed, map, players, settings, bundles\[\] }. tools/replay speelt hem headless af en vergelijkt de hash per 20 frames met de opgeslagen hashes.
2. Elke pull request op packages/sim draait de vaste replay-set. Een afwijkende hash blokkeert de merge.

## 6. Contract 3: dataschema

Alle spelregels die getallen zijn, staan in JSON onder data/ en nergens in code. Werkstroom 4 is eigenaar van de inhoud, packages/data van de schema's en de loader.

| Bestand | Record | Velden (eenheid) |
| --- | --- | --- |
| factions.json | Factie | id, naam, bodyTypes\[\], startUnits\[\], startScrap, housingGrowthPerMin, safetyNet { threshold, action }, uniqueUnits\[\], uniqueBuildings\[\], specialChannel |
| loadouts.json | Loadout (unit = body plus loadout) | id, faction, bodyType, role, weapon, armorType, hp, damage, damageType, rangeM, speedMps, cooldownTicks, scrapCost, craftTicks, popCost, prereqTech\[\], visuals { meshSlots } |
| buildings.json | Gebouw | id, faction, hp, armorType, scrapCost, buildTicks, footprint { w, h }, beds, provides\[\] (werkplaats, huisvesting, claim, turret, beacon, lab), prereqTech\[\], visuals |
| tech.json | Upgrade | id, faction, scrapCost, researchTicks, building, prereqTech\[\], effects\[\] (stat, target, delta) |
| heroes.json | Held | id, faction, archetype (bouwer, krijger, tacticus), special { S, P, E, C, I, A, L }, abilities\[\], perkPool\[\], reviveScrap, reviveTicks, revivePenaltyPct |
| perks.json | Perk | id, naam, flavourText, requires { stat, min }, effects\[\] |
| damage-matrix.json | Matrix | damageType (ballistic, energy, melee, fire) maal armorType (none, light, medium, heavy, robot) naar multiplier in procenten |
| maps/\*.json | Map | id, size { w, h } in cellen van 1 m, heightmap-ref, passability-ref, scrapNodes\[\] { x, y, amount }, claimPoints\[\] { x, y, kind }, spawns\[\], creepCamps\[\] |
| ai/\*.json | AI-script | bouwvolgorde, aanvalstimers, rallypunten |

Regels:

1. Eenheden in de bestanden zijn menselijk: meters, seconden, procenten. De loader rekent om naar sim-eenheden (256 per meter, ticks) en rondt deterministisch af naar integers. Die omrekening staat op één plek.
2. Elk bestand heeft een zod-schema in packages/data. Ongeldige data laat de build falen. Onbekende velden worden geweigerd.
3. data/VERSION bevat een semver. Die versie zit in elke replay en in de hash-seed, zodat een oude replay nooit stil op nieuwe data draait.
4. Startwaarden voor de Dwellers-slice komen van werkstroom 4 in sprint 1, gemarkeerd als startwaarde, geen balans. Richtlijn: bewoner 60 hp, pipe pistol 8 schade per 1,0 s op 8 m, scavenger haalt 10 scrap per 6 s, woning 4 bedden voor 60 scrap, werkplaats 120 scrap. Alles verandert zodra de testgroep speelt.
5. Visuals in de data verwijzen naar manifest-ids uit assets/dist, nooit naar bestandspaden. De asset-cli (werkstroom 3) genereert het manifest.

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

**Afdwinging**

1. ESLint-regelset sim-determinism in packages/sim: no-restricted-globals en no-restricted-properties voor de lijst hierboven, no-floating-point-typed-arrays als eigen regel, no-restricted-imports voor three en DOM-packages.
2. CI: replay-set draaien in Node. Wekelijks dezelfde set in Chromium, Firefox en WebKit via Playwright op de GitHub-runner, plus handmatig in Chrome op Martiens MacBook voor de WebGPU-meting; afwijkende hashes zijn een P1.
3. Benchmark in CI: 200 units, 10.000 ticks, gemiddelde tick onder 5 ms op de CI-runner. Boven budget blokkeert niet, maar meldt in de PR.

## 8. Agentdefinities

Acht subagents in Claude Code, één per werkstroom plus bulk. Elke agent heeft een vaste scope (packages die hij mag schrijven), een model en een effort-niveau. Dit is de inhoud van .claude/agents/\*.md.

| Agent | Model, effort | Schrijft in | Leest | Review door |
| --- | --- | --- | --- | --- |
| architect | Fable 5.1, hoog | packages/protocol, docs | alles | Martien |
| sim-core | Opus 5.5, hoog | packages/sim, tools/replay | protocol, data | architect |
| render-pipeline | Opus 5.5, hoog | packages/render, apps/client (render-deel) | protocol, data, assets/dist | architect |
| asset-cli | Sonnet 5.5, midden | tools/asset-cli, assets/dist | assets/src | render-pipeline |
| content | Sonnet 5.5, midden | data/, packages/data | protocol, Spelfundament | sim-core, architect steekproef |
| hud | Sonnet 5.5, midden | packages/ui, apps/client (ui-deel) | protocol, data | render-pipeline |
| relay | Sonnet 5.5, midden | packages/relay, apps/client (netwerk-deel) | protocol | architect |
| map | Sonnet 5.5, midden | packages/map, data/maps | protocol, data | sim-core |
| bulk | Haiku 5.5, laag | assets/dist, fixtures, docs-opmaak | alles | niemand, output is mechanisch |

Gedragsregels voor elke agent:

1. Lees eerst sectie 1, 3, 7 en je eigen brief. Vraag bij twijfel over een contract aan architect; wijzig nooit zelf een contract.
2. Werk op je eigen branch, lever kleine pull requests met één onderwerp, met tests en een regel in CHANGELOG.md van je package.
3. Raak geen package aan buiten je scope. Heb je iets nodig uit een ander package, dan maak je een issue met de gewenste interface.
4. Elke PR beschrijft wat getest is en hoe het te zien is (commando, URL, screenshot).
5. Stop hook: een agent sluit zijn taak alleen af met groene CI, anders rapporteert hij wat blokkeert.
6. Tools: bash, bestandsbewerking, tests. Geen netwerkcalls buiten package-installs. Geen secrets in code.

## 9. Briefs per werkstroom

Elke brief: wat je bouwt, waar het op steunt, en wanneer het klaar is. Alles geldt voor de Dwellers-slice.

**sim-core (werkstroom 1)**

1. Bouwt: packages/sim volgens contract 1, tools/replay, de scripted AI, de winroutes vernietiging en dominantie.
2. Steunt op: protocol-types, data-loader, map-passability uit packages/map.
3. Klaar als: 50 bewoners per kant verzamelen, bouwen, wisselen van rol en vechten op de slice-map; replay-set draait identiek in Node en in drie browsers; benchmark 200 units onder 5 ms per tick; serialize en deserialize geven dezelfde hash; lint sim-determinism is groen.

**render-pipeline (werkstroom 2)**

1. Bouwt: packages/render met WebGPURenderer en WebGL2-fallback, TSL toon-ramp-materiaal met teammasker, instanced skinning via bone-matrix textures, 3 LODs per unit, blob-schaduwen, RTS-camera (pan, zoom, rotatie, randscroll), selectie-highlight, snapshot-interpolatie, NixieFX-koppeling voor 4 effecten (mondingsvuur, inslag, bouwstof, dood).
2. Steunt op: snapshotformaat uit contract 1, manifest uit asset-cli, placeholder-humanoids en animaties uit de Quaternius Universal Animation Library (CC0), props uit de Gobkit Nature Kit (CC0).
3. Klaar als: 200 geanimeerde placeholder-units plus 40 gebouwen op 60 fps op een laptop met geïntegreerde GPU, onder 150 draw calls, zonder frame boven 20 ms bij een camera-draai; een Quaternius-asset vervangen door een ander GLB uit het manifest kost nul regels code.

**asset-cli (werkstroom 3)**

1. Bouwt: tools/asset-cli. GLB in; uit: meshopt-GLB, KTX2-textures, 3 LODs via gltfpack, animatieclips gebakken naar bone-matrix textures, manifest.json met ids, boundingboxes en socketposities. Validatierapport per asset tegen de brief uit het Spelfundament (tris, bones, texturemaat, botnamen).
2. Steunt op: niets in code; wel op de artist-brief als norm.
3. Klaar als: alle Quaternius-placeholders en 10 Gobkit-props door de buis lopen met één commando; een asset dat de norm schendt faalt met een leesbare reden; de uitvoer laadt in packages/render zonder handwerk.

**content (werkstroom 4)**

1. Bouwt: packages/data (zod-schema's, loader, omrekening naar sim-eenheden) en data/ voor de Dwellers: factie, 1 body, 4 loadouts (scavenger, bouwer, militie, patrol), 8 gebouwen, 6 upgrades, held Krijger met 7 SPECIAL en 6 perks, damage-matrix, AI-script.
2. Steunt op: Spelfundament secties 2, 4, 5; contract 3.
3. Klaar als: elk bestand valideert; de sim start op deze data; een nieuwe loadout toevoegen is alleen JSON; elke waarde heeft een regel commentaar met de bedoeling.

**hud (werkstroom 5)**

1. Bouwt: packages/ui als Preact-overlay: scrap- en bewonersteller met pop-cap, minimap met fog en claims, selectiepaneel (unit, loadout, hp, rol), commandokaart met sneltoetsen, bouwmenu met plaatsing en footprint-preview, held-paneel (SPECIAL, level, perk-keuze), waarschuwingen (aanval, bewoner verloren, claim verloren), opgeven, desync-melding.
2. Steunt op: queryMessage uit contract 1, commando-types uit contract 2.
3. Klaar als: een potje tegen de AI is volledig speelbaar zonder console; elke actie heeft een sneltoets; de HUD rendert onder 2 ms per frame; stijl volgt de stijlbijbel zodra die er is, tot dan neutraal.

**relay (werkstroom 6)**

1. Bouwt: packages/relay op ws, lobby en rooms, frame-bundeling met DELAY, hash-vergelijking en desyncEvent, resync-protocol, en de loopback-relay in apps/client voor lokaal spelen.
2. Steunt op: contract 2.
3. Klaar als: twee browsers op één machine spelen een potje via de relay zonder desync; de loopback geeft dezelfde hashes als de relay; een client die 10 seconden wegvalt komt terug via resync; gesimuleerde latency van 300 ms blijft speelbaar met adaptieve DELAY.

**map (werkstroom 7)**

1. Bouwt: packages/map met terreintegels, heightmap, passability-bitmap in cellen van 1 m, scrap-nodes, claimpunten, spawns, creep-kampen; de ene slice-map (werknaam Rustbelt, 128 bij 128 m, 2 spelers, 6 scrap-nodes, 3 claimpunten); een greybox-export naar packages/render.
2. Steunt op: contract 3 (maps/\*.json), Procedural Terrains als startpunt, Three Scatter voor props.
3. Klaar als: de map laadt in sim en render; passability klopt met wat je ziet; een tweede map toevoegen is alleen data.

**bulk (Haiku)**

1. Doet: asset-conversies draaien, fixtures genereren, lint-fixes, CHANGELOG en docs opmaken, log-triage bij CI-fouten met een samenvatting voor de verantwoordelijke agent.
2. Klaar als: de taak mechanisch controleerbaar is afgerond. Geen ontwerpkeuzes.

## 10. Sprint 1 en 2

Twee sprints van twee weken naar de eerste geïntegreerde build: Dwellers lopen, verzamelen, bouwen en vechten tegen de AI op één map, via de loopback-relay. Geen datums; de sprint start als fase 0 groen is.

| Werkstroom | Sprint 1 | Sprint 2 |
| --- | --- | --- |
| sim-core | Tick-loop, ECS, fixed-point en tabellen, RNG, hash, serialisatie, beweging plus flow fields op een testmap, replay-runner | Gevecht, economie (verzamelen, bouwen, huisvesting), rolwissel, claims, winroutes A en B, scripted AI, benchmark |
| render-pipeline | WebGPU-scene met fallback, camera, snapshot-interpolatie, 200 Quaternius-units instanced met gebakken animatie op 60 fps | Toon-materiaal met teammasker, LODs, blob-schaduwen, selectie, gebouwen, 4 NixieFX-effecten, draw-call-budget |
| asset-cli | GLB naar meshopt plus KTX2 plus LODs, manifest | Animatiebakken naar textures, validatierapport, socketposities, alle placeholders en props door de buis |
| content | Zod-schema's, loader met omrekening, damage-matrix, Dwellers-factie, body, 4 loadouts | 8 gebouwen, 6 upgrades, held Krijger met perks, AI-script, startwaarden met commentaar |
| hud | Overlay-skelet, tellers, selectiepaneel, commandokaart, sneltoetsen | Minimap met fog en claims, bouwmenu met plaatsing, held-paneel, waarschuwingen, opgeven |
| relay | Lobby, rooms, frame-bundeling, loopback in de client | Hash-vergelijking, desyncEvent, resync, adaptieve DELAY, latency-simulatie |
| map | Terreintegels, passability-bitmap, maps/\*.json, greybox-export | Slice-map Rustbelt met scrap-nodes, claimpunten, spawns, creep-kampen; Three Scatter voor props |
| bulk | Fixtures en placeholder-conversies | Log-triage, CHANGELOGs, docs |

Integratiemomenten:

1. Eind sprint 1: sim-worker stuurt snapshots naar de renderer; 200 units lopen op de testmap. Eerste meting op het prestatiedoel.
2. Eind sprint 2: volledig potje tegen de AI op Rustbelt via loopback. Eerste sessie met de testgroep. Dit is de kandidaat voor gate 1.

## 11. Open punten voor fase 0

Besloten op 13 oktober 2026: repo op GitHub, CI via GitHub Actions op GitHub-hosted runners; placeholders uit Quaternius (de 8 vrije Gobkit-minions hebben 5 bones zonder benen en 240 tris, ongeschikt als humanoid), props uit de Gobkit Nature Kit; de WebGPU-meting en de handmatige hash-test in Chrome op de MacBook, de browsermatrix verder via Playwright op de runner. Er is geen aparte instructieskill: de rolinstructie van het project is de enige instructie, en de agentdefinities in sectie 8 staan op zichzelf; koppeling aan de Agent Workflow Graph gebeurt bij de repo-inrichting.

- [ ] Scaffold pushen naar github.com/hapjespan/Crawlout
- [ ] three.js-versie pinnen bij de eerste commit en WebGPU meten in Chrome op de MacBook
- [ ] Tickrate bevestigen na de benchmark in sprint 1

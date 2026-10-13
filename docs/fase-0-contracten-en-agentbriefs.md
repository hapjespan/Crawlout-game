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
   Yaw-conventie (besluit sprint 1, `YAW_PLUS_X`, `YAW_PLUS_Y` in protocol): 0 kijkt naar sim +x, 16384 naar sim +y; yaw = atan2(dy, dx) geschaald naar 0..65535. De renderer zet sim (x, y) op wereld (x, z); een model dat bij 0 naar wereld +z kijkt en om +y draait, gebruikt radialen = π/2 − yaw · 2π/65536. De sim is de bron; render rekent om.
5. RNG: xorshift32 met Math.imul, één stream per sim, seed uit de lobby. Nooit Math.random.

**ECS**

1. Entity-id: uint32 met generatie-bits, hergebruik via vrije lijst. Alle componenten als typed arrays (SoA), vooraf gealloceerd op MAX\_ENTITIES = 4096. Indeling (besluit sprint 1, `ENTITY_INDEX_BITS`, `ENTITY_GEN_BITS`, `ENTITY_NONE` in protocol): id = index · 2^20 + generatie, index in de hoge 12 bits, generatie 1 tot 2^20 − 1 in de lage 20 bits. Oplopende id is oplopende index; id 0 is nooit een entity.
2. Componenten voor de slice: Transform (x, y, yaw), Movement (speed, flowFieldId), Health (hp, maxHp, armorType), Owner, Unit (bodyType, loadoutId, role), Orders (ringbuffer van 4), Target, Combat (cooldown, damage, damageType, range), Building (typeId, progress), ResourceNode (amount), Housing (beds), Claim (owner, progress), Hero (SPECIAL als 7 bytes, level, xp, perks als bitset).
3. Systeemvolgorde per tick, vast: 1 commando's van deze tick toepassen, 2 orders en AI, 3 flow fields (gebudgetteerd: maximaal N cellen per tick), 4 beweging plus separatie, 5 gevecht, 6 economie (verzamelen, bouwen, huisvestingsgroei, tribute), 7 claims en winroutes, 8 dood en opruimen, 9 hash.
4. Iteratie altijd op oplopende entity-id. Sorteren altijd met een tiebreak op id.
5. Volledige state is serialiseerbaar naar één ArrayBuffer en terug (nodig voor resync en replays). Serialize gevolgd door deserialize levert dezelfde hash.

**State-hash**

1. FNV-1a 32-bit over alle componentarrays in vaste volgorde, plus tick en RNG-state. Elke tick berekend, elke 20 ticks naar de relay gestuurd.
2. De state-header bevat een envHash (besluit sprint 1): FNV-1a over dataVersion, de sim-config, de map en het aantal spelers. Hij zit in elke state-hash, zodat twee clients met andere data of een andere map op frame 0 al verschillen, en deserialize weigert een state met een andere envHash. Dit is de invulling van "dataVersion in de hash-seed" uit contract 3.

**Snapshot sim naar render**

1. Na elke tick post de worker één transferable ArrayBuffer. Header: tick (uint32), hash (uint32), entityCount (uint16), eventCount (uint16). tick is het laatst uitgevoerde frame; hash is de state-hash na dat frame (besluit sprint 1).
2. Per entity, SoA: id uint32, typeId uint16, owner uint8, x int32, y int32, yaw uint16, anim uint8, animT uint16 (0 tot 65535 is 0 tot 100% van de clip), hpPct uint8, flags uint8 (selected, dead, carrying, inCombat). anim-ids (besluit sprint 1, `ANIM` in protocol) volgen de clipvolgorde van de artist-brief: idle 0, walk 1, run 2, attack1 3, attack2 4, gather 5, build 6, death 7. Sim en render gebruiken deze constanten, nooit eigen getallen.
3. Events voor VFX en audio: type uint8, a uint32, b uint32, x int32, y int32. Types: spawn, death, shotFired (a is schutter, b is doel), hit, buildingPlaced, buildingDone, claimTaken, resourceDepleted, heroLevel.
4. De renderer interpoleert tussen de laatste twee snapshots en loopt één tick achter. De renderer leest nooit sim-state direct.
5. Spelerstatus (scrap, bewoners, pop, selectie-details, held-stats) gaat apart via een queryMessage op verzoek van de UI, niet in elke snapshot.

**AI in de slice**

1. Eén scripted tegenstander als Dwellers: bouwvolgorde uit een JSON-script, verzamelt, bouwt, valt aan op een timer. Geen leren, geen cheats. Goed genoeg om de loop te testen.
2. De AI draait in de sim, op elke client (besluit sprint 1). Een AI-speler is een LobbyPlayer met ai = true, zonder verbinding en zonder hash-meldingen. De sim leest de ai-vlag uit het start-bericht en geeft de AI-commando's in systeemstap 2 (orders en AI), met dezelfde validatie als spelerscommando's. Ze gaan niet over de relay en staan niet in de bundels: de replay reproduceert ze uit seed, data en script.

## 5. Contract 2: commandoprotocol

De relay simuleert niets. Hij ordent commando's in frames, verspreidt ze naar alle spelers en vergelijkt hashes. Lokaal skirmish gebruikt exact dezelfde weg via een loopback-relay in het geheugen.

**Commando**

1. Vorm: { frame, playerId, seq, type, payload }. Alle velden integers of korte strings, zod-schema in packages/protocol. JSON in fase 1, binair pas als het meetbaar nodig is.
2. Types in de slice: Move, AttackMove, Attack, Stop, Gather, Build (typeId, x, y), Cancel, SetRole (scavenger, builder, militia), Craft (loadoutId), Research (techId), Recruit, Claim, HeroAbility (abilityId, x, y, target), PickPerk (perkId), Surrender.
3. Elk commando bevat de entity-ids waarop het werkt, maximaal 64 per commando. De sim valideert elk commando (eigenaar, kosten, bereik) en negeert ongeldige stilzwijgend.

**Lockstep**

1. Frame = één tick. Een commando dat de speler geeft in frame f, voert de sim uit in frame f + DELAY. DELAY = 4 frames (200 ms) bij de start, later adaptief tussen 2 en 8 op basis van gemeten latency.
2. De relay bundelt per frame: { frame, commands: \[...\] } en stuurt de bundel naar alle spelers, ook een lege. Een client voert frame f pas uit als de bundel voor f binnen is.
   Frame-semantiek (besluit sprint 1): bundle.frame is het uitvoerframe; envelope.frame is het frame waarin de speler het commando gaf. De relay plant een commando op max(envelope.frame + DELAY, eerstvolgende bundel): een te laat commando schuift naar de eerstvolgende bundel en wordt nooit verworpen. De sim leest alleen bundle.frame. Sim.frame is het volgende uit te voeren frame; in de state-serialisatie staat tick = aantal uitgevoerde ticks.
3. Ontbreekt een bundel langer dan 2 seconden, dan pauzeert de sim en toont de UI wie er wacht. De relay stuurt bundels in volgorde, nooit met een gat.

**Hash en desync**

1. Elke client stuurt { frame, hash } elke 20 frames. De relay vergelijkt zodra alle spelers dezelfde frame gemeld hebben. { frame: f, hash } betekent: de state-hash na uitvoering van frame f, gemeld als f mod 20 = 0 (besluit sprint 1; dezelfde conventie als Replay.hashes en de snapshot-header). AI-spelers en offline spelers tellen niet mee.
2. Bij afwijking stuurt de relay een desyncEvent met de frame. Elke client dumpt zijn state-serialisatie van die frame naar IndexedDB, zodat de oorzaak achteraf te vergelijken is.
3. In de slice stopt een desync het potje met een duidelijke melding. Later: automatische resync vanaf de meerderheid.

**Reconnect en resync**

1. Een terugkerende client vraagt resync. De relay wijst een peer aan (de speler met de laagste playerId die online is), die zijn volledige state-serialisatie van frame f stuurt plus alle bundels sinds f.
2. De client laadt de state, speelt de bundels versneld af tot hij bij is, en meldt zich weer. Resync in de slice alleen voor lokaal testen; de echte test komt in fase 2 met survival.

**Lobby**

1. Berichten van de client: join (roomId, naam, clientId), leave, ready, setFaction, setMap, setSettings, addAi (factie), removeAi (playerId), chat. Van de relay: lobby, start (seed, map, players, settings, dataVersion, you), bundle, desync, stall, chat, error. De relay kiest de seed (uint32) en stuurt die in start.
2. Rooms zijn in het geheugen van de relay. Geen accounts, geen matchmaking in de slice.
3. Start (besluit sprint 1): er is geen client-bericht start. De relay start zodra elke menselijke speler ready is en het minimum aantal spelers (mens plus AI) is gehaald. Een AI-speler komt via addAi in de lobby, staat als LobbyPlayer met ai = true in start en heeft geen verbinding.
4. Instellingen (besluit sprint 1): de relay kent geen spelregels. MatchSettings = { mode, delayFrames, dominanceMinutes? }. De host (laagste playerId) zet ze met setSettings; de relay vult ze in lobby en start door. Ontbreekt dominanceMinutes, dan geldt de waarde uit de map (maps/\*.json, dominance). Geen defaultgetallen in relay-code.
5. Reconnect (besluit sprint 1): clientId is een willekeurige string die de client zelf kiest en in sessionStorage bewaart. Joint een verbinding na start met een bekend clientId, dan koppelt de relay haar aan dezelfde playerId, zet online op true en de client vraagt resync. Zonder clientId weigert de relay een join na start.
6. Desync (besluit sprint 1): na een desyncEvent geeft de relay geen bundels meer uit; het potje stopt. Dit blijft zo tot de automatische resync (na de slice).

**Replay**

1. Een replay is { dataVersion, seed, map, players, settings, bundles\[\], hashes\[\] }. tools/replay speelt hem headless af en vergelijkt de hash per 20 frames met de opgeslagen hashes.
2. Elke pull request op packages/sim draait de vaste replay-set. Een afwijkende hash blokkeert de merge.
3. Startopstelling (besluit sprint 1): niet in de replay. Zij volgt deterministisch uit map (spawns, toegewezen in volgorde van playerId), data (factions.startUnits van de factie van elke speler, in bestandsvolgorde) en players. De sim bouwt haar op in start(), voor frame 0, met entity-ids in die volgorde. Tot de integratie met packages/map en de data-loader (sprint 2) staat een programmatische testopstelling per mapnaam in tools/replay/src/scenarios.ts; de sprint-1-fixtures draaien op de testconfig (dataVersion test-sprint1) en worden in sprint 2 opnieuw opgenomen op echte data.

## 6. Contract 3: dataschema

Alle spelregels die getallen zijn, staan in JSON onder data/ en nergens in code. Werkstroom 4 is eigenaar van de inhoud, packages/data van de schema's en de loader.

| Bestand | Record | Velden (eenheid) |
| --- | --- | --- |
| factions.json | Factie | id, naam, bodyTypes\[\], startUnits\[\], startScrap, housingGrowthPerMin, safetyNet { threshold, action }, uniqueUnits\[\], uniqueBuildings\[\], specialChannel |
| loadouts.json | Loadout (unit = body plus loadout) | id, faction, bodyType, role, weapon, armorType, hp, damage, damageType, rangeM, speedMps, cooldownS, scrapCost, craftS, popCost, gatherAmount, gatherS, prereqTech\[\], visuals { meshSlots } |
| buildings.json | Gebouw | id, faction, hp, armorType, scrapCost, buildS, footprint { w, h }, beds, provides\[\] (werkplaats, huisvesting, claim, turret, beacon, lab, hq, training), prereqTech\[\], visuals |
| tech.json | Upgrade | id, faction, scrapCost, researchS, building, prereqTech\[\], effects\[\] (stat, target, delta) |
| heroes.json | Held | id, faction, archetype (bouwer, krijger, tacticus), special { S, P, E, C, I, A, L }, abilities\[\] { id, cooldownS, rangeM }, perkPool\[\], reviveScrap, reviveS, revivePenaltyPct, maxRevives |
| perks.json | Perk | id, naam, flavourText, requires { stat, min }, effects\[\] |
| damage-matrix.json | Matrix | strict object: \_comment plus per damageType (ballistic, energy, melee, fire) een rij armorType (none, light, medium, heavy, robot) naar multiplier in procenten |
| maps/\*.json | Map | id, size { w, h } in cellen van 1 m, heightmap-ref, passability-ref, scrapNodes\[\] { x, y, amount }, claimPoints\[\] { x, y, kind }, spawns\[\], creepCamps\[\], dominance { pointsRequired, minutes } |
| ai/\*.json | AI-script | bouwvolgorde, aanvalstimers, rallypunten |

Regels:

1. Eenheden in de bestanden zijn menselijk: meters, seconden, procenten. De loader rekent om naar sim-eenheden (256 per meter, ticks) en rondt deterministisch af naar integers. Die omrekening staat op één plek. Naamgeving (besluit sprint 1): in de bestanden dragen velden het suffix van hun menselijke eenheid (cooldownS, craftS, buildS, researchS, reviveS, gatherS, rangeM, speedMps, revivePenaltyPct); de loader levert ze als ...Ticks, ...U (eenheden), ...UPT (eenheden per tick) en ...Permille. Dezelfde suffix-conventie geldt voor effects\[\].stat (Pct, M, S; anders een ruw geheel getal), met als extra eis dat de set stat-namen een enum in packages/data is, zodat een typefout de build laat falen.
2. Elk bestand heeft een zod-schema in packages/data. Ongeldige data laat de build falen. Onbekende velden worden geweigerd. Elk record mag een \_comment dragen (bedoeling van de waarde).
3. data/VERSION bevat een semver. Die versie zit in elke replay en, via de envHash in de state-header (contract 1), in elke state-hash, zodat een oude replay nooit stil op nieuwe data draait.
4. Verzamelen (besluit sprint 1): gatherAmount (scrap per rit) en gatherS (seconden per rit) staan op de loadout; 0 en 0 voor loadouts die niet verzamelen. Held: maxRevives is het aantal keren oplappen voordat de held leeg is (Spelfundament: 4). Dominantie: pointsRequired en minutes staan per map; MatchSettings.dominanceMinutes is alleen een lobby-override.
5. Startwaarden voor de Dwellers-slice komen van werkstroom 4 in sprint 1, gemarkeerd als startwaarde, geen balans. Richtlijn: bewoner 60 hp, pipe pistol 8 schade per 1,0 s op 8 m, scavenger haalt 10 scrap per 6 s, woning 4 bedden voor 60 scrap, werkplaats 120 scrap. Alles verandert zodra de testgroep speelt.
6. Visuals in de data verwijzen naar manifest-ids uit assets/dist, nooit naar bestandspaden. De asset-cli (werkstroom 3) genereert het manifest.

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
2. Steunt op: niets in code; wel op de artist-brief als norm en op `ANIM_NAMES` uit protocol voor de clipvolgorde.
3. Klaar als: alle Quaternius-placeholders en 10 Gobkit-props door de buis lopen met één commando; een asset dat de norm schendt faalt met een leesbare reden; de uitvoer laadt in packages/render zonder handwerk.
4. Levert in sprint 2 het bone-matrix-formaat uit sectie 12 (besluit sprint 1): de asset-cli schrijft de texture en het manifest, render leest ze. Het manifest is van de asset-cli; het textureformaat van render.

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
- [x] three.js-versie gepind op 0.186.1 (render-pipeline, sprint 1); WebGPU meten in Chrome op de MacBook staat nog open
- [x] Tickrate bevestigd na de benchmark in sprint 1: 200 units, 10.000 ticks, 0,15 ms per tick gemiddeld, 20 Hz blijft

## 12. Contractbesluiten na sprint 1

Genomen op 13 oktober 2026 bij de architect-review van sprint 1, verwerkt in de secties hierboven, in packages/protocol en in docs/CHANGELOG.md. Hier staat alleen wat niet in één contractregel past.

**Bone-matrix-formaat tussen asset-cli en render**

De asset-cli levert per karakter-asset een bone-matrix-texture plus manifest-velden; packages/render leest ze zonder handwerk. Het formaat is dat van `packages/render/src/units/bake.ts`; het manifest is dat van `tools/asset-cli/src/manifest.ts`.

1. Texture: RGBA float32, little-endian, rij-voor-rij, in een los binair bestand (`<id>.anim.f32`) naast de GLB's; breedte = boneCount · 4 texels, hoogte = som van de frames van alle clips. Texel (bone · 4 + c, row) is kolom c van de skin-matrix van die bone in dat frame, column-major zoals three.js Matrix4.elements. Skin-matrix = geanimeerde joint-wereldmatrix · inverse bind-matrix, in modelruimte (meters, +y omhoog, voeten op y = 0, model kijkt naar +z).
2. Bone-volgorde = de joint-volgorde van de skin in de GLB, dezelfde die het skinIndex-attribuut van de mesh gebruikt. De asset-cli garandeert dat mesh en texture uit dezelfde GLB komen.
3. Clips: precies de acht uit `ANIM_NAMES`, in die volgorde, elk een aaneengesloten blok rijen; 30 fps; loopende clips bemonsteren \[0, 1), one-shot clips (death) sluiten de laatste pose op 1 in. Manifest per clip: name, firstFrame, frameCount, loop, durationSeconds. Manifest per asset: texturePath, width, height, fps, boneCount.
4. Render bouwt hieruit zijn clip-tabel (startRow, frameCount, loop, duration) en DataTexture; de procedurele placeholder-rig in render verdwijnt zodra de eerste Quaternius-asset door de buis is.
5. Eigenaar: manifest-schema is van asset-cli (werkstroom 3); de interpretatie van de texture is van render (werkstroom 2). Een wijziging gaat via beide briefs en deze sectie.

**Wat sprint 2 per werkstroom hieruit volgt**

1. sim-core: `ANIM`, `ENTITY_*` en `YAW_*` uit protocol importeren in plaats van eigen constanten; start() met startopstelling uit map plus data; AI in de sim met ai-vlag uit start; fixtures opnieuw opnemen op echte data.
2. render-pipeline: yaw-omrekening is al aangepast (interpolate.ts); `ANIM` uit protocol gebruiken voor de clipvolgorde; loader voor het bone-matrix-formaat.
3. asset-cli: bakker volgens dit formaat; manifest-schema uitbreiden met width, height, loop, durationSeconds; clipvolgorde valideren tegen `ANIM_NAMES`.
4. content: schema's uitbreiden met gatherAmount, gatherS, maxRevives, maps.dominance en een stat-enum voor effects; data/VERSION omhoog.
5. relay: setSettings, addAi, removeAi, clientId-reconnect, settings in lobby; geen defaultgetallen; loopback aansluiten in apps/client.
6. hud en map: ai-vlag en settings in de lobby-UI; dominance in maps/\*.json.

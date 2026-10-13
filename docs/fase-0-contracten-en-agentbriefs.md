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
| packages/render | three.js WebGPU-renderer, TSL-materialen, instanced skinning, LOD, camera, VFX-koppeling | protocol, data, asset-cli (alleen `@crawlout/asset-cli/manifest`, het manifest-schema; besluit sprint 3) | 2 |
| packages/ui | HUD als Preact-overlay: minimap, tellers, selectiepaneel, commandokaart | protocol, data | 5 |
| packages/relay | Node-relay op ws: lobby, rooms, frame-bundeling, hash-vergelijking, resync | protocol | 6 |
| packages/map | Terreintegels, passability-bitmap, scrap-nodes, claimpunten, de slice-map | protocol, data | 7 |
| apps/client | Vite-app die sim-worker, render, ui en een loopback- of ws-relay samenbrengt | alles | 2 en 5 samen |
| tools/asset-cli | GLB in, meshopt plus KTX2 plus 3 LODs plus animatietextures plus manifest uit | niets | 3 |
| tools/replay | Headless replay-runner: speelt een command-log af en vergelijkt hashes | sim, protocol, data, map (besluit sprint 2: de omgeving van een replay komt uit data/ en data/maps) | 1 |

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
2. Componenten voor de slice: Transform (x, y, yaw), Movement (speed, flowFieldId), Health (hp, maxHp, armorType), Owner, Unit (bodyType, loadoutId, role), Orders (ringbuffer van 4), Target, Combat (cooldown, damage, damageType, range; besluit sprint 4: ook op een voltooid gebouw met een wapen, de turret van besluit 8, dat zelf zijn doel kiest), Building (typeId, progress), ResourceNode (amount), Housing (beds), Claim (owner, progress), Hero (SPECIAL als 7 bytes, level, xp, perks als bitset).
3. Systeemvolgorde per tick, vast: 1 commando's van deze tick toepassen, 2 orders en AI, 3 flow fields (gebudgetteerd: maximaal N cellen per tick), 4 beweging plus separatie, 5 gevecht, 6 economie (verzamelen, bouwen, huisvestingsgroei, tribute), 7 claims en winroutes, 8 dood en opruimen, 9 hash.
4. Iteratie altijd op oplopende entity-id. Sorteren altijd met een tiebreak op id.
5. Volledige state is serialiseerbaar naar één ArrayBuffer en terug (nodig voor resync en replays). Serialize gevolgd door deserialize levert dezelfde hash.

**State-hash**

1. FNV-1a 32-bit over alle componentarrays in vaste volgorde, plus tick en RNG-state. Elke tick berekend, elke 20 ticks naar de relay gestuurd.
2. De state-header bevat een envHash (besluit sprint 1): FNV-1a over dataVersion, de sim-config, de map en het aantal spelers. Hij zit in elke state-hash, zodat twee clients met andere data of een andere map op frame 0 al verschillen, en deserialize weigert een state met een andere envHash. Dit is de invulling van "dataVersion in de hash-seed" uit contract 3.

**Snapshot sim naar render**

1. Na elke tick post de worker één transferable ArrayBuffer. Header: tick (uint32), hash (uint32), entityCount (uint16), eventCount (uint16). tick is het laatst uitgevoerde frame; hash is de state-hash na dat frame (besluit sprint 1).
2. Per entity, SoA: id uint32, typeId uint16, owner uint8, x int32, y int32, yaw uint16, anim uint8, animT uint16 (0 tot 65535 is 0 tot 100% van de clip), hpPct uint8, flags uint8 (selected, dead, carrying, inCombat). anim-ids (besluit sprint 1, `ANIM` in protocol) volgen de clipvolgorde van de artist-brief: idle 0, walk 1, run 2, attack1 3, attack2 4, gather 5, build 6, death 7. Sim en render gebruiken deze constanten, nooit eigen getallen.
   Besluiten sprint 2:
   - typeId-ruimte (code in packages/data/src/typeIds.ts, omdat de indices uit de data-loader komen): unit = 1 + loadoutId (1 tot 999), held = 1000 + heroId (1000 tot 1023; besluit sprint 3: de held is een unit zonder loadout, `kindOfTypeId` geeft unit en `heroIdOfTypeId` zegt welke held), gebouw = 1024 + buildingId (1024 tot 2047), scrap-node 2048, claimpunt 2049, 0 is geen type. Sim, render, HUD en client lezen de soort via `kindOfTypeId`, nooit met eigen grenzen.
   - owner: speler 0 tot MAX\_PLAYERS − 1, of `OWNER_NEUTRAL` = 255 voor scrap-nodes en onbezette claimpunten. De waarden daartussen zijn gereserveerd.
   - hpPct: units en gebouwen hp in procenten; scrap-node resterende voorraad in procenten van de startvoorraad; claimpunt 100.
   - anim en animT buiten units: gebouw in aanbouw build met animT = bouwvoortgang, daarna idle; claimpunt animT = claimvoortgang; lijk death met animT = verstreken deel van corpseS.
   - flags.selected zet de client, niet de sim: selectie is geen sim-state. De client stempelt hem in de snapshotbuffer voordat de renderer leest. dead, carrying en inCombat komen uit de sim. Besluit sprint 4: inCombat staat ook op een turret zolang hij een doel heeft; dead en carrying alleen op units.
   - Inhalen (besluit sprint 4): na een resync, of bij meer dan 16 klaarliggende bundels, tikt de worker door binnen een tijdbudget van de host en post hij alleen de snapshot van de laatste tick; de state-hashes van de overgeslagen meldframes gaan vooraf als één `hashes`-bericht naar de client (packages/sim/src/worker.ts, geen relay-bericht). Events van overgeslagen ticks vervallen: ze zijn VFX, audio en meldingen, geen state.
3. Events voor VFX en audio: type uint8, a uint32, b uint32, x int32, y int32. Types: spawn, death, shotFired (a is schutter, b is doel), hit, buildingPlaced, buildingDone, claimTaken, resourceDepleted, heroLevel, abilityZone.
   Besluit sprint 2: a is altijd de entity waar het om gaat, x en y zijn haar positie op dat moment. b per type: spawn, death, buildingPlaced en buildingDone b = typeId; shotFired a = schutter, b = doel; hit a = doel, b = schutter; claimTaken a = claimpunt, b = nieuwe eigenaar (`OWNER_NEUTRAL` als het punt terugvalt); resourceDepleted b = 0; heroLevel b = nieuw level. Een entity die dezelfde tick verdwijnt (gesloopt gebouw, lege node) staat niet meer in de snapshot; de renderer leest typeId dan uit b.
   Besluit sprint 3: abilityZone (10) markeert het begin van een ability-zone (Lockdown): a = held, b = abilityId (index in heroes.abilities), x en y = het midden van de zone, de enige uitzondering op "x, y is de positie van a". Straal en duur leest de renderer uit packages/data op de held (`heroIdOfTypeId` van het typeId van a); er is geen event voor het einde.
4. De renderer interpoleert tussen de laatste twee snapshots en loopt één tick achter. De renderer leest nooit sim-state direct.
5. Spelerstatus (scrap, bewoners, pop, selectie-details, held-stats) gaat apart via een queryMessage op verzoek van de UI, niet in elke snapshot. PlayerStatus = { playerId, scrap, settlers, pop, popCap, beds, hero, techs }. Besluit sprint 2: hero = null zonder held, anders HeroStatus { heroId, level, xp, xpNext, special\[7\], perks\[\], pendingPerks, revivesLeft }; naam en perk-teksten haalt de HUD uit packages/data op heroId. heroId, xpNext, pendingPerks en revivesLeft zijn verplicht sinds de held in de sim zit (sprint 3); de eigen HeroInfo van de HUD is weg.
   Besluit sprint 3: HeroStatus krijgt state (alive, dead, reviving, empty), reviveTicksLeft (0 buiten reviving), entityId (de levende held, anders `ENTITY_NONE`) en abilityCooldownTicks\[\] (per ability, 0 = klaar); de HUD leidt dood-zijn en cooldowns dan niet meer af uit de snapshot. PlayerStatus.techs = onderzochte tech-ids, oplopend, zodat de HUD bouwmenu en craft-opties op prereqTech filtert. Sinds sprint 4 (protocol 0.3.0) zijn alle velden verplicht: de sim levert ze (hero.ts heroStatus), de HUD leest state, abilityCooldownTicks en techs (apps/client/src/main.ts).

**AI in de slice**

1. Eén scripted tegenstander als Dwellers: bouwvolgorde uit een JSON-script, verzamelt, bouwt, valt aan op een timer. Geen leren, geen cheats. Goed genoeg om de loop te testen.
2. De AI draait in de sim, op elke client (besluit sprint 1). Een AI-speler is een LobbyPlayer met ai = true, zonder verbinding en zonder hash-meldingen. De sim leest de ai-vlag uit het start-bericht en geeft de AI-commando's in systeemstap 2 (orders en AI), met dezelfde validatie als spelerscommando's. Ze gaan niet over de relay en staan niet in de bundels: de replay reproduceert ze uit seed, data en script.

## 5. Contract 2: commandoprotocol

De relay simuleert niets. Hij ordent commando's in frames, verspreidt ze naar alle spelers en vergelijkt hashes. Lokaal skirmish gebruikt exact dezelfde weg via een loopback-relay in het geheugen.

**Commando**

1. Vorm: { frame, playerId, seq, type, payload }. Alle velden integers of korte strings, zod-schema in packages/protocol. JSON in fase 1, binair pas als het meetbaar nodig is.
2. Types in de slice: Move, AttackMove, Attack, Stop, Gather, Build (typeId, x, y), Cancel, SetRole (scavenger, builder, militia), Craft (loadoutId), Research (techId), Recruit, Claim, HeroAbility (abilityId, x, y, target), PickPerk (perkId), Surrender.
   Besluiten sprint 2:
   - Build: typeId is de gebouw-typeId (contract 1); x, y is het midden van de footprint in sim-eenheden. De oorsprong (cel linksboven) is cel(x, y) − (w >> 1, h >> 1) met cel(v) = v >> 8. De HUD snapt het midden op de celgrens (even maten op een celhoek, oneven op een celmidden); de sim valideert factie, kosten en vrije cellen. Alleen bouwers; wijst x, y naar een eigen bouwplaats van dit type, dan helpen ze daar zonder kosten.
   - Cancel: ids zijn eigen bouwplaatsen (verdwijnen met teruggave) en/of eigen units (stoppen; een betaalde omscholing wordt terugbetaald).
   - Claim (ids, pointId): ids zijn bouwers; de sim laat hen het claimgebouw (provides claim) van hun factie bouwen binnen claimRadiusM van het punt, als Build op de dichtstbijzijnde vrije plek (sinds sprint 3; het interim van sprint 2 in sectie 13 is voorbij).
   Besluiten sprint 3:
   - Recruit (buildingId): in de slice het oplappen van de gesneuvelde held. buildingId is het entity-id van het eigen voltooide hoofdgebouw (provides hq); de sim rekent heroes.reviveScrap meteen af, de held staat reviveS later naast het hoofdgebouw (HeroStatus.state reviving, daarna alive). Cancel met het hoofdgebouw stopt het oplappen met teruggave. Later rekruteert hetzelfde commando op andere gebouwen (Garde-Initiate, zwervers); er komt geen apart commando.
   - Research (techId): de sim kiest zelf het eerste voltooide eigen gebouw van het type uit tech.building zonder lopend onderzoek en rekent de kosten meteen af; Cancel met dat gebouw stopt het onderzoek met teruggave.
   - HeroAbility (heroId, abilityId, x?, y?, target?): abilityId is de index in heroes.abilities; zonder x, y en target geldt de positie van de held. Het begin van de zone komt als event abilityZone (contract 1).
3. Elk commando bevat de entity-ids waarop het werkt, maximaal 64 per commando. De sim valideert elk commando (eigenaar, kosten, bereik) en negeert ongeldige stilzwijgend. Besluit sprint 2: de zod-validatie gebeurt één keer bij binnenkomst van de bundel (buiten de tick); de tick doet alleen integer- en spelregelchecks.

**Lockstep**

1. Frame = één tick. Een commando dat de speler geeft in frame f, voert de sim uit in frame f + DELAY. DELAY = 4 frames (200 ms) bij de start, later adaptief tussen 2 en 8 op basis van gemeten latency.
   Besluit sprint 2: de relay past DELAY zelf aan uit het verschil tussen het frame dat hij uitgeeft en envelope.frame (of HashReport.frame + 1) van de traagste online speler, omhoog direct en omlaag met hysterese; er is geen bericht voor nodig. MatchSettings.delayFrames is alleen de startwaarde. Een client kent DELAY niet: hij stuurt envelope.frame = zijn eerstvolgende frame en de relay plant. Per speler zijn uitvoerframes monotoon, zodat seq-volgorde blijft als DELAY tussendoor verandert.
2. De relay bundelt per frame: { frame, commands: \[...\] } en stuurt de bundel naar alle spelers, ook een lege. Een client voert frame f pas uit als de bundel voor f binnen is.
   Frame-semantiek (besluit sprint 1): bundle.frame is het uitvoerframe; envelope.frame is het frame waarin de speler het commando gaf. De relay plant een commando op max(envelope.frame + DELAY, eerstvolgende bundel): een te laat commando schuift naar de eerstvolgende bundel en wordt nooit verworpen. De sim leest alleen bundle.frame. Sim.frame is het volgende uit te voeren frame; in de state-serialisatie staat tick = aantal uitgevoerde ticks.
3. Ontbreekt een bundel langer dan 2 seconden, dan pauzeert de sim en toont de UI wie er wacht. De relay stuurt bundels in volgorde, nooit met een gat.
   Besluit sprint 2: twee kanten. De client pauzeert zelf zodra zijn eerstvolgende bundel ontbreekt (de worker tikt alleen met bundel). De relay blijft bundels uitgeven en stuurt `stall` { waitingFor } zodra een online menselijke speler zijn hash voor het oudste openstaande frame langer dan STALL\_TIMEOUT\_MS schuldig blijft nadat een ander al meldde; alleen bij wijziging, een lege waitingFor wist de melding. Hashes zijn dus de hartslag.
   Besluit sprint 4: "nooit met een gat" geldt aan beide kanten. De client (BundleFeed in apps/client/src/net/resync.ts) geeft alleen aaneengesloten frames aan de worker; een bundel achter een gat wacht tot het ontbrekende frame er is.

**Hash en desync**

1. Elke client stuurt { frame, hash } elke 20 frames. De relay vergelijkt zodra alle spelers dezelfde frame gemeld hebben. { frame: f, hash } betekent: de state-hash na uitvoering van frame f, gemeld als f mod 20 = 0 (besluit sprint 1; dezelfde conventie als Replay.hashes en de snapshot-header). AI-spelers en offline spelers tellen niet mee.
   Besluit sprint 4: ook tijdens inhalen meldt de client elk meldframe (de worker geeft ze gebundeld door, contract 1); de relay krijgt dus nooit een gat in de hashreeks van een speler. De relay neemt hashmeldingen tijdens een resync en de eerste 100 frames erna niet mee in de DELAY-meting (SAMPLE\_GRACE\_FRAMES), zodat het inhalen DELAY niet omhoog drijft.
2. Bij afwijking stuurt de relay een desyncEvent met de frame. Elke client dumpt zijn state-serialisatie van die frame naar IndexedDB, zodat de oorzaak achteraf te vergelijken is.
3. In de slice stopt een desync het potje met een duidelijke melding. Later: automatische resync vanaf de meerderheid.

**Reconnect en resync**

1. Een terugkerende client vraagt resync. De relay wijst een peer aan (de speler met de laagste playerId die online is), die zijn volledige state-serialisatie van frame f stuurt plus alle bundels sinds f.
   Besluit sprint 2: ResyncResponse.frame = Sim.frame van de meegestuurde state, dus het eerstvolgende uit te voeren frame (state na frame − 1). bundles zijn alle bundels vanaf frame, aansluitend; de peer stuurt wat hij heeft en de relay vult aan uit zijn eigen geschiedenis (de laatste 1200 frames). Een state ouder dan die geschiedenis wijst de relay af en hij vraagt de volgende peer; een peer die niet binnen 5 s antwoordt ook. De peer is de laagste online menselijke playerId met een state (niet het doel, niet al geprobeerd).
2. De client laadt de state, speelt de bundels versneld af tot hij bij is, en meldt zich weer. Resync in de slice alleen voor lokaal testen; de echte test komt in fase 2 met survival.
   Besluit sprint 2: na een reconnect (lobby 5) start de relay de resync zelf; een resyncRequest van de client blijft toegestaan en is een no-op zolang er een loopt. De teruggekeerde speler meldt hashes vanaf ResyncResponse.frame; de relay verwacht er geen van hem voor eerdere frames.

**Lobby**

1. Berichten van de client: join (roomId, naam, clientId), leave, ready, setFaction, setMap, setSettings, addAi (factie), removeAi (playerId), chat. Van de relay: lobby, start (seed, map, players, settings, dataVersion, you), bundle, desync, stall, chat, error. De relay kiest de seed (uint32) en stuurt die in start.
   dataVersion (besluit sprint 4): `pnpm relay` leest data/VERSION en geeft die als dataVersion door in start; de client vergelijkt hem met zijn eigen data en weigert bij verschil, ook bij '0' (een relay zonder versie is een fout, geen uitzondering).
2. Rooms zijn in het geheugen van de relay. Geen accounts, geen matchmaking in de slice.
3. Start (besluit sprint 1): er is geen client-bericht start. De relay start zodra elke menselijke speler ready is en het minimum aantal spelers (mens plus AI) is gehaald. Een AI-speler komt via addAi in de lobby, staat als LobbyPlayer met ai = true in start en heeft geen verbinding.
4. Instellingen (besluit sprint 1): de relay kent geen spelregels. MatchSettings = { mode, delayFrames, dominanceMinutes? }. De host (laagste playerId) zet ze met setSettings; de relay vult ze in lobby en start door. Ontbreekt dominanceMinutes, dan geldt de waarde uit de map (maps/\*.json, dominance). Geen defaultgetallen in relay-code.
5. Reconnect (besluit sprint 1): clientId is een willekeurige string die de client zelf kiest en in sessionStorage bewaart. Joint een verbinding na start met een bekend clientId, dan koppelt de relay haar aan dezelfde playerId, zet online op true en de client vraagt resync. Zonder clientId weigert de relay een join na start. Aanscherping sprint 2: de relay stuurt de teruggekeerde verbinding opnieuw `start` (zelfde seed, map, spelers en settings), zodat de client een verse sim kan maken, en start daarna zelf de resync (contract 2, resync). Een gestarte room zonder verbindingen blijft 60 s bestaan voor reconnect.
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
| buildings.json | Gebouw | id, faction, hp, armorType, scrapCost, buildS, footprint { w, h }, beds, provides\[\] (werkplaats, huisvesting, claim, turret, beacon, lab, hq, training), prereqTech\[\], visuals; besluit sprint 3, voor gebouwen met provides turret: damage, damageType, rangeM, cooldownS (verplicht bij provides turret, data 0.7.0; de loader levert damage, damageType, rangeU, cooldownTicks, 0 voor andere gebouwen) |
| tech.json | Upgrade | id, faction, scrapCost, researchS, building, prereqTech\[\], effects\[\] (stat, target, delta) |
| heroes.json | Held | id, faction, archetype (bouwer, krijger, tacticus), naam, special { S, P, E, C, I, A, L }, xpPerLevel\[\] (per stap; de loader levert cumulatieve xpThresholds), xpPerKill, xpPerDiscovery, abilities\[\] { id, naam, cooldownS, rangeM, radiusM, durationS, effects\[\] { stat, side (enemy, ally), target (units, turrets, alle), delta } }, perkPool\[\], reviveScrap, reviveS, revivePenaltyPct, maxRevives. Lichaam, wapen en basisstats komen tot na gate 1 van het militie-loadout van de factie (besluit sprint 3) |
| perks.json | Perk | id, naam, flavourText, requires { stat, min }, effects\[\] |
| damage-matrix.json | Matrix | strict object: \_comment plus per damageType (ballistic, energy, melee, fire) een rij armorType (none, light, medium, heavy, robot) naar multiplier in procenten |
| maps/\*.json | Map | id, size { w, h } in cellen van 1 m, heightmap-ref, passability-ref, scrapNodes\[\] { x, y, amount }, claimPoints\[\] { x, y, kind }, spawns\[\], creepCamps\[\], dominance { pointsRequired, minutes } |
| ai/\*.json | AI-script | id, faction, buildOrder\[\] { atS, buildingId }, attackTimersS\[\], rallyPoint, militiaPct (besluit sprint 2: verhuist uit sim.json) |
| sim.json | Sim-tuning (één record, besluit sprint 2) | unitRadiusM, arriveRadiusM, separationPct, flowFieldBudgetCells, walkAnimStep, aggroRangeM, interactRangeM, claimRadiusM, popCapMax, corpseS, cancelRefundPct; besluit sprint 3, SPECIAL per punt van de letter (geldt voor elke held, dus geen heldregel): specialStrengthDamagePct, specialPerceptionRangeM, specialEnduranceHpPct, specialCharismaGrowthPct, specialIntelligenceResearchPct, specialAgilitySpeedPct, specialLuckCritPct, critDamagePct. De loader levert U, Permille en Ticks. Geen factie- of mapregels: die staan in factions en maps |

Regels:

1. Eenheden in de bestanden zijn menselijk: meters, seconden, procenten. De loader rekent om naar sim-eenheden (256 per meter, ticks) en rondt deterministisch af naar integers. Die omrekening staat op één plek. Naamgeving (besluit sprint 1): in de bestanden dragen velden het suffix van hun menselijke eenheid (cooldownS, craftS, buildS, researchS, reviveS, gatherS, rangeM, speedMps, revivePenaltyPct); de loader levert ze als ...Ticks, ...U (eenheden), ...UPT (eenheden per tick) en ...Permille. Dezelfde suffix-conventie geldt voor effects\[\].stat (Pct, M, S; anders een ruw geheel getal), met als extra eis dat de set stat-namen een enum in packages/data is, zodat een typefout de build laat falen.
2. Elk bestand heeft een zod-schema in packages/data. Ongeldige data laat de build falen. Onbekende velden worden geweigerd. Elk record mag een \_comment dragen (bedoeling van de waarde).
3. data/VERSION bevat een semver. Die versie zit in elke replay en, via de envHash in de state-header (contract 1), in elke state-hash, zodat een oude replay nooit stil op nieuwe data draait.
4. Verzamelen (besluit sprint 1): gatherAmount (scrap per rit) en gatherS (seconden per rit) staan op de loadout; 0 en 0 voor loadouts die niet verzamelen. Held: maxRevives is het aantal keren oplappen voordat de held leeg is (Spelfundament: 4). Dominantie: pointsRequired en minutes staan per map; MatchSettings.dominanceMinutes is alleen een lobby-override.
5. Startwaarden voor de Dwellers-slice komen van werkstroom 4 in sprint 1, gemarkeerd als startwaarde, geen balans. Richtlijn: bewoner 60 hp, pipe pistol 8 schade per 1,0 s op 8 m, scavenger haalt 10 scrap per 6 s, woning 4 bedden voor 60 scrap, werkplaats 120 scrap. Alles verandert zodra de testgroep speelt.
6. Visuals in de data verwijzen naar manifest-ids uit assets/dist, nooit naar bestandspaden. De asset-cli (werkstroom 3) genereert het manifest.
7. Sim-tuning (besluit sprint 2): getallen die bij geen factie, loadout, gebouw of map horen staan in sim.json. aggroRangeM (militie en AttackMove kiezen zelf een doel), interactRangeM (reikwijdte tot node of footprint), claimRadiusM (straal waarbinnen een claimgebouw het punt neemt), popCapMax (Spelfundament 2.5: 50), corpseS (lijk voor de death-clip), cancelRefundPct (teruggave bij Cancel; sprint 2 gedraagt zich als 100). aiMilitiaPct hoort bij het AI-script (ai/\*.json, militiaPct); claimS vervalt zodra claimen via het claimgebouw loopt (sectie 13).

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
   Sinds sprint 4: `pnpm --filter @crawlout/replay run replay:browsers` (tools/replay/src/browsers.ts: de runner gebundeld met esbuild, via Playwright in Chromium, Firefox en WebKit, ook na serialize/deserialize halverwege, eindhashes over de browsers vergeleken); .github/workflows/browsers.yml draait hem wekelijks met `playwright install --with-deps` en REPLAY\_BROWSERS\_STRICT=1. `--chrome` is de handmatige hash-test in de geïnstalleerde Chrome; de WebGPU-meting blijft de render-demo. Uitleg in tools/replay/README.md.
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
- [x] three.js-versie gepind op 0.186.1 (render-pipeline, sprint 1); WebGPU gemeten in Chrome op de MacBook (render-demo via Playwright, sprint 2 tot 4: 15 draw calls, 120 fps, slechtste frame 10,5 ms); de meting op een laptop met geïntegreerde GPU staat open (vraagt Martien)
- [x] Tickrate bevestigd na de benchmark in sprint 1: 200 units, 10.000 ticks, 0,15 ms per tick gemiddeld, 20 Hz blijft

## 12. Contractbesluiten na sprint 1

Genomen op 13 oktober 2026 bij de architect-review van sprint 1, verwerkt in de secties hierboven, in packages/protocol en in docs/CHANGELOG.md. Hier staat alleen wat niet in één contractregel past.

**Bone-matrix-formaat tussen asset-cli en render**

De asset-cli levert per karakter-asset een bone-matrix-texture plus manifest-velden; packages/render leest ze zonder handwerk. Het formaat is dat van `packages/render/src/units/bake.ts`; het manifest is dat van `tools/asset-cli/src/manifest.ts`.

1. Texture: RGBA float32, little-endian, rij-voor-rij, in een los binair bestand (`<id>.anim.f32`) naast de GLB's; breedte = boneCount · 4 texels, hoogte = som van de frames van alle clips. Texel (bone · 4 + c, row) is kolom c van de skin-matrix van die bone in dat frame, column-major zoals three.js Matrix4.elements. Skin-matrix = geanimeerde joint-wereldmatrix · inverse bind-matrix, in modelruimte (meters, +y omhoog, voeten op y = 0, model kijkt naar +z).
2. Bone-volgorde = de joint-volgorde van de skin in de GLB, dezelfde die het skinIndex-attribuut van de mesh gebruikt. De asset-cli garandeert dat mesh en texture uit dezelfde GLB komen.
3. Clips: precies de acht uit `ANIM_NAMES`, in die volgorde, elk een aaneengesloten blok rijen; 30 fps; loopende clips bemonsteren \[0, 1), one-shot clips (death) sluiten de laatste pose op 1 in. Manifest (besluit sprint 2, de code van `tools/asset-cli/src/manifest.ts` is leidend): per asset `boneCount` en, voor karakters met clips, `baked { path, width, height, fps, clips[] }`; per clip `{ name, startRow, frames, loop, durationSeconds }`. path is relatief aan manifest.json (`<id>/<id>.anim.f32`), width = boneCount · 4, height = som van frames, frames = max(2, round(duur · fps)). Het zod-schema controleert clipvolgorde, aaneengesloten blokken, height en width.
4. Render bouwt hieruit zijn clip-tabel (startRow, frames, loop, durationSeconds) en DataTexture, in float32 of half-float waar WebGL2 float32 weigert (besluit sprint 2: render kiest de precisie, het manifest blijft float32); de procedurele placeholder-rig in render verdwijnt zodra de eerste Quaternius-asset door de buis is.
5. Eigenaar: manifest-schema is van asset-cli (werkstroom 3); de interpretatie van de texture is van render (werkstroom 2). Een wijziging gaat via beide briefs en deze sectie.

**Wat sprint 2 per werkstroom hieruit volgt**

1. sim-core: `ANIM`, `ENTITY_*` en `YAW_*` uit protocol importeren in plaats van eigen constanten; start() met startopstelling uit map plus data; AI in de sim met ai-vlag uit start; fixtures opnieuw opnemen op echte data.
2. render-pipeline: yaw-omrekening is al aangepast (interpolate.ts); `ANIM` uit protocol gebruiken voor de clipvolgorde; loader voor het bone-matrix-formaat.
3. asset-cli: bakker volgens dit formaat; manifest-schema uitbreiden met width, height, loop, durationSeconds; clipvolgorde valideren tegen `ANIM_NAMES`.
4. content: schema's uitbreiden met gatherAmount, gatherS, maxRevives, maps.dominance en een stat-enum voor effects; data/VERSION omhoog.
5. relay: setSettings, addAi, removeAi, clientId-reconnect, settings in lobby; geen defaultgetallen; loopback aansluiten in apps/client.
6. hud en map: ai-vlag en settings in de lobby-UI; dominance in maps/\*.json.

## 13. Contractbesluiten na sprint 2

Genomen op 14 oktober 2026 bij de architect-review van sprint 2, verwerkt in de secties hierboven (besluiten sprint 2), in packages/protocol en in docs/CHANGELOG.md. Hier staat wat niet in één contractregel past: de spelregels die sim-core zonder data heeft ingevuld, en wat sprint 3 daaruit volgt.

**Spelregels uit sprint 2, per regel**

1. Omscholen alleen bij een werkplaats: akkoord. Spelfundament 2.1 zegt het letterlijk ("wisselen kost looptijd naar de werkplaats"). Regel, geen getal. SetRole en Craft sturen de unit naar de dichtstbijzijnde eigen werkplaats; zonder werkplaats wacht hij. Het doel-loadout van SetRole is per factie het goedkoopste loadout van die rol zonder prereqTech (laagste id bij gelijke prijs).
2. Het hoofdgebouw is niet bouwbaar: akkoord als regel. Eén per speler, uit de startopstelling (provides hq); verlies ervan is winroute A. Het bouwmenu toont het niet.
3. Cancel geeft de volle scrap terug: akkoord voor de slice, maar het is een getal. Nieuw veld sim.json cancelRefundPct (content), de sim leest het (sim-core, sprint 3). Tot dan gedraagt de sim zich als 100. Geldt voor bouwplaatsen en voor een betaalde omscholing.
4. Claimen vraagt een Claim-order en een vijand pauzeert het: terug naar het ontwerp. Spelfundament 3.1: "claimen is een outpost bouwen in de radius; een geclaimde node is exclusief voor de eigenaar", en de data heeft dat gebouw al (claimpaal, provides claim). Regel vanaf sprint 3: een claimpunt is van speler p zolang een voltooid gebouw van p met provides claim binnen claimRadiusM van het punt staat (het hoofdgebouw telt mee, dus het punt bij de spawn is meteen van de speler); staat er geen, dan is het punt neutraal; staan er van meerdere spelers, dan houdt de huidige eigenaar het tot zijn gebouw weg is, daarna de laagste playerId. Een scrap-node binnen claimRadiusM van een bezet punt is exclusief: alleen scavengers van de eigenaar verzamelen er. Het Claim-commando wordt een Build van het claimgebouw bij het punt (contract 2). claimS vervalt; claimRadiusM blijft. Sprint 2 hield het interim (Claim-order, claimS ongestoord in de straal, vijand pauzeert) voor de eerste testsessie; sprint 3 heeft de omslag gemaakt (data 0.6.0, fixtures opnieuw opgenomen). Let op: Rustbelt heeft bewust geen claimpunt bij de spawn (sectie 14, besluit 9), dus "het punt bij de spawn is meteen van de speler" is daar niet van toepassing.
5. Groei levert scavengers: akkoord. Elke bewoner begint als scavenger (Spelfundament 2.1); de nieuwe bewoner is het SetRole-loadout van de rol scavenger. De nieuwe bewoner verschijnt op een vrije cel rond het hoofdgebouw.
6. Groei spaart niet op: akkoord. Spelfundament 2.3: geen bed, geen groei. Zonder vrij bed (of zonder voltooid hoofdgebouw) gaat de teller op nul; housingGrowthPerMin telt alleen op zolang er plek is.

**Overig, bevestigd in sprint 2**

1. De scripted AI geeft gewone commando's via dezelfde validatie als spelers, in playerId-volgorde, voor de unit-orders. Geen cheats; hij ziet de map, de spawns en zijn eigen units. Zijn militie-aandeel is een scriptwaarde (ai/\*.json militiaPct), niet een sim-getal.
2. Alleen militie kiest zelf een doel binnen aggroRangeM; scavengers en bouwers vechten niet terug zonder order. Akkoord voor de slice; de testgroep beslist of bewoners moeten vluchten of terugslaan.
3. Dood: een unit blijft corpseS seconden als lijk staan (anim death, flag dead, zonder Health); een gebouw verdwijnt meteen. Een lijk telt niet mee voor pop, dominantie of claims.
4. Winnaar staat vast in de state (globals: winnaar, reden, frame); de sim tikt daarna door, de client toont het einde uit de query.
5. Flow fields krijgen een rechthoek als doel (cel of footprint) en beginnen allemaal opnieuw bij elke wijziging van de begaanbaarheid; dat is derived state en zit niet in de hash.

**Wat sprint 3 per werkstroom hieruit volgt (richting gate 1)**

1. sim-core: `OWNER_NEUTRAL` uit protocol gebruiken; hpPct van een scrap-node = resterend deel van de startvoorraad; claimen via het claimgebouw, exclusieve nodes, claimS weg (fixtures opnieuw opnemen); cancelRefundPct en militiaPct uit de data; de held (HeroStatus, PickPerk, heroLevel-event, oplappen); Research en Recruit; `replay:browsers` via Playwright.
2. render-pipeline: bij death het typeId uit event.b gebruiken voor de footprint van een gesloopt gebouw, bij hit eerst a (doel) als positie; bone-matrix-loader voor `baked` uit het manifest en de eerste Quaternius-asset in plaats van de placeholder-rig; scrap-schaal uit hpPct werkt zodra de sim het levert.
3. asset-cli: Quaternius-placeholders en 10 Gobkit-props door de buis, clipmap tegen de echte GLB's controleren.
4. content: sim.json cancelRefundPct erbij, aiMilitiaPct naar ai/\*.json als militiaPct, claimS weg zodra sim-core omschakelt; held-xp-tabel (xp per level) in heroes.json voor xpNext; data/VERSION omhoog.
5. hud: HeroInfo vervangen door HeroStatus plus naam uit packages/data; `OWNER_NEUTRAL` en `kindOfTypeId` in de client in plaats van eigen constanten; desync-dump naar IndexedDB; lobby-paneel op de ws-relay; de client gebruikt start.you en start.map in plaats van vaste waarden.
6. relay: ws-transport en reconnect in apps/client (start opnieuw, state laden in de worker, bundels versneld afspelen), latency-simulatie, de test met twee browsers op één machine; defaultFaction alleen via RoomOptions.
7. map: creep-kampen en props via Three Scatter; controleren dat elke scrap-node die exclusief moet zijn binnen claimRadiusM van een claimpunt ligt.

## 14. Contractbesluiten na sprint 3 (de slice-ronde)

Genomen op 14 oktober 2026 bij de architect-review van de slice-ronde (held, claims via het claimgebouw, research, craft, oplappen; ws-relay met reconnect en resync; asset-loader en bouwplaatsen), verwerkt in de secties hierboven (besluiten sprint 3), in packages/protocol 0.2.0 en in docs/CHANGELOG.md. Hier staat wat niet in één contractregel past: de negen vragen uit de ronde, en wat sprint 4 daaruit volgt richting gate 1. De gate-1-checklist zelf staat in docs/gate-1-checklist.md.

**Besluiten, per vraag**

1. HeroStatus: heroId, xpNext, pendingPerks en revivesLeft zijn verplicht (de sim levert ze). Het voorstel van sim-core is overgenomen en uitgebreid: state (alive, dead, reviving, empty), reviveTicksLeft, entityId en abilityCooldownTicks\[\] (de HUD toont nu cooldownPct 0 omdat het veld ontbrak). Optioneel tot sim-core ze levert en de HUD ze leest (sprint 4), daarna verplicht. De HUD leidt dood-zijn dan niet meer af uit de snapshot: tijdens het oplappen toont hij nu ten onrechte opnieuw "Oplappen".
2. PlayerStatus.techs: onderzochte tech-ids, oplopend. De sim levert het al (sim.ts, één regel bij deze review). De HUD filtert hiermee het bouwmenu (turret en trainingsfaciliteit zijn nu nooit bouwbaar in de HUD, ook na onderzoek), de craft-opties (patrol zonder geweerrek wordt nu stil genegeerd) en de research-opties (al onderzochte techs staan nu in de lijst).
3. Event abilityZone (10): a = held, b = abilityId, x en y = midden van de zone. De sim stuurt het (hero.ts, één regel bij deze review); render tekent de zone (ring of decal met radiusU en durationTicks uit packages/data) in sprint 4. Events zitten niet in de hash, dus de fixtures blijven geldig.
4. Recruit = oplappen van de held op het hoofdgebouw: akkoord. buildingId is het entity-id van het eigen voltooide hoofdgebouw; Cancel met het hoofdgebouw stopt het. Geen eigen commando: Recruit op een ander gebouw wordt later de rekrutering van die factie (Garde-Initiate, zwervers), en de HUD kent het al als gebouwpaneel-regel.
5. typeId van de held = 1000 + heroId in de unit-ruimte, loadouts 1 tot 999: akkoord. De held is voor render en HUD een unit (selectie, orders, rig); `heroIdOfTypeId` zegt welke held. De grens 1000 is een afspraak in packages/data/src/typeIds.ts, niet in protocol-code (zelfde reden als de rest van de ruimte).
6. De zes interpretaties van het Spelfundament door sim-core: alle zes akkoord, als regel.
   - Perks werken alleen zolang de held leeft (Spelfundament 5.5 "dood: de perks vallen weg"); na oplappen komen ze terug, geschaald.
   - Oplappen schaalt perk-deltas en maxHp van de held met (1 − 0,2·r) na r keer (revivePenaltyPct uit heroes.json); na maxRevives is de held leeg (state empty).
   - xpPerKill alleen voor vijandelijke units die de held zelf doodt (het schot dat hp onder 0 brengt).
   - xpPerDiscovery alleen voor de eerste keer dat de speler een claimpunt neemt (`seenBy`), niet bij de startopstelling. Creep-kampen komen hier later bij.
   - De held telt niet als bewoner of pop (Spelfundament 2.5 telt bewoners; de held is er geen), schoolt niet om en is geen "bewoner verloren" in de HUD.
   - C en I werken voor de speler als geheel alleen zolang de held leeft; S, P, E, A, L op de held zelf.
7. SPECIAL-tuning in sim.json: akkoord. De waarde per punt van een letter geldt voor elke held van elke factie, dus het is een simregel, geen heldregel; de namen blijven specialXxx en critDamagePct. De held op het militie-loadout als basis: akkoord tot en met gate 1. Daarna krijgt heroes.json eigen basisvelden (hp, damage, damageType, armorType, rangeM, speedMps, cooldownS, visuals { meshSlots }), zodat de Krijger zijn eigen rig en wapen krijgt (Spelfundament 9: "1 held Krijger" als los asset). Niet voor gate 1: eerst de testgroep.
8. Turrets schieten niet: nodig voor de slice. Drie van de zes techs en perks (lasergeleiding, kluisvet, stille_knop) en de helft van Lockdown gaan over turrets, en "turret-netwerk" is de militaire identiteit van de Dwellers (Spelfundament 4). Afspraak: buildings.json krijgt voor gebouwen met provides turret damage, damageType, rangeM en cooldownS (content, contract 3); een voltooid gebouw met die velden heeft Combat in de sim: het kiest zelf een doel binnen rangeM (het beweegt niet, dus geen aggroRange), schiet in systeem 5 met shotFired en hit zoals een unit, tech- en perk-effecten op het gebouwtype gelden, en Lockdown target turrets werkt (sim-core). De scripted AI onderzoekt de prereqTech van zijn volgende bouworder (geweerrek voor de turret) in plaats van de order over te slaan (sim-core). Render: shotFired vanaf een gebouw krijgt mondingsvuur op dakhoogte (render-pipeline). Fixtures opnieuw (sim-core).
9. Exclusieve nodes op Rustbelt: opdracht aan map (werkstroom 7). Gemeten op data/maps/rustbelt.json met claimRadiusM 6: de dichtstbijzijnde scrap-node ligt op 34 tot 42 m van elk claimpunt, en elk claimpunt ligt op 61 tot 62 m van de spawns. Geen node is dus ooit exclusief en geen punt is bij de start van iemand; de regel uit sectie 13.4 werkt, de map niet. Eis: elk settlement-claimpunt heeft minstens één scrap-node binnen claimRadiusM, puntsymmetrie blijft. Voorstel: de twee settlement-punten naar circa 4 m van de 2500-nodes op (40, 38) en (87, 89), zodat de eigen uitbreidingsnode exclusief wordt zodra de claimpaal staat; het powerArmor-punt blijft in het midden. De map zit in de envHash: sim-core neemt de Rustbelt-fixtures opnieuw op na de mapwijziging.

**Overig, bevestigd in deze ronde**

1. packages/render mag `@crawlout/asset-cli/manifest` importeren (alleen het manifest-schema; tabel sectie 3). Het manifest is van de asset-cli (sectie 12), dus de zod-definitie hoort daar en render leest hem.
2. Claimen via het claimgebouw is doorgevoerd (data 0.6.0, claimS en aiMilitiaPct weg); het Claim-commando bouwt de claimpaal op de vrije plek het dichtst bij het punt, een eigen claimbouwplaats in de straal wordt geholpen.
3. Research kiest zelf het gebouw (eerste voltooide eigen gebouw van het type uit tech.building zonder lopend onderzoek); voortgang in duizendsten van een tick zodat researchTimePct en buildTimePct zonder breuken werken. Bevestigd.
4. De relay draait met dataVersion '0' als hij zonder versie start en de client slaat de controle dan over. Dat is een dode check: `pnpm relay` geeft data/VERSION door en de client-uitzondering vervalt (relay, sprint 4). Afgerond in de gate-1-ronde (sectie 15).

**Wat sprint 4 per werkstroom hieruit volgt (richting gate 1)**

1. sim-core: HeroStatus state, reviveTicksLeft, entityId en abilityCooldownTicks leveren; turrets (besluit 8) en de AI die prereqTech onderzoekt; fixtures opnieuw na turrets en na de mapwijziging; `replay:browsers` echt maken (Playwright in Chromium, Firefox en WebKit), het is een brief-eindcriterium en nu een echo.
2. render-pipeline: abilityZone tonen; shotFired vanaf gebouwen; de eerste Quaternius-asset door de echte buis zodra assets/src gevuld is (vraagt Martien: de agents doen geen downloads).
3. asset-cli: Quaternius-placeholders en tien Gobkit-props door de buis zodra de bronbestanden in assets/src staan; assets/dist/manifest.json is nu leeg.
4. content: turret-velden in buildings.json, data/VERSION omhoog; de basisvelden van de held pas na gate 1.
5. hud: PlayerStatus.techs voor bouwmenu, craft en research; HeroStatus.state en abilityCooldownTicks zodra de sim ze levert (entity-scan en cooldownPct 0 weg); de twee tests "werkt met de optionele velden afwezig" in packages/ui/src/hud.sprint3.test.ts vervallen (de velden zijn verplicht) en blokkeren tot dan de typecheck op arch-slice.
6. relay: BundleFeed.drain in apps/client geeft alleen aaneengesloten frames vrij (nu kan een gat stil een frame overslaan); dataVersion uit data/VERSION in `pnpm relay`; latency-simulatie van 300 ms (brief-eindcriterium); de test met twee browsers op één machine vastleggen als script.
7. map: claimpunten bij de nodes (besluit 9); creep-kampen en props via Three Scatter blijven open.

## 15. Contractbesluiten na sprint 4 (de gate-1-ronde)

Genomen op 14 oktober 2026 bij de architect-review van de gate-1-ronde (branch sprint-1 tot en met commit a1fcc3e: turret-velden en data 0.7.0, claimpunten bij de nodes, BundleFeed zonder gaten en dataVersion over ws, abilityZone-decal, turretschot en held in de shader, HeroStatus volledig, turrets en AI-research in de sim, inhalen met tijdbudget, alle fixtures opnieuw, `replay:browsers` echt), verwerkt in de secties hierboven (besluiten sprint 4), in packages/protocol 0.3.0 en in docs/CHANGELOG.md. Oordeel per gate: sim merge, netcode merge, shader merge; de enige "moet" lag bij de architect zelf (protocol-versie en CHANGELOG na de wijziging in snapshot.ts) en is in deze branch gefixt. De gate-1-checklist staat in docs/gate-1-checklist.md.

**Besluiten**

1. HeroStatus is compleet en verplicht (protocol 0.3.0). De code-wijziging in packages/protocol/src/snapshot.ts kwam van sim-core (commit 9b2b729) en volgt besluit 1 van sectie 14 letterlijk; eenmalig aanvaard. De scope-regel blijft: een wijziging in packages/protocol is een issue aan de architect, ook als het besluit al genomen is.
2. Turrets zijn Combat op een gebouw: een voltooid gebouw met damage > 0 krijgt Combat bij voltooiing (entities.ts completeBuilding), kiest zelf zijn doel binnen range (vanaf het midden van het gebouw tot de rand of footprint van het doel; units voor gebouwen, dichtstbijzijnde, tiebreak laagste id, nooit eigen of neutraal), houdt het zolang het binnen range is, en schiet in systeem 5 met shotFired en hit zoals een unit. flags.inCombat staat op een turret met doel (contract 1). Tech- en perk-effecten op het gebouwtype en ability-zones met target turrets of alle gelden. De turret-velden zitten in de envHash, dus data 0.7.0 heeft alle Rustbelt-fixtures opnieuw opgenomen.
3. De scripted AI onderzoekt de prereqTech van zijn volgende bouworder (diepte eerst in de keten) en wacht met de order tot de tech er is; zonder gebouw van het juiste type of bij een tech van een andere factie slaat hij de order over. Dat de hele bouwvolgorde wacht tot de tech betaald is, is bewust simpel: beide AI's komen er in de fixtures doorheen (s2-rustbelt-ai-vs-ai: geweerrek en een schietende turret aan beide kanten). Verfijnen na de testgroep.
4. Inhalen in de worker: contract 1 en 2 aangevuld (het `hashes`-bericht, geen gat in de hashreeks, events van overgeslagen ticks vervallen). Gevolg voor de HUD: waarschuwingen die uit events komen (bewoner verloren, claim verloren, aanval) ontbreken voor de ingehaalde periode na een resync. Aanvaard voor de slice; de HUD toont de stand uit de query.
5. Het `hashes`-bericht en het tijdbudget (CATCH\_UP\_BACKLOG 16 bundels, 14 ms per slag in host/worker-entry.ts) zijn sim-interne afspraken tussen worker en client, geen protocol: ze staan in packages/sim en apps/client, niet in packages/protocol.
6. Aan de clientkant geldt "nooit met een gat" (contract 2, lockstep 3) nu ook: BundleFeed geeft alleen aaneengesloten frames vrij. dataVersion over ws is af (sectie 14, overig 4): `pnpm relay` leest data/VERSION, de '0'-uitzondering is weg.
7. `replay:browsers` is de afdwinging uit sectie 7 (2): Playwright in Chromium, Firefox en WebKit, wekelijks in CI met strict, `--chrome` als handmatige test. Lokaal is alleen Chrome 155 en Chromium 147 gedraaid; Firefox en WebKit zijn nooit gedraaid tot Martien de browsers installeert of de branch pusht (de workflow draait alleen op GitHub).
8. Fixtures mogen met een bot worden opgenomen (tools/replay/src/bot.ts): de bot kijkt naar de state en geeft gewone commando's, de fixture bevat de bundels, het afspelen draait zonder bot. De bot mag floats gebruiken; het determinisme zit in de sim. Zo zijn s4-rustbelt-turrets en s4-rustbelt-fifty (het brief-eindcriterium van sim-core: 50 bewoners per kant uit huisvestingsgroei, binnen de pop-cap) opgenomen.
9. Rustbelt (data 0.7.0): settlement-claimpunten op (40, 34) en (87, 93), 4 m van de 2500-nodes, binnen claimRadiusM 6; creep-kampen op (52, 56) en (75, 71) op de route basis naar midden. Creep-kampen blijven data zonder simregel tot na gate 1 (ze horen bij xpPerDiscovery, sectie 14 besluit 6); props via Three Scatter idem. Geen van beide is een gate-1-criterium uit het Spelfundament.
10. Shader-gate (packages/render/src/units/unitMaterial.ts): de held-vlag zit als 256 boven de uint8-snapshotvlaggen in de instance-attribute iAnim.w (float32) en de shader leest iAnim.w alleen als "≥ 256", dus de snapshotvlaggen blijven ongemoeid; de held-onderdelen van de placeholder zitten in de vertexkleur (alpha ≥ 2, masker = alpha − 2) en klappen voor gewone units naar de bone-oorsprong; een geladen GLB heeft alpha ≤ 1 en krijgt alleen de schaal (1,15 om de modeloorsprong, voeten op y = 0). Eén draw per rig per LOD blijft; abilityZone en het turretschot zitten in de bestaande decal- en particle-batches. Akkoord; de eigen rig van de held komt na gate 1 (sectie 14, besluit 7).

**Open na deze ronde, per werkstroom (mag, geen blokkade voor gate 1)**

1. sim-core: combat.ts turretAim overschrijft het hele flags-byte van het gebouw (nu onschadelijk, wel maskeren zodra gebouwen een tweede vlag krijgen); de AI die zijn bouwvolgorde laat wachten op een onbetaalbare tech (besluit 3 hierboven); de events die bij inhalen vervallen (besluit 4).
2. relay: het klokvrije harnas (apps/client/test/support/lockstepNet.ts) tikt de sim direct, niet via SimWorkerCore.pump en session.ts, dus het `hashes`-pad is alleen in packages/sim/test/worker.test.ts gedekt; één harnastest via createSimWorkerCore sluit dat. `startRelayServer` zonder dataVersion meldt nog '0' (server.ts), wat de client nu weigert: maak de optie verplicht of lees data/VERSION als default. `BundleFeed.gapAt` wordt nergens gelezen. De test met twee browsers op één machine over de ws-relay is nog geen script.
3. render-pipeline: de cull-bol van een held is niet met HERO\_SCALE vergroot, dus een held aan de schermrand kan iets te vroeg verdwijnen.
4. hud: de vier filters uit sectie 14 zijn gebouwd (apps/client/src/main.ts: bouwmenu, craft en research op PlayerStatus.techs, dood-zijn en cooldownPct uit HeroStatus); de entity-scan als terugval in heroAlive is dode code sinds state verplicht is.
5. map: creep-kampen in de sim en props (na gate 1).

**Wat Martien moet doen (niet door agents te doen)**

1. assets/src vullen met de Quaternius-placeholders en tien Gobkit-props en `pnpm assets` draaien; daarna de render-demo met `?unit=<id>`: dat bewijst de renderbuis met placeholders (voorwaarde voor de artistkeuze, Spelfundament 12).
2. De browsermatrix en de meting: eenmalig `pnpm --filter @crawlout/replay exec playwright install chromium firefox webkit`, dan `pnpm --filter @crawlout/replay run replay:browsers -- --chrome`; en de render-demo op een laptop met geïntegreerde GPU (het doel is 60 fps, 150 draw calls, geen frame boven 20 ms). Na het pushen draait browsers.yml wekelijks.
3. De testgroep (5 tot 8 mensen) samenstellen en de eerste sessie spelen: een potje tegen de AI uit de HUD zonder console, en één potje met twee browsers over `pnpm relay`, met een reload halverwege.

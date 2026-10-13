# Contractwijzigingen

Elke wijziging aan een contract (fase-0 sectie 4 tot 6) komt hier, samen met de bijbehorende wijziging in packages/protocol.

- 2026-10-13: fase 0 vastgelegd. Contract 1, 2 en 3 als doc en als code in packages/protocol en packages/data.
- 2026-10-13 (architect-review sprint 1), contract 1:
  - Yaw-conventie vastgelegd: 0 = sim +x, 16384 = sim +y, yaw = atan2(dy, dx) (`YAW_PLUS_X`, `YAW_PLUS_Y`). Waarom: sim en render namen elk een andere conventie aan; de sim is de bron van waarheid en een wijziging daar zou alle fixtures ongeldig maken. Render rekent om (interpolate.ts), hashes ongewijzigd.
  - Anim-ids vastgelegd als `ANIM` en `ANIM_NAMES` (idle 0 tot death 7, de clipvolgorde van de artist-brief). Waarom: sim en render gebruikten elk eigen getallen die toevallig gelijk waren.
  - Entity-id-indeling vastgelegd: index · 2^20 + generatie (`ENTITY_INDEX_BITS`, `ENTITY_GEN_BITS`, `ENTITY_NONE`). Waarom: de sim-implementatie klopt en de HUD en render moeten ids kunnen lezen zonder de sim te importeren.
  - Snapshot-header: tick is het laatst uitgevoerde frame, hash de state-hash na dat frame. envHash (dataVersion, config, map, spelers) in de state-header is de invulling van "dataVersion in de hash-seed".
  - AI draait in de sim op elke client (LobbyPlayer.ai), niet als tweede verbinding met hash-vrijstelling. Waarom: determinisme en replays zonder aparte AI-client; past op systeemstap 2.
- 2026-10-13 (architect-review sprint 1), contract 2:
  - Frame-semantiek: bundle.frame is het uitvoerframe, envelope.frame het frame van de speler; te late commando's schuiven naar de eerstvolgende bundel. HashReport.frame = f is de hash na frame f, gemeld als f mod 20 = 0; Replay.hashes idem.
  - Seed is een uint32 (`SEED_MAX`), in start en in Replay.
  - LobbyPlayer krijgt `ai: boolean` (verplicht). MatchSettings.dominanceMinutes wordt optioneel: ontbreekt hij, dan geldt de waarde uit de map. Waarom: de relay mag geen spelregelgetallen kennen (regel 4); de default van 10 minuten in relay-code is verwijderd.
  - Nieuwe client-berichten: setSettings, addAi, removeAi; join krijgt een optioneel clientId voor reconnect na start; het lobby-bericht krijgt optioneel settings. Geen client-bericht start: de relay start zodra iedereen ready is.
  - Startopstelling staat niet in de replay; zij volgt uit map (spawns) plus data (startUnits) plus players. Tot sprint 2 staat de testopstelling in tools/replay/src/scenarios.ts.
  - Desync stopt het potje (bevestigd). Fixtures opnieuw opgenomen vanwege het ai-veld; alle hashes identiek.
- 2026-10-13 (architect-review sprint 1), contract 3:
  - Veldnamen in de bestanden volgen de menselijke eenheid (cooldownS, craftS, buildS, researchS, reviveS, rangeM, speedMps, revivePenaltyPct); de loader levert Ticks, U, UPT en Permille. De doc is hierop aangepast; de code was al zo.
  - Nieuwe velden (content, sprint 2): loadouts gatherAmount en gatherS; heroes maxRevives; maps dominance { pointsRequired, minutes }. DamageMatrix als strict object met \_comment bevestigd. effects\[\].stat houdt de suffix-conventie Pct, M, S, maar de set namen wordt een enum in packages/data.
- 2026-10-13 (architect-review sprint 1), sectie 12 toegevoegd: bone-matrix-formaat tussen asset-cli en render (texture van render, manifest van asset-cli) en de sprint-2-gevolgen per werkstroom.
- 2026-10-13 (content, sprint 2), contract 3: schema-uitbreidingen uit het architectbesluit zijn doorgevoerd (data/VERSION 0.3.0). Loadouts gatherAmount/gatherS (scavenger 10 per 6 s, rest 0), heroes maxRevives (4), MapDef dominance (voorlopig optioneel tot de mapbestanden het veld hebben), effects[].stat als enum `EffectStat`. Nieuw, ter review door de architect: typeId-ruimte in packages/data/src/typeIds.ts (unit 1+loadoutId, gebouw 1024+buildingId, scrap-node 2048, claim-point 2049).
- 2026-10-14 (architect-review sprint 2), contract 1:
  - `OWNER_NEUTRAL` = 255 in protocol als eigenaar van scrap-nodes en onbezette claimpunten (sim had `NEUTRAL` in world.ts, de client een eigen 255). Waarom: HUD, render en client lezen owner uit de snapshot en moeten neutraal herkennen zonder de sim te importeren.
  - typeId-ruimte vastgelegd (unit 1 + loadoutId, gebouw 1024 + buildingId, scrap-node 2048, claimpunt 2049); de code blijft in packages/data/src/typeIds.ts omdat de indices uit de loader komen.
  - Events: a is altijd de entity, x en y haar positie; b per type (death en gebouw-events typeId, hit a = doel en b = schutter, claimTaken b = nieuwe eigenaar, heroLevel b = level). Waarom: een gesloopt gebouw staat niet meer in de snapshot waar het event in zit.
  - hpPct en animT buiten units: scrap-node hpPct = resterende voorraad in procent (sim-core sprint 3); gebouw in aanbouw build met animT = voortgang; claimpunt animT = claimvoortgang; lijk death. flags.selected zet de client.
  - PlayerStatus.hero wordt `HeroStatus` met heroId, xpNext, pendingPerks en revivesLeft (optioneel tot de held in de sim zit, sprint 3). Waarom: de HUD had er een eigen HeroInfo voor nodig.
- 2026-10-14 (architect-review sprint 2), contract 2:
  - Build: x, y is het midden van de footprint, oorsprong cel(x, y) − (w >> 1, h >> 1); Cancel voor bouwplaatsen en units; Claim wordt het bouwen van het claimgebouw bij het punt (sprint 2 interim: Claim-order). Zod-validatie één keer bij binnenkomst van de bundel.
  - DELAY adaptief op de relay zonder bericht; MatchSettings.delayFrames is de startwaarde. Stall van twee kanten: client pauzeert zelf bij een ontbrekende bundel, relay meldt `stall` op een ontbrekende hash na STALL\_TIMEOUT\_MS.
  - ResyncResponse.frame = Sim.frame van de state (eerstvolgend uit te voeren frame); bundels vanaf frame, aangevuld uit de relay-geschiedenis (1200 frames, peer-timeout 5 s). Reconnect: relay stuurt opnieuw `start` en start de resync zelf; gestarte lege room blijft 60 s.
- 2026-10-14 (architect-review sprint 2), contract 3:
  - sim.json staat nu in de tabel: unitRadiusM, arriveRadiusM, separationPct, flowFieldBudgetCells, walkAnimStep, aggroRangeM, interactRangeM, claimRadiusM, popCapMax, corpseS, plus nieuw cancelRefundPct. aiMilitiaPct verhuist naar ai/\*.json als militiaPct; claimS vervalt zodra claimen via het claimgebouw loopt (sectie 13). Content voert dit in sprint 3 door; data 0.4.0 blijft geldig tot dan.
  - tools/replay mag packages/map importeren (tabel sectie 3). Waarom: de omgeving van een replay komt uit data/ en data/maps, dezelfde opbouw als de client.
- 2026-10-14 (architect-review sprint 2), sectie 12: manifest-velden gelijkgetrokken met de code van tools/asset-cli/src/manifest.ts (`baked { path, width, height, fps, clips[{ name, startRow, frames, loop, durationSeconds }] }`, boneCount per asset); render kiest float32 of half-float, het manifest blijft float32.
- 2026-10-14 (architect-review sprint 2), sectie 13 toegevoegd: de zes spelregels die sim-core zonder data invulde (vijf akkoord, claimen terug naar het ontwerp met het claimgebouw) en de sprint-3-gevolgen per werkstroom.
- 2026-10-14 (content, sprint 3), contract 3: data/VERSION 0.5.0. sim.json cancelRefundPct 100; ai/*.json militiaPct 50 (sim.json aiMilitiaPct en claimS blijven staan tot sim-core omschakelt en vervallen dan); heroes.json krijgt naam, xpPerLevel (per stap, niet cumulatief; de loader levert cumulatieve `xpThresholds`), xpPerKill, xpPerDiscovery en abilities met naam, radiusM, durationS en effects[] { stat, side, target, delta } (Lockdown: 6 m straal, 8 s, vijanden speedPct -50, eigen units en turrets damagePct +25). GameData: `sim.cancelRefundPermille`, `aiScripts[].militiaPermille`, `heroes[].naam/xpThresholds/xpPerKill/xpPerDiscovery`, `heroes[].abilities[].radiusU/durationTicks/effects`.

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

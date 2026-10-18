## 23. Contractbesluiten na fase 2 ronde 1 en 2 (deel c)

**Open na deze ronde, per werkstroom (mag, tenzij anders vermeld)**

1. relay met hud (moet): `you` in het lobby-bericht dragen en lezen (besluit 7); relay 0.3.0 afknippen (besluit 8).
2. hud met architect (moet): protocol 0.13.0, `PlayerStatus.claimPoints` verplicht zodra de PlayerStatus-literals in packages/ui, apps/client, protocol.test.ts en packages/sim/test hem dragen (10 van de 21 dragen hem nu; sectie 22 besluit 3); mag: een gemarkeerd voorstel voor de Raider-stand in PlayerStatus als de HUD de dosis en cooldown van een Chem-dealer wil tonen (besluit 8); de build-test voor de skin (sectie 22 besluit 9).
3. render-pipeline: de render-demo `?xl` opnieuw meten met de mist en de aanhangsels (besluit 6); rockTerrain.ts in de demo en de cull-bol van de held staan nog.
4. asset-cli: props voor de Dweller-wapens en -gereedschappen (9 slots overgeslagen, besluit 6); `rigid: true` uit het schema en het manifest en `scale` per prop in rigmap.json staan nog.
5. sim-core: sim.rng in plaats van de laagste playerId in claims.ts bij meer dan één aanvaller of held in een cirkel (sectie 22 besluit 6, vóór een potje met drie of meer spelers); de punten uit sectie 17 (upgradeOne, raidOver) en sectie 15 (events van overgeslagen ticks) staan nog.
6. content: data/README.md kent de Raiders, de mist en de creep-kampen nog niet (geen regel over sightM, vision, creeps.json of versus); de balans van het hoge kamp na de testgroep (besluit 5); elke balanswijziging aan een loadout met een regel in combat-balance.test.ts (sectie 22 besluit 5).
7. map en replay: ongewijzigd voor de contracten; match-length.test.ts en de tijdtests buiten de parallelle run staan nog.

**Wat Martien moet doen (niet door agents te doen)**

1. Winroute C kiezen (vraag 1 van docs/fase-2-plan.md): welk bouwproject, zichtbaar voor iedereen, met een countdown en een zwakke plek; tot die keuze bouwt niemand eraan.
2. Spelen op Rustbelt XL uit het menu: een potje als Dwellers tegen de Raider-AI en een potje als Raiders tegen de Dweller-AI, met de mist (verkend grijs, onverkend donker, ghosts van vijandelijke gebouwen), de creep-kampen (het nabije kamp rond minuut 10, het hoge kamp is dodelijk voor een losse held), vangen en bevrijden met de rechtsklik, en de Raider-balk; zeggen of de klassieke mist bevalt of dat alleen "niet zichtbaar" beter voelt.
3. De meting op een laptop met geïntegreerde GPU, nu met de mist en de aanhangsels: het potje (`index.html?skip=1`) en de render-demo (`render-demo.html?xl`) op WebGPU en met `?webgl`, elk met de standaard en met `?shadows=0`; het doel blijft 60 fps, onder 150 draw calls, geen frame boven 20 ms bij een camera-draai. Op de MacBook is alles groen (besluit 6).
4. sprint-1 pushen en de PR naar main openen (ci.yml en browsers.yml hebben nog nooit gedraaid); lokaal `replay:browsers -- --chrome` op data 0.25.0.
5. De testgroep en de eerste sessie: potje tegen de AI, potje met twee browsers over `pnpm relay` uit de lobby van het menu met een reload. Geen screenshots met de bitmapskin of fanart delen (`?noskin`).

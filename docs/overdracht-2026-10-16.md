# Overdracht: nacht van 15 op 16 oktober 2026

Alles staat op `sprint-1` en is gepusht. Lint, typecheck, 1188 tests, 11 replay-fixtures en `prettier --check` zijn groen. Data 0.18.0, sim 0.15.0, protocol 0.9.0. Er staat geen fanart in git, en de productiebuild bevat ook geen fanart (gecontroleerd op checksum).

Video van deze stand (uit de productiebuild, dus zonder fanart): `~/Crawlout-video/crawlout-nacht-16okt.mp4` (39 s). Hij staat bewust buiten de repo.

## Wat er bij kwam

| Onderdeel               | Wat je ziet                                                                                                                                                                                                                                                                         | Waar                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Schaduw en licht        | Echte zonschaduw van units, robots, bomen, gebouwen en scrap; één lichtopzet met hemellicht, ACES, lucht en mist in dezelfde kleur; de kaartrand loopt door in heuvels en verdwijnt in nevel. `?shadows=low` of `?shadows=0`; WebGL2 kiest zelf laag                                | `packages/render/src/lighting`, `shadows`                         |
| Eén stijl               | Gedeeld palet, materiaalrecept en verwering voor gebouwen, props, units en robots; teamkleur als accent op borst en schouders                                                                                                                                                       | `packages/render/src/look`                                        |
| Terrein                 | Detail van dichtbij, contactrand onder gebouwen, gebouwen op hellingen staan op een vlak plateau; minimale zoom 26 m                                                                                                                                                                | `packages/render/src/terrain`, `decals`                           |
| Beweging                | Elke unit loopt in eigen fase en tempo; groepsorders geven een formatie in rijen                                                                                                                                                                                                    | `units/animVariation.ts`, `packages/sim/src/systems/formation.ts` |
| Robot-uitbreiding       | Robotfabriek, beveiligingsrobot, reparatiedrone, sentinel, laserturret met netwerkbonus, technicus-regel (1 per 4 robots), radiobaken als vangnet, SPECIAL-training, bonussen van de Opziener                                                                                       | data 0.16.0, sim 0.13.0                                           |
| AI                      | Bouwt robots, sentinels en laserturrets, traint de held; potjes 25,9 tot 32,6 minuten, 24 op dominantie en 9 op vernietiging                                                                                                                                                        | `data/ai/dwellers-basic.json`                                     |
| HUD                     | Gebouwen-balk met al je gebouwen en hun upgrades; gebouwen aanklikbaar op dak en muren; klik op lege grond of Esc deselecteert; commando's per unit-type; kaartenvenster boven de commando's; fps rechtsboven; kaarten voor produceren en trainen; een rode bouwplek noemt de reden | `packages/ui`, `apps/client`                                      |
| Klikprobleem            | Oorzaak: de client bleef na Verplaats of Val aan in de richtmodus hangen en slikte daarna elke klik. Opgelost en afgedekt met een browsertest                                                                                                                                       | `tools/replay/src/hud-clicks.ts`                                  |
| Vastlopende plunderaars | Oorzaak: een gebouw mocht op een scrapbron staan, en verzamelaars bleven dan op de plek lopen. Nu moet rond elk gebouw 1 m vrij blijven, kiezen verzamelaars een andere bron, en gaan nieuwe bewoners vanzelf verzamelen                                                            | `packages/sim/src/systems/placement.ts`                           |
| Held-ability            | Buiten bereik loopt de held eerst naar het doel; een klik op een vijand tijdens Val aan of een ability wordt het doel                                                                                                                                                               | sim en `game/clickRules.ts`                                       |
| Speeltest-bot           | Speelt 15 minuten via de echte HUD met muis en toetsenbord en meldt wat hapert                                                                                                                                                                                                      | `npx -y pnpm@9 --filter @crawlout/replay run playtest`            |
| Sim-snelheid            | De piek na het plaatsen van een gebouw is weg (max per tick rond 2 ms)                                                                                                                                                                                                              | `packages/sim/src/flowfield.ts`                                   |
| Assets                  | Gedetailleerde robots en robotfabriek; cilinders en kegels in alle gebouwen staan niet meer binnenstebuiten                                                                                                                                                                         | `assets/src/robots.json`, `tools/asset-cli`                       |
| Architect               | Besluiten in fase-0 secties 20 en 21; gate-1-checklist bijgewerkt                                                                                                                                                                                                                   | `docs/`                                                           |

## Voor jou om te beslissen

1. **Looppad rond de basis.** `depotClearanceM` staat op 1 m. Met 2 m blijft het eerlijk, maar eindigen te weinig potjes op vernietiging. Wil je een breder pad rond het hoofdgebouw?
2. **Losse unit.** Eén losse unit stopt tot ongeveer 1 m naast je klik, op een vast raster (nodig voor eerlijkheid onder de spiegel).
3. **Robotformaat.** De beveiligingsrobot is 3 x 3,5 m en de sentinel 4 x 6,4 m: kleine tanks naast poppetjes van 1,8 m.
4. **Donkere kant van modellen.** Om schaduwen zichtbaar te maken is de schaduwkant van alle modellen iets donkerder gezet. Beoordeel of je dat mooi vindt.
5. **PR naar main**, zodat CI eindelijk draait: `gh pr create --base main --head sprint-1`.

## Nog open

- Meten op een laptop met geïntegreerde GPU (`?shadows=low`, `?shadows=0`, `?webgl`).
- "Groep loopt op de snelheid van de traagste" is niet gebouwd (vraagt nieuwe sim-state).
- Het dak van de woning gebruikt een grove atlas; rotsen en bomen blijven zacht door hun bronbestanden.
- Ordening van de render-, ui- en client-CHANGELOGs (bulk-werk, loopt nog of volgt).

## Starten

```
cd ~/Crawlout
npx -y pnpm@9 dev                          # spel op http://localhost:5173/
npx -y pnpm@9 relay                        # multiplayer: ?relay=ws://<ip>:8787&room=x&name=Jij
```

Deel geen screenshots of video's uit de dev-server: die laadt lokaal je fanart. De video hierboven komt uit de productiebuild en is schoon.

# Winroute C: het oude winkelcentrum (Bouwproject)

18 oktober 2026 · keuze van Martien: "oud winkelcentrum met supermarkt, benzinestation, garage en watertoren". Voorstel, ter bevestiging door de architect (data 0.30.0, sim 0.25.0, protocol 0.16.0, map 0.11.0, ui 0.18.0, client 0.10.0).

## Regel

1. Op de map staat een vervallen winkelcentrum met vier soorten delen: Supermarkt, Benzinestation, Garage en Watertoren. Elk deel is een neutrale ruïne: geen doelwit, geen zicht, van niemand.
2. Bouwers herstellen een ruïne (rechtsklik op de ruïne, of de kaart "Herstel" in het projectpaneel; in de sim gewoon Build op de ruïne). De kosten gaan meteen af, daarna is het een bouwplaats van die speler (hp groeit, meer bouwers gaan sneller, Cancel geeft de ruïne terug met teruggave).
3. Een hersteld deel is van wie het herstelde: een gebouw (doelwit, gebied om bij te bouwen, zicht) met een kleine bonus:
   - Supermarkt (25 x 15 m): voedsel, 5 bedden.
   - Benzinestation (luifel 15 x 10 m): brandstof, robots en voertuigen 15 procent sneller.
   - Garage (12 x 10 m): gereedschap, bouwen en herstellen 15 procent sneller.
   - Watertoren (voet 6 x 6 m, 18 m hoog): uitkijkpost, 40 m zicht.
4. Wie van elke soort een hersteld deel houdt, start een openbare countdown van 5 minuten. Loopt hij af, dan wint die speler ("door het Bouwproject").
5. De zwakke plek: een treffer op een van zijn herstelde delen zet de countdown 10 seconden stil (sabotage); valt een deel op 0 hp, dan is het weer een ruïne en staat zijn countdown op nul. Een ruïne herstelt wie het eerst komt, ook de vijand.
6. Iedereen ziet de delen en hun stand (kaartkennis zoals claimpunten): op de map, op de minimap (vierkant in de kleur van de eigenaar, oranje omlijnd als ruïne, rood bij sabotage) en in het projectpaneel; meldingen bij herstel, verlies, sabotage en een countdown die begint.

## Keuzes

- **Twee gespiegelde vleugels bij de landbrug, geen centrum in het midden.** Rustbelt XL is puntsymmetrisch; vier verschillende delen kunnen niet zelf-symmetrisch om één punt staan, dus één complex is nooit eerlijk. Elke oever van de kloof krijgt een vleugel met alle vier de delen op de tafelberg naast de brug (oost: supermarkt 241,188, watertoren 222,190, garage 238,208, benzinestation 258,208; west gespiegeld). Een vleugel ligt aan de eigen kant maar 130 m van de basis, aan de frontlinie: een turtler moet naar buiten, de tegenstander kan via de brug saboteren. Gangen van minstens 3 m, de ruïne-dekking van de map blijft staan; de begaanbaarheid en het terrein van de map veranderen niet.
- **Elke soort één keer, uit elke vleugel.** De countdown vraagt van elke soort één hersteld deel, niet een hele vleugel: een sterke speler kan een deel van de vijand overnemen nadat hij het tot ruïne schoot.
- **Apart speltype Bouwproject.** Skirmish blijft winroute A en B, precies zoals gemeten en gebalanceerd voor de testgroep; Bouwproject is Skirmish plus winroute C. De sim zet de delen alleen neer met `MatchSettings.mode` `project` (in de envHash), dus alle Skirmish-replays houden hun uitkomst. Als C na de speltest goed voelt, gaat het met één instelling in Skirmish.
- **Eén entity per deel, twee gebouwtypes.** Ruïne en hersteld zijn twee neutrale gebouwtypes per deel (data/project.json, door de loader achter de factiegebouwen gezet), zodat render en HUD het juiste model en de juiste naam tonen zonder protocolwijziging in de snapshot. Asset-ids: `site_<deel>_ruin` en `site_<deel>_restored` (procedurele placeholders van de asset-cli; een GLB van Martien kan ze onder dezelfde id vervangen).

## Data

`data/project.json`: countdownS 300, pauseAfterHitS 10, per deel hp, pantser, restoreScrap (260, 180, 220, 150), restoreS (70, 45, 55, 40), footprint, bedden, zicht, effecten en de twee asset-ids. `ai/*.json project`: de Dweller-AI herstelt vanaf minuut 13 met 10 man leger (natuurlijke winroute, verzamelt zijn leger bij de delen); beide AI's saboteren een tegenstander die 3 (Dwellers) of 2 (Raiders) soorten houdt of zijn countdown loopt. De Raiders herstellen niet zelf. Maps: `projectSites` in maps/rustbelt.json (gegenereerd uit packages/map/src/gen/rustbelt.ts).

## Meting (AI tegen AI, Bouwproject, seeds 1 tot 11, drie rondes)

| Matchup                                   | Winst                  | Routes                                       | Lengte            |
| ----------------------------------------- | ---------------------- | -------------------------------------------- | ----------------- |
| Dwellers tegen Dwellers                   | speler 0 7, speler 1 4 | 6 vernietiging, 3 dominantie, 2 Bouwproject  | 29,0 tot 36,8 min |
| Raiders tegen Dwellers (beide kanten, 22) | Raiders 7, Dwellers 15 | 12 vernietiging, 8 dominantie, 2 Bouwproject | 26,4 tot 39,7 min |
| Raiders tegen Raiders                     | speler 0 8, speler 1 3 | 4 vernietiging, 7 dominantie                 | 26,3 tot 35,8 min |

Open: de Raiders winnen in Bouwproject 32 procent (de band van Skirmish is 40 tot 55): de delen geven de Dwellers bedden en tempo. Twee extra rondes (later herstel, eerder saboteren) verschoven het niet en maakten potjes langer; na drie rondes gestopt (regel van Martien). Volgende stap voor content: de Raider-AI de delen laten gebruiken of de bonus van de supermarkt verkleinen, gemeten over 33 seeds.

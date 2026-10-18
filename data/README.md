# data/

Alle spelregels die getallen zijn. Eigenaar: werkstroom content. Schema's en loader staan in `packages/data` (`src/schemas.ts` is de bron van waarheid voor velden en bereiken; alle schema's zijn `strict`, een onbekend veld laat de build falen).

Eenheden in deze bestanden zijn menselijk: meters, seconden, procenten. De loader rekent om naar sim-eenheden. `VERSION` is semver en zit in elke replay en in de hash-seed. Elk balanswaarde-veld hoort een `_comment` te hebben met de bedoeling van het getal.

Een lijst die over een map verdeeld is (`loadouts/*.json`, `buildings/*.json`) bestaat uit JSON-arrays die de reader op bestandsnaam aan elkaar plakt; de volgorde telt, vandaar het nummer vooraan de naam.

## Bestanden

| Bestand                              | Inhoud                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| `factions.json`                      | per factie: startunits, vangnet, robotregels, Raider-regels (slaven, plunder, chems)  |
| `loadouts/*.json`                    | units: stats, kosten, `visuals.meshSlots`, en per rol de extra blokken hieronder      |
| `buildings/*.json`                   | gebouwen: footprint, `provides`, turretstats, `cage`, `placement`, `sightM`           |
| `tech.json`, `training.json`         | techboom en SPECIAL-training van de Dwellers                                          |
| `heroes.json`, `perks.json`          | helden (xp, abilities, `aura`) en perks                                               |
| `creeps.json`                        | neutrale bandietenkampen: units en tiers                                              |
| `damage-matrix.json`, `sim.json`     | schadetype tegen pantsertype; globale sim-tuning (vorming, plaatsing, vision, claims) |
| `maps/<id>.json` (plus raster-files) | kaart: nodes, claimpunten, spawns, `creepCamps`, dominantie                           |
| `ai/*.json`                          | AI-scripts: bouwvolgorde, golven, onderzoek, roofplan, creeps                         |

## Raiders (data 0.21.0)

Alle blokken zijn optioneel; een Dweller-record blijft geldig. Factie `raiders` heeft `specialChannel: "chems"`.

**`factions.json`, factie `raiders`:**

| Veld                                                                                                                                                                              | Wat                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `slaves.capturedLoadoutId`                                                                                                                                                        | loadout waar een gevangene na de Kooi-transitie een slaaf van wordt                                                                                                                        |
| `slaves.minDistanceFromOwnerBaseM`                                                                                                                                                | roven mag alleen verder dan dit van het hoofdgebouw van het doel                                                                                                                           |
| `slaves.liberation`: `touchS`, `touchRangeM`, `guardRadiusM`, `freedSpeedPct`                                                                                                     | een vijand die de slaaf `touchS` aanraakt bevrijdt hem, tenzij een Raider-vechter binnen `guardRadiusM` staat                                                                              |
| `slaves.revolt`: `cageNearM`, `guardRadiusM`, `cageGuards`, `guardModeSlavesPerGuard`, `noCageGuards`, `noCageSlaves`, `escapeM`, `graceS`, `emptyGraceS`, `escapePct`, `repeatS` | de bewaakregel (data 0.29.0, zie hieronder): te weinig bewakers bij een slavengroep: na `graceS` ontsnapt `escapePct` van de groep, herhaald elke `repeatS`                                |
| `plunder`: `buildingLootPct`, `depotLootMultiplierPct`, `carryLootPct`, `bonusTech` + `bonusPct`                                                                                  | buit uit gesloopte vijandelijke gebouwen (procent van `scrapCost`, depot dubbel bij 200) en gedode verzamelaars (procent van de vracht); de bonus komt uit een tech en moet als paar staan |
| `tribute`: `claimKind`, `scrapPerMin`, `bonusTech` + `bonusPct`                                                                                                                   | scrap per minuut per bezet neutraal claimpunt van die soort (`scrap`, `settlement`, `powerArmor`)                                                                                          |
| `chems[]`                                                                                                                                                                         | zie hieronder; verplicht bij `specialChannel: "chems"`, anders verboden                                                                                                                    |

**Chem** (`id`, `naam`, `flavourText`, `requiresTech`, `doseScrap`, `activeS`, `crashS`, `cooldownS`, `effects`, `crash`, optioneel `refined`): een dosis kost `doseScrap`, werkt `activeS` seconden met `effects`, geeft daarna `crashS` seconden `crash`-effecten en daarna `cooldownS` rust op die unit. Geen verslaving. `refined` (`requiresTech`, `activePct`, `crashPct`) verandert de duren in procenten (negatief = korter). Effecten zijn `{ stat, target, delta }` zoals bij tech en perks.

**`loadouts/*.json`, Raider-units:**

| Veld                                                   | Wat                                                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `slave: true`                                          | slaaf: `role` scavenger of builder, `human`, `damage` 0, geen `producedAt`, werkt alleen binnen `cage.workRadiusM` van zijn Kooi, bevrijdbaar          |
| `capture`: `rangeM`, `captureS`, `targets`, `maxHpPct` | slaver: roft een `wanderer` (zwerver) of `resident` (vijandelijke bewoner onder `maxHpPct` hp); de gevangene loopt naar de dichtstbijzijnde eigen Kooi |
| `aura`: `radiusM`, `chems`, `trigger: "gevecht"`       | chem-dealer: doseert eigen units in de straal met een chem uit de lijst (voorkeursvolgorde), zodra er gevecht is                                       |
| `producedAt`                                           | gebouw-id waar de unit nieuw gebouwd wordt (tent, autosloperij); verplicht bij robots, nu ook toegestaan bij andere lichamen                           |
| `bodyType: beast` / `vehicle`                          | honden en de Buggy: alleen een ander lichaam, geen eigen sim-regels                                                                                    |

**`buildings/*.json`:** `cage` (`capacity`, `transitionS`, `workRadiusM`) is verplicht bij `provides: ["kooi"]` en anders verboden. `placement` (`minFromHqM`, `maxFromHqM`, midden tot midden) beperkt waar een gebouw mag staan, bijvoorbeeld de Kooi aan de rand van de basis. Nieuwe `provides`-waarden: `tent` (vechters-instroom en vangnet), `kooi`, `depot` (afleverpunt naast hq en werkplaats), `chemlab`. Het vangnet van de Raiders is `tenten_instroom` (`threshold` telt vechters).

**`heroes.json`, held van de Raiders (Warlord):** `aura` (`radiusM`, `effects[]`) is een passieve intimidatie-aura, altijd aan zolang de held leeft; een effect is `{ stat, side: "enemy" | "ally", target: "units" | "turrets" | "alle", delta }` zoals bij een ability. Verder `xpPerCapture` (xp per geroofde gevangene) en `baseLoadoutId` (het basis-loadout van de held; afwezig = het goedkoopste militie-loadout zonder tech en zonder `producedAt`).

## Zicht (fog of war, data 0.22.0)

`sim.json` blok `vision`: `cellM` (1, 2 of 4 m, grid van het zicht) en de standaardstralen `unitSightM`, `heroSightM`, `buildingSightM` (voorbij de rand van de footprint) en `turretSightExtraM` (voorbij `rangeM`). Maximaal 64 m. Een record kan dit overschrijven met **`sightM`** (meter, 0 tot 64): op een loadout of held vanaf het midden van de unit, op een gebouw voorbij de footprint (de sim telt de helft van de grootste zijde erbij). Zonder `sightM`: unit en held krijgen de standaard, een turret `rangeM + turretSightExtraM`, een ander gebouw `buildingSightM`.

## Creeps (data 0.25.0)

`creeps.json` heeft `units` en `tiers`. De kaart zet kampen in `maps/<id>.json` `creepCamps` (`x`, `y`, `tier`).

- **`units[]`**: neutrale loadouts zonder factie (nooit getraind of gebouwd): `id`, `naam`, `bodyType`, `weapon`, `armorType`, `hp`, `damage`, `damageType`, `rangeM`, `speedMps`, `cooldownS`, optioneel `sightM`, `visuals.meshSlots`. De loader zet ze na de factie-loadouts, dus hun typeId's volgen daarop.
- **`tiers[]`**: `tier`, `naam`, `units` (`unitId` + `count`), `aggroRadiusM`, `leashRadiusM` (minstens `aggroRadiusM`), `respawnS` (0 = blijft leeg), `lootScrap`, `heroXp`, `heroXpRadiusM`.
- **Regels**: een kamp aggroot op een spelersunit binnen `aggroRadiusM` van het midden (of als een bandiet geraakt wordt). Bandieten vechten alleen binnen `leashRadiusM`, vallen nooit gebouwen aan, en gaan met het hele kamp naar huis (en genezen) als een bandiet buiten de straal komt of er niemand meer binnen staat. De laatste dodelijke klap geeft `lootScrap` aan die speler en `heroXp` aan zijn levende held binnen `heroXpRadiusM`. Held-xp voor het nemen van een kamp: `heroes.json` `xpPerDiscovery`.

## Kampovername (data 0.27.0; voorstel, ter bevestiging door de architect)

`creeps.json` `takeover[]` (optioneel): per factie (`faction`) de tiers die hij overneemt in plaats van ruimt, elk met `tier`, `surrenderHpPct`, `minUnits`, `yieldS` en `yieldMax`. Een vechtend kamp geeft zich over als de units binnen `leashRadiusM` allemaal van één speler zijn (minstens `minUnits`) en de levende bandieten samen nog `surrenderHpPct` van hun hp hebben: ze sluiten zich bij die speler aan (militie, popCost 1, hun hp zoals het is), hij krijgt `lootScrap` en `heroXp` zoals bij ruimen, en het kamp is zijn buitenpost. De genadeklap op de laatste bandiet neemt het ook over, zonder rekruten. De buitenpost levert elke `yieldS` een bandiet van de tier (in tier-volgorde), hoogstens `yieldMax`, zolang er geen unit van een ander binnen `aggroRadiusM` staat. Een factie zonder regel (de Dwellers) ruimt kampen voor buit. Data 0.27.0: alleen de Raiders. Data 0.29.0: de Raider-vechters zijn weer op hun sterkte van data 0.26.0 (de verzwakking van 0.27.0 was een misverstand: "die zijn zwakker dan bouwers" sloeg op de kampen), en het lage kamp is zwak: drie Kruimeldieven en een Vechtjas, elk man tegen man zwakker dan een Dweller-bouwer, zodat het startleger van de Warlord en een kleine Dweller-groep het vanaf het begin nemen; het hoge kamp blijft een echt gevecht.

## Bewaakregel en Bewaak (data 0.29.0; voorstel, ter bevestiging door content en de architect)

Martien, 18 oktober: "Slaven die werken bij scrap en daarbij een kooi naast de scrap, lopen niet weg bij 1 militie/raider want door de dreiging. Als er geen kooi dichtbij staat dan zijn er 2 op 5 slaven nodig. Geef de raider/militie een bewaakmodus-optie op een kooi zodat dit in een actie werkt." En: "een bewaker op een scrapbron dekt 3 slaven. = 5 efficiënter dan 2 los in de buurt zonder taak".

- **Groepen**: een slaaf die verzamelt bij een node met een eigen voltooide Kooi (ook het Raiderkamp) binnen `cageNearM` (midden van de node tot de rand van de Kooi) hoort bij die Kooi; een slaaf die niet verzamelt bij zijn eigen Kooi; slaven bij een node zonder Kooi dichtbij vormen de groep van die node.
- **Nodig**: een Kooi-groep `cageGuards` (1: de dreiging van de Kooi). Een node-groep van n slaven `ceil(n / guardModeSlavesPerGuard)` (1 op 5) zodra er een bewaker in bewaakmodus op de node staat, anders `ceil(n * noCageGuards / noCageSlaves)` (2 op 5, losse vechters).
- **Bewakers**: eigen vechters (rol militia, niet de held, geen slaaf) in bewaakmodus op de Kooi of een node van de groep, of binnen `guardRadiusM` van de rand van de Kooi of van een node van de groep.
- **Opstand**: zolang een groep te weinig bewakers heeft, loopt een teller; na `graceS` (bij nul bewakers `emptyGraceS`) ontsnapt `escapePct` van de groep (minstens 1) als neutrale zwervers die `escapeM` weglopen; daarna elke `repeatS` opnieuw.
- **Bewaak** (commando Guard `{ ids, targetId }`, protocol 0.15.0; `sim.json` blok `guard`: `standM`, `leashM` minstens `standM`): een vechter (militia of robot, niet de held) bewaakt een eigen Kooi of een node met scrap. Hij loopt tot binnen `standM` (rand van de Kooi, midden van de node), vecht met een vijand die hij zelf kiest zolang die binnen `leashM` plus zijn wapenbereik van het doel blijft, en keert terug. De order blijft tot een ander commando of tot het doel weg is. Voor de Dwellers bewaakt hij gewoon een node.
- Tot data 0.28.0: `garrisonRadiusM`, `slavesPerGuard`, `minGuards` (per Kooi `max(1, ceil(slaven / 3))` vechters binnen 30 m).

## AI-scripts (`ai/*.json`)

Naast de gewone velden (bouwvolgorde, golven, onderzoek, claims) zijn er optionele blokken:

| Veld                                                                          | Wat                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `versus` (factie-id)                                                          | het script dat een AI van deze factie speelt tegen een tegenstander van die factie; zonder `versus` is het het standaardscript. Hoogstens één script per factie en tegenstander (de loader controleert)                                                                                                                |
| `creeps`: `fromS`, `maxPathM`, `tiers[]` (`tier`, `minArmy`)                  | de AI ruimt kampen op: vanaf `fromS`, zonder vijand bij zijn gebouwen, loopt een rustig leger van minstens `minArmy` (per tier; een tier zonder regel valt hij nooit aan) met de held naar het dichtstbijzijnde levende kamp binnen `maxPathM` over land van zijn hoofdgebouw. Zonder blok laat hij de kampen met rust |
| `raidPlan`: `fighterMix`, `harass`, `slaveRaids`, `garrison`, `dominancePush` | roofplan van de Raider-AI: samenstelling uit de tenten, Buggy-harass, slaversroof met escorte, bewakers thuis (`garrison.minFighters` in bewaakmodus op het Raiderkamp; data 0.29.0: verder bewaakt de AI elke slavengroep volgens de bewaakregel), dominantie-push                                                    |
| `liberate`: `minFree`, `units`, `radiusM`                                     | bevrijding: met minstens `minFree` vrije militie en geen dreiging stuurt de AI `units` naar de dichtstbijzijnde zichtbare vijandelijke slaaf of gevangene binnen `radiusM` van een eigen gebouw                                                                                                                        |
| `defendHqFirst`                                                               | zolang een vijand binnen `defendRadiusM` van het hoofdgebouw staat, draait elke militie en robot die niet op een push is naar die dreiging                                                                                                                                                                             |
| `heroClaimRadiusM`                                                            | een rustende held loopt naar een neutraal claimpunt binnen deze afstand en claimt het door er te staan (0 of afwezig = uit)                                                                                                                                                                                            |
| `robots`, `reserve`, `training`                                               | robotproductie, spaarregels en SPECIAL-training van de Dwellers                                                                                                                                                                                                                                                        |

Elk `site` in `buildOrder` en `richBuilds` is `hq`, `claim` (eigen claimpunt het dichtst bij huis) of `front` (het dichtst bij de vijand).

## Bouwrobot (data 0.26.0, voorstel, ter bevestiging door de architect)

`loadouts/*.json` **`canBuild: true`** (alleen bij `role: "robot"`): de robot bouwt zoals een bouwer (Build, Claim, helpen bij een bouwplaats binnen `builderAutoHelpRadiusM`, hervatten) en telt voor het bouwer-vangnet. Hij blijft een robot: geen bed, wel pop, niet omschoolbaar, hij vraagt een technicus (`robotRules`) en is er zelf geen; ongedekt bouwt hij op het robottempo. Bouwtijd-effecten (`buildTimePct`) gaan per type, dus een tech die bouwers versnelt noemt hem apart (zie `bouwrobots`). In `ai/*.json` zet **`robots.builders`** (`loadoutId`, `max`, `fromS`) de bouwrobots van de AI: naast `sequence`, vanaf `fromS` tot `max` (levend plus in productie); ze werken met de bouwers en tellen niet voor `robots.max`, het leger of `builders`.

## Plaatsing en territorium (`sim.json` blok `placement`)

`clearanceM` (minstens 1 m): vrije begaanbare grond rond elke footprint, ook van nodes en claimpunten. `depotClearanceM` (minstens `clearanceM`): gang rond een afleverpunt (hq, werkplaats). `buildRangeM` en `claimBuildRangeM`: een nieuwe footprint moet een cel raken die binnen deze afstand ligt van een eigen gebouw (of van een claimpost voor `claimBuildRangeM`), geteld in stappen over begaanbaar terrein (rots, klif en water stoppen het); 0 = geen territoriumregel. Verwante globale velden in `sim.json`: `exclusiveRadiusM` (een scrap-node binnen deze afstand van een gehouden claimpunt is exclusief van de eigenaar; minstens `claimRadiusM`), `heroClaimS` en `contestFlipS` (een held claimt een vrij punt door er `heroClaimS` te staan; een claim zonder toren gaat na `contestFlipS` naar een vijand die er staat zonder de houder), `autoGatherRadiusM`.

## Visuals

`loadouts/*.json` `visuals.meshSlots` koppelt een slot (`body`, `weapon`, `tool`, `armor`, `gear_back`, `gear_head`) aan een manifest-id uit `assets/dist/manifest.json`. Een id zonder asset wordt door render stil overgeslagen. Procedurele wapens, gereedschap en pantser: `assets/src/raiders.json` en `assets/src/dwellers-gear.json` (zie `tools/asset-cli/README.md`).

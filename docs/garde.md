# De Garde (Het Bolwerk), faction 3

Data 0.37.0, alles startwaarden, geen balans. Bron: Spelfundament sectie 4 tot 6. Data: `data/factions.json` (id `garde`), `data/loadouts/06-garde.json`, `data/buildings/04-garde.json`, `data/tech/01-garde.json`. De sim speelt de Garde nog niet.

## Identiteit en tempo
Brotherhood-achtig: een orde die pre-war tech bewaakt. Traag en zwaar: krachtpantsers van 2 m/s tegen 3 m/s voor Dwellers en Raiders. Alles kost meer scrap (zoeker 45 tegen 30, bouwer 80, wacht 40, woning-equivalent 130 voor 4 bedden tegen 95 voor 5). Elk verlies is duur, vroeg is ze zwak.

## Pantser
De Initiates (zoeker, bouwer, wacht, klerk) zijn light. De frames zijn `heavy` (krachtpantser 380 hp, plasmaridder 460 hp); de Vertibird is medium. Damage-matrix: ballistic tegen heavy 50 procent, melee 40, fire 60, energy 125. Een plunderaar (7 ballistic) doet dus 3,5 per schot op een frame, effectief 760 hp. De Garde schiet energy: 100 procent op light, 125 op heavy, 150 op robots.

## Economie en instroom
Startscrap 320, start met 3 zoekers, 1 bouwer, 2 wachten. Bewoners komen niet gratis: `housingGrowthPerMin` 1 (Dwellers 2, Raiders 0) en de rest wordt geworven voor scrap in de Kazerne (`producedAt kazerne`, bestaande mechanica van de Raider-tent). Zoeker verzamelt 6 per 13 s, `bergingsdienst`-achtige bonussen volgen in de uitbreiding. Vangnet: de Bastion heeft `provides tent`, dus `tenten_instroom` (drempel 3 vechters, 90 s, max 6, loadout `initiate_wacht`) werkt zonder nieuwe regel. Frames tellen 3 pop (frame plus klerk), bodyType `vehicle`: 3 pop, 0 bedden.

## Unieke units en gebouwen
| Unit | id | Rol |
|---|---|---|
| Ridder in krachtpantser | `krachtpantser` | kern, heavy, laserkarabijn 16 per 1,2 s op 10 m, 150 scrap |
| Plasmaridder | `plasmaridder` | late brekijzer, 30 per 2,0 s op 7 m, 240 scrap |
| Klerk | `klerk` | technicus: repareren, onderzoek, PA-sabotage (sim volgt) |
| Vertibird | `vertibird` | transport en strafe, 6 m/s, laat, 320 scrap |

Gebouwen: `bastion` (hq, 1800 hp heavy), `kazerne`, `smederij` (werkplaats, bouwt frames), `archief` (lab, tech en SPECIAL), `wachtpost` (claim), `geschutstoren` (laserturret), `landingsplatform`. Initiates promoveren via gevechtservaring naar Ridder en Paladin (sim, zie onder). Held Paladin-Commander (pantser-aura, Charge) staat nog niet in `heroes.json`: volgt in een aparte stap met perks.

## SPECIAL-kanaal
`specialChannel tech`: de held krijgt SPECIAL door onderzoek in het Archief. Nu `holobanden` (+1 I, P, S op target `held`). Een tweede tech `servo_kalibratie` (S en E) staat in de uitbreidingslijst.

## Natuurlijke winroute
Vernietiging: de Garde wint door de vijandelijke hoofdgebouwen te slopen met plasmaridders en Vertibirds. Geen bouwproject, geen dominantie.

## Balansdoel in de driehoek
- Sterk tegen de Raiders mid: pipe guns doen halve schade, melee 40 procent, molotovs 60 procent. Rekensom: 150 scrap is 1 frame of 6 plunderaars (23 dps op het frame, frame doodt ze in 25 s van zijn 33 s): wint nipt 1 tegen 6, duidelijk bij upgrades en medische klerken.
- Zwak vroeg tegen de Raiders: een zwerm voor het eerste frame (`fusiekernen` 200 scrap plus smederij 190) wint. Daarom het vangnet en de duur van de eerste frames.
- Zwak laat tegen de Dwellers: laserturrets en robots (energy 125 procent op heavy), robots raken niet op, upgrades schalen door, frames zijn duur en beperkt tot circa 16 per 50 pop.
- Te toetsen in een latere balansronde (niet gedaan): 1 frame tegen 6 plunderaars, 4 frames tegen 2 laserturrets.

## Asset-ids (nog te bouwen)
Units: `garde_body_initiate`, `garde_weapon_multitool`, `garde_weapon_laser_pistol`, `garde_body_clerk`, `garde_body_power_armor`, `garde_weapon_laser_carbine`, `garde_body_power_armor_heavy`, `garde_weapon_plasma_caster`, `garde_body_vertibird`, `garde_weapon_vertibird_gun`.
Gebouwen: `garde_building_bastion`, `_barracks`, `_forge`, `_archive`, `_outpost`, `_turret_laser`, `_helipad` (allemaal met prefix `garde_building_`).

## Wat de sim moet bouwen
1. Veteranen-promotie: Initiate-wacht na kills naar Ridder (en Paladin), fase 2 perks op bewoners.
2. Fusion cores: elk frame kost een core, alleen de Garde craft en repareert ze (nu alleen `fusiekernen` als gate).
3. (sim 0.33.0, data 0.39.0: repareren en overloaden gebouwd; onderzoekssnelheid open) Klerk: repareren van frames en gebouwen (`Repair` is nu alleen voor robots; voorstel: `RepairTarget` uitbreiden met `vehicle`, optioneel, en `repair` toestaan bij role technician), onderzoekssnelheid, vijandelijke krachtpantser overloaden.
4. (sim 0.33.0: gebouwd, factions mapPowerArmor) Map-power-armor: claimen door Dwellers en Raiders op 2/3 kwaliteit (`claimKind powerArmor` bestaat in het schema).
5. (sim 0.33.0, protocol 0.18.0 Load en Unload: gebouwd) Vertibird: vliegen (negeert terrein) en transport (capaciteit, laden en lossen); strafe is gewoon een aanval.
6. Tech-effecten op target `held` (SPECIAL via tech) toepassen.
7. Held Paladin-Commander (pantser-aura, Charge) en een AI-script `garde-basic`.
8. (data 0.39.0: de 6 techs staan in data/tech/01-garde.json met idGroup 1) `MAX_TECHS` (nu 32) verhogen; de Garde heeft nu 4 techs omdat het cap vol is. Uitbreiding: `laserkunde`, `klerkenschool`, `bergingsdienst`, `drilboek`, `servo_kalibratie`, `vertibird_programma`.
9. Loader leest nu `data/tech/*.json` na `tech.json`; sim-fixtures opnieuw opnemen (ids verschuiven door sortById).

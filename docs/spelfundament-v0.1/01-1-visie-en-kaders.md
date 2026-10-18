# Spelfundament v0.1: Wasteland RTS (werktitel)

Oct 13, 2026 · @Martien

## 1. Visie en kaders

Een browser-RTS met eigen IP: de settlement-logica van Fallout 4, de toon en SPECIAL-laag van Fallout 1 en 2, in de stylized kwaliteit van League of Legends, gebouwd in three.js.

1. Eigen IP: fictieve regio, toon is zwarte humor en retro-futurisme zoals Fallout 1 en 2, met vaults, facties en wasteland-humor. Geen Fallout-namen, -merken of -assets. Naam en lore volgen in de art-fase.
2. Pijler 1: bewoners zijn schaars en doen al het werk. Elke bewoner die vecht, werkt niet.
3. Pijler 2: drie facties op dezelfde economie, drie totaal andere spellen.
4. Pijler 3: leesbaar op RTS-afstand, mooi van dichtbij.
5. Pijler 4: één simulatie voor alles: skirmish, survival co-op, 1v1, campagne.
6. Wat het niet is: geen turn-based tactiek, geen squads, geen physics-simulatie, geen mobiel-first.
7. Doelplatform: desktop browser, 60 fps op een middenklasse laptop met geïntegreerde GPU. Verdienmodel en desktop-wrapper zijn geparkeerd tot de slice speelbaar is.

## 2. Kernloop en economie

Twee grondstoffen: Scrap en Bewoners. Bewoners zijn de schaarse resource, scrap is wat ze ophalen.

1. Bewoner: één unit, rol bepaald door wat hij vasthoudt. Scavenger (scrap halen), Bouwer, Militie (wapen uit de werkplaats). Wisselen kost looptijd naar de werkplaats, dus omschakelen is een echte keuze.
2. Scrap: eindige nodes op de map (ruïnes, wrakken), zoals bomen in Age of Empires. Ook uit gesloopte gebouwen, inclusief die van de vijand.
3. Huisvesting: bed-cap bepaalt het maximum aantal bewoners en de basisgroei. Geen bed, geen groei.
4. Werkplaats: craft loadouts in tiers (pipe gun, geweer, shotgun, melee, pantser). Hier zit de tech-tree. Units zijn geen types maar loadouts: één bewoner-rig, N uitrustingen.
5. Populatie-cap: 50 per speler. Een Garde-gevechtsunit telt 3 pop (power armor plus klerk), dus de Garde speelt met 16 tot 17 gevechtsunits, de Dwellers met 50 lichte.
6. Potje: 25 tot 35 minuten, 60 tot 100 units in beeld inclusief vijand.
7. Vangnet tegen de doodsspiraal: elke factie heeft een minimale instroom als ze onder een drempel zakt (zie 4). Plus een opgeven-knop.
8. Geen squads. De cap van 50 en het loadout-model houden de micro beheersbaar; bewoners krijgen auto-rol en rally points.

## 3. Map, claims en winroutes

Hybride map: vrij bewegen met fog of war, met claimbare punten die zowel de economie als de dominantie-win dragen.

1. Claimbare punten: scrap-nodes, neutrale nederzettingen (tribute), power-armor-vindplaatsen. Claimen is een outpost bouwen in de radius. Een geclaimde node is exclusief voor de eigenaar.
2. Neutrale elementen: zwervers (werven of roven), gevangenkampen (bevrijden levert bewoners op), bandietennesten als creeps met loot en held-XP (Warcraft 3), random encounters, settlement-events (handelaar, radstorm).
3. Camera: vrij 3D, zoomen en roteren (Company of Heroes).
4. Winroute A, Vernietiging: hoofdgebouw van de tegenstander slopen.
5. Winroute B, Dominantie: X van de Y claimbare punten gedurende Z minuten vasthouden. Hangt aan hetzelfde claim-systeem als de economie.
6. Winroute C, Bouwproject: bijvoorbeeld een reactor opstarten. Zichtbaar voor iedereen, met countdown en een zwakke plek, zodat turtelen geen patstelling wordt.
7. Slice: A en B. C komt in fase 2 zodra de economie staat; de invulling van C is bewust uitgesteld tot dan.
8. Power armor op de map spawnt na minuut 10, centraal en aangekondigd. Geen muntje opgooien op minuut 3.

## 4. Facties

Drie facties op dezelfde economie, 70% gedeelde kern en asymmetrie via instroom, doctrine en 3 unieke units per factie. Bouwvolgorde: Dwellers, dan Raiders, dan Garde.

|                       | Dwellers (werknaam De Kluis)                                                                                                   | Raiders                                                                                                           | Garde (Brotherhood-achtig)                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Tempo en pantser      | Snel, leer en composiet                                                                                                        | Midden, staal                                                                                                     | Traag, zwaar                                                                                                      |
| Instroom bewoners     | Trekken aan: huisvesting, radiobakens, settlements. Robots uit de Robotfabriek hebben geen bed nodig, 1 technicus per 4 robots | Roven: zwervers en verslagen vijandelijke bewoners worden slaven. Vechters komen uit tenten. Raiders werken nooit | Werven voor veel scrap, matige huisvestingsgroei. Initiate promoveert via gevechtservaring naar Knight en Paladin |
| Economie              | Raffinage-upgrades, meer scrap per bewoner                                                                                     | Plunderen van depots, tribute van neutrale nederzettingen zolang bezet                                            | Tech-salvage uit pre-war nodes, alles kost meer scrap                                                             |
| Militair              | Turret-netwerk, lasers die schalen met lab-upgrades, robots, veel lichte units                                                 | Zwermen, pipe guns, melee, chems, molotovs, honden                                                                | Zwaar pantser, laser en plasma, eigen power armor, 3 pop per gevechtsunit                                         |
| Unieke units          | Beveiligingsrobot (tank), Reparatiedrone (support), Sentinel (siege, laat)                                                     | Slaver (capture), Chem-dealer (buff-aura), Buggy (harass)                                                         | Power armor frame, Vertibird (transport en strafe, laat), Klerk (repair, research, PA-sabotage)                   |
| Held, Krijger-variant | Opziener: upgrades goedkoper, turrets sterker, Lockdown                                                                        | Warlord: intimidatie-aura, Raid, levelt het snelst                                                                | Paladin-Commander: pantser-aura, Charge                                                                           |
| SPECIAL-kanaal        | Trainingsfaciliteit                                                                                                            | Chems                                                                                                             | Tech                                                                                                              |
| Vangnet               | Radiobaken trekt bewoners aan                                                                                                  | Tenten leveren instroom zolang er minder dan 5 vechters zijn                                                      | Hoofdgebouw levert gratis een Initiate per 90 s zolang er minder dan 3 gevechtsunits zijn                         |
| Natuurlijke winroute  | Bouwproject                                                                                                                    | Dominantie                                                                                                        | Vernietiging                                                                                                      |
| Zwakte                | Traag, weinig mensen, robots kunnen niet werven of roven                                                                       | Fragiel, geen late schaal zonder loot, garnizoen nodig tegen opstand                                              | Elk verlies is duur, zwak vroeg, traag                                                                            |

Driehoek: Raiders verslaan Dwellers vroeg (voor de turrets), Garde verslaat Raiders mid (pantser negeert pipe guns), Dwellers verslaan Garde laat (robots raken niet op, upgrades schalen door).

## 5. Helden en SPECIAL

Elke speler kiest bij de start 1 van 3 helden per factie. De slice levert alleen de Dweller-Krijger; de eerste speelbare versie 1 held per factie; de 9 kits zijn het einddoel.

1. Archetypes, vast over alle facties: Bouwer (economie), Krijger (agressie), Tacticus (control). Elke factie geeft er eigen kleur aan. Zo blijft de ontwerpruimte beperkt en de balans vergelijkbaar.
2. SPECIAL: alle 7 actief vanaf de slice. Charisma stuurt rekruteringssnelheid en tribute, Luck stuurt crits en loot.
3. XP via gevecht en ontdekking. Per level een perk-keuze met smaak: dit is de plek voor de Fallout-humor.
4. Perk-kanalen buiten de held: Dwellers trainen SPECIAL in een trainingsfaciliteit, Raiders via chems, Garde via tech.
5. Dood: de perks vallen weg. Oplappen bij het hoofdgebouw met timer en scrapkosten. Elke oplap kost 20% van perks en health; na 4 keer is de held leeg.
6. Campagne: de held levelt mee over missies heen.
7. RPG-laag gefaseerd: held (slice), perks op bewoners als veteranen (Garde-signature, fase 2), doctrine-boom per potje (fase 3).

## 6. Power armor, chems en slaven

Drie regelsets die de factie-identiteit scherp houden.

**Power armor**

1. De Garde craft eigen power armor op volle kwaliteit in de Smederij, op fusion cores.
2. Map-power-armor is 2/3 van die kwaliteit, claimbaar door Dwellers en Raiders, spawnt na minuut 10.
3. Alleen de Garde repareert frames en craft cores. Anderen hebben het één keer; de Garde houdt het.
4. Een Klerk kan vijandelijke power armor vernietigen door de power-unit te overloaden.

**Chems**

1. Exclusief Raiders. Chem-dealer werkt als aura-unit.
2. Psycho geeft schade, Jet geeft snelheid, beide met een crash erna.
3. Geen verslaving: te veel microbeheer voor een RTS.

**Slaven**

1. Roven kan alleen buiten de basisradius van de eigenaar. Kooien staan verplicht aan de rand van de Raider-basis.
2. Een gevangene gaat eerst in de Kooi met transitietijd, daarna is hij werker. Nooit soldaat.
3. Slaven werken binnen de radius van een Kooi. Raakt een vijandelijke unit een slaaf 3 seconden aan zonder Raider in de buurt, dan is hij bevrijd en loopt hij terug naar huis. Escorteren of verliezen.
4. Te weinig Raiders in de basis: opstand en ontsnapping. Raiders moeten een garnizoen achterlaten.
5. Raiders starten met een paar slaven, anders staat de economie stil.
6. Comeback-mechaniek gratis: wie bewoners kwijt is, kan ze terughalen uit de Raider-basis.

## 7. Spelmodi

Eén simulatie, vier modi, in deze release-volgorde. Elk potje, ook tegen de AI, draait door dezelfde netcode, zodat multiplayer later een schakelaar is en geen verbouwing.

1. Skirmish tegen AI (slice): lokaal, 1 map, Dwellers, winroutes A en B.
2. Survival co-op: gedeelde map, eigen bouwzone per speler, golven ghouls en mutanten gericht op de zwakste speler, 15 golven in 30 tot 35 minuten, mini-boss in golf 8 (deathclaw-achtig roofdier, eigen naam volgt met de IP), Behemoth in golf 15. Held-XP telt mee. Dit is tegelijk de beste tutorial.
3. 1v1 en FFA: vereist balans, matchmaking en anti-cheat. Laatste multiplayer-stap.
4. Campagne: leerlaag voor units en progressie, held levelt mee. Komt na het speelbaar en getest is.

## 8. Technische pijlers

Deterministische lockstep-simulatie, volledig gescheiden van de three.js-renderer. De sim weet niets van rendering; de renderer weet niets van spelregels.

1. Simulatie: vaste tickrate (voorstel 20 Hz), fixed-point integers, seeded RNG, geen floats en geen Math.sin in de gamelogica, state-hash per tick vanaf de eerste commit. ECS op typed arrays, object pooling, geen garbage per tick.
2. Pathfinding: flow fields, samen met de sim in een Web Worker. De timer draait in de worker, zodat tab-throttling de lockstep niet stilzet.
3. Renderer: three.js WebGPURenderer met WebGL2-fallback. Interpoleert tussen sim-snapshots. Eigen TSL toon-ramp-materiaal (2 tot 3 lichtstappen plus rimlight) met teammasker. Instanced skinning via bone-matrix textures. three.ez/instanced-mesh voor gebouwen en props. Blob-schaduwen onder units, echte schaduw alleen op gebouwen. Drie LOD-niveaus.
4. Netcode: lichte Node WebSocket-relay voor lobby en commando-uitwisseling. Commando-delay 100 tot 200 ms (Age of Empires 2 werkt met 250). Reconnect met state-resync. Replays en desync-detectie komen gratis uit de command-log. Geen authoritative server, geen physics-engine in de sim.
5. Contracten, fase 0: snapshotformaat sim naar render, commandoprotocol client naar relay, dataschema voor units, gebouwen en tech-tree (JSON). Deze drie staan vast voor de werkstromen parallel gaan.
6. Prestatiedoel: 200 units op 60 fps op een laptop met geïntegreerde GPU, minder dan 150 draw calls, Stats.js in elke build.
7. VFX via NixieFX (editor plus MIT-runtime), GPU-particles, tracers als instanced lines, subtiele bloom voor energiewapens.

## 9. Asset-pipeline en artist-brief

Placeholders eerst, want de renderbuis is het moeilijke deel. Handwerk kopen we alleen in waar het de LoL-kwaliteit bepaalt: helden en signature pieces.

**Fasen**

1. Greybox plus CC0-placeholders (Quaternius-karakters en animaties, Gobkit Nature Kit voor props) om de complete renderbuis te bouwen en te meten op het prestatiedoel.
2. Stijlbijbel als Design System en conceptsheets als Design-artboards: palet per factie, teamkleuren, silhouettaal, HUD.
3. Artist-opdracht Dwellers: 1 body, 4 uitrustingssets (Scavenger, Bouwer, Militie, Patrol), 1 held Krijger. Zoek op ArtStation of Polycount naar stylized hand-painted character artists. Richtprijs circa 400 tot 1500 euro per karakter inclusief rig, uitrusting goedkoper.
4. Asset erin, placeholder eruit. Als de brief gevolgd is, verandert er geen regel code.
5. Release: 3 helden en per factie 2 signature pieces (hoofdgebouw, elite-unit) door de artist.

**Art-regels**

1. Hand-painted diffuse textures met ingebakken licht en schaduw. Geen PBR.
2. Silhouet eerst: overdreven proporties, grotere hoofden, handen en wapens.
3. Drie waardes per unit (licht, midden, donker), hoog contrast in de textuur zelf.
4. Eén palet per factie, teamkleur via maskerkanaal.
5. Eén bewoner-body per factie, uitrusting als losse meshes op sockets.
6. Stijlbreuk voorkomen: elk asset langs de stijlbijbel, ook placeholders die blijven hangen.

**Technische brief (gaat letterlijk naar de artist)**

| Onderdeel | Eis                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Tris      | LOD0 3000 tot 4000, LOD1 1200 tot 1500 (werkpaard), LOD2 400 tot 600                                                                 |
| Textuur   | 1 atlas van 2048 per factie voor body plus uitrusting, 1 diffuse, teammasker in het alfakanaal, geen normal-, roughness- of metalmap |
| Rig       | Humanoid, maximaal 28 bones, geen vingers, Mixamo-botnamen, T- of A-pose, socket-bones voor hand, rug, hoofd                         |
| Animaties | idle, walk, run, attack1, attack2, gather, build, death; 30 fps; alles op één gedeeld skelet                                         |
| Schaal    | 1 unit is 1 meter, poppetje 1,8 m, voeten op y=0, Y omhoog, gezicht naar +Z                                                          |
| Meshes    | body, gear\_head, gear\_back, weapon\_r; 1 UV-set binnen 0 tot 1; alleen tris en quads; transformaties toegepast                     |
| Export    | GLB met meshopt (gltfpack), KTX2-textures; Draco alleen voor statische props; .blend als bronbestand welkom                          |

Inventaris, ruw: 2 rigs (mens, robot), 9 helden waarvan 3 in de eerste speelbare, circa 15 uitrustingssets, 24 gebouwen (3 facties keer 8), circa 60 props. Dat is ongeveer een maand artist voor het handwerk; de rest loopt door de asset-CLI.

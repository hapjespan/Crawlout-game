## Raiders (`assets/src/raiders.json`)

Alle 24 manifest-ids die de Raider-data gebruikt (`data/buildings/*.json` `visuals.mesh`, `data/loadouts/*.json` `visuals.meshSlots`), procedureel en op echte schaal (poppetje 1,8 m, deuren minstens 2,1 m, de footprint volgt het model en wordt nooit gekrompen), zonder downloads. Zelfde formaat en bouwer als `robots.json` (`src/robots.ts`, dezelfde onderdelen, `maxLod`/`minLod`, `mirror`, `repeat`) met één groep erbij: `attachments`. Eigen identiteit tegenover de Dwellers: lappendeken van schroot (golfplaat in grijs, roest, rood en zwart), spijkers, banden, doeken, zandzakken, schedels als vormen (koepel, gelaatsblok, kaak, oogkassen; geen tekst) en rood-zwarte vaste platen. `team_trim` blijft het enige teammateriaal (banier, band of vlag); een aanhangsel heeft geen teammateriaal, het schema weigert het. Alle getallen staan in `raiders.json`, gewoon bewerkbaar, gesplitst in de fragmenten `assets/src/raiders/*.json` (per sectie: materialen, units, gebouwen, aanhangsels; zie README, Gesplitste configs).

| Id                                    | Soort      | Maat (b x h x d, m)        | LOD0 / 1 / 2  | Wat                                                                                        |
| ------------------------------------- | ---------- | -------------------------- | ------------- | ------------------------------------------------------------------------------------------ |
| `raider_building_camp` (17 x 17)      | building   | 17,3 x 9,3 x 16,7          | 2423/990/260  | palissade van schroot, poort 5 x 4 m met schedel, uitkijktoren, hal, kleine kooi, tenten   |
| `raider_building_tent` (7 x 5)        | building   | 7,2 x 4,5 x 5,1            | 469/312/104   | legertent, deur 1,8 x 2,2 m, voorluifel, nokpaal met schedel                               |
| `raider_building_cage` (5 x 5)        | building   | 5,1 x 5,4 x 5,0            | 1470/690/232  | kooi met spijlen om de 0,3 m, poort 1,5 x 2,3 m, hoekpalen met schedels, roestdak          |
| `raider_building_market` (13 x 11)    | building   | 13,4 x 6,5 x 11,0          | 1752/580/276  | depotloods met kratten en balie, twee kramen met luifels, bordpaal met schedels            |
| `raider_building_chemlab` (11 x 9)    | building   | 10,8 x 8,5 x 8,3           | 920/426/132   | geblakerde bunker, deur 1,3 x 2,3 m met schedel en gekruiste botten, schoorsteen, tanks    |
| `raider_building_garage` (17 x 13)    | building   | 17,1 x 8,2 x 13,1          | 1618/470/152  | loods met deur 4,6 x 3,8 m, schroothoop van geplette auto's met kraan, wrak, bandenstapels |
| `raider_building_mg_nest` (5 x 5)     | building   | 4,8 x 3,6 x 4,9            | 1411/296/208  | zandzakmuur met schietopening, mitrailleur op een paal, roestdak                           |
| `raider_building_claim_post` (3 x 3)  | building   | 3,0 x 6,9 x 3,0            | 605/218/118   | steiger met platform, ladder, mast met grote schedel, vlag                                 |
| `raider_vehicle_buggy`                | rigid-unit | 2,4 x 2,5 x 3,8            | 1584/712/264  | open buizenframe, rolkooi, achterwielen van 1,2 m, motor, bumper met spijkers, pijpkanon   |
| `raider_body_hound`                   | rigid-unit | 0,3 x 0,8 x 1,4            | 438/228/172   | hond van 0,6 m schofthoogte (rigide placeholder, hoort eigenlijk geskind en geanimeerd)    |
| `raider_body_human`                   | character  | 1,94 x 1,82 x 0,36         | 3598/1348/492 | zelfde mesh, skelet en animaties als `dweller_body_human`, andere basiskleuren             |
| `raider_body_slave`                   | character  | 1,94 x 1,82 x 0,36         | 3598/1348/492 | als `raider_body_human`, bleke lappen en alleen een teamband (slaaf, slaaf_bouwer)         |
| 12 tool-, weapon-, gear- en armor-ids | prop       | zie `test/raiders.test.ts` | 28 tot 424    | handwapens, gereedschap, rugstukken, helm, platen                                          |

**Controles** per id: maat-bereik per as, footprint (binnen 5 procent, vulling 85 procent, LOD2 75 procent, midden), voet op y = 0, budgetten (units 2000/800/300, gebouwen 2500/1000/300, props 2000/800/300), driehoeken dalend per LOD, windrichting (`test/winding.test.ts` doet de Raiders ook). Een `tube` met een scherpe knik van 90 graden draait driehoeken om; de rolkooi gebruikt daarom afgeschuinde hoeken (twee bochten van 45 graden).

**Oppervlaksoort per materiaal** (render leest de soort uit de naam, `surfaceKindOfMaterial`; `test/raiders.test.ts` bewaakt de tabel):

| Materiaal                                                                            | Soort                         |
| ------------------------------------------------------------------------------------ | ----------------------------- |
| `scrap_metal`, `_dark`, `_black`, `_red`, `_hazard`, `tank_toxic`, `tank_yellow`     | geverfd metaal                |
| `rust_metal`, `rust_dark`, `rust_roof`                                               | roest                         |
| `tyre_rubber`, `leather_dark`, `leather_tan`, `opening`                              | leer                          |
| `canvas_tent`, `_dark`, `_red`, `_black`, `sandbag_canvas`                           | doek                          |
| `wood_plank`, `wood_dark` (de terugval van de look: geen sleutelwoord)               | hout                          |
| `bone_stone` (botten van de schedels: krijtachtig, mat), `concrete`, `concrete_soot` | beton                         |
| `lens_amber`, `lens_red`, `lens_glass`                                               | lens                          |
| `team_trim`                                                                          | geverfd metaal (spelerskleur) |

**Mensen: `raider_body_human` en aanhangsels.** De menselijke Raider-loadouts (slaaf, slaaf-bouwer, plunderaar, plunderaar in staal, knuppelaar, molotovgooier, slaver, chemdealer, krijgsheer) gebruiken het bestaande humanoid-skelet. `raider_body_human` is geen apart bronbestand maar een afgeleide uitvoer van `dweller_body_human` (rigmap-veld `derive`: `{ id, colors }` met een `#rrggbb` per bronmateriaal): dezelfde mesh, skin, sockets en animaties, andere basiskleuren (`M_Main` roodbruin, `M_Joints` roet). De gebakken animatietexture wordt gedeeld (het manifest wijst naar `dweller_body_human/dweller_body_human.anim.f32`), dus de variant kost alleen drie LOD-GLB's. De handwapens, het gereedschap, de rugstukken, de helm en het pantser zijn `kind: 'prop'` (`teamMask: 'none'`, geen footprint, geen team-materiaal) met een **anker** (`anchor` in `raiders.json`):

| Anker  | Oorsprong en assen                                                                                                | Ids                                                                                                                                                    |
| ------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `grip` | de greep (binnen het model); loop of kop naar +Z, bovenkant +Y                                                    | `raider_tool_shovel` (1,5 m), `_hammer`, `raider_weapon_pipe_gun` (1,0 m), `_spiked_club`, `_molotov`, `_net_whip`, `_chem_sprayer`, `_scrap_revolver` |
| `back` | de rugsocket (`sockets.back`) van het lichaam; alles achter het lichaam (z kleiner dan -0,12), +Y boven           | `raider_gear_shackles`, `raider_gear_chem_tank`                                                                                                        |
| `head` | de hoofdsocket (`sockets.head`, de nek); de helm zit 0,03 tot 0,4 m erboven                                       | `raider_gear_warlord_helm`                                                                                                                             |
| `body` | de lichaamsruimte van het poppetje (voeten y = 0, rustpose, borst op 1,1 tot 1,5 m); geen socket, past op de romp | `raider_armor_steel`                                                                                                                                   |

**Kledingpalet** (`palette` in het manifest, uit `derive[].palette` van de rigmap): de render schildert het lichaam per regio (`bodyRegions.ts`), de basiskleuren in de GLB gelden daar niet. Sleutels: `jacket`, `patchTop` (linkerarm, een lap op de mouw), `patchLeg` (rechterbovenbeen), `belt`, `trousers`, `boots`, `skin` als `#rrggbb`; `teamZone` `chest` (borst en schouders, standaard) of `band` (een band om de linkerbovenarm); `farTeam` 0 tot 1 (hoeveel van het bovenlijf op afstand de spelerskleur krijgt, standaard 1). Een ontbrekende regio houdt de Dweller-kleding (`patchTop` volgt `jacket`, `patchLeg` volgt `trousers`); een karakter zonder `palette` ziet eruit als voorheen. `raider_body_human`: lederbruin met een rode linkermouw, zwarte riem, broek en laarzen; `raider_body_slave`: bleek linnen, touw om het middel, `teamZone: band`, `farTeam: 0`.

**Wat render doet** (render 0.21.0, `units/attachment*.ts`): `loadout.visuals.meshSlots` buiten `body` wordt gelezen en de props worden uit het manifest geladen (een id die het manifest niet heeft, bijvoorbeeld een Dweller-wapen zonder art, wordt stil overgeslagen: `Renderer.attachmentAssets()`); elk prop staat op de bone van zijn slot (hand-socket en `RightHand` met een vaste draaiing voor `weapon` en `tool`, rug-socket en `Spine2`, hoofd-socket en `Head`, `armor` op `Spine2` zonder offset), geskind op die ene bone zodat hij dezelfde bake-texture, clip en fase volgt als het lichaam, met een instanced mesh per prop. Nog open: de hond loopt als star model, een echte hond hoort een skin en clips te krijgen; banieren en vlaggen zijn star, een wapperende vlag is render.

**Preview**: `tools/asset-cli/preview/raiders.html` (serveer de repo-root statisch; opties `manifest`, `ref`, `lod`, `w`, `az`, `el`, `team`, `only=<id,id>`, `norefs=1`, `loadouts=1`): de gebouwen en units naast een poppetje van 1,8 m en het Dweller-huis (`dweller_building_housing`) met de footprint als rechthoek; met `loadouts=1` een rij poppetjes met hun wapens en gear (het wapen naast de heup gehouden, zoals de arm in de animaties hangt).

## Dweller-uitrusting (`assets/src/dwellers-gear.json`)

De negen wapen-, gereedschap- en pantser-ids die de Dweller-loadouts in `visuals.meshSlots` noemen (`data/loadouts/*.json`) hadden geen asset; render sloeg ze stil over. Nu zijn het procedurele aanhangsels in dezelfde bouwer en hetzelfde formaat als de Raider-aanhangsels (groep `attachments` van `src/robots.ts`, `kind: 'prop'`, `teamMask: 'none'`, geen footprint, geen teammateriaal, `anchor` `grip` of `body`, budget 2000/800/300). De config heeft geen `units` of `buildings`; `buildAssets` bouwt hem naast `robots.json` en `raiders.json` (optie `dwellersGearPath`). Alle getallen staan in het bestand, gesplitst in de fragmenten `assets/src/dwellers-gear/*.json` (zie README, Gesplitste configs).

Eigen stijl tegenover de Raiders: opgeruimde "vault-tech" in plaats van schroot. Blauwgrijs geverfd metaal in drie tinten (`metal_vault`, `_dark`, `_light`), composietplaat (`composite_metal`), gele veiligheidsbanden (`metal_vault_yellow`), blank staal (`steel_bare`: hamerkop, koevoet, sleutelbek), rubberen grepen (`rubber_grip`), grijs canvas (`canvas_grey`) en blauwe lenzen (`lens_blue`: richtkijkers, contactdop, statuslampen). Geen roest, spijkers, schedels of logo's, ook geen tekst of cijfers; vlakken zijn recht met kleine afschuiningen.

| Id                            | Slot en anker | Maat (b x h x d, m) | LOD0 / 1 / 2 | Wat                                                                                          |
| ----------------------------- | ------------- | ------------------- | ------------ | -------------------------------------------------------------------------------------------- |
| `dweller_weapon_pipe_pistol`  | weapon, grip  | 0,05 x 0,19 x 0,37  | 180/104/72   | pijppistool: korte loop in blauwgrijze huls, gele monding, rubberen greep                    |
| `dweller_weapon_rifle`        | weapon, grip  | 0,05 x 0,28 x 1,11  | 280/200/84   | geweer: kast met gele band, lange loop, kolf, richtkijker met blauwe lens                    |
| `dweller_weapon_patrol_rifle` | weapon, grip  | 0,06 x 0,30 x 1,18  | 344/268/84   | patrolgeweer: composiet kast, handguard met voorgreep, draagbalk met optiek, demper          |
| `dweller_weapon_shotgun`      | weapon, grip  | 0,07 x 0,18 x 1,10  | 256/184/84   | pompgeweer: dikke loop met magazijnbuis, gele pompgreep, kolf                                |
| `dweller_weapon_club`         | weapon, grip  | 0,11 x 0,10 x 1,03  | 304/192/52   | slagwapen (stoknuppel): stalen schacht, rubberen greep, kop met gele banden, blauwe dop      |
| `dweller_tool_multitool`      | tool, grip    | 0,14 x 0,09 x 0,43  | 184/144/72   | multitool: handvat, kop met sleutelbek, schroevendraaier, blauwe statuslamp                  |
| `dweller_tool_hammer`         | tool, grip    | 0,29 x 0,09 x 0,53  | 156/128/68   | bouwhamer: stalen schacht, rubberen greep, blokkop van blank staal met gele band             |
| `dweller_tool_scrapbag`       | tool, grip    | 0,31 x 0,68 x 0,21  | 204/132/72   | schroottas van de scavenger: canvas tas aan riem onder de hand, gele gesp, koevoet           |
| `dweller_armor_composite`     | armor, body   | 0,74 x 0,58 x 0,38  | 244/84/54    | composietpantser: borstplaat met gele band en blauwe lamp, schouderkappen, buik- en rugplaat |

Maten en ankers volgen het Raider-hoofdstuk: wapens en gereedschap hebben de oorsprong in de greep met de loop of kop naar +Z en de bovenkant op +Y; de tas hangt onder de greep; het pantser staat in lichaamsruimte (voeten y = 0, borst op 1,1 tot 1,5 m). De slots zijn die van de Dweller-data: `weapon` voor de vijf wapens, `tool` voor multitool, hamer en tas, `armor` voor het composietpantser.

**Oppervlaksoort per materiaal** (render leest de soort uit de naam; `test/dwellers-gear.test.ts` bewaakt de tabel):

| Materiaal                                                                    | Soort          |
| ---------------------------------------------------------------------------- | -------------- |
| `metal_vault`, `_dark`, `_light`, `_yellow`, `composite_metal`, `steel_bare` | geverfd metaal |
| `rubber_grip`                                                                | leer           |
| `canvas_grey`                                                                | doek           |
| `lens_blue`                                                                  | lens           |

**Controles** (`test/dwellers-gear.test.ts`, windrichting in `test/winding.test.ts`): de ids tegen `data/loadouts/*.json` (alle niet-body ids, negen), het anker bij het slot, maat-bereik per as, budgetten en dalend aantal driehoeken per LOD, `teamMask` `none`, geen Raider-materiaal of teammateriaal, oppervlaksoort per materiaal, byte-gelijke tweede bouw en `assets/dist` is de bouw van deze config.

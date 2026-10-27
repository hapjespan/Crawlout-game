# Map-assets gevraagd: van een 5 naar een 8 (27 oktober 2026)

Martien: "Welke assets heb je nodig om nog meer uit de map te halen voor de verschillende spelvarianten? Je ging van een 3 naar een 5; ik daag je uit naar een 8." Dit is het antwoord: wat er aan kunst nodig is, per spelvariant en per soort, en eerlijk wat er aan code naast moet.

Algemeen formaat zoals in `docs/assets-gevraagd.md`: GLB, +Z is voor, +Y omhoog, echte schaal in meters (een mens is 1,8 m), LOD's maakt de pijp. Props komen binnen als entry in `assets/local/delivered.json` (zoals de units nu), krijgen een `category` (`tree-leafy`, `tree-bare`, `rock`, `structure`, `debris`, ...) en worden door de prop-laag geïnstanced. Texturen: PNG, machten van twee.

## Wat een 8 is

Nu (een 5): de grond heeft echte detail (128 texels/m, vier gegenereerde lagen), er groeit gras, struiken, riet en bosjes, de rivier heeft een zachte oever. Wat ontbreekt:

1. **Overzichtszoom.** Van ver is de kaart nog een groen-bruin vlak met camouflagevlekken; er is geen structuur die je uit Command & Conquer of Company of Heroes kent: wegen, akkers, verbrande plekken, ruïnes die de kaart in vakken delen.
2. **Plekken met een naam.** De landbrug, de voordes, de settlements en de vleugels van het winkelcentrum moeten elk een landmark hebben dat je op elke zoom herkent.
3. **Een verhaal in de grond.** Bandensporen, kraters, olievlekken, puin rond ruïnes, een weg die ergens heen ging. Dat is wat een wasteland van een weiland onderscheidt.

## Eerst eerlijk: code die naast de kunst nodig is

| Zwak punt | Wat er nodig is | Werkstroom | Omvang |
|---|---|---|---|
| De gespiegelde heightmap (Rock Terrain 4-tegels, gespiegeld en geroteerd) bepaalt de vorm van de map: dezelfde rug komt vier keer terug. | Een eigen hoogtekaart per map (16-bit PNG, 1 px/m) en de map-generator die hem leest. Passability en water volgen eruit, dus dit is een **nieuwe mapversie met nieuwe replay-fixtures**, via de architect. | map + sim-core | groot |
| Verste zoom: het gras is weg (zakt weg tussen 70 en 115 m) en de cover-kaart toont als vlekken. | Een macro-laag in de grondshader: een gebakken overzichtskleur per map (1 texel per 0,5 m) plus grasdichtheid als kleur in plaats van als vlek, en tree-impostors voor de verste zoom. | render | middel |
| De lagen worden bij het opstarten gegenereerd (ongeveer 0,5 s). | Aangeleverde PBR-sets inladen als texture-array; liefst KTX2 (de asset-cli moet dat leren), anders PNG met cache. Het genereren blijft als terugval. | render + asset-cli | middel |
| Er is geen wegensysteem. | Wegen als render-only splines (eigen bestand naast de map, buiten de envHash) met een weg-decal of strook-mesh die het terrein volgt, en de grondkaart die er dirt en grind langs legt. | render + map | middel |
| De decal-laag doet alleen ringen en blobs. | Een decal-atlas (projected decals) met tot 2000 statische decals in een paar draws. | render | middel |
| De grondsplat heeft vier lagen (twee RGBA8). | Naar acht lagen (asfalt, beton, modder, as erbij): een tweede splat-paar en de grondkaart die weet waar ze liggen. | render | middel |
| Vegetatiesoorten zijn procedurele meshes. | Een GLB per soort laden in `vegetationMeshes`, met dezelfde instancing en wind. | render | klein |
| Ambient-effecten hebben geen plek op de map. | Een render-only lijst van emitters (rook, stof, vuur, licht) per map. | render + map | klein |

## Per spelvariant

**Skirmish op Rustbelt XL (384 x 384 m, twee spelers, puntsymmetrisch).** Rivier met twee voordes en een landbrug in het midden, de tafelberg, vier settlements en een middenpunt, drie creepkampen. Nodig: een landmark op de landbrug (de oude viaductpijler), stapstenen en een kapotte vonder bij de voordes, een eigen silhouet per settlement (watertank, zendmast, schuur), een kampdressing per creepkamp, en wegen die de basissen, de voordes en de brug verbinden.

**Survival co-op (1 tot 4 spelers, golven van vier randen).** Nodig: een zichtbare herkomst van de golven (een gat in een hek, een tunnelmond, een duiker onder een dijk per rand), leesbare bouwzones (paaltjes, een geverfde rand of een betonnen plaat per zone), een arena voor de Behemoth (een open krater met puin), en sfeer voor de late golven: brandende tonnen, zoeklichten, rook.

**Bouwproject (het oude winkelcentrum, twee gespiegelde vleugels bij de landbrug).** Nodig: een parkeerterrein (gescheurd asfalt met vakken als decal), autowrakken en winkelwagentjes, lantaarnpalen, een reclamezuil, pompeilanden bij het benzinestation en puin rond de ruïnes. Een hersteld deel krijgt een schonere omgeving: nieuwe decals en props die verschijnen bij herstel (code: render toont ze bij de eigenaar).

## Prioriteit 1: de grootste stap (samen van een 5 naar een 7)

| Id | Wat | Formaat | Maat | Budget | Waarom | Waar in de pijp |
|---|---|---|---|---|---|---|
| `ground_dry_grass` | droog gras op stoffige aarde | PBR-set: albedo, normal, roughness, AO, hoogte | tegel 8 x 8 m | 1024² per kaart = 128 texels/m | vervangt de gegenereerde turf-laag; meer variatie, echte bladvorm | terreinlaag (groundLayers, texture-array) |
| `ground_cracked_dirt` | uitgedroogde, gescheurde aarde | PBR-set | 8 x 8 m | 1024², 128 tx/m | de dirt-laag; de scheuren lezen op de standaardzoom | terreinlaag |
| `ground_gravel_rubble` | grind met baksteen- en betonbrokjes | PBR-set | 8 x 8 m | 1024², 128 tx/m | wegbermen, rond ruïnes, de landbrug | terreinlaag |
| `ground_rock_cliff` | gelaagde rots voor wanden | PBR-set, naadloos | 8 x 8 m | 1024², 128 tx/m | de triplanar rots op kliffen, nu gegenereerde strata | terreinlaag |
| `ground_asphalt_cracked` | gescheurd asfalt met onkruid in de naden | PBR-set | 8 x 8 m | 1024², 128 tx/m | wegen en het parkeerterrein van het winkelcentrum | terreinlaag (nieuw, code: acht lagen) |
| `heightmap_rustbelt_xl` | eigen hoogtekaart, niet gespiegeld per tegel | 16-bit PNG | 385 x 385 px, 1 px/m | n.v.t. | de vorm van de map is nu vier keer dezelfde rug | map-generator (nieuwe mapversie) |
| `road_kit` | wegstrook recht en bocht, kapotte rand, middenstreep | decal-atlas plus GLB-randstukken | strook 6 m breed, stukken van 8 m | 2048² atlas; randstukken 300 tris | wegen delen de kaart in vakken: het grootste overzichtseffect | decal-atlas en wegsplines (code) |
| `bridge_overpass_pillar` | ingestort viaduct: twee pijlers en een gebroken dek naast de landbrug | GLB | 14 m hoog, dek 20 x 8 m | 4–6k tris, 2048² | landmark van het middenpunt, op elke zoom te lezen; staat buiten de vrije straal van 16 m | `delivered.json` prop, category `structure` |
| `tree_dead_oak` | dode eik, dikke stam, kale takken | GLB, alpha-mask voor fijne takken | 9–12 m | 3–5k tris, 1024² | het wasteland mist dode, grijze bomen met karakter | `delivered.json` prop, `tree-bare` |
| `tree_scrub_pine` | verwaaide den, scheef, half kaal | GLB | 7–10 m | 3–5k tris, 1024² | variatie in de bosjes; dennen lezen nu als kerstbomen | prop, `tree-leafy` |
| `tree_birch_burnt` | verbrande berk, zwarte stam | GLB | 6–9 m | 2–3k tris, 512² | verbrande plekken in de bosjes, verhaal | prop, `tree-bare` |
| `tree_impostors` | impostor-atlas van elke boom (8 hoeken) | PNG atlas, albedo plus normal | per boom 256² per hoek | 2 tris per boom | bomen bij de verste zoom zonder 2M driehoeken | prop-LOD 3 (code: impostor-LOD) |
| `ruin_wall_kit` | bakstenen muurstukken: heel, half, stomp, hoek, met raam | GLB, modulair | 4 m breed, 0,3–3,5 m hoog | 400–900 tris per stuk, gedeelde 2048² | ruïnes als dekking en verhaal, overal inzetbaar | `delivered.json` props, `structure` |
| `car_wreck` | drie autowrakken: sedan, pick-up, bus | GLB | 4,5 / 5,5 / 11 m lang | 1,5–3k tris, 1024² | het parkeerterrein, langs wegen, als barricade | props, `structure` |

## Prioriteit 2: van een 7 naar een 8

| Id | Wat | Formaat | Maat | Budget | Waarom | Waar in de pijp |
|---|---|---|---|---|---|---|
| `shore_rocks_kit` | ronde oeverkeien en platte stenen | GLB | 0,3–1,5 m | 200–600 tris, gedeelde 1024² | breekt de vloeiende oeverlijn, stapstenen bij de voordes | props, `rock` |
| `shore_mud_decals` | natte modderrand, schuim, aangespoeld afval | decal-atlas | stukken 2–6 m | 2048² atlas | de oever leest als nat, niet als een lijn | decal-atlas |
| `water_normal_flow` | golfnormal en flowmap | PNG normal 512², flowmap 1 px/m | tegel 4 m | 512² | stroming die de bocht volgt; nu één golfpatroon | waterLayer (code: flowmap) |
| `ford_stepping` | vonder van planken en een kapotte pallet | GLB | 6 m lang | 600 tris, 512² | maakt van de voorde een herkenbare oversteek | prop, `debris` |
| `decal_scorch` | brandplekken en kraters | decal-atlas | 2–8 m | in de grond-atlas | verhaal en variatie; Survival-golven laten ze achter | decal-atlas |
| `decal_tracks` | bandensporen en voetpaden | decal-atlas, tegelbaar langs spline | 0,5–2 m breed | 1024² | paden tussen basis en schroot: de kaart vertelt waar gelopen wordt | decal-atlas en splines |
| `decal_oil_rust` | olievlekken, roestplassen, putdeksels | decal-atlas | 0,5–3 m | in de atlas | het parkeerterrein en de garage | decal-atlas |
| `decal_parking_lines` | vakken, pijlen, invalidenvak, verbleekt | decal-atlas | vak 2,5 x 5 m | 1024² | het parkeerterrein leest meteen als winkelcentrum | decal-atlas |
| `mall_props_kit` | winkelwagen, lantaarnpaal, reclamezuil, pomp, winkelwagenstalling | GLB | wagen 1 m, paal 8 m, zuil 10 m, pomp 1,8 m | 200–1500 tris, gedeelde 2048² | Bouwproject krijgt een eigen beeld rond de vier delen | props, `structure` en `debris` |
| `fence_kit` | gaashek, betonnen paaltjes, prikkeldraad, kapotte poort | GLB modulair | 3 m stuk, 2,2 m hoog | 300–500 tris, alpha-mask | bouwzones in Survival, randen van settlements | props, `structure` |
| `survival_breach_kit` | gat in een hek, tunnelmond, duiker onder een dijk | GLB | 6–10 m breed | 2–4k tris, 2048² | elke golf komt ergens vandaan; de speler leest de rand | props op de vier randen (code: plekken uit `waves.json`) |
| `rubble_piles` | puinhopen beton en baksteen, drie maten | GLB | 1,5 / 3 / 6 m | 500–1500 tris | rond ruïnes en de Behemoth-krater | props, `rock` |
| `shrub_sage` | grijsgroene alsem-struik | GLB, of procedureel naar referentie | 0,6–1,2 m | 300 tris, 256² | de droge ruggen; nu dezelfde ronde struik | vegetatiesoort (`SPECIES`) |
| `shrub_thorn` | doornstruik, kaal en dicht | GLB | 1,2–2,2 m | 400 tris | de randen van onbegaanbare grond | vegetatiesoort |
| `grass_tall_dry` | hoog droog gras met aren | GLB of procedureel, kaart 256² met alpha | 0,6–1 m | 60 tris per pol | weiden met hoogteverschil, beweegt mooi in de wind | vegetatiesoort |
| `cattail` | lisdodde voor de oever | GLB | 1,4–2 m | 80 tris | variatie naast het riet | vegetatiesoort |

## Prioriteit 3: sfeer en afwerking

| Id | Wat | Formaat | Maat | Budget | Waarom | Waar in de pijp |
|---|---|---|---|---|---|---|
| `fx_dust_devil` | stofhoos en waaiend stof | sprite-sheet 8 x 8 | 2–6 m hoog | 1024² | beweging op de kaart als er niets gebeurt | ambient-emitter (code) |
| `fx_smoke_column` | rookkolom uit een ruïne of een brandende ton | sprite-sheet | 10–20 m hoog | 1024² | landmark van ver, verhaal | ambient-emitter; de rook-laag bestaat |
| `fx_fire_barrel` | brandende ton met vuur en licht | GLB plus sprite | 0,9 m | 300 tris | Survival, settlements, nacht | prop plus emitter |
| `light_cookies` | lichtvlekken van lantaarns en zoeklichten | PNG 256² | 4–12 m | 256² | schemer-variant voor late golven | decal-atlas, additief |
| `sky_dust_gradient` | lucht- en nevelkleuren per tijd van de dag | kleurtabel | n.v.t. | n.v.t. | vier stemmingen (ochtend, middag, stof, schemer) per spelvariant | lightRig |
| `ground_ash_mud` | as en modder | PBR-set | 8 x 8 m | 1024², 128 tx/m | kraters, oevers, brandplekken | terreinlaag (acht lagen) |
| `ground_concrete_slab` | betonplaten met naden | PBR-set | 8 x 8 m | 1024² | funderingen, de bouwzones, het winkelcentrum | terreinlaag |
| `signage_kit` | verkeersborden, roestige billboards | GLB | 2–8 m | 200–800 tris | oriëntatie en humor | props, `structure` |
| `utility_poles` | houten elektriciteitspalen met kabels | GLB, kabels als strook | 9 m, 30 m tussen palen | 300 tris | lijnen die de kaart structureren, ook van ver | props langs wegsplines |

## Volgorde

1. Code eerst waar kunst op wacht: acht grondlagen met texture-array, decal-atlas, wegsplines. Daarna leveren de PBR-sets en de road-kit meteen beeld op.
2. De hoogtekaart is de grootste stap voor de vorm, maar raakt de sim: plan hem als mapversie met de architect.
3. Landmarks (viaduct, wrakken, ruïnes) per spelvariant, dan de vegetatiesoorten en de sfeer.

Alle aantallen zijn een eerste schatting. De grens blijft het prestatiedoel uit `docs/spelfundament-v0.1/01-1-visie-en-kaders.md` (200 units op 60 fps op een laptop met geïntegreerde GPU, minder dan 150 draw calls): elke nieuwe prop-soort is een instanced draw per LOD, dus liever een kit met een gedeelde atlas dan veel losse assets. Nu op de standaardzoom: ongeveer 200 tot 265 draw calls en 1,9M driehoeken, al boven dat doel. De vrije stralen rond oversteken (12 m) en claimpunten (16 m bomen, 7 m struiken, render 0.30.2) gelden ook voor geplaatste landmarks.

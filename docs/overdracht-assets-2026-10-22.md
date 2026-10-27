# Overdracht assets 22 oktober 2026

Martien leverde negen GLB's en een sheet met negen heldportretten. Dit is de stand, wat er mis is, en wat er moet gebeuren.

## Waar de dingen staan

- **Bronmodellen**: `assets/local/delivered/` (negen nieuwe, naast de negen die er al stonden). Ze kwamen binnen in `assets/src/` — dat is een **gecommitte map in een publieke repo**, dus ze zijn verplaatst. 338 MB.
- **Config**: `assets/local/delivered.json`. **Let op: die map staat in `.gitignore`, dus al het configwerk is niet versiebeheerd.** De code zegt dat de config wél in git hoort (alleen de kunst niet). Openstaand punt.
- **Bouwen**: `pnpm assets:local` → `assets/dist-local`.
- **Heldportretten**: gesneden door `tools/hud-art/heroes.mjs` (wél in git, alleen coördinaten) uit de sheet, naar `assets/local/hud/portrait-hero-<id>.png` plus manifest-entries.

## Wat de buis doet (duur geleerd, niet opnieuw uitzoeken)

1. **Node-transforms zetten alles al op Y-omhoog.** Niet roteren tenzij een model echt scheef staat; mijn eerste Vertibird-poging kantelde een correct model. Meet met `getBounds(scene)`, niet met de ruwe accessor-min/max — die negeren de node-transforms en liegen.
2. **De gebouwde LOD's zijn meshopt-gecomprimeerd.** Terugsnelezen vereist `await MeshoptDecoder.ready` vóór de eerste `readBinary`, anders "Cannot read properties of undefined (reading 'exports')".
3. **Een team-materiaal is verplicht** (naam bevat "team"). Een klein bronmateriaal hernoemen werkt niet: het wordt wegge-pruned bij de reductie. Daarom gebruiken álle delivered assets een `extraParts`-vorm met `team_trim`.
4. **Materialen samenvoegen mag alleen bij dezelfde textuur.** Anders faalt het met "bronmaterialen met dezelfde uitvoernaam moeten dezelfde textuur hebben".
5. **Elke materiaalgroep houdt een bodem van ongeveer 22 driehoeken.** Zestien materialen = 356 driehoeken in LOD2, tegen een budget van 300. Daar liep de Klerk op vast.
6. **Een lokaal asset met dezelfde id overschrijft het procedurele** (`mergeManifests`, lokaal wint). Een held krijgt zijn eigen model via de id `hero_<key>`.

7. **`Prune` sloopt een photogrammetry-scan.** De simplify-vlaggen staan standaard op `['Prune', 'Permissive']`. `Prune` laat losse kleine onderdelen vallen — bedoeld voor de planken en spijlen van een procedureel huisje. Een scan bestáát uit duizenden losse schelpjes, dus bij een krap LOD-budget eet Prune het hele gebouw op: `dweller_building_storage` kwam uit op LOD0 5989 en LOD1/LOD2 van **12** driehoeken, oftewel alleen de teamband. Het gebouw zou op middenafstand verdwijnen. Met alleen `['Permissive']` wordt het 5990 / 2040 / 693 en houden alle drie de LOD's de vorm. Zet `simplify.flags` dus per asset, en wantrouw Prune bij alles wat gescand is.

## Wat er nu staat, en waarom het niet goed genoeg is

Omgezet: `garde_body_power_armor`, `garde_body_power_armor_heavy`, `garde_body_clerk`, `hero_warlord`, `garde_body_vertibird`, `garde_building_dormitory`.

**Martiens oordeel (22 oktober): lelijk omgezet. Opnieuw doen.** Drie concrete punten:

1. **Texturen moeten behouden blijven.** De Klerk is effen gekleurd geworden omdat ik zestien materialen tot vier groepen samenvoegde om onder het LOD2-budget te komen — en samenvoegen dwingt `flat: true` af. Dat is de verkeerde afslag geweest: het budget had omhoog gemoeten, niet de textuur eruit.
2. **Te weinig polygonen.** LOD0 landt nu op circa 1900 driehoeken terwijl `characterMaxTris[0]` 4000 toestaat. De bronmodellen hebben 50.000 tot 2.000.000 driehoeken; de reductie is veel te grof. Martien: "de pipeline vs bron bestanden is echt te grof."
3. **Het frame klopt niet.** Het power-armour-frame is het exoskelet **zonder helm**: de bovenkant zit op **schouderhoogte**, dus het hoort **kleiner** te zijn dan het volledige pantser met helm. Nu staat het frame op 2,30 m en het volle pantser op 2,19 m — precies omgekeerd. Het frame moet naar ongeveer 1,6 tot 1,7 m.

## Te doen

1. `lod0Triangles` fors omhoog (richting 4000 voor karakters, 2500 voor gebouwen) en de LOD-banden nalopen; eerst meten wat LOD2 dan doet.
2. Klerk terug naar textuur: materialen **niet** samenvoegen, maar het aantal groepen terugbrengen door alleen gelijk-getextureerde samen te nemen en de rest te laten staan, met een hoger budget.
3. Frame herschalen naar schouderhoogte en de twee power-armour-varianten omwisselen qua maat.
4. Vertibird: de rotorschijven staan rechtop (standvlucht) terwijl het toestel in het spel zweeft. Kantelen of accepteren — vraag staat open bij Martien.
5. Nog niet omgezet: radiotoren (`broadcast_tower_game_ready.glb`), `industrial_utility_building_game-ready.glb`, `old_industrial_storage_building.glb`. Nieuwe content, vraagt ook data-entries.
6. `garde_building_dormitory` is gebouwd maar `data/buildings/04-garde.json` wijst de slaapzaal nog naar `garde_building_barracks`.
7. **Karakters zijn star.** De delivered-buis kent geen skinning, dus ze lopen niet. Voor echte animatie moeten ze via de rig-buis (`autorig.ts`, `retarget.ts`). Openstaand besluit van Martien.

## Gereedschap dat nu bestaat

- `tools/asset-cli/src/silhouette.ts` — orthografische vooraanzichten van gebouwde assets, naast elkaar op één meterschaal met raster. Geen browser of GPU nodig; dit beantwoordt "klopt de maat naast een dweller van 1,8 m" beter dan een spelscreenshot.
- `tools/replay/src/asset-shots.ts` — screenshots uit de render-demo. Werkt, maar de camera kijkt niet vanzelf naar de units; de silhouet-route is betrouwbaarder.
- `tools/hud-art/heroes.mjs` — snijdt de heldsheet.

## Overig (los van de assets)

De HUD-kaarten tonen nu portretten: `MenuHero.key` (nieuw veld, door `heroCards.ts` gevuld uit `HeroData.key`), `Option.portrait` in de RadioGroup, een basisstijl in `styles.controls.ts` en de skin-regels in `menuSkinCss`. Lint en typecheck groen, 278 UI-tests groen.

## Terrein (Rock Terrain 4)

`npx -y pnpm@9 --filter @crawlout/asset-cli run terrain` maakt uit `assets/local/rock_terrain_4.glb` (CC-BY-4.0, Lassi Kaukonen; 47 MB, gitignored, de bron gaat nooit in git) afgeleide data die wel in git staat, in `assets/dist/terrain/`. Zonder bronbestand meldt de CLI dat en stopt met exit 0; vanuit een worktree zoekt hij de bron ook in de hoofdcheckout. Opties: `--src`, `--out`, `--crop-size <m>`, `--rotation <graden>`, `--albedo-size <px>` (albedo op een eigen raster van die maat; het hoogteveld blijft gelijk; de gecommitte albedo is 2048, 16 px per meter op de map). Twee runs geven byte-identieke uitvoer; een run duurt ongeveer 3 s. Code: `src/terrain.ts` (buis) en `src/heightfield.ts` (schema's, browser-safe). Naamsvermelding: `assets/src/licenses/rock-terrain-4-CC-BY-4.0.txt`, en in `terrain.json`.

```
assets/dist/terrain/terrain.json                 terrein-manifest (los van manifest.json, geen kind in assetManifest)
assets/dist/terrain/rock_terrain_4.height.json   hoogteveld, 128 x 128 cellen van 1 m (ongeveer 88 kB)
assets/dist/terrain/rock_terrain_4.albedo.jpg    kleur in bovenaanzicht, 2048 x 2048 (ongeveer 650 kB)
```

**Waarom een uitsnede met draaiing.** De bron is geen vierkant van 119 x 114 m maar een scheve rotsbult met een voetafdruk van ongeveer 8800 m2 (diagonaal ongeveer 155 m lang, 70 tot 80 m breed). Daar past hooguit een vierkant van ongeveer 70 m in. De buis kiest daarom het vierkant van 64 m (schaal precies 2 naar 128 m) met de meeste reliëfvariatie (standaardafwijking van de hoogte) onder alle draaihoeken 0 tot 89 graden en posities in stappen van 1 m, met minstens 99 procent dekking. Dat is nu: draaiing 20 graden om de y-as, linker-achterhoek op (-10, -43) in de gedraaide bronruimte. De keuze staat in `terrain.json` onder `crop`.

**Hoe het wordt afgeleid.**

1. Alleen driehoeken met een diffuse-textuur (het rotsoppervlak). De driehoeken van het Base-materiaal zijn de platte voet van het diorama en tellen niet mee.
2. Node-transformaties zijn toegepast (de root draait -90 graden om X: Z omhoog wordt Y omhoog; mesh-y wordt wereld -z).
3. Zwevende fotogrammetrie-schijfjes (een paar meter breed, tot 10 m boven de grond) vallen weg via een morfologische opening (straal 3 m, drempel 4 m); de gaten worden opgevuld uit de buren.
4. Een rasterisatie van boven (gelijk aan een raycast op de monsterpunten): 1024 x 1024 monsters over de uitsnede, per monster de hoogste y. Elke cel (8 x 8 monsters) krijgt het gemiddelde.
5. Uniforme schaal 2 (horizontaal en verticaal, dus de hellingshoeken blijven die van de bron), en het laagste punt gaat naar 0 (`crop.heightOffsetM` is wat er is afgetrokken).

**Hoogteveld** (`crawlout-heightfield/1`, zod-schema `heightfieldSchema` in `@crawlout/asset-cli/heightfield`):

```
{ "format": "crawlout-heightfield/1", "w": 128, "h": 128, "metersPerCell": 1, "minM": 0, "maxM": 26.25,
  "heights": [ ... ] }   // meters, rij voor rij, 2 decimalen, één rij per regel in het bestand
```

`heights[j * w + i]`: i loopt met +x, j met +z (rij 0 is de kleinste z, zoals de rijen van `data/maps`, dus map-y is veld-j). Het celmidden ligt op ((i + 0.5), (j + 0.5)) m. `heightAt(field, xM, zM)` geeft bilineair de hoogte op een positie in meters.

**Textures.** `rock_terrain_4.albedo.jpg` is geen kopie van de bron-diffuse maar een bovenaanzicht van de bronkleur (basiskleur-textuur maal factor, sRGB), uitgelijnd met het hoogteveld: pixel (px, py) hoort bij x = px / breedte * 128 m en z = py / hoogte * 128 m. Gaten (minder dan 2 procent) worden opgevuld met pull-push, een zachte overgang tussen de gedekte randen. Reden: de bron-diffuse is een fotogrammetrie-atlas met eilanden per brok mesh (niet tegelbaar en alleen bruikbaar met de uv's van de 871k-driehoeken-mesh, die niet in git komt). De normal map en de ORM-textuur zijn daarom niet meegenomen (render gebruikt geen PBR; normalen kan render uit het hoogteveld afleiden). `terrain.json` bevat verder `rockTint` (gemiddelde kleur van de albedo) en `groundTint` (kleur van het Base-materiaal), als effen kleuren voor de ruimte buiten het veld.

**Zo gebruikt de map-agent het.**

```ts
import {
  heightfieldSchema,
  terrainManifestSchema,
  heightAt,
} from '@crawlout/asset-cli/heightfield';
const field = heightfieldSchema.parse(
  JSON.parse(read('assets/dist/terrain/rock_terrain_4.height.json')),
);
// sim-heightmap (Int16, 1/256 m): Math.round(field.heights[i] * k * 256), met k een eigen verticale factor
```

- Het veld is 128 x 128 m met cellen van 1 m en past dus 1 op 1 op de rustbelt-map (128 x 128). Reken in de map-generator van meters naar sim-eenheden (`* 256`) en rond af.
- Het reliëf is groot: de bron heeft ongeveer 12,7 m verschil, na schaal 2 is dat 26,25 m, tegen `ruinHeight` 2,5 m en `cliffHeight` 5 m in de huidige generator. Schaal de hoogtes met een eigen factor `k` (bijvoorbeeld 0,2 voor ongeveer 5 m) of knip ze af; dat is een lineaire bewerking op `heights`.
- Het veld is niet puntsymmetrisch. Voor een eerlijke 1-tegen-1 maakt de map-agent het symmetrisch (bijvoorbeeld de helft j < 64 spiegelen met `h(i, j) = h(127 - i, 127 - j)`); dat staat bewust niet in de buis.
- Hellingen: ongeveer 13 procent van de cellen heeft een helling boven 45 graden (de klif tussen plateau en laagland loopt tot ongeveer 80 graden); leid begaanbaarheid af uit de gradient, niet uit de hoogte alleen.
- Kleur: leg `rock_terrain_4.albedo.jpg` als map over het terrein met uv = (x / 128, z / 128), of gebruik `rockTint` als vlakke kleur.
- Reliefoverzicht (kolom i = x, rij j = z): een plateau van 18 tot 26 m beslaat het westen en het midden (kolommen 0 tot 85, rijen 16 tot 100), met de hoogste top (26,25 m) bij (29, 82). Het oosten (kolommen vanaf 90) is laagland op 2 tot 4 m, gescheiden van het plateau door een steile klif van ongeveer 20 m op kolommen 80 tot 92 (rijen ongeveer 40 tot 100, het scherpst op rijen 56 tot 90, steilste punt bij (89, 83)); in het noordoosten loopt het plateau juist geleidelijk af. De noordrand (rijen 0 tot 15) loopt af van ongeveer 15 m in het westen naar 10 m in het midden en 2 m in het oosten, de zuidrand (rijen 104 en hoger) van ongeveer 18 naar 4 tot 5 m.

## Tests

`test/packs.test.ts` toetst de pack-buis met een synthetische pack-GLB (splitsen, FBX-draaiing, echte schaal, voet en midden, MASK met WebP-alfa, de config, bladsoort, determinisme, behoud van de uitvoer als de bron ontbreekt); `test/packs-dist.test.ts` toetst de gecommitte uitvoer in `assets/dist` tegen `packs.json`: per categorie redelijke hoogtes, voet op y = 0, budgetten en alfagedrag.\n\n`test/shapes.test.ts` toetst de vormen van `src/shapes.ts` (windrichting tegen de normalen, gesloten volumes, driehoeksaantallen, determinisme) en `repeat` en `mirror`; `test/robots.test.ts` de zes robot-assets (maten, 10 procent van de oude placeholders, budgetten per LOD, deur van 4 m, oppervlaksoort per materiaal, manifestvelden en de LOD-GLB's in `assets/dist`).

`test/buildings.test.ts` toetst de gebouwen: config tegen `data/buildings.json`, footprint-schaal per LOD, grond, team-materiaal, geen PBR, budgetten, determinisme (twee runs, gelijke bytes), het manifest-schema en de meshgereedschappen.

`npx -y pnpm@9 test` (`test/bake.test.ts` voor de bakker, inclusief roundtrip van een bekende pose; `test/conform.test.ts` voor bone-snoeien, rigmap, simplify met skinning en een smoke-test op de echte UAL-GLB) genereert synthetische GLB's met gltf-transform (geldige humanoid-dummy, te zware en foute varianten) in `test/fixtures.ts`.

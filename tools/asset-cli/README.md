# asset-cli

Buis van GLB naar meshopt, 3 LODs en `manifest.json`, met validatie tegen de technische brief (`docs/spelfundament-v0.1.md` sectie 9).

## Quaternius- en Gobkit-bestanden toevoegen

De CLI doet zelf geen netwerkcalls. Download de CC0-pakketten handmatig en zet de GLB-bestanden in `assets/src` (submappen mogen):

1. Quaternius: Universal Animation Library en de basiskarakters. Exporteer of download als `.glb`.
2. Gobkit Nature Kit: de props als `.glb`.
3. Kopieer de bestanden naar `assets/src/`, bijvoorbeeld `assets/src/characters/` en `assets/src/props/`.

De asset-id is de bestandsnaam in kleine letters, zonder extensie, met `_` voor andere tekens (`Hero Dummy.glb` wordt `hero_dummy`). Twee bestanden met dezelfde id geven een fout.

Een asset met een skin geldt als karakter, zonder skin als prop.

## Draaien

```
npx -y pnpm@9 install      # eerste keer
npx -y pnpm@9 assets       # of: pnpm assets
```

Uitvoer in `assets/dist/` (gecommit):

```
assets/dist/manifest.json
assets/dist/validation-report.json
assets/dist/<id>/lod0.glb
assets/dist/<id>/lod1.glb
assets/dist/<id>/lod2.glb
assets/dist/<id>/<id>.anim.f32   (karakters met animaties)
```

`validation-report.json` (deterministisch, geen tijdstempels) geeft per asset de bron en wat de buis eraan veranderd heeft: tris van bron en per LOD, bones van bron en uitvoer, gesnoeide bones, weggevallen animatiekanalen, behouden en vervallen clips, verwijderde UV-sets en schaal, plus waarschuwingen.

Lege `assets/src` geeft groen met de melding "geen assets" en een lege manifest. Schendt een asset de brief, dan staat per asset een leesbare reden op het scherm, is de exit code 1 en wordt er niets naar `assets/dist` geschreven. Opties: `--src <map>`, `--dist <map>` en `--local` (zie Lokale assets).

## Bronnen die niet aan de brief voldoen (conform-stap)

Vóór de validatie draait een conform-stap (`src/conform.ts`), alleen voor wat in de config staat. Zo kan een zwaardere placeholder (Quaternius-mannequin: 13.744 tris, 53 bones, 46 clips) door de buis zonder de norm voor eindassets te verlagen: de validatie en de budgetcontrole draaien op het resultaat van de conform-stap, niet op de bron. Een eindasset zonder entry in `rigmap.json` wordt dus nog steeds met de volle norm getoetst.

`assets/src/rigmap.json`:

```json
{
  "rigs": {
    "quaternius-ual": {
      "bones": { "DEF-hips": "Hips", "pelvis": "Hips", "DEF-hand.L": "LeftHand" }
    }
  },
  "assets": {
    "dweller_body_human": { "rig": "quaternius-ual", "lod0Triangles": 3600 },
    "rock001": { "scale": 0.01 }
  }
}
```

- **Bone-snoeien en hernoemen** (`rig`): bones die niet in `rigs.<naam>.bones` staan (vingers, tenen, `*_leaf`, `root`) verdwijnen uit de skin. Hun gewichten tellen op bij de dichtstbijzijnde behouden voorouder (hand of voet) en worden daarna per vertex genormaliseerd (maximaal 4 invloeden). Animatiekanalen van gesnoeide bones vallen weg. Een gesnoeide bone met behouden afstammelingen (de statische `root` met zijn -90 graden X-rotatie) blijft als gewone node op zijn rustpose boven `Hips`; de clips zijn daardoor in-place gebakken. De bronnamen mogen DEF-stijl (de echte UAL-GLB) of UE-stijl zijn; sleutels zijn hoofdletterongevoelig. De joint-volgorde van de bron blijft behouden (skinIndex en texture blijven synchroon). Namen zijn voor validatie en sockets; render gebruikt de volgorde.
- **Reductie** (`lod0Triangles`): is de bron zwaarder, dan reduceert meshopt-simplify hem naar dit aantal (binnen 3000 tot 4000 voor karakters). Alle attributen (UV, normalen, JOINTS_0, WEIGHTS_0) blijven behouden omdat alleen de indexbuffer verandert. LOD1 en LOD2 worden daaruit afgeleid (doelen 1350 en 500, midden van de bandbreedtes); als de buis zelf gereduceerd heeft, wordt ook de ondergrens van de brief gecontroleerd (3000, 1200, 400).
- **Schaal** (`scale`): uniforme schaal in de vertices gebakken, voor props (de Gobkit-props zijn in centimeters: 0.01). Bij karakters niet ondersteund; die moeten in de bron al 1,8 m zijn.
- Extra UV-sets (`TEXCOORD_1` en hoger) worden verwijderd voor assets met een entry.
- **Clips**: altijd (ook zonder entry) blijven alleen de via de clipmap of op naam gekoppelde clips over, met de canonieke naam; de rest vervalt uit het manifest en uit de bake. De LOD-GLB's bevatten geen animaties meer, die zitten in de bone-matrix-texture.

Oriëntatie en schaal van de UAL-mannequin zijn gecontroleerd: 1,83 m, voeten op y = 0,002, gezicht naar +Z (de tenen staan +0,15 m voor de enkel), +Y omhoog. Er is dus geen correctie nodig; de enige transformatie is de statische `root`-node (-90 graden X, Blender naar glTF), die in de skin-matrices van de bake zit.

## Lokale assets (`pnpm assets --local`)

Voor bronnen die nooit in git mogen (fanart buiten de eigen IP, zie Spelfundament sectie 1) is er een tweede, lokale buis. `assets/local/` en `assets/dist-local/` staan in `.gitignore`; zet er nooit iets van in een commit, test of fixture.

```
npx -y pnpm@9 assets --local     # of: pnpm assets:local
```

- Bron: `assets/local/*.glb`, met een eigen `assets/local/rigmap.json` en `assets/local/clipmap.json` (zelfde formaat als in `assets/src`, ook buiten git). Alleen GLB's met een entry in die rigmap gaan erdoor; andere lokale bronnen (bijvoorbeeld voor terrein) worden overgeslagen met een melding.
- Uitvoer: `assets/dist-local/` met een eigen `manifest.json` en `validation-report.json` in hetzelfde formaat. Ontbreekt `assets/local` of staat er geen GLB in, dan gebeurt er niets (exit 0, geen map); `pnpm assets` zonder `--local` is ongewijzigd.
- De client (`apps/client/src/game/assets.ts`) leest `assets/dist-local/manifest.json` als die er is en geeft de ids daarin voorrang boven die van `assets/dist`; zonder dist-local gedraagt hij zich als voorheen. Een lokaal asset `hero_<key>` (bijvoorbeeld `hero_opziener`) tekent de held met die key (typeId 1000 + heroId, via `assets.bind` van render).

Extra velden per entry in de rigmap (ook bruikbaar voor `assets/src`, maar bedoeld voor lokale bronnen), in de volgorde waarin de conform-stap ze uitvoert:

| Veld                  | Wat                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | Publiceer onder deze id in plaats van de bestandsnaam, bijvoorbeeld `dweller_body_human` om het repo-asset lokaal te vervangen. Rigmap en clipmap blijven op de bestandsnaam-id.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `meshes`              | Alleen deze meshes (exacte namen) blijven over; de rest van een scène (deur, vloer) vervalt, met ongebruikte nodes, materialen en textures.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `fit`                 | `{ height, yawDegrees? }`: het skelet wordt in zijn node-pose opnieuw gebonden (rustpose = bindpose), gedraaid om +Y, geschaald naar `height` meter, voeten op y = 0, midden op x = z = 0. Alle transformaties zijn daarna toegepast (joints star, mesh-nodes op de identiteit). De eigen clips van de bron vervallen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `rig` (met `merge`)   | Zoals hierboven; `rigs.<naam>.merge` stuurt het gewicht van een gesnoeide bone naar een gekozen bone in plaats van de voorouder (bijvoorbeeld een twist-bone die onder de schouder hangt maar bij de bovenarm hoort).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `retarget`            | `{ from, rigmap, clipmap, bones?, alignRest? }`, paden relatief aan de rigmap: de clips van een ander karakter (de Quaternius-UAL) worden overgezet, zie hieronder.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `emissiveAsBaseColor` | Een materiaal zonder diffuse maar met een emissive textuur (Sketchfab-unlit) krijgt die als diffuse.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `atlas`               | Alle diffuse textures in één vierkante PNG-atlas van maximaal deze maat (render tekent één atlas per draw). Elke textuur krijgt een cel (macht van 2); past het niet, dan halveert eerst de textuur met de hoogste texeldichtheid. UV's buiten 0 tot 1 gaan zoals de bron ze bedoelde (wrap REPEAT): elke driehoek schuift naar zijn eigen tegel (hoekpunten die in driehoeken met verschillende tegels zitten worden gedupliceerd) en een overschrijding van hooguit 3 procent wordt afgeklemd. Een driehoek die een tegelgrens echt overspant (tegelende UV's, bijvoorbeeld 0 tot 3) laat de textuur in de cel N x N keer herhalen (cel groter, maximaal 8 herhalingen, `atlas.cells[].repeat` in het rapport); wrap CLAMP_TO_EDGE klemt per hoekpunt. Daarna is er één materiaal `atlas` en één primitive. |
| `teamMask`            | `{ hue: [van, tot], minSaturation?, minValue?, softness? }`: het teammasker per texel in de alfa van de diffuse (render: modus `diffuseAlpha`). Texels in het kleurbereik krijgen alfa 1, de rest 0; het masker wordt vervaagd (gauss met sigma `softness` texels, standaard 1) en door een smoothstep gehaald, zodat de rand zacht is en speldeprikken in de textuurruis verdwijnen. De kleur van de texels blijft ongemoeid, het materiaal blijft OPAQUE. Het manifest krijgt `teamMask: 'diffuseAlpha'` (zie Manifest). Draait na de atlas, dus op de textuur die render laadt. Met `bones` (Mixamo-namen) en `minWeight` (standaard 0,5) alleen op texels van driehoeken die gemiddeld minstens zoveel gewicht op die bones hebben (twee texels gegroeid), bijvoorbeeld de armbanden van de bovenarmen.   |
| `autoRig`             | `{ from, skeleton, rigmap, clipmap, height?, yawDegrees?, heat?, attachRadius? }`, paden relatief aan de rigmap: een statische mesh zonder skelet (`from`, mag elders staan, bijvoorbeeld onder `delivered/`; de sleutel van de entry is de bron-id) krijgt het skelet, de bindpose en de clips van `skeleton` (eerst geconformeerd met zijn eigen rigmap en clipmap). Zie Auto-rig hieronder. Niet samen met `meshes`, `fit`, `rig` of `retarget`.                                                                                                                                                                                                                                                                                                                                                           |     |

Retargeten (`src/retarget.ts`): bron en doel staan na de conform-stap in hetzelfde assenstelsel (meters, +Y, gezicht +Z) met Mixamo-namen; koppeling op naam, of via `bones` (doel naar bron) waar ze verschillen. Per doelbone wordt de rotatie relatief aan de rustpose overgenomen: het verschil van de bronbone met zijn rustpose in de wereld, D = Q_bron(t) · Q_bron,rust⁻¹, wat voor een volledig gekoppelde keten gelijk is aan de lokale delta omgerekend naar de rustpose van het doel. Daarvoor komt een rustpose-uitlijning A (kortste rotatie van de botrichting van het doel in rust naar die van de bron in rust, voor bones met precies één gekoppeld kind; anders geërfd van de ouder), zodat een T-pose-clip goed op een model met hangende armen of in A-pose komt. Doel: Q_doel(t) = D · A · Q_doel,rust. De Hips-translatie is het verschil met de rustpositie, geschaald met beenlengte doel / bron. Doelbones zonder bron houden hun rustpose. De nieuwe clips (30 keyframes per seconde, LINEAR) worden daarna gebakken zoals elke andere clip.

Auto-rig (`src/autorig.ts`): voor een getextureerde mensfiguur zonder skelet (T- of A-pose). (1) Draaiing om +Y, uniforme schaal naar `height` (standaard 1,8 m, gemeten zonder kleine losse delen), voeten op y = 0, gecentreerd. (2) Landmarks op de bron en op de skin van de referentie in bindpose, op dezelfde manier gemeten zodat afwijkingen wegvallen: kruin, kruis (laagste punt van de doorsnede x = 0), per kant de armwortel (midden van de doorsnede op het okselvlak) en de vingertop (het eiland van de mesh voorbij het okselvlak), het beenmidden en de teen. (3) Het referentieskelet wordt in de bron ingebed: hoogtes stuksgewijs lineair tussen vloer, kruis, schouder en kruin; de armgewrichten op dezelfde fractie langs de armas, die in een A-pose naar beneden hangt; de benen volgen het beenmidden. (4) Skin-gewichten met bone heat (Baran en Popovic, Pinocchio): per bone (L + H) w = H p op de gelaste graaf van de mesh (randgewicht 1 / lengte^2), met p de dichtstbijzijnde bone die de vertex ziet (het lijnstuk erheen snijdt geen driehoek) en H = `heat` / d^2. Zo zijn de gewichten glad, tellen ze op tot 1 en lopen ze niet over tussen delen die elkaar alleen raken (benen, arm en romp). Kleine losse delen (noppen, een gesp, haarkaarten; diagonaal onder 10 procent van de lengte) worden aan de dichtstbijzijnde lichaamsvertex gekoppeld (binnen `attachRadius`, standaard 5 cm) en nemen de gewichten van het lichaam over. Daarna maximaal 4 invloeden, kleine gewichten weg, genormaliseerd. (5) Met linear blend skinning naar de bindpose van de referentie: per bone de draaiing van de ingebedde richting naar die van de referentie en een rek langs de bone naar de referentielengte (bladbones, hoofd, handen en voeten, houden hun maat); A-pose-armen komen zo in de T-pose van het skelet en de proporties volgen het skelet, zodat elleboog en knie op de gewrichten buigen. (6) Het resultaat vervangt de mesh in het referentiedocument met de eigen materialen en textures; joints, inverse bindmatrices en clips blijven, dus de gebakken animatietexture is byte-gelijk aan die van de referentie (een eigen bestand in de uitvoer, omdat de lokale `dweller_body_human` een ander skelet heeft). Het verslag (`autoRig`) geeft schaal, hoogtes, losse delen, vertices zonder zichtbare bone, armhoek van de bron en de rek per bone. Zonder `palette` in het manifest en met `teamMask: 'diffuseAlpha'` schildert render het lichaam niet per regio: de eigen textuur blijft zichtbaar, de spelerskleur komt uit het masker. Beperkingen: een figuur in een andere pose dan T of A, een lange jas of rok (het kruis wordt dan te laag gemeten) of lagen kleding die alles afschermen (die vertices krijgen hun gewicht alleen van de buren) vragen handwerk.

Reductie: haalt meshopt het doel niet omdat hij vastloopt op UV-naden (een atlas met veel eilanden), dan begint de reductie opnieuw bij de onvereenvoudigde mesh (de herhaalde passes met foutgrens 1 hebben dan al hele delen weggevouwen, bijvoorbeeld een hoofd op LOD2) met één pass over naden heen (`Permissive`, uv en normaal als gewogen attributen) en als laatste `simplifySloppy`. Alleen als de gewone passes het doel niet halen; de repo-assets veranderen daardoor niet.

Normalen: elke primitive zonder `NORMAL` (of met alleen nul-vectoren) krijgt oppervlak-gewogen gladde normalen (`src/normals.ts`; hoekpunten op dezelfde plek, zoals UV-naden, delen hun normaal), voor alle assets, vóór de fit. De LOD-bouw en de fit gebruiken `prune` met `keepAttributes`: zonder die vlag gooit gltf-transform `NORMAL` weg bij unlit materialen (Sketchfab), waardoor render het model plat belicht.

Afhankelijkheid: `sharp` (al in de lockfile via gltf-transform) voor de atlas en het teammasker; alleen geladen als die stappen in de config staan.

## Wat wordt gevalideerd

| Regel    | Norm                                                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tris     | Karakters LOD0 maximaal 4000 (LOD1 1500, LOD2 600 via simplify). Props (lager, `budgets.ts`): LOD0 maximaal 2000, LOD1 800, LOD2 300; een prop eronder blijft ongewijzigd, dus de LODs zijn dan gelijk |
| Bones    | Maximaal 28                                                                                                                                                                                            |
| Botnamen | Mixamo (`mixamorig:Hips` enzovoort; prefix optioneel); kern-bones moeten bestaan                                                                                                                       |
| Textuur  | Maximaal 2048 x 2048                                                                                                                                                                                   |
| UV       | Eén set (`TEXCOORD_0`)                                                                                                                                                                                 |
| Schaal   | Karakter ongeveer 1,8 m (tolerantie 15 procent), voeten rond y=0 (5 cm)                                                                                                                                |

Een karakter met animaties moet alle acht clips van `ANIM_NAMES` hebben (idle, walk, run, attack1, attack2, gather, build, death), direct of via de clipmap; een ontbrekende clip is een fout met de naam van die clip, een dubbelzinnige koppeling ook. Verder: precies 1 skin, en alle `JOINTS_0`-indices liggen binnen de joints van die skin. Een karakter zonder animaties krijgt een waarschuwing en geen `baked`.

Waarschuwingen (geen fout): ontbrekende socket-bones (`socket_hand`, `socket_back`, `socket_head`, met fallback op `RightHand`, `Spine2`, `Head`). De waarden staan in `src/budgets.ts`.

Gezicht naar +Z wordt gecontroleerd aan de zolen: staan de zoolvertices meer dan 2 cm achter de enkel-bones (`LeftFoot`, `RightFoot`), dan is het een fout. Een model zonder voeten geeft geen oordeel.

Niet gecontroleerd: tris-only meshes, hand-painted stijl.

## Gebouwen (`src/buildings.ts`, `assets/src/buildings/variants.json`)

De acht Dweller-gebouwen zijn geen losse GLB's in `assets/src` maar varianten van een bron-huisje (`buildings/base_house.glb`, Low poly House van winwoods, CC-BY-4.0, de naamsvermelding staat in `assets/src/licenses` en in het veld `asset.copyright` van elke LOD-GLB). De bron zelf wordt geen asset: bestanden die in `variants.json` onder `sources` staan, slaat de buis over. Alle vormgetallen staan in `variants.json`, niet in code.

De asset-id is de sleutel in `variants`, exact de `visuals.mesh` uit `data/buildings.json` (`dweller_building_hq` enzovoort). Per variant:

- `footprint` `{ w, h }` in cellen van 1 m (zelfde als de data; een test vergelijkt ze). Het model staat binnen w x h in x en z (hooguit 5 procent erbuiten) en vult minstens 85 procent van w en van h (LOD2: 75 procent, de veranda valt weg); het midden van de bounds ligt binnen 8 procent van de oorsprong in x en z, de grond is y = 0. Zie 'Geen grondplaat' hieronder.
- `lod0Triangles`: doel voor LOD0 (hooguit het plafond van `budgets.ts`); LOD1 en LOD2 volgen de verhoudingen `buildingLodRatios`.
- `tints`: kleur per uitvoermateriaal (`#rrggbb`, sRGB), vermenigvuldigd met de basiskleur. `colors`: kleur per effen materiaal voor dit gebouw.
- `parts`: onderdelen, positie (`position`) is de voet (midden onder) in meters, `rotation` in graden (volgorde Y, X, Z), `maxLod` laat fijn detail op LOD1 en LOD2 vallen.
  - `house`: een kopie (of met `select` een deel) van het bron-huisje op de **wereldschaal** van de bron: `sources.<id>.metersPerUnit` (0,0245 m per eenheid voor het huisje: de deur is 2,11 m, het huis 12,1 x 18,6 m en 10,0 m hoog; zie `sources.house.door` en `note`). Er is geen eigen maat per variant (`size`, `fit` en `heightFactor` bestaan niet meer; het schema weigert ze): `position` is de voet van het hele bronhuis (midden van de bounds in x en z, onderkant op y), ook voor een geselecteerd deel, zodat het dak op LOD2 precies op het huis van LOD0 en 1 staat; `rotation` draait om die voet (een kwartslag om Y: x wordt z, z wordt min x). Optioneel `select` (`materials` met bronnamen, `yFrom` en `yTo` als deel van de huishoogte, bijvoorbeeld alleen de begane grond voor de werkplaats, `components` voor de N grootste losse delen, bijvoorbeeld alleen de dakvlakken) en `weight` voor het aandeel in het driehoekbudget (standaard 1). `sources.<id>.keep` laat los rommel buiten een blok weg (samenhangende delen die er niet helemaal in liggen). De footprint is de bounds naar boven afgerond op hele, oneven cellen (oneven: het midden ligt op een cel, zodat het hoofdgebouw op de spawn puntsymmetrisch staat); de rest van de footprint blijft grond.
  - `box` (`size`), `cylinder` (`radius`, `radiusTop`, `height`, `segments`), `cone` (`radius`, `height`, `segments`), elk met een effen `material` uit `flatMaterials`.

Materialen: elk bronmateriaal (spec-gloss, `KHR_materials_pbrSpecularGlossiness`) wordt via `sourceMaterials` een effen basiskleur plus diffuse textuur onder een eigen naam (bronmaterialen met dezelfde naam moeten dezelfde textuur en kleur hebben en worden een materiaal; `color` vervangt de diffuse factor). De uitvoer heeft geen PBR-extensies, geen normal-, occlusion-, emissive- of metallic-roughness-textuur (metallic 0, roughness 1). Elk gebouw heeft een effen **team-materiaal** (`team_trim`: een banier, band of dakrand); de naam bevat "team", dus de teammasker-regel van render (`TEAM_MATERIAL`) herkent het, de basiskleur is het neutrale masker (lineair 0,8).

Driehoeken en textures: de bronmeshes worden vereenvoudigd (meshopt met `Prune` en `Permissive`, uv en normaal gewogen, het budget over de materiaalmeshes verdeeld naar driehoeken^0,5 zodat het dak niet leegloopt); vormen (box, cylinder, cone) blijven heel. Budgetten per LOD (`buildingMaxTris`): 2500, 1000 en 300 (het hoofdgebouw en het woonhuis, `housing`, zitten rond 2400; claimpaal, radiobaken en turret zijn alleen vormen en hebben op elke LOD dezelfde driehoeken). Een mesh die door `Prune` ver onder het doel eindigt (minder dan 90 procent) wordt opnieuw gereduceerd zonder `Prune`, zodat het doel gehaald wordt. Textures gaan naar JPEG (de bronnen hebben geen alfa) op 1024, 512 en 256 per LOD (`buildingTextureSizes`, plafond 1024; een bron-textuur wordt nooit vergroot; render houdt ze in een texture-array met 1024 px per laag); texture-atlas samenvoegen kan niet omdat de bron-UV's herhalen (tegels buiten 0 tot 1), wel delen materialen met dezelfde textuur een materiaal. KTX2 geldt niet voor gebouwen (alleen PNG wordt omgezet).

Validatie per LOD (faalt de build): binnen de footprint (5 procent), vulling en midden (zie `footprint`), grond op y = 0 (1 cm), team-materiaal aanwezig, geen PBR-extensies of andere textures dan diffuse, tris onder het plafond, textuurmaat. In `validation-report.json` staat per gebouw de bron-driehoeken, de driehoeken per LOD, de materialen en de textuurmaten.

**Geen grondplaat (keuze, rustbelt-ronde 'scatter').** De vijf gebouwen met een erf (woning, hoofdgebouw, werkplaats, training: een `dirt`-box van 4 cm; lab: een `metal`-box van 8 cm) hadden een plaat die de footprint vulde, zodat de bounds de footprint op 5 procent haalden. Op het rotsterrein van Rustbelt XL stak die zandkleurige of grijze rechthoek hard af. Een lage, randloze erf-plaat in een neutrale aardetint is met effen materialen niet te maken: 'randloos' vraagt een verloop (vertexkleur of een alfa-rand) en de buis levert geen vertexkleuren of textures voor effen onderdelen; elke effen plaat houdt dus een scherpe rand, ook in een neutrale tint, en het terrein verschilt per plek van kleur. De plaat is daarom weggehaald (en de `dirt`-kleur uit `flatMaterials`): het huis staat op het vlakke bouwvlak van de map (`pads`, 30 m straal) en de voet is y = 0. De footprint-controle leunt niet meer op de plaat: zie de eisen onder `footprint` (binnen de footprint, vulling 85 procent, LOD2 75). `test/buildings.test.ts` bewaakt dat er geen vlakke box meer is die de footprint vult.

Preview voor eigen controle: `tools/asset-cli/preview/characters.html` tekent de karakters uit een manifest in rustpose met het teammasker uit het manifest (`?manifest=/assets/dist-local/manifest.json&az=0&el=6`, opties `only`, `lod`, `team`, `debug=mask|normals|flat`); `tools/asset-cli/preview/buildings.html` (three.js, geen onderdeel van de buis) tekent de gebouwen uit `assets/dist` met footprint-raster, een maatstaf van 1,8 m en team-materialen in een spelerskleur; serveer de repo-root statisch en open `/tools/asset-cli/preview/buildings.html?manifest=/assets/dist/manifest.json&lod=0` (opties: `lod`, `only`, `az`, `el`, `debug=materials`).

## Robots (`src/robots.ts`, `assets/src/robots.json`)

Vijf procedurele assets op echte schaal (poppetje 1,8 m): de drie robots `dweller_robot_guard`, `_drone` en `_sentinel` (rigide units) en twee gebouwen, `dweller_building_robotfactory` (15 x 13) en `dweller_building_turret_laser` (3 x 3). Gebouwd zoals de gebouw-varianten (zelfde `parts`-formaat, `maxLod` en `minLod` voor detail per LOD; vormen worden niet gesimplificeerd, de LODs ontstaan uit de onderdelen), zonder downloads of externe modellen. Alles staat in `robots.json`: `flatMaterials`, `units` (rigide units) en `buildings` (footprint, oneven cellen, volgt de bounds). Per id moet een maat-bereik (`heightM`, bij units ook `widthM` en `depthM`) kloppen, anders faalt de build.

**Vormen** (`src/shapes.ts`, naast `box`, `cylinder` en `cone`; een onderdeel staat in meters, de voet is het midden onder, behalve waar hieronder anders staat):

| Onderdeel           | Wat het maakt                                                                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `box` met `chamfer` | doos met afgeschuinde randen (44 driehoeken), voor pantserplaten en rompen; `open: true` laat de onderkant weg (10 driehoeken), ook bij `cylinder` en `cone`                                                          |
| `prism`             | een veelhoek (`profile`, ook hol) uitgetrokken over `height`: `axis` y (profiel in x en z, vanaf de voet), x (profiel in z en y) of z (profiel in x en y), de laatste twee gecentreerd op `position`; `taper`, `caps` |
| `track`             | rups: stadion-zijaanzicht met loopvlak (`teeth`, `toothHeight`) over `width`, lang langs z, staat op y = 0                                                                                                            |
| `corrugated`        | golfplaat als golfstrook (4 driehoeken per periode, een zijde), `length` langs x, `height` langs y, kammen `depth` naar +z; voor wanden en daken                                                                      |
| `tube`              | gezwaaide buis langs `points` (kabels, leidingen), vloeiend geschaduwd                                                                                                                                                |
| `sphere`            | bol of koepel (`half: 'top'`), midden op `position`                                                                                                                                                                   |

Alle onderdelen kennen `mirror` (ook een gespiegelde kopie in x; positie, rotatie en asymmetrische vormen volgen) en `repeat` (`count` kopieen, elk `step` verder: wielen, klinknagels, ribben); `src/partExpand.ts` zet ze om in gewone onderdelen. Alle cilinders en kegels (gebouwen en robots) komen uit `shapes.ts` (`makeCylinderClean`, `makeCone`): de zijkant is tegen de klok in gewikkeld gezien van buiten en een kegel heeft geen ontaarde driehoeken. De oude `makeCylinder` uit `geometry.ts` (zijkant andersom, een gecullde render zag de binnenkant) is verwijderd; `test/winding.test.ts` bewaakt dat elk vormonderdeel en elke gecommitte LOD naar buiten wijst.

**Oppervlaksoort en team per onderdeel.** Het GLB heeft per materiaal een effen kleur en geen extra attributen; render leidt de oppervlaksoort af uit de materiaalnaam (`surfaceKindOfMaterial`, `packages/render/src/look/surfaces.ts`) en zet die per hoekpunt in `uvl.x` van de platte onderdelen (`buildingGeometryFromGltf`, hetzelfde pad voor gebouwen en rigide units; `rigidUnitMaterial.ts` leest `uvl.x` en het teammasker in `color.w`). De namen in `flatMaterials` zijn daarop gekozen en `test/robots.test.ts` bewaakt dat ze niet op de terugval (hout) uitkomen:

| Materiaal                                            | Oppervlaksoort | Waar                                                      |
| ---------------------------------------------------- | -------------- | --------------------------------------------------------- |
| `metal`, `metal_dark`, `metal_light`, `metal_hazard` | geverfd metaal | romp, behuizingen, pantserplaten, gevels, deuren          |
| `rust_metal`, `rust_dark`, `rust_roof`               | roest          | onderstel, wielen, uitlaten, golfplaat-dak                |
| `rubber`                                             | leer           | rupsen, kabels, luchtroosters                             |
| `lens`, `lens_red`, `lens_amber`, `lens_glass`       | lens           | sensorogen, vizier, laserkern, waarschuwingslampen, ramen |
| `concrete`                                           | beton          | voet, laadperron, schoorsteen                             |
| `opening`                                            | leer (donker)  | deuropening van de hal                                    |
| `team_trim`                                          | geverfd metaal | team-band (het enige materiaal met de spelerskleur)       |

Per asset (LOD0, LOD1, LOD2 in driehoeken; afmeting b x h x d in m): guard 1946 / 538 / 202, 3,0 x 2,2 x 3,5 (rupsen met loopvlak en wielen, geroest onderstel, romp met glacis, torso met team-band, kop met visier, twee armen met een loop, uitlaten, kabels); drone 956 / 508 / 200, 0,94 x 0,84 x 1,28 en `hover` 1,3 (schijf met koepel, camera-oog, thrusterpods, antenne, geleed reparatie-arm); sentinel 1952 / 486 / 178, 4,1 x 3,5 x 6,4 (zwaar rupsonderstel, hoekige romp, motordek met uitlaten, zeshoekige geschuttoren, kanon van 4 m met remmen en gloedringen); robotfactory 2166 / 806 / 166, 14,9 x 9,6 x 13,3 (golfplaat-loods, golfplaat-dak met lichtkoepels en ventilatoren, schuifdeur van 6 x 4 m met rail, schoorsteen tot 9,6 m, laadperron met oprit en afdak, portaalkraan); turret_laser 1034 / 388 / 152, 3,0 x 3,2 x 3,1 (betonnen voet, achthoekige behuizing met ribben en koepel, tweelingrail met cyaan kern).

Rigide units (`kind: 'rigid-unit'`): geen skelet, geen animaties, geen bake; beweging is een transform van het hele model. Manifest-velden (contract met render, `src/manifest.ts`):

| Veld                 | Betekenis                                                                                                                                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind: 'rigid-unit'` | star model                                                                                                                                                                                                                                |
| `rigid: true`        | verplicht bij dit kind                                                                                                                                                                                                                    |
| `bounds`             | meters, modelruimte, kijkt naar +Z, midden op x = z = 0                                                                                                                                                                                   |
| `teamMaterials`      | namen van de materialen met de spelerskleur (`['team_trim']`), `teamMask: 'materialName'`                                                                                                                                                 |
| `hover`              | optioneel, alleen zwevers (drone): meter van de onderkant boven de grond. De zweefhoogte zit al in het model (`bounds.min.y == hover`); render telt `hover` er niet bij op, maar gebruikt het voor schaduwvlek, selectiering en healthbar |

`boneCount` is 0 en `footprint` ontbreekt. Preview: `tools/asset-cli/preview/robots.html` (serveer de repo-root statisch; opties `lod`, `az`, `team`, `only`).

## Raiders (`assets/src/raiders.json`)

Alle 24 manifest-ids die de Raider-data gebruikt (`data/buildings.json` `visuals.mesh`, `data/loadouts.json` `visuals.meshSlots`), procedureel en op echte schaal (poppetje 1,8 m, deuren minstens 2,1 m, de footprint volgt het model en wordt nooit gekrompen), zonder downloads. Zelfde formaat en bouwer als `robots.json` (`src/robots.ts`, dezelfde onderdelen, `maxLod`/`minLod`, `mirror`, `repeat`) met één groep erbij: `attachments`. Eigen identiteit tegenover de Dwellers: lappendeken van schroot (golfplaat in grijs, roest, rood en zwart), spijkers, banden, doeken, zandzakken, schedels als vormen (koepel, gelaatsblok, kaak, oogkassen; geen tekst) en rood-zwarte vaste platen. `team_trim` blijft het enige teammateriaal (banier, band of vlag); een aanhangsel heeft geen teammateriaal, het schema weigert het. Alle getallen staan in `raiders.json`, een gewoon bewerkbaar bestand.

| Id                                    | Soort      | Maat (b x h x d, m)        | LOD0 / 1 / 2  | Wat                                                                                        |
| ------------------------------------- | ---------- | -------------------------- | ------------- | ------------------------------------------------------------------------------------------ |
| `raider_building_camp` (17 x 17)      | building   | 17,3 x 9,3 x 16,7          | 2423/990/260  | palissade van schroot, poort 5 x 4 m met schedel, uitkijktoren, hal, kleine kooi, tenten   |
| `raider_building_tent` (7 x 5)        | building   | 7,2 x 4,5 x 5,1            | 469/312/104   | legertent, deur 1,8 x 2,2 m, voorluifel, nokpaal met schedel                               |
| `raider_building_cage` (9 x 9)        | building   | 9,2 x 5,8 x 8,9            | 1710/740/232  | kooi met spijlen om de 0,4 m, poort 1,6 x 2,3 m, hoekpalen met schedels, roestdak          |
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

De negen wapen-, gereedschap- en pantser-ids die de Dweller-loadouts in `visuals.meshSlots` noemen (`data/loadouts.json`) hadden geen asset; render sloeg ze stil over. Nu zijn het procedurele aanhangsels in dezelfde bouwer en hetzelfde formaat als de Raider-aanhangsels (groep `attachments` van `src/robots.ts`, `kind: 'prop'`, `teamMask: 'none'`, geen footprint, geen teammateriaal, `anchor` `grip` of `body`, budget 2000/800/300). De config heeft geen `units` of `buildings`; `buildAssets` bouwt hem naast `robots.json` en `raiders.json` (optie `dwellersGearPath`). Alle getallen staan in het bestand.

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

**Controles** (`test/dwellers-gear.test.ts`, windrichting in `test/winding.test.ts`): de ids tegen `data/loadouts.json` (alle niet-body ids, negen), het anker bij het slot, maat-bereik per as, budgetten en dalend aantal driehoeken per LOD, `teamMask` `none`, geen Raider-materiaal of teammateriaal, oppervlaksoort per materiaal, byte-gelijke tweede bouw en `assets/dist` is de bouw van deze config.

## Geleverde modellen (`src/delivered.ts`, `assets/local/delivered.json`)

GLB's van de ontwerper (robots, wapens, gereedschap, tenten, torens) gaan zoals geleverd door de lokale buis (`pnpm assets --local`): de textures blijven, er is geen rigmap-entry voor nodig. De bronnen staan in `assets/local/delivered/` (gitignored: de meeste zijn fanmodellen, dus nooit in git, nooit in een prodbuild, alleen dev via de lokale manifest). Een geleverde mensfiguur zonder skelet loopt niet via `delivered.json` maar via een rigmap-entry met `autoRig` (zie Lokale assets). Ook de config is lokaal: `assets/local/delivered.json` (node- en materiaalnamen, maten en ankers; gitignored, want hij noemt de fanmodellen bij naam). In git staat alleen de code. De uitvoer komt in `assets/dist-local` onder het id van het repo-asset, dat de client in dev vervangt (`mergeManifests` in `apps/client/src/game/assets.ts`); een id dat het repo niet kent (bijvoorbeeld `dweller_robot_builder`) komt er gewoon bij. `--delivered <pad>` wijst een andere config aan (standaard `<--src>/delivered.json`); bestanden onder `assets/local/delivered/` zijn zelf geen asset.

Per entry (id = sleutel in `assets`; schema `deliveredAssetSchema`):

| Veld                      | Wat                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `file`, `kind`            | Bron relatief aan `assets/local` en `rigid-unit`, `prop` of `building`. `alias`: dezelfde LOD-bestanden onder nog meer ids.                                                                                                                                                                                                                                          |
| `include`, `exclude`      | Alleen meshes onder deze nodes (naam van de node of een voorouder), of juist niet; de rest van een scène (tweede toren, vloer) valt weg.                                                                                                                                                                                                                             |
| `rotate`                  | Graden (volgorde Y, X, Z) na de node-transformaties: model naar +Z voor, +Y omhoog. Een lijst van stappen wordt na elkaar toegepast. Wapens en gereedschap: de loop of kop naar +Z.                                                                                                                                                                                  |
| `scale` of `fit`          | Echte maat: een uniforme schaal, of `fit: { axis, meters }` (een as naar zoveel meter). Nooit gekrompen of opgerekt naar een footprint.                                                                                                                                                                                                                              |
| `align`, `hover`          | Oorsprong per as: `centre`, `min`, `max`, `keep`, `{ fromMin }` of `{ fromMax }` (meter vanaf een uiteinde, bijvoorbeeld de greep 0,2 m van het uiteinde van het handvat). Standaard x en z `centre`, y `min` (de grond). `hover` zet de onderkant zo hoog (rigide unit, ook in het manifest). Na het reduceren valt elke LOD opnieuw op de grond of de zweefhoogte. |
| `materials`               | Per bronmateriaal (of `node:<naam>` voor alles onder een node): `name`, `color`, `flat` (textuur weg), `drop`, `twoSided` (omgekeerde kopie van elke driehoek voor een doek zonder dikte, telt dubbel mee in het budget) en `solo` (driehoeken op LOD0 voor een romp die anders door veel kleine delen wordt uitgehongerd).                                          |
| `surface`, `atlasName`    | Het oppervlaksoort-sleutelwoord in de materiaalnaam (`metal`, `canvas`, `rust_metal`, `wood`, `leather`: render leest de soort uit de naam). Een getextureerd materiaal krijgt `<surface>_<bronnaam>_<id>` (render keyt zijn textuurlaag op de naam, dus uniek per asset); meer dan een diffuse textuur wordt een atlas van ten hoogste 1024 (`atlas`).              |
| `extraParts`, `footprint` | Extra vormen in modelruimte (zelfde onderdelen als `robots.json`, materialen uit `flatMaterials`), vooral de teamband `team_trim`. Gebouwen: de footprint van de data.                                                                                                                                                                                               |
| `lod0Triangles`           | Doel voor LOD0; LOD1 en LOD2 als aandeel (gebouwen 1 / 0,4 / 0,12, units en props 1 / 0,4 / 0,15, binnen de plafonds 2500, 2000 en 2000 voor LOD0 en 1000 of 800 en 300 voor de ver LODs).                                                                                                                                                                           |
| `anchor`, `simplify`      | Props: het anker (`grip`, `back`, `head`, `body`, zoals bij de Raiders). `simplify`: `flags`, `uvWeight`, `normalWeight` voor meshopt.                                                                                                                                                                                                                               |

Reductie: een enkele meshopt-pass over alle materialen samen (het materiaal van een hoekpunt is een zwaar gewogen attribuut, zodat naden dicht blijven en het budget daar heen gaat waar de vorm het vraagt; zonder `Prune`, dat met foutgrens 1 elk dun of klein deel weggooit, en met `Permissive` voor de naden van atlassen en harde normalen). Daarna dezelfde afronding als de procedurele modellen (JPEG-textures per LOD, meshopt, validatie: team-materiaal bij units en gebouwen, geen PBR, tris onder het plafond, grond op y = 0).

Maat en footprint: een gebouw dat meer dan 15 procent van de footprint in de data afwijkt (langste zijde) of eruit steekt, geeft een waarschuwing met `neededFootprint` (oneven cellen) in `validation-report.json`; het model blijft op echte schaal en de data wordt niet aangepast. Een model zonder team-materiaal heeft een eigen `team_trim` nodig (een band, `prism` om de romp, of een bestaand materiaal hernoemen naar iets met "team").

## KTX2

KTX2 is optioneel. Staat `toktx` (KTX-Software) op PATH, dan worden PNG-textures per LOD naar KTX2 (UASTC) omgezet. Ontbreekt hij, dan blijven textures PNG en meldt de CLI dat als waarschuwing. Dat is geen fout. De toktx-route is in sprint 1 niet getest (geen binary beschikbaar).

## Manifest

Schema en types: `src/manifest.ts` (zod). Voor render:

```ts
import { manifestSchema, type AssetManifest } from '@crawlout/asset-cli/manifest';
```

Dit pad is gedefinieerd in `exports` van `tools/asset-cli/package.json`; `@crawlout/asset-cli` zelf exporteert ook de CLI-API (`buildAssets`, `validateAsset`). Render moet `@crawlout/asset-cli` als devDependency toevoegen (`workspace:*`). Het manifest is deterministisch (geen tijdstempels, assets gesorteerd op id).

Per asset: `id`, `kind` (`character`, `prop` of `building`), `bounds` (min en max, meter), `lods` (drie items met `level`, `path` relatief aan `manifest.json` en `triangles`), `sockets` (`hand`, `back`, `head`, rustpose in modelruimte, alleen aanwezig als gevonden), `animations` (canonieke namen van de behouden clips en `durationSeconds`), `boneCount` en, voor karakters met animaties, `baked`.

`palette` (alleen karakters; optioneel): kledingkleuren die render op het skelet schildert, zie het Raiders-hoofdstuk (`bodyPaletteSchema` in `manifest.ts`).

`teamMask` (karakters en props; optioneel, ontbreekt = `materialName`): waar het teammasker vandaan komt, gelijk aan render's `TeamMaskSource`: `materialName` (materialen met "team" in de naam, of het hoofdmateriaal), `diffuseAlpha` (de alfa van de diffuse is het masker, per texel; gezet door de `teamMask`-regel in de rigmap) of `none`. Render leest het veld uit het manifest (`unitAssetLoader`, `unitAssets`); een expliciete render-optie gaat voor. Gebouwen gebruiken `teamMaterials`.

Alleen voor `kind: 'prop'` (de pack-props, zie Prop-packs): `category` (`tree-leafy`, `tree-bare`, `grass`, `plant`, `rock`, `crate`, `chest`, `barrel`, `structure`, `debris`; `PROP_CATEGORIES` in `manifest.ts`) en `alpha: 'mask'` bij bladkaarten en gras (materiaal met alphaMode MASK en alphaCutoff, diffuse als WebP met alfa: render tekent met alpha-test). De oude Gobkit-props hebben deze velden niet.\n\nAlleen voor `kind: 'building'`: `footprint` `{ w, h }` (cellen van 1 m) en `teamMaterials` (namen van de materialen die de spelerskleur krijgen). Een gebouw heeft `boneCount` 0, geen `baked` en geen `sockets`. Het model staat met het midden van de footprint op de oorsprong in x en z, de grond op y = 0, +Y omhoog; de LOD's hebben dezelfde bounds. Zonder deze velden zijn `footprint` en `teamMaterials` bij andere soorten verboden (het schema controleert dat).

### `baked` (fase-0 sectie 12)

```
baked: { path, width, height, fps, clips: [{ name, startRow, frames, loop, durationSeconds }] }
```

- `path`: `<id>/<id>.anim.f32`, relatief aan `manifest.json`. RGBA float32 little-endian, rij na rij.
- `width` = `boneCount` * 4 texels, `height` = som van alle `frames`. Texel (bone * 4 + c, row) is kolom c van de skin-matrix van die bone (column-major, zoals `Matrix4.elements`). Skin-matrix = geanimeerde joint-wereldmatrix * inverse bind-matrix. Bone-volgorde = joint-volgorde van de skin in de GLB.
- `clips`: altijd precies de acht namen van `ANIM_NAMES`, in die volgorde, elk een aaneengesloten blok rijen vanaf `startRow`. 30 fps, `frames` = max(2, round(duur * 30)). Loop-clips bemonsteren [0, 1); `death` (`loop: false`) sluit de laatste pose op 1 in.
- Het zod-schema controleert clipvolgorde, aaneengesloten blokken, `height` en `width` = `boneCount` * 4.
- Beperkingen: CUBICSPLINE-samplers worden lineair benaderd; de wereldmatrix van de mesh-node zelf telt niet mee (verwacht identiteit, transformaties toegepast).

## Clipnamen koppelen (`assets/src/clipmap.json`)

Quaternius-clips hebben andere namen dan `ANIM_NAMES` (bijvoorbeeld `Walk_Loop`). Het optionele bestand `assets/src/clipmap.json` koppelt ze zonder codewijziging:

```json
{
  "clips": { "Walk_Loop": "walk", "Jog_Fwd_Loop": "run" },
  "assets": { "hero": { "Sword_Attack": "attack2" } }
}
```

- `clips` geldt voor alle assets; `assets.<id>` geldt alleen voor dat asset en gaat voor.
- Sleutels zijn hoofdletterongevoelig; waarden moeten een van de acht canonieke namen zijn (anders een fout). Een clip die al een canonieke naam heeft hoeft niet in de map.
- Twee bronclips die naar dezelfde doelclip wijzen geven een fout, evenals een ontbrekende doelclip. De meegeleverde map staat per asset (`assets.dweller_body_human`), omdat de UAL meer clips per doel heeft (`Jog_Fwd_Loop` en `Sprint_Loop`); ze is gecontroleerd tegen de echte GLB: idle `Idle_Loop`, walk `Walk_Loop`, run `Jog_Fwd_Loop`, attack1 `Pistol_Shoot`, attack2 `Punch_Cross`, gather `Interact`, build `Fixing_Kneeling`, death `Death01`.

## Wat render moet doen om te laden

1. `@crawlout/asset-cli` als devDependency (`workspace:*`) en `manifestSchema` uit `@crawlout/asset-cli/manifest` parsen.
2. Per karakter `fetch(baked.path)` (relatief aan manifest.json), `new Float32Array(buffer)` en een `DataTexture(data, baked.width, baked.height, RGBAFormat, FloatType)` maken (NearestFilter).
3. Clip-tabel uit `baked.clips`: (`startRow`, `frames`, `loop`, `durationSeconds`), geindexeerd op `ANIM[name]`; de volgorde is die van `ANIM_NAMES`.
4. Het skinIndex-attribuut van de LOD-meshes verwijst naar bone-index in deze texture (zelfde GLB, zelfde volgorde).

## Prop-packs (DJMaesen, `assets/src/packs.json`)

Negen Sketchfab-packs van DJMaesen (CC-BY-4.0, naamsvermelding in `assets/src/licenses/djmaesen-packs-CC-BY-4.0.txt` en in `asset.copyright` van elke LOD-GLB) worden door `src/packs.ts` in losse props gesplitst. De bronnen staan in `assets/src/packs/` (80 MB, gitignored, nooit in git; vanuit een worktree zoekt de buis ze ook in de hoofdcheckout). Alles wat bijgestuurd kan worden staat in **`assets/src/packs.json`**, zonder code:

- `categories`: per categorie (`tree-leafy`, `tree-bare`, `grass`, `plant`, `rock`, `crate`, `chest`, `barrel`, `structure`, `debris`) de redelijke hoogte (`heightRangeM`, de maat-check naast een poppetje van 1,8 m), de driehoeken per LOD (`tris`, plafond), de maximale atlas (`atlas`: 1024, of 512 voor kleine props) en hoe het prop op x en z gecentreerd wordt (`centre`: `bounds` of `base`, de voet, voor bomen).
- `sources.<pack>`: `file`, `unit` (meter per bron-eenheid; de FBX-exports zijn in centimeters: 0.01), de **splitsregel** `split.parent` (elk kind van die node is een kandidaat-prop) en `skip` (kinderen die geen prop worden, met reden). Een kind dat in geen van beide staat is een fout, zodat er niets stil wegvalt.
- `sources.<pack>.props.<id>`: `node` (het kind), `category`, en de **echte maat**: `heightM` (uniforme schaal naar deze hoogte; zonder: bron-eenheden maal `unit`) of `longestM` (langste afmeting, voor lage brede props zoals een pallet), plus optioneel `heightRangeM` (strengere check dan de categorie), `lod0Triangles`, `atlas`, `centre`, `alpha` (`mask` of `none`: verwacht alfagedrag) en `note`.

Per prop: de meshes onder het object (alle node-transformaties erin gebakken, de plaatsing in het pack en de FBX-draaiing van Sketchfab vallen weg, Y omhoog), uniform geschaald naar de echte maat, voet op y = 0, gecentreerd op x en z. Alle diffuse textures van het prop gaan in een atlas (maximaal `atlas` px; nooit vergroot), de primitives worden samengevoegd tot een mesh met een materiaal. Bladkaarten en gras: de bron staat op BLEND of MASK, de uitvoer altijd op **alphaMode MASK met alphaCutoff** (de cutoff van de bronmaterialen met MASK, anders 0,5; oak 0,65, pine 0,87), de atlas is WebP met alfakanaal (kleur onder volledig transparante texels is naar het gemiddelde gevuld, geen donkere randen) en het manifest-veld is `alpha: 'mask'`. Ondoorzichtige props krijgen een JPEG-atlas. LOD0 tot LOD2: meshopt-simplify (uv en normaal gewogen) op het budget van de categorie, de atlas halveert per LOD (1024, 512, 256 of 512, 256, 128), elke LOD zet zijn eigen voet op y = 0. Bomen met bladkaarten (`reduceFoliageMesh`) geven op LOD1 en LOD2 40 procent van het budget aan de stam en de rest aan de grootste kaarten, die tot 2,2 keer groter worden, zodat de kruin niet verdwijnt.

Controles (een fout faalt de build met een leesbare reden): hoogte binnen het bereik, voet op y = 0, midden, driehoeken per LOD binnen het budget, een materiaal, geen PBR, MASK behouden, en de bladsoort: `tree-leafy` eist groene tot geelgroene, verzadigde kaarten, `tree-bare` bruin of grijs twijgwerk (tint en verzadiging van de dekkende texels, in `validation-report.json` onder `alpha`). Het verslag geeft per prop de bron-hoogte bij `unit`, de uiteindelijke hoogte, de schaal, de atlas en de driehoeken.

Manifest: `kind: 'prop'`, `category`, `alpha` (alleen bij bladkaarten en gras), `bounds`, `teamMask: 'none'`. Ontbreekt een pack-bron (CI, een verse clone), dan blijft de bestaande uitvoer van de props uit dat pack in `assets/dist` staan en geeft de buis een waarschuwing; zonder eerdere uitvoer is het een fout.

Preview: `tools/asset-cli/preview/props.html` (serveer de repo-root statisch; `?lod=0|1|2&w=<px>&only=<id,id>&manifest=<pad>`) tekent alle pack-props in rijen op echte schaal, elk naast een poppetje van 1,8 m en met de hulplijn op 1,8 m.

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

`test/packs.test.ts` toetst de pack-buis met een synthetische pack-GLB (splitsen, FBX-draaiing, echte schaal, voet en midden, MASK met WebP-alfa, de config, bladsoort, determinisme, behoud van de uitvoer als de bron ontbreekt); `test/packs-dist.test.ts` toetst de gecommitte uitvoer in `assets/dist` tegen `packs.json`: per categorie redelijke hoogtes, voet op y = 0, budgetten en alfagedrag.\n\n`test/shapes.test.ts` toetst de vormen van `src/shapes.ts` (windrichting tegen de normalen, gesloten volumes, driehoeksaantallen, determinisme) en `repeat` en `mirror`; `test/robots.test.ts` de vijf robot-assets (maten, 10 procent van de oude placeholders, budgetten per LOD, deur van 4 m, oppervlaksoort per materiaal, manifestvelden en de LOD-GLB's in `assets/dist`).

`test/buildings.test.ts` toetst de gebouwen: config tegen `data/buildings.json`, footprint-schaal per LOD, grond, team-materiaal, geen PBR, budgetten, determinisme (twee runs, gelijke bytes), het manifest-schema en de meshgereedschappen.

`npx -y pnpm@9 test` (`test/bake.test.ts` voor de bakker, inclusief roundtrip van een bekende pose; `test/conform.test.ts` voor bone-snoeien, rigmap, simplify met skinning en een smoke-test op de echte UAL-GLB) genereert synthetische GLB's met gltf-transform (geldige humanoid-dummy, te zware en foute varianten) in `test/fixtures.ts`.

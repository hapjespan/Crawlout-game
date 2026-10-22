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

Alleen voor `kind: 'prop'` (de pack-props, zie Prop-packs): `category` (`tree-leafy`, `tree-bare`, `grass`, `plant`, `rock`, `crate`, `chest`, `barrel`, `structure`, `debris`; `PROP_CATEGORIES` in `manifest.ts`) en `alpha: 'mask'` bij bladkaarten en gras (materiaal met alphaMode MASK en alphaCutoff, diffuse als WebP met alfa: render tekent met alpha-test). De oude Gobkit-props hebben deze velden niet.\n\nAlleen voor `kind: 'building'`: `footprint` `{ w, h }` (cellen van 1 m) en `teamMaterials` (namen van de materialen die de spelerskleur krijgen; leeg bij een ruine zonder eigenaar, de `site_*_ruin`-gebouwen). Een gebouw heeft `boneCount` 0, geen `baked` en geen `sockets`. Het model staat met het midden van de footprint op de oorsprong in x en z, de grond op y = 0, +Y omhoog; de LOD's hebben dezelfde bounds. Zonder deze velden zijn `footprint` en `teamMaterials` bij andere soorten verboden (het schema controleert dat).

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

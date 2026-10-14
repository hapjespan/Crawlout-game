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

Lege `assets/src` geeft groen met de melding "geen assets" en een lege manifest. Schendt een asset de brief, dan staat per asset een leesbare reden op het scherm, is de exit code 1 en wordt er niets naar `assets/dist` geschreven. Opties: `--src <map>` en `--dist <map>`.

## Bronnen die niet aan de brief voldoen (conform-stap)

Vóór de validatie draait een conform-stap (`src/conform.ts`), alleen voor wat in de config staat. Zo kan een zwaardere placeholder (Quaternius-mannequin: 13.744 tris, 53 bones, 46 clips) door de buis zonder de norm voor eindassets te verlagen: de validatie en de budgetcontrole draaien op het resultaat van de conform-stap, niet op de bron. Een eindasset zonder entry in `rigmap.json` wordt dus nog steeds met de volle norm getoetst.

`assets/src/rigmap.json`:

```json
{
  "rigs": { "quaternius-ual": { "bones": { "DEF-hips": "Hips", "pelvis": "Hips", "DEF-hand.L": "LeftHand" } } },
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

## Wat wordt gevalideerd

| Regel | Norm |
| --- | --- |
| Tris | Karakters LOD0 maximaal 4000 (LOD1 1500, LOD2 600 via simplify). Props (lager, `budgets.ts`): LOD0 maximaal 2000, LOD1 800, LOD2 300; een prop eronder blijft ongewijzigd, dus de LODs zijn dan gelijk |
| Bones | Maximaal 28 |
| Botnamen | Mixamo (`mixamorig:Hips` enzovoort; prefix optioneel); kern-bones moeten bestaan |
| Textuur | Maximaal 2048 x 2048 |
| UV | Eén set (`TEXCOORD_0`) |
| Schaal | Karakter ongeveer 1,8 m (tolerantie 15 procent), voeten rond y=0 (5 cm) |

Een karakter met animaties moet alle acht clips van `ANIM_NAMES` hebben (idle, walk, run, attack1, attack2, gather, build, death), direct of via de clipmap; een ontbrekende clip is een fout met de naam van die clip, een dubbelzinnige koppeling ook. Verder: precies 1 skin, en alle `JOINTS_0`-indices liggen binnen de joints van die skin. Een karakter zonder animaties krijgt een waarschuwing en geen `baked`.

Waarschuwingen (geen fout): ontbrekende socket-bones (`socket_hand`, `socket_back`, `socket_head`, met fallback op `RightHand`, `Spine2`, `Head`). De waarden staan in `src/budgets.ts`.

Gezicht naar +Z wordt gecontroleerd aan de zolen: staan de zoolvertices meer dan 2 cm achter de enkel-bones (`LeftFoot`, `RightFoot`), dan is het een fout. Een model zonder voeten geeft geen oordeel.

Niet gecontroleerd: tris-only meshes, hand-painted stijl.

## KTX2

KTX2 is optioneel. Staat `toktx` (KTX-Software) op PATH, dan worden PNG-textures per LOD naar KTX2 (UASTC) omgezet. Ontbreekt hij, dan blijven textures PNG en meldt de CLI dat als waarschuwing. Dat is geen fout. De toktx-route is in sprint 1 niet getest (geen binary beschikbaar).

## Manifest

Schema en types: `src/manifest.ts` (zod). Voor render:

```ts
import { manifestSchema, type AssetManifest } from '@crawlout/asset-cli/manifest';
```

Dit pad is gedefinieerd in `exports` van `tools/asset-cli/package.json`; `@crawlout/asset-cli` zelf exporteert ook de CLI-API (`buildAssets`, `validateAsset`). Render moet `@crawlout/asset-cli` als devDependency toevoegen (`workspace:*`). Het manifest is deterministisch (geen tijdstempels, assets gesorteerd op id).

Per asset: `id`, `kind` (`character` of `prop`), `bounds` (min en max, meter), `lods` (drie items met `level`, `path` relatief aan `manifest.json` en `triangles`), `sockets` (`hand`, `back`, `head`, rustpose in modelruimte, alleen aanwezig als gevonden), `animations` (canonieke namen van de behouden clips en `durationSeconds`), `boneCount` en, voor karakters met animaties, `baked`.

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

## Tests

`npx -y pnpm@9 test` (`test/bake.test.ts` voor de bakker, inclusief roundtrip van een bekende pose; `test/conform.test.ts` voor bone-snoeien, rigmap, simplify met skinning en een smoke-test op de echte UAL-GLB) genereert synthetische GLB's met gltf-transform (geldige humanoid-dummy, te zware en foute varianten) in `test/fixtures.ts`.

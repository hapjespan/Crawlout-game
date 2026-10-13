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
assets/dist/<id>/lod0.glb
assets/dist/<id>/lod1.glb
assets/dist/<id>/lod2.glb
```

Lege `assets/src` geeft groen met de melding "geen assets" en een lege manifest. Schendt een asset de brief, dan staat per asset een leesbare reden op het scherm, is de exit code 1 en wordt er niets naar `assets/dist` geschreven. Opties: `--src <map>` en `--dist <map>`.

## Wat wordt gevalideerd

| Regel | Norm |
| --- | --- |
| Tris | Karakters LOD0 maximaal 4000 (LOD1 1500, LOD2 600 via simplify). Props: LOD0 maximaal 4000, LOD1 40 procent, LOD2 15 procent |
| Bones | Maximaal 28 |
| Botnamen | Mixamo (`mixamorig:Hips` enzovoort; prefix optioneel); kern-bones moeten bestaan |
| Textuur | Maximaal 2048 x 2048 |
| UV | Eén set (`TEXCOORD_0`) |
| Schaal | Karakter ongeveer 1,8 m (tolerantie 15 procent), voeten rond y=0 (5 cm) |

Waarschuwingen (geen fout): ontbrekende socket-bones (`socket_hand`, `socket_back`, `socket_head`, met fallback op `RightHand`, `Spine2`, `Head`) en ontbrekende clips (idle, walk, run, attack1, attack2, gather, build, death). De waarden staan in `src/budgets.ts`.

Niet gecontroleerd: gezicht naar +Z, tris-only meshes, hand-painted stijl.

## KTX2

KTX2 is optioneel. Staat `toktx` (KTX-Software) op PATH, dan worden PNG-textures per LOD naar KTX2 (UASTC) omgezet. Ontbreekt hij, dan blijven textures PNG en meldt de CLI dat als waarschuwing. Dat is geen fout. De toktx-route is in sprint 1 niet getest (geen binary beschikbaar).

## Manifest

Schema en types: `src/manifest.ts` (zod). Voor render:

```ts
import { manifestSchema, type AssetManifest } from '@crawlout/asset-cli/manifest';
```

Dit pad is gedefinieerd in `exports` van `tools/asset-cli/package.json`; `@crawlout/asset-cli` zelf exporteert ook de CLI-API (`buildAssets`, `validateAsset`). Render moet `@crawlout/asset-cli` als devDependency toevoegen (`workspace:*`). Het manifest is deterministisch (geen tijdstempels, assets gesorteerd op id).

Per asset: `id`, `kind` (`character` of `prop`), `bounds` (min en max, meter), `lods` (drie items met `level`, `path` relatief aan `manifest.json` en `triangles`), `sockets` (`hand`, `back`, `head`, rustpose in modelruimte, alleen aanwezig als gevonden), `animations` (naam en `durationSeconds`) en `boneCount`. Het veld `baked` is gereserveerd voor sprint 2.

## Sprint 2

`src/bake.ts` bevat alleen de interface (`bakeAnimations`) voor het bakken van animaties naar bone-matrix textures; hij gooit nu een fout en wordt door de buis niet aangeroepen.

## Tests

`npx -y pnpm@9 test` genereert synthetische GLB's met gltf-transform (geldige humanoid-dummy, te zware en foute varianten) in `test/fixtures.ts`.

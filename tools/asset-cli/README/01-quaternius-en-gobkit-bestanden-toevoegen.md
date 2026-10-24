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
- **Reductie** (`lod0Triangles`): is de bron zwaarder, dan reduceert meshopt-simplify hem naar dit aantal (richtpunt circa 20.000 voor karakters, plafond 24.000; herzien 23 oktober 2026). Alle attributen (UV, normalen, JOINTS_0, WEIGHTS_0) blijven behouden omdat alleen de indexbuffer verandert. LOD1 en LOD2 worden daaruit afgeleid (doelen 7.000 en 2.200, `characterLodTargets`); als de buis zelf gereduceerd heeft, wordt ook de ondergrens gecontroleerd (`characterMinTris`: 3000, 2500, 800).
- **Schaal** (`scale`): uniforme schaal in de vertices gebakken, voor props (de Gobkit-props zijn in centimeters: 0.01). Bij karakters niet ondersteund; die moeten in de bron al 1,8 m zijn.
- Extra UV-sets (`TEXCOORD_1` en hoger) worden verwijderd voor assets met een entry.
- **Clips**: altijd (ook zonder entry) blijven alleen de via de clipmap of op naam gekoppelde clips over, met de canonieke naam; de rest vervalt uit het manifest en uit de bake. De LOD-GLB's bevatten geen animaties meer, die zitten in de bone-matrix-texture.

Oriëntatie en schaal van de UAL-mannequin zijn gecontroleerd: 1,83 m, voeten op y = 0,002, gezicht naar +Z (de tenen staan +0,15 m voor de enkel), +Y omhoog. Er is dus geen correctie nodig; de enige transformatie is de statische `root`-node (-90 graden X, Blender naar glTF), die in de skin-matrices van de bake zit.

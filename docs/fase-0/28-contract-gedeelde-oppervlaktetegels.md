## 28. Gedeelde oppervlaktetegels in het assetmanifest (24 oktober, **voorstel, nog niet goedgekeurd**)

> **Status: contractwijziging, wacht op review van de architect.** Harde regel 1 zegt dat de contracten bevroren zijn en dat een wijziging een PR is op `docs/fase-0/` plus `packages/protocol`, met review door de architect. Dit document is die PR-helft. De code staat op de branch, de tests zijn groen en `assets/dist` is herbouwd, maar het besluit is **niet** genomen. Dit is geen genomen besluit zoals sectie 12 tot en met 27; het is een voorstel met de meting erbij.
>
> `packages/protocol` is **ongewijzigd**. Het assetmanifest is geen deel van de drie contracten in `packages/protocol` (sim en snapshot, commandoprotocol, dataschema): het is het contract tussen werkstroom 3 (asset-cli) en werkstroom 2 (render), en het woont in `tools/asset-cli/src/manifest.ts`. Daarom raakt dit voorstel protocol niet. Of dat de juiste plek is, is zelf een vraag voor de architect (zie "Open punten", punt 1).

### Het probleem, gemeten

De procedurele geometrie (gebouwen, rigide units, aanhangsels) krijgt reliëf uit gegenereerde kaarten: per oppervlaktesoort één verweringskaart op de basiskleur, één normalkaart en één metallic-roughnesskaart (`tools/asset-cli/src/surfaceTex.ts`). Die kaarten **tegelen**: een soort heeft precies één set, dezelfde bytes overal.

Tot nu toe droeg elk asset zijn eigen kopie in elk LOD-GLB. Gemeten op `assets/dist` van commit `c9ce71a`:

| | bytes | |
|---|---|---|
| `assets/dist` totaal | 34.783.840 | 33,17 MiB |
| alle GLB's samen | 28.380.628 | 27,07 MiB |
| de 136 GLB's (68 assets) die een tegel droegen | 16.724.556 | 15,95 MiB |
| waarvan ingebedde tegel-JPEG | 7.561.639 | 7,21 MiB |

Elf soorten inhoud, 136 kopieën. Render dedupliceert ze aan de laadkant toch al weg: `TextureLayerTable` (`packages/render/src/structures/buildingGeometry.ts`) sleutelt op de materiaalnaam en houdt één laag per naam, dus de kopieën bereiken de GPU nooit. Het zijn puur bytes over de lijn.

*Noot bij de getallen in de opdracht.* De opdracht noemde 8,70 → 21,73 MB en de code-commentaar in `buildings.part1.ts` noemde +12,6 MB. Die cijfers dateren van vóór de JPEG-stap in `finishBuildingLod`; met PNG waren de tegels inderdaad zo zwaar. Op de gemeten uitgangsstand is 7,21 MiB het bedrag dat er werkelijk in zit, niet 13 MB. De 8,70 klopt wel: dat is precies wat die 136 GLB's zonder tegel wegen.

### Het voorstel

Eén gedeelde tegelset naast `manifest.json`, waar assets naar verwijzen.

**1. Nieuw veld in het manifest: `surfaces` (optioneel, top-level).**

```jsonc
{
  "version": 1,
  "assets": [ /* ongewijzigd */ ],
  "surfaces": {
    "size": 256,            // texelzijde van elke tegel, vierkant
    "metersPerTile": 2,     // meters die een hele tegel beslaat in de UV (asset-cli UV_METERS_PER_TILE)
    "tiles": [              // hoogstens één regel per soort, gesorteerd op kind
      { "kind": "cloth",
        "base":   "surfaces/cloth.base.jpg",
        "normal": "surfaces/cloth.normal.jpg",
        "mr":     "surfaces/cloth.mr.jpg" }
      // ... 11 soorten
    ]
  }
}
```

| veld | type | betekenis |
|---|---|---|
| `surfaces` | object, **optioneel** | Ontbreekt het, dan gebruikt geen enkel asset gedeelde tegels en draagt elk materiaal zijn eigen kaarten. Dat is het gedrag van vóór deze wijziging en blijft geldig. |
| `surfaces.size` | int > 0 | Texelzijde. Alle soorten en alle drie de kaarten hebben dezelfde maat, zodat render ze op één laagindex kan adresseren. |
| `surfaces.metersPerTile` | number > 0 | Hoeveel meter oppervlak één hele tegel beslaat in de UV van de assets. |
| `surfaces.tiles[]` | array, ≥ 1 | Hoogstens één regel per soort, gesorteerd op `kind` (afgedwongen door het schema, zodat het manifest byte-stabiel is). |
| `tiles[].kind` | enum | Een van `SURFACE_KINDS`: `wood`, `paintedMetal`, `rustMetal`, `cloth`, `leather`, `skin`, `rock`, `foliage`, `concrete`, `roofing`, `lens`. Die lijst verhuist naar `manifest.ts` omdat hij nu contract is; `surfaceTex.part1.ts` en `packages/render/src/look/surfaces.ts` houden hem gelijk. |
| `tiles[].base` | pad | Grijswaarde-verweringskaart op de basiskleur (sRGB). Pad relatief aan de map van `manifest.json`, forward slashes, zoals `lods[].path`. |
| `tiles[].normal` | pad | Tangent-space normalkaart (lineair, glTF +Y omhoog). |
| `tiles[].mr` | pad | glTF metallicRoughness: G = roughness, B = metalness (lineair). |

Er komt **geen** veld per asset bij. De aanwezigheid van `surfaces` is het enige signaal dat render nodig heeft om de bestanden op te halen.

**2. Nieuwe afspraak in het GLB: `extras.surface` op het materiaal.**

Een effen materiaal dat een gegenereerd oppervlak gebruikt draagt géén enkele textuur meer, maar wél een glTF-material-extra:

```jsonc
{ "name": "team_trim", "extras": { "surface": "paintedMetal" } }
```

De waarde is een `SURFACE_KINDS`-naam. Drie's `GLTFLoader` zet material extras op `material.userData`, dus render leest `material.userData.surface` zonder extra loader. Een materiaal met deze extra heeft per definitie geen eigen basiskleur-, normal- of metallic-roughnesskaart; `validateBuildingDocument` weigert de combinatie, zodat een stille overschrijving niet kan ontstaan.

Waarom een extra en niet "render leidt de soort zelf af uit de materiaalnaam": dat kan render al (`surfaceKindOfMaterial`), maar dan weet het niet *of* dit materiaal een tegel hoort te krijgen. LOD2 is bewust effen, bronmaterialen hebben echte kunst, en een materiaal zonder UV mag er geen krijgen. De extra zegt precies de drie dingen die niet af te leiden zijn: wel of geen tegel, welke soort, en dat de asset-cli het zo bedoeld heeft.

**3. Eén maat voor alle LOD's.** De ingebedde tegels waren 256 op LOD0 en 128 op LOD1. Dat laatste haalde nooit de GPU: de laagtabel houdt per materiaalnaam de grootste afbeelding, dus de 128-kopie werd nooit een laag. Wat hij wél deed was de UV-herschaling van LOD1 verschuiven (`texelDensity.ts` rekent met de textuurbreedte), waardoor de panelen van LOD1 op 64 cm lazen in plaats van op de meter waarop ze zijn getekend. Met één gedeelde tegel van 256 verdwijnt die inconsistentie samen met de bytes. **Dit is de enige zichtbare verandering van het voorstel** en hij gaat de goede kant op.

### Wat het oplevert

Gemeten op dezelfde boom, `pnpm assets` ervoor en erna (de build is byte-voor-byte reproduceerbaar; de uitgangsstand is geverifieerd met een schone herbouw):

| | voor | na | verschil |
|---|---|---|---|
| `assets/dist` totaal | 34.783.840 | 27.226.165 | **−7.557.675 bytes (−7,21 MiB, −21,7 %)** |
| alle GLB's samen | 28.380.628 | 20.555.932 | −7.824.696 bytes (−7,46 MiB, −27,6 %) |
| de 136 betrokken GLB's | 16.724.556 | 8.899.860 | −7.824.696 bytes (−7,46 MiB) |
| de gedeelde tegelset (33 bestanden) | — | 265.005 | +259 kB |

Dus: **7,2 MiB eraf, niet de 13 MB uit de opdracht.** Het verschil zit hem in de JPEG-stap die er al was; zie de noot hierboven.

Eén tegenpost zit in dat getal verwerkt. `prune()` in `finishBuildingLod` gooide TEXCOORD\_0 weg zodra het materiaal geen textuur meer had — precies de UV waarmee render de gedeelde tegel bemonstert, waardoor elk gebouw vlak binnenkwam. `prune({ keepAttributes })` staat daarom aan op de LOD's die een tegel gebruiken en uit op LOD2. Dat kost 830 kB aan behouden UV's; zonder die correctie was het 8,0 MiB geweest, maar dan zonder reliëf.

### Wat render doet

Nieuw: `packages/render/src/look/surfaceTiles.ts`.

- `loadSurfaceTiles(manifest, resolveUrl, io)` haalt de bestanden op en decodeert ze (in de browser `createImageBitmap`, injecteerbaar voor tests). Geen `surfaces`-blok → `null`. Een soort die faalt landt in `missing` en zijn materialen blijven effen; een tegel is nooit een reden om een asset te laten vallen.
- `surfaceTilesFor(manifestUrl, ...)` cachet dat per manifest-URL, zodat de vier laders (gebouwen, props, aanhangsels, rigide units) de 33 bestanden samen één keer ophalen.
- `applySurfaceTiles(root, tiles)` hangt de tegels op de gemarkeerde materialen van een geparseerde scene. Idempotent, en een materiaal dat al een `map` heeft wordt nooit overschreven — dus een ouder manifest met ingebedde kaarten blijft werken.

De aanroep staat in elke lader tussen `parseGltf` en de geometriebouwer, want de laagtabel leest de afbeeldingsmaat om een laag te kiezen en om de UV op texeldichtheid te herschalen. `TextureLayerTable` en `layerOf` zijn **niet aangeraakt**: vanaf dat punt is een gedeelde tegel niet te onderscheiden van een ingebedde kopie. `loadRigidUnitAsset` krijgt de set via `opts.surfaces`, omdat een rigide entry van het manifest wordt afgesplitst vóór het schema hem ziet en die lader hem dus niet zelf kan opzoeken.

Karakters (`unitAssetLoader`, de zware kant) raken dit voorstel niet: die hebben echte kunst en geen gegenereerde tegels.

### Compatibiliteit

| | nieuw render | oud render |
|---|---|---|
| **nieuw manifest** (met `surfaces`) | werkt | **breekt stil**: gebouwen en props komen effen binnen |
| **oud manifest** (zonder `surfaces`) | werkt | werkt |

De ene gevaarlijke cel is nieuw-manifest-met-oude-render. `MANIFEST_VERSION` staat in dit voorstel op `1` omdat het schema zuiver additief is en manifest en GLB's samen één artefact zijn (`assets/dist` staat in git en wordt in één commit herbouwd). Wil de architect dat die cel hard valt in plaats van stil, dan is de bump naar `2` de knop; zie "Open punten", punt 2.

### Open punten voor de architect

1. **Hoort het assetmanifest hier?** Het is een bevroren contract tussen twee werkstromen maar staat niet in `packages/protocol` en had tot nu toe geen sectie in `docs/fase-0/`. Dit document is de eerste. Als het antwoord "ja" is, hoort er ook een regel in sectie 8 (wie schrijft waar) bij, want werkstroom 3 heeft nu in `packages/render` geschreven.
2. **`MANIFEST_VERSION` op 1 houden of naar 2?** Zie de tabel hierboven. De bump kost het bijwerken van zeventien plekken met een hardgecodeerde `1`, en maakt van een stille vlakke build een luide fout.
3. **De dubbele soortenlijst.** `SURFACE_KINDS` staat nu in `tools/asset-cli/src/manifest.ts` (contract) en in `packages/render/src/look/surfaces.ts` (de recepten). Ze moeten gelijk lopen en niets dwingt dat af; er is alleen commentaar aan beide kanten. Een test die de twee vergelijkt kan er zo bij, maar dan importeert render-test de asset-cli — wat al gebeurt, dus het is eerder een vraag of de architect die richting wil vastleggen.
4. **Het alternatief dat niet gekozen is: externe image-URI's in het GLB.** glTF kan een afbeelding bij URI noemen in plaats van in te bedden; `GLTFLoader` lost die op naast het GLB en de browsercache dedupliceert ze. Dat had geen enkele contractwijziging gekost. Niet gedaan omdat (a) het GLB dan niet meer zelfstandig is, (b) het ~1.500 losse verzoeken bij een koude cache betekent in plaats van 33, en (c) `validateBuildingDocument` de maat van een kaart leest uit de ingebedde bytes en dat dan niet meer kan. Vermeld omdat het de goedkoopste optie was en de architect hem moet kunnen afwegen.
5. **`metersPerTile` wordt nu door render gelezen noch gebruikt.** Het staat in het manifest omdat het de tegel pas betekenis geeft (256 texels over 2 m is 128 texels/m, binnen `DENSITY_BAND`) en omdat `texelDensity.ts` het ooit expliciet zou kunnen gebruiken in plaats van het impliciet uit de UV af te leiden. Een veld dat niemand leest is een contractschuld; weglaten kan ook.

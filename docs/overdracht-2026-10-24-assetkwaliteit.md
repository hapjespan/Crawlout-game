# Overdracht 24 oktober 2026: assetkwaliteit

Martien gaf de stand een 3 tot 4 van 10, met het krachtpantser als enige 7. Dit is wat daarachter bleek te zitten en wat ervan gerepareerd is.

## Stand van zaken

Op `sprint-1`, gecommit maar **niet gepusht** (Martien pusht zelf). De commits staan los per onderwerp: documentherziening, renderer, rig en kleding, de Blender-route, het PBR-verbod, de procedurele texturen, de herbouwde `assets/dist`, en de test-aanpassingen. Nog ongecommit op het moment van schrijven: het geheugenwerk in `tools/asset-cli` (`textures.*`, `ktx2.ts`, `build.part*`), omdat drie bestanden over de 5.000-tokengrens van de pre-commit-hook staan en eerst gesplitst moeten worden.

Volledige suite groen: 2151 tests over 225 bestanden, lint en typecheck schoon.

## Waarom het krachtpantser de enige 7 was

Twee oorzaken, allebei toeval:

1. De renderer bond maar één textuur per asset (`const atlas = maps[0]` in `gltfUnitGeometry.ts`). Het krachtpantser heeft er precies **één**; de Klerk 23, dus 22 onderdelen tekenden wit.
2. Het krachtpantser was de enige karakterbron die zijn **eigen skelet** meebracht (96 botten). De rest zijn standbeelden die de buis zelf moest riggen.

## Gevonden fouten, allemaal gerepareerd

- `units/gltfUnitGeometry.ts` — alleen `maps[0]` gebonden. Nu één `DataArrayTexture` per kaartsoort.
- `canvasRasterize` — 2D-canvas slaat voorvermenigvuldigd op, dus kleur onder alfa 0 werd zwart. 94% van de texels van de Klerk-jas. Nu `glRasterize` (WebGL2).
- `lods.ts` `restore()` — bewaarde vertex-arrays op volgnummer, dus na een weggevallen primitief kreeg elk onderdeel de geometrie van zijn buurman. LOD1/2 tekenden de jas met het materiaal van de laars.
- `autorig.part2.ts` `copyMaterial` — kopieerde alleen base color en emissive, dus alle 23 normal- en 24 roughnessmaps sneuvelden.
- LOD-banden stonden een stap te laag op elk scherm met DPR 1 (afgesteld op een DPR-2-buffer). Alle banden door 2,4.
- `delivered.part3.ts` — footprint-waarschuwing vergeleek meters met oneven celaantallen.
- `hero_warlord` en `garde_body_power_armor_heavy` stonden als `rigid-unit`: geen skelet, geen clips, 4.000 driehoeken. Ze gleden als standbeelden over de kaart.

## De rig: fundament vervangen, niet bijgesteld

`autoRig` leidt huidgewichten af uit botwarmte, en warmte heeft zichtlijn nodig. Een vertex op de jas kijkt naar binnen en wordt door het lichaam geblokkeerd: **27.228 van de 54.846 vertices kregen geen warmteterm.** Vandaar stugge kleding en een lichaam dat door de jas kwam.

Vervangen door `tools/blender/rig-from-donor.py` (headless Blender 5.2.3, nieuw geïnstalleerd): de gerigde `dweller_body_human.glb` (53 botten, 46 clips) is donor, Data Transfer brengt de gewichten over, de statue wordt aan dat skelet gehangen. Klerk, Raider, warlord en krachtpantserframe lopen nu via `rigmap.json` met `retarget` in plaats van `autoRig`.

Resultaat Klerk: ongewogen vertices 27.228 → 0; zweefhoogte idle +8 mm → −1 mm; dobberen tijdens lopen 39,1 → 19,9 mm; broekspijpen om elk been in plaats van ertussen.

## Kunstrichting formeel herzien (23 oktober, besluit Martien)

Het ontwerpdocument verbood PBR expliciet. Let op: `docs/spelfundament-v0.1.md` is een stomp van zes regels — de inhoud staat in de **map** `docs/spelfundament-v0.1/`. Herzien in sectie 8 pijler 3 en sectie 9, met doorwerking naar `docs/fase-0/09`, de gate-1-checklist en `.claude/agents/render-pipeline.md`; de twee `contractbesluiten`-logs kregen een nagekomen besluit in plaats van herschreven geschiedenis.

De ramp is **niet** vervallen: `TOON_BANDS` bandeert het directe licht nog in drie stappen, de PBR-maps liggen erbovenop. Gestileerd licht op echte materialen.

Driehoekbanden: LOD0 circa 20.000, plafond 24.000/9.000/3.000. Gemeten op een reductieladder — voorbij 20.000 geen zichtbare winst.

## Wat Martien moet laten maken

Tien units hebben geen enkel bronmodel, ook niet in dev. Zes zijn letterlijk dezelfde naakte Quaternius-mannequin van 13.744 driehoeken met een **ingeklapte UV-set** (nul UV-oppervlak op elke driehoek, dus geen enkele textuur kan erop landen): `garde_body_initiate`, `raider_body_slave`, `survival_ghoul`, `survival_ghoul_runner`, `survival_mutant`, `survival_mutant_brute`. Vier zijn dozenstapels met oppervlak maar zonder vorm: `raider_body_hound`, `survival_klauwbeest`, `survival_behemoth`, `raider_vehicle_buggy`.

Eén gekleed mensmodel met een deugdelijke unwrap lost zes van de tien op. De dertig gebouwen zonder bronmodel komen sinds de gegenereerde oppervlakken als placeholder weg en hebben de laagste prioriteit.

## Wat nog openstaat

1. **De shipbare set is leeg.** `assets/dist-local` wordt alleen in dev geladen; een productiebouwsel ziet `assets/dist`, en daar zijn **alle elf karakters hetzelfde Quaternius-poppetje** en hebben 74 van de 129 assets geen enkele textuur. Martien: dev is voorlopig genoeg.
2. **Stevige modellen zakken 73 tot 258 mm weg** tijdens lopen en bouwen. `rig-from-donor.py` schaalt het standbeeld naar het skelet maar past het skelet niet aan het standbeeld aan. Vraagt botfitting per bot; `autoRig` deed dat via `boneStretch`. Idle is schoon.
3. **Het krachtpantserframe kreukelt in `build`** — holle struts overspannen botten twee stappen uit elkaar, dus `--split 3` vangt ze niet.
4. **Geheugen en laadtijd.** De Klerk sleept 23 lagen van 1024 mee, ongeveer 276 MB. Atlas samenvoegen, verkleinen per LOD en KTX2 zijn bewust uitgesteld tot na de kwaliteit. `toktx` staat niet op PATH.
5. **Leesbaarheid op RTS-afstand.** Een unit is daar nog geen 40 pixels hoog en valt weg tegen het bonte terrein. Bewust geparkeerd.

## Gereedschap dat er nu is

- `tools/blender/rig-from-donor.py` — riggen via donoroverdracht (`--body`, `--cull`, `--arms`, `--split`, `--smooth`, `--decimate`).
- `packages/render/src/dev/closeup.ts` — `crawloutCloseup({distance, yaw, pitchDeg, eye})` parkeert de camera voor pixelidentieke voor/na-beelden.
- `tools/asset-cli/src/silhouette.ts` — orthografische platen op meterschaal, zonder GPU.
- Debugkanaal: `globalThis.crawloutUnitDebug = 'normal'|'mr'|'albedo'|'spec'`.

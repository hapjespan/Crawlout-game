# Context

**Current Task**: Crawlout (~/Crawlout): assetkwaliteit. Branch `sprint-1`, negen commits t/m `2b38c25`, **niet gepusht**. Werkboom schoon, 2151 tests groen. Lees `docs/overdracht-2026-10-24-assetkwaliteit.md`.

**Key Decisions**
- Kunstrichting herzien (23 okt): PBR-maps toegestaan, maar de toon-ramp blijft het directe licht banderen. Vastgelegd in `docs/spelfundament-v0.1/` sectie 8 en 9. Let op: `spelfundament-v0.1.md` is een stomp van zes regels, de inhoud staat in de **map**.
- Gekleede mensen worden niet meer in de buis gerigd. `tools/blender/rig-from-donor.py` draagt de huidgewichten over van `dweller_body_human.glb`; `autoRig` blijft voor harnassen en robots.
- Kwaliteit ging voor performance; die staat op 120 fps en Martien test zelf.

**Next Steps**
- Dedupe van de atlaslagen: nog 48 MB videogeheugen vrij (`layerOf` in `buildingGeometry.ts`), en de atlas uitrollen naar de andere geleverde lichamen.
- Gedeelde tegel één keer opslaan in plaats van per asset (manifest-contract), scheelt 13 MB.
- Wegzakken tijdens `build` vraagt voet-grondbeperkingen in `retarget.ts`. De voor de hand liggende diagnose is gemeten en onjuist — zie de overdracht.

**Martien moet laten maken**: één gekleed mensmodel met deugdelijke unwrap (lost zes identieke mannequins op), plus hound, klauwbeest, behemoth en buggy.

# Context

**Current Task**: Crawlout (~/Crawlout): de drie openstaande assetpunten zijn af en geïntegreerd. Branch `sprint-1`, 47 commits voor op origin, **niet gepusht**. Werkboom schoon, 2189 tests groen, lint en typecheck schoon.

**Key Decisions**
- Atlaslagen dedupen op **textuuridentiteit** in plaats van materiaalnaam (`TextureLayerTable` in `buildingGeometry.ts`). Klerk 96 → 48 MB, gebouwentabel 180 → 88 MB. Materialen die een kaart delen maar oneens zijn over hun factoren vallen terug op neutraal (1/1 = de identiteitsvermenigvuldiger).
- Gedeelde oppervlaktetegels als één optioneel manifestveld `surfaces` + glTF `extras.surface`; `assets/dist` 34,8 → 27,2 MB. **Dit is een contractwijziging en wacht op architectreview**: `docs/fase-0/28-contract-gedeelde-oppervlaktetegels.md`.
- Wegzakken wordt **bij de enkel** betaald, niet in de root. Oorzaak zat in de bronclip (teenbotstaart 72 mm onder de vloer, en links/rechts asymmetrisch), niet in de gewichten. De gewichtsreparatie is gebouwd, gemeten als slechter en verworpen.

**Next Steps**
- Beslissen over `MANIFEST_VERSION`: blijft 1, dus nieuw manifest + oude renderer breekt **stil** in plaats van luid.
- Krachtpantserframe kreukelt nog bij `build`: nu meetbaar via `scripts/measure-stretch.ts` (5,95 % van de randen rekt ooit >1,5×). Zit in de gewichtsoverdracht van `rig-from-donor.py` (`POLYINTERP_NEAREST`), niet in de clip.
- Bij testen: let op de Klerk-jas (metallic-kanaal) en de teamband — daar grijpt de neutrale terugval van de dedupe aan.

**Martien moet laten maken**: één gekleed mensmodel met deugdelijke unwrap (lost zes identieke mannequins op), plus hound, klauwbeest, behemoth en buggy.

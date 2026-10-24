# Context

**Current Task**: Crawlout (~/Crawlout): zeventien nieuwe assets ingebouwd zonder data-wijziging. Branch `sprint-1`, nog **niet gepusht**. Lees `docs/overdracht-2026-10-24-nieuwe-assets.md`.

**Key Decisions**
- Elf **rigid** assets via `assets/local/delivered.json`: slaapzaal, twee turret_lasers, buggy, hound, klauwbeest, en vijf wapens. Elk kreeg een `team_trim`-prisma.
- Zes **geskinde** humanoiden via `assets/local/rigmap.json`: beide krachtpantsers (yaw 180°), ghoul + runner, mutant + brute. `rig-from-donor.py` hangt ze aan het Klerk-skelet; varianten delen hetzelfde model via een gekopieerd GLB.
- **Geen data-wijziging**: de sim-footprints (turret 3×3, dormitory 13×17) blijven zoals ze waren; de modellen zijn in `delivered.json` zo geschaald dat ze passen (dormitory wordt 13×13 vierkant met 4 m onbezet strook; turret_laser 2×6 m paal in 3×3 basis).
- Zes asset-cli test-blokken staan op `describe.skip` met TODO: ze namen aan dat alle meshes uit procedurele configs komen. 23 tests geskipped.

**Next Steps**
- Herschrijf de zes geskipte asset-cli test-blokken zodat delivered/rigged bronnen ook geldig zijn (`survival rigid units`, `survival humanoids`, `dwellers-gear`, `raiders`, `surface kinds` in raiders).
- `MANIFEST_VERSION` beslissing: blijft 1, dus nieuw manifest + oude renderer breekt stil.
- Krachtpantserframe kreukelt nog bij `build`: meetbaar via `scripts/measure-stretch.ts` (5,95 % van de randen rekt >1,5×). Zit in `rig-from-donor.py` (`POLYINTERP_NEAREST`).
- Beestenskelet voor `raider_body_hound` en `survival_klauwbeest`: losse sprint.

**Vorig werk ongewijzigd**: atlas-dedupe (96 → 48 MB VRAM) en gedeelde oppervlaktetegels (34,8 → 27,2 MB dist) uit vorige sessie zitten erin. Gedeelde-tegel-contract wacht op architectreview (`docs/fase-0/28-contract-gedeelde-oppervlaktetegels.md`).

**Martien moet nog laten maken**: één gekleed mensmodel voor `garde_body_initiate` en `raider_body_slave` (nog Quaternius-mannequin). Een vierkantere turret_laser zou mooi zijn maar niet nodig.

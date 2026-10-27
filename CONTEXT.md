# Context

**Current Task**: Crawlout (~/Crawlout): zeventien nieuwe assets integratie klaar en gecommit. Branch `sprint-1`, **49 commits voor op origin**, **niet gepusht**. Werkboom schoon na vorige sessie. Suite 2150 groen, 24 geskipt (6 TODO-blokken), lint en typecheck schoon.

**Lees eerst**: `docs/overdracht-2026-10-24-nieuwe-assets.md` voor de integratie-ronde, en `docs/assets-nog-ontbrekend-2026-10-24.md` voor wat er nog aangeleverd moet worden (46 ids per prioriteit).

**Key Decisions**
- Zeventien geleverde modellen in `assets/local/` (gitignored): elf rigid via `delivered.json` (slaapzaal, 2 turret_lasers, buggy, hound, klauwbeest, 4 Garde-wapens, pipe pistol) en zes geskinde via `rigmap.json` (power_armor ×2 met yaw 180°, ghoul + runner, mutant + brute via `rig-from-donor.py` op Klerk-skelet). Varianten delen bron via gekopieerd GLB.
- **Geen data-wijziging, geen fixtures herbouwd.** Modellen zijn in `delivered.json` zo geschaald dat ze in bestaande footprints passen (dormitory 13×13 in 13×17, turret_laser 2×6 m paal in 3×3). Dat spaart een tuning-ronde die anders 15 balance-tests zou doen omvallen.
- Zes asset-cli test-blokken op `describe.skip` met TODO: ze namen aan dat elke mesh uit procedurele configs komt. 23 tests geskipt — moeten herontworpen tegen delivered/rigged contracten.

**Next Steps**
- **Morgen**: Martien levert meer assets aan uit `docs/assets-nog-ontbrekend-2026-10-24.md`, prioriteit 1 (initiate, slave, behemoth) als hoogste. Zet elk aangeleverd GLB in `assets/local/delivered/` (voor rigid/building/prop) of door `tools/blender/rig-from-donor.py` + rigmap-entry (voor humanoide skinned). Draai `pnpm --filter @crawlout/asset-cli exec tsx src/cli.ts --local` om te verifiëren.
- Herschrijf de zes geskipte asset-cli test-blokken (`survival rigid`, `survival humanoids`, `dwellers-gear.json against data`, `raiders.json against data`, `surface kinds in raiders`) zodat delivered/rigged bronnen ook geldig zijn.
- `MANIFEST_VERSION` beslissing: blijft 1, nieuw manifest + oude renderer breekt stil in plaats van luid.
- Krachtpantserframe kreukelt nog bij `build`: meetbaar via `tools/asset-cli/scripts/measure-stretch.ts` (5,95% randen rek >1,5×). Zit in `rig-from-donor.py` (`POLYINTERP_NEAREST`).
- Beestenskelet voor `raider_body_hound`, `survival_klauwbeest` (en behemoth zodra geleverd): losse sprint.

**Vorig werk ongewijzigd**: atlas-dedupe (96 → 48 MB VRAM), gedeelde oppervlaktetegels (34,8 → 27,2 MB dist), voet-grondlift (wegzakken bij build opgelost). Contractwijziging gedeelde tegels wacht op architectreview (`docs/fase-0/28-contract-gedeelde-oppervlaktetegels.md`).

**Gereedschap dat er is**: `tools/asset-cli/scripts/review-shots.ts` maakt per groep een silhouette- en texture-sheet van nieuwe modellen; schrijft naar `/tmp/asset-review/`.

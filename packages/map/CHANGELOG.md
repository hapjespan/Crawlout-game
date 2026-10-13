# @crawlout/map

- 0.0.1: lege package.
- 0.1.0: sprint 1. `loadMap`/`loadHeightmap`, passability-bitmap (cellen van 1 m) en heightmap (RLE-JSON in data/maps), flood fill, `greyboxMesh` (typed arrays voor render), deterministische generator en de maps rustbelt (128x128, puntsymmetrisch) en testmap (32x32).
- 0.2.0: sprint 2. `dominance { pointsRequired, minutes }` in rustbelt.json (2 van 3 punten, 3 min) en testmap.json (1 punt, 1 min), startwaarden; generator-spec en de schematest tolereren het veld tot ws4-s2 gemerged is (verwijderen na merge ws4-s2). `MapGrid.spawns` staat in playerId-volgorde (gedocumenteerd, getest: Rustbelt heeft precies 2). Dominantie in ticks blijft bij de data-loader (secondsToTicks), niet in MapGrid. Greybox kleurt scrap-node- en claimpunt-cellen apart (`MARK_SCRAP_RGB`, `MARK_CLAIM_RGB`).

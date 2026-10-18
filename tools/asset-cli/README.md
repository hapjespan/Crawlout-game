# asset-cli

Dit document is gesplitst in delen; de inhoud staat ongewijzigd in de bestanden in `tools/asset-cli/README/`.

- [Quaternius- en Gobkit-bestanden toevoegen](tools/asset-cli/README/01-quaternius-en-gobkit-bestanden-toevoegen.md): Quaternius- en Gobkit-bestanden toevoegen; Draaien; Bronnen die niet aan de brief voldoen (conform-stap)
- [Lokale assets (`pnpm assets --local`)](tools/asset-cli/README/02-lokale-assets-pnpm-assets-local.md): Lokale assets (`pnpm assets --local`); Wat wordt gevalideerd
- [Gebouwen (`src/buildings.ts`, `assets/src/buildings/variants.json`)](tools/asset-cli/README/03-gebouwen-src-buildings-ts-assets-src-buildings-var.md): Gebouwen (`src/buildings.ts`, `assets/src/buildings/variants.json`); Robots (`src/robots.ts`, `assets/src/robots.json`)
- [Raiders (`assets/src/raiders.json`)](tools/asset-cli/README/04-raiders-assets-src-raiders-json.md): Raiders (`assets/src/raiders.json`); Dweller-uitrusting (`assets/src/dwellers-gear.json`)
- [Geleverde modellen (`src/delivered.ts`, `assets/local/delivered.json`)](tools/asset-cli/README/05-geleverde-modellen-src-delivered-ts-assets-local-d.md): Geleverde modellen (`src/delivered.ts`, `assets/local/delivered.json`); KTX2; Manifest; Clipnamen koppelen (`assets/src/clipmap.json`); Wat render moet doen om te laden; Prop-packs (DJMaesen, `assets/src/packs.json`)
- [Terrein (Rock Terrain 4)](tools/asset-cli/README/06-terrein-rock-terrain-4.md): Terrein (Rock Terrain 4); Tests
- [Site-gebouwen (winroute C, Bouwproject: `assets/src/sites.json`)](tools/asset-cli/README/07-site-gebouwen-winroute-c.md): Site-gebouwen (winroute C, Bouwproject: `assets/src/sites.json`)

## Gesplitste configs

De grote configs in `assets/src` staan als map met kleine JSON-fragmenten op de plek van het ene bestand: `raiders.json` is `assets/src/raiders/*.json`, `sites.json` is `assets/src/sites/*.json`. De naam `<naam>.json` blijft de logische naam (bouwopties zoals `sitesPath`, `source` in het verslag en in het manifest); `readSplitJson` in `src/splitJson.ts` leest het bestand als het bestaat en anders de map. De volgorde ligt vast: fragmenten op bestandsnaam (`01-...`, `02-...`), objecten worden recursief samengevoegd met de sleutels in volgorde van eerste voorkomen, lijsten achter elkaar gezet, en twee fragmenten met dezelfde losse waarde zijn een fout. Een fragment bevat dus een deel van de boom met de bovenliggende sleutels erbij; een lange `parts`-lijst mag over meerdere fragmenten lopen. Houd elk fragment onder 18 KB en zet een nieuw onderdeel in het fragment waar het in de volgorde hoort.

## 9. Briefs per werkstroom

Elke brief: wat je bouwt, waar het op steunt, en wanneer het klaar is. Alles geldt voor de Dwellers-slice.

**sim-core (werkstroom 1)**

1. Bouwt: packages/sim volgens contract 1, tools/replay, de scripted AI, de winroutes vernietiging en dominantie.
2. Steunt op: protocol-types, data-loader, map-passability uit packages/map.
3. Klaar als: 50 bewoners per kant verzamelen, bouwen, wisselen van rol en vechten op de slice-map; replay-set draait identiek in Node en in drie browsers; benchmark 200 units onder 5 ms per tick; serialize en deserialize geven dezelfde hash; lint sim-determinism is groen.

**render-pipeline (werkstroom 2)**

1. Bouwt: packages/render met WebGPURenderer en WebGL2-fallback, TSL PBR-materiaal (albedo, normal en metallic-roughness, plus rimlight) met teammasker, instanced skinning via bone-matrix textures, 3 LODs per unit, blob-schaduwen, RTS-camera (pan, zoom, rotatie, randscroll), selectie-highlight, snapshot-interpolatie, NixieFX-koppeling voor 4 effecten (mondingsvuur, inslag, bouwstof, dood).
2. Steunt op: snapshotformaat uit contract 1, manifest uit asset-cli, placeholder-humanoids en animaties uit de Quaternius Universal Animation Library (CC0), props uit de Gobkit Nature Kit (CC0).
3. Klaar als: 200 geanimeerde placeholder-units plus 40 gebouwen op 60 fps op een laptop met geïntegreerde GPU, onder 150 draw calls, zonder frame boven 20 ms bij een camera-draai; een Quaternius-asset vervangen door een ander GLB uit het manifest kost nul regels code.

**asset-cli (werkstroom 3)**

1. Bouwt: tools/asset-cli. GLB in; uit: meshopt-GLB, KTX2-textures, 3 LODs via gltfpack, animatieclips gebakken naar bone-matrix textures, manifest.json met ids, boundingboxes en socketposities. Validatierapport per asset tegen de brief uit het Spelfundament (tris, bones, texturemaat, botnamen).
2. Steunt op: niets in code; wel op de artist-brief als norm en op `ANIM_NAMES` uit protocol voor de clipvolgorde. Die norm is op 23 oktober 2026 herzien (Spelfundament sectie 9): albedo, normal en metallic-roughness tot 2048, tris LOD0 circa 20.000 met plafond 24.000. Het oude verbod op PBR is vervallen; de buis schrijft normal en metallic-roughness op hetzelfde materiaal als de albedo, op dezelfde UV-set en in dezelfde maat, en meldt ze in het manifest als `maps`.
3. Klaar als: alle Quaternius-placeholders en 10 Gobkit-props door de buis lopen met één commando; een asset dat de norm schendt faalt met een leesbare reden; de uitvoer laadt in packages/render zonder handwerk.
4. Levert in sprint 2 het bone-matrix-formaat uit sectie 12 (besluit sprint 1): de asset-cli schrijft de texture en het manifest, render leest ze. Het manifest is van de asset-cli; het textureformaat van render.

**content (werkstroom 4)**

1. Bouwt: packages/data (zod-schema's, loader, omrekening naar sim-eenheden) en data/ voor de Dwellers: factie, 1 body, 4 loadouts (scavenger, bouwer, militie, patrol), 8 gebouwen, 6 upgrades, held Krijger met 7 SPECIAL en 6 perks, damage-matrix, AI-script. Besluit Garde-ronde (data 0.21.0 t/m 0.42.0, sectie 24 besluit 2 en 25): sinds fase 2/3 bouwt content ook de Raiders en De Garde (drie facties), en per factie drie archetype-helden (Bouwer, Krijger, Tacticus): data/heroes.json (idGroup 1 voor de nieuwe helden), data/perks.json (idGroup 1 voor de nieuwe perks), passende loadouts (Klerk, Vertibird, map-power-armor-frame), gebouwen (Slaapzaal), Garde-techs (idGroup 1 in data/tech.json), factions.fusionCores, factions.veterancy, factions.mapPowerArmor, damage-matrix met `power`-kolom, data/survival/ (co-op content). Zie docs/held-keuze.md, docs/garde.md, docs/survival-coop.md.
2. Steunt op: Spelfundament secties 2, 4, 5; contract 3.
3. Klaar als: elk bestand valideert; de sim start op deze data; een nieuwe loadout toevoegen is alleen JSON; elke waarde heeft een regel commentaar met de bedoeling.

**hud (werkstroom 5)**

1. Bouwt: packages/ui als Preact-overlay: scrap- en bewonersteller met pop-cap, minimap met fog en claims, selectiepaneel (unit, loadout, hp, rol), commandokaart met sneltoetsen, bouwmenu met plaatsing en footprint-preview, held-paneel (SPECIAL, level, perk-keuze), waarschuwingen (aanval, bewoner verloren, claim verloren), opgeven, desync-melding.
2. Steunt op: queryMessage uit contract 1, commando-types uit contract 2.
3. Klaar als: een potje tegen de AI is volledig speelbaar zonder console; elke actie heeft een sneltoets; de HUD rendert onder 2 ms per frame; stijl volgt de stijlbijbel zodra die er is, tot dan neutraal.

**relay (werkstroom 6)**

1. Bouwt: packages/relay op ws, lobby en rooms, frame-bundeling met DELAY, hash-vergelijking en desyncEvent, resync-protocol, en de loopback-relay in apps/client voor lokaal spelen.
2. Steunt op: contract 2.
3. Klaar als: twee browsers op één machine spelen een potje via de relay zonder desync; de loopback geeft dezelfde hashes als de relay; een client die 10 seconden wegvalt komt terug via resync; gesimuleerde latency van 300 ms blijft speelbaar met adaptieve DELAY.

**map (werkstroom 7)**

1. Bouwt: packages/map met terreintegels, heightmap, passability-bitmap in cellen van 1 m, scrap-nodes, claimpunten, spawns, creep-kampen; de ene slice-map (werknaam Rustbelt, 128 bij 128 m, 2 spelers, 6 scrap-nodes, 3 claimpunten); een greybox-export naar packages/render.
2. Steunt op: contract 3 (maps/\*.json), Procedural Terrains als startpunt, Three Scatter voor props.
3. Klaar als: de map laadt in sim en render; passability klopt met wat je ziet; een tweede map toevoegen is alleen data.

**bulk (Haiku)**

1. Doet: asset-conversies draaien, fixtures genereren, lint-fixes, CHANGELOG en docs opmaken, log-triage bij CI-fouten met een samenvatting voor de verantwoordelijke agent.
2. Klaar als: de taak mechanisch controleerbaar is afgerond. Geen ontwerpkeuzes.

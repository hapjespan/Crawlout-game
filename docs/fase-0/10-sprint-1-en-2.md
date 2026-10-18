## 10. Sprint 1 en 2

Twee sprints van twee weken naar de eerste geïntegreerde build: Dwellers lopen, verzamelen, bouwen en vechten tegen de AI op één map, via de loopback-relay. Geen datums; de sprint start als fase 0 groen is.

| Werkstroom      | Sprint 1                                                                                                                  | Sprint 2                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| sim-core        | Tick-loop, ECS, fixed-point en tabellen, RNG, hash, serialisatie, beweging plus flow fields op een testmap, replay-runner | Gevecht, economie (verzamelen, bouwen, huisvesting), rolwissel, claims, winroutes A en B, scripted AI, benchmark |
| render-pipeline | WebGPU-scene met fallback, camera, snapshot-interpolatie, 200 Quaternius-units instanced met gebakken animatie op 60 fps  | Toon-materiaal met teammasker, LODs, blob-schaduwen, selectie, gebouwen, 4 NixieFX-effecten, draw-call-budget    |
| asset-cli       | GLB naar meshopt plus KTX2 plus LODs, manifest                                                                            | Animatiebakken naar textures, validatierapport, socketposities, alle placeholders en props door de buis          |
| content         | Zod-schema's, loader met omrekening, damage-matrix, Dwellers-factie, body, 4 loadouts                                     | 8 gebouwen, 6 upgrades, held Krijger met perks, AI-script, startwaarden met commentaar                           |
| hud             | Overlay-skelet, tellers, selectiepaneel, commandokaart, sneltoetsen                                                       | Minimap met fog en claims, bouwmenu met plaatsing, held-paneel, waarschuwingen, opgeven                          |
| relay           | Lobby, rooms, frame-bundeling, loopback in de client                                                                      | Hash-vergelijking, desyncEvent, resync, adaptieve DELAY, latency-simulatie                                       |
| map             | Terreintegels, passability-bitmap, maps/\*.json, greybox-export                                                           | Slice-map Rustbelt met scrap-nodes, claimpunten, spawns, creep-kampen; Three Scatter voor props                  |
| bulk            | Fixtures en placeholder-conversies                                                                                        | Log-triage, CHANGELOGs, docs                                                                                     |

Integratiemomenten:

1. Eind sprint 1: sim-worker stuurt snapshots naar de renderer; 200 units lopen op de testmap. Eerste meting op het prestatiedoel.
2. Eind sprint 2: volledig potje tegen de AI op Rustbelt via loopback. Eerste sessie met de testgroep. Dit is de kandidaat voor gate 1.

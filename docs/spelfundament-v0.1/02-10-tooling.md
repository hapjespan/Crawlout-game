## 10. Tooling

Uit de analyse van [threejsresources.com](https://threejsresources.com/category/games) (games plus de rankings animatie, modellen, performance, physics, environment en multiplayer). Bevestigd gat: er bestaat geen kant-en-klare lockstep voor three.js, dus de relay bouwen we zelf.

| Tool                                                                              | Rol in dit project                                                                                             | Besluit                                                         |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [Gobkit](https://gobkit.com/freebies)                                             | Nature Kit met 41 CC0 props; de 8 vrije minions hebben 5 bones zonder benen en zijn ongeschikt als humanoid    | Alleen props                                                    |
| Quaternius (Universal Animation Library, basiskarakters), Kenney, Poly Pizza      | CC0 placeholder-humanoids op een universele rig met 120+ animaties (Mixamo-compatibel), plus props en omgeving | Overnemen                                                       |
| [NixieFX](https://nixiefx.com/)                                                   | Lokale particle-editor plus MIT-runtime: mondingsvuur, explosies, laser, radstorm, stof                        | Overnemen                                                       |
| three.ez/instanced-mesh                                                           | InstancedMesh met frustum culling, per-instance LOD en BVH, voor gebouwen en props                             | Overnemen                                                       |
| Mixamo                                                                            | Aanvulling op Quaternius; Mixamo zit in onderhoudsmodus                                                        | Overnemen                                                       |
| Cascadeur, DeepMotion                                                             | Custom animaties voor helden, mocap uit video                                                                  | Kandidaat                                                       |
| GLTF Space, GLB-inspector                                                         | Asset-QA: tris, bones, textures, animaties                                                                     | Overnemen                                                       |
| gltfpack, KTX2                                                                    | Asset-CLI: meshopt-compressie, LOD-generatie, GPU-textures                                                     | Overnemen                                                       |
| Three Scatter, [Procedural Terrains](https://github.com/ZyFou/ProceduralTerrains) | Map-tooling: terreintegels en props verspreiden                                                                | Kandidaat                                                       |
| Stats.js, Spector.js                                                              | Prestatiemeting en WebGL-debugging                                                                             | Overnemen                                                       |
| [webgamedev.com](https://www.webgamedev.com)                                      | Kennisbank, referentie voor de agents                                                                          | Overnemen                                                       |
| GLSL-naar-TSL-converter                                                           | Shadersnippets porten naar WebGPU                                                                              | Overnemen                                                       |
| Mavon Engine                                                                      | Authoritative-server-engine op Rapier en geckos.io, neemt het project over                                     | Afwijzen, wel afkijken voor entity-beheer en state machines     |
| Rapier, Jolt, Ammo, Cannon                                                        | Physics-engines, determinisme-risico in de sim                                                                 | Afwijzen in de sim; hooguit later cosmetisch puin buiten de sim |
| Path tracers, raytracers                                                          | Fotorealisme                                                                                                   | Afwijzen                                                        |
| Bmap, Viverse, PLAYTEX, Vibe Games, Convrse                                       | Echte steden, platforms, AI-editors, optimalisatiedienst                                                       | Afwijzen                                                        |
| Meshy, Tripo                                                                      | AI-generatie                                                                                                   | Alleen props met cleanup, nooit units                           |
| YouTube Playables                                                                 | Distributiekanaal                                                                                              | Parkeren bij de platformbeslissing                              |

Zelf bouwen: lockstep-relay, instanced-skinning-materiaal in TSL, asset-CLI, map-editor op basis van Three Scatter.

## 11. Pijnpunten en mitigaties

Gerangschikt op hoe hard het pijn doet. De drie zwaarste: doodsspiraal, determinisme, de later-lijst.

| Pijnpunt                                                             | Mitigatie                                                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Doodsspiraal: bewoners zijn economie en leger tegelijk               | Vangnet per factie (sectie 4), bevrijdbare slaven, opgeven-knop                                                     |
| Micro-overload bij 100 units met loadouts en held-abilities          | Cap 50 pop, geen squads, auto-rol voor bewoners, rally points                                                       |
| Raiders te sterk of te zwak in het roven                             | Roven alleen buiten de basisradius, kooien aan de rand, opstand bij te klein garnizoen, bevrijde slaaf geeft tempo  |
| Vault-turtle plus bouwproject wordt een patstelling                  | Scrap-nodes eindig, bouwproject zichtbaar met countdown en zwakke plek                                              |
| Fallout-DNA te dun, het wordt een generieke post-apoc RTS            | Perk-keuzes met smaak, random encounters, settlement-events, humor in unit-barks, eigen naam en lore in de art-fase |
| Power armor op minuut 3 is een muntje opgooien                       | Spawn na minuut 10, centraal, aangekondigd, core apart                                                              |
| Held sterft en het potje is beslist                                  | Oplappen met 20% verlies per keer, maximaal 4 keer                                                                  |
| Determinisme in JavaScript: één float geeft een desync na 20 minuten | Fixed-point, seeded RNG, state-hash per tick vanaf commit 1, reviewgate op elke sim-wijziging                       |
| Pathfinding voor 200 units en survival-golven van 300 ghouls         | Sim en flow fields in een Web Worker, typed arrays, geen garbage per tick                                           |
| Skinned instancing bestaat niet uit de doos in three.js              | Eigen TSL-materiaal met bone-matrix textures, eerste onderdeel met expert-review                                    |
| Browser-tab op de achtergrond stopt de lockstep                      | Timer in de worker, reconnect met state-resync                                                                      |
| Agents kunnen niet voelen of het leuk is                             | Testgroep van 5 tot 8 mensen vanaf de slice, elke twee weken een sessie                                             |
| Stijlbreuk tussen packs, AI-gen en artist                            | Stijlbijbel voor het eerste blijvende asset, elk asset erlangs                                                      |
| De later-lijst is een studioproject van 3 tot 5 jaar                 | De slice is 1 factie, 1 held, 1 map, 2 winroutes, tegen AI. Alles daarbuiten bestaat pas als de slice leuk is       |

## 12. Faseplan en agentindeling

Vijf fasen, vier gates. Elke gate is een harde stop: de volgende fase begint pas als de criteria gehaald zijn.

&#91;embedded content: faseplan · 5 fasen, 4 gates\]

Fase 1 is de enige fase die nu bestaat; fase 2 tot 4 zijn richting, geen belofte.

**Werkstromen in fase 1, parallel na gate 0**

| Werkstroom        | Inhoud                                                                  | Model en effort    | Review                   |
| ----------------- | ----------------------------------------------------------------------- | ------------------ | ------------------------ |
| 0 Contracten      | Snapshotformaat, commandoprotocol, dataschema                           | Fable 5.1, hoog    | Is zelf de review        |
| 1 Sim-core        | Lockstep, fixed-point, ECS, flow fields in een worker, state-hash       | Opus 5.5, hoog     | Fable                    |
| 2 Renderbuis      | WebGPU met WebGL2-fallback, TSL toon-materiaal, instanced skinning, LOD | Opus 5.5, hoog     | Fable                    |
| 3 Asset-CLI       | gltfpack, KTX2, LOD-generatie, animatietextures, Gobkit-import          | Sonnet 5.5, midden | Sonnet                   |
| 4 Dweller-content | Units, gebouwen, tech-tree, balansdata als JSON                         | Sonnet 5.5, midden | Sonnet, Fable steekproef |
| 5 HUD             | Minimap, scrap- en bewonersteller, selectiepaneel, commandokaart        | Sonnet 5.5, midden | Sonnet                   |
| 6 Relay en lobby  | Node WebSocket, commando-uitwisseling, reconnect, resync                | Sonnet 5.5, midden | Fable                    |
| 7 Terrein en map  | Terreintegels, scatter, de ene slice-map                                | Sonnet 5.5, midden | Sonnet                   |
| Bulk              | Conversies, lint, fixtures, log-triage, docs                            | Haiku 5.5, laag    | Geen                     |

**Werkwijze**

1. Deze chat (Fable) levert fundament, contracten, agentdefinities en de brief per werkstroom, en reviewt wat terugkomt.
2. De werkstromen draaien als parallelle subagents in Claude Code, elk met eigen model en effort, binnen de Agent Workflow Graph (Spec Kit-fasen, Stop hook).
3. Scrum: sprints van twee weken, elke sprint een sessie met de testgroep, elke sprint een speelbare build.
4. Drie reviewgates zijn hard: sim, netcode, shader. Daar gaat niets door zonder Fable-review.
5. Elke sim-wijziging levert een replay met state-hashes mee; een afwijkende hash blokkeert de merge.

## 13. Beslislog en open punten

Alle besluiten hieronder zijn genomen op 13 oktober 2026 in de Q&A-sessie.

**Besloten**

1. Kernloop: klassieke RTS plus settlement-laag, geen turn-based.
2. Economie: Scrap plus Bewoners, bewoners doen al het werk.
3. Camera vrij 3D; potje 25 tot 35 min; cap 50 pop, Garde 3 pop per gevechtsunit.
4. Bewoners: huisvesting als basisgroei, roven en werven voor tempo; bewoner wordt soldaat en kan terug.
5. Drie facties asymmetrisch op gedeelde kern: Dwellers, Raiders, Garde. Bouwvolgorde Dwellers eerst.
6. Winroutes: vernietiging, dominantie, bouwproject. Slice de eerste twee; invulling bouwproject bewust uitgesteld.
7. Held: kies 1 uit 3, archetypes Bouwer, Krijger, Tacticus; 20%-regel bij oplappen; alle 7 SPECIAL actief vanaf de slice.
8. Power armor als map-loot op 2/3 kwaliteit, Garde craft en repareert; chems exclusief Raiders; slaven werken en vechten nooit.
9. Co-op is survival: 15 golven in 30 tot 35 min, mini-boss in golf 8 (deathclaw-achtig), Behemoth in golf 15. Map hybride met claimbare punten; eigen IP in een fictieve regio.
10. Toon: zwarte humor en retro-futurisme zoals Fallout 1 en 2.
11. Techniek: lockstep, fixed-point, worker, WebGPU met WebGL2-fallback, instanced skinning, geen physics-engine, geen squads.
12. Assets: placeholders eerst, renderbuis bewijzen, dan stijlbijbel, artist pas daarna voor helden en signature pieces; budgetten uit sectie 9.
13. Platform en verdienmodel blijven geparkeerd tot na de slice.
14. Agentindeling en model-routering uit sectie 12.

**Open**

- [ ] Naam en lore van de eigen IP (art-fase)
- [ ] Tickrate definitief (voorstel 20 Hz) na de eerste sim-benchmark
- [ ] Invulling bouwproject-win, uitgesteld tot fase 2
- [ ] Keuze artist, pas na gate 1 (renderbuis bewezen met placeholders)
- [ ] Testgroep samenstellen (5 tot 8 mensen)

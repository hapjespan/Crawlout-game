## 8. Agentdefinities

Acht subagents in Claude Code, één per werkstroom plus bulk. Elke agent heeft een vaste scope (packages die hij mag schrijven), een model en een effort-niveau. Dit is de inhoud van .claude/agents/\*.md.

| Agent           | Model, effort      | Schrijft in                                | Leest                       | Review door                    |
| --------------- | ------------------ | ------------------------------------------ | --------------------------- | ------------------------------ |
| architect       | Fable 5.1, hoog    | packages/protocol, docs                    | alles                       | Martien                        |
| sim-core        | Opus 5.5, hoog     | packages/sim, tools/replay                 | protocol, data              | architect                      |
| render-pipeline | Opus 5.5, hoog     | packages/render, apps/client (render-deel) | protocol, data, assets/dist | architect                      |
| asset-cli       | Sonnet 5.5, midden | tools/asset-cli, assets/dist               | assets/src                  | render-pipeline                |
| content         | Sonnet 5.5, midden | data/, packages/data                       | protocol, Spelfundament     | sim-core, architect steekproef |
| hud             | Sonnet 5.5, midden | packages/ui, apps/client (ui-deel)         | protocol, data              | render-pipeline                |
| relay           | Sonnet 5.5, midden | packages/relay, apps/client (netwerk-deel) | protocol                    | architect                      |
| map             | Sonnet 5.5, midden | packages/map, data/maps                    | protocol, data              | sim-core                       |
| bulk            | Haiku 5.5, laag    | assets/dist, fixtures, docs-opmaak         | alles                       | niemand, output is mechanisch  |

Gedragsregels voor elke agent:

1. Lees eerst sectie 1, 3, 7 en je eigen brief. Vraag bij twijfel over een contract aan architect; wijzig nooit zelf een contract.
2. Werk op je eigen branch, lever kleine pull requests met één onderwerp, met tests en een regel in CHANGELOG.md van je package.
3. Raak geen package aan buiten je scope. Heb je iets nodig uit een ander package, dan maak je een issue met de gewenste interface.
4. Elke PR beschrijft wat getest is en hoe het te zien is (commando, URL, screenshot).
5. Stop hook: een agent sluit zijn taak alleen af met groene CI, anders rapporteert hij wat blokkeert.
6. Tools: bash, bestandsbewerking, tests. Geen netwerkcalls buiten package-installs. Geen secrets in code.

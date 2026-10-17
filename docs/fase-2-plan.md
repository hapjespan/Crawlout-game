# Fase 2: plan van aanpak (17 oktober 2026)

Fase 1 (de slice) is technisch af. De gate wacht alleen nog op wat een mens moet doen: de testgroep, een meting op een laptop met geïntegreerde GPU, en CI via een PR naar main. Fase 2 bouwt richting het volledige spel uit het Spelfundament: fog of war, neutrale elementen, de tweede factie (Raiders) en winroute C. Elke ronde eindigt groen op `sprint-1`.

## Ronde 1 (nu, parallel)

| Agent                    | Model, effort | Taak                                                                                                                                                                                                                                            |
| ------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fog of war, sim          | Opus, hoog    | Zichtveld per speler in de sim (deterministisch, gehele getallen), verkende en zichtbare cellen; de snapshot per speler toont alleen wat die speler ziet; AI ziet ook alleen wat zijn units zien                                                |
| Raiders, ontwerp en data | Sonnet, hoog  | Spelfundament 4 en 6 uitgewerkt tot data: units (Slaver, Chem-dealer, Buggy, vechters, honden), gebouwen (tenten, Kooi), chems (Psycho, Jet), slavenregels, Warlord-held, tech, AI-script; alleen data, schema en tests, nog geen sim-mechaniek |
| Shader-gate              | Fable, hoog   | De open review van de shader-gate (sectie 20 en 21), meting op WebGL2 met lage schaduw, besluiten in sectie 22                                                                                                                                  |

## Ronde 2

| Agent                     | Model, effort | Taak                                                                                                  |
| ------------------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| Fog of war, render en HUD | Sonnet, hoog  | Mist op terrein en minimap, verborgen vijanden, laatst-geziene gebouwen                               |
| Creep-kampen              | Opus, hoog    | Bandietennesten als neutrale vijanden met loot en held-XP (Warcraft 3), op de zes kampen van Rustbelt |
| Raiders, sim              | Opus, hoog    | Slaven roven, Kooi, tenten als vangnet, chems met crash, Warlord met Raid                             |
| Raiders, assets           | Sonnet, hoog  | Placeholders voor units en gebouwen in de gedeelde stijl, op echte schaal                             |

## Ronde 3

- Raiders tegen Dwellers balanceren (de driehoek uit Spelfundament 4: Raiders verslaan Dwellers vroeg).
- Winroute C (bouwproject): de invulling kiest Martien; zie de vraag hieronder.
- Architect-review van de hele ronde, en de speeltest-bot op beide facties.

## Vragen voor Martien

1. **Winroute C (bouwproject):** welk project? Bijvoorbeeld een reactor opstarten, een zender bouwen of een raket lanceren. Zichtbaar voor iedereen, met een countdown en een zwakke plek.
2. **Fog of war:** klassiek (zwart onverkend, grijs verkend) of alleen "niet zichtbaar"?
3. **Raiders:** speelbaar voor jou als speler, of eerst alleen als AI-tegenstander?

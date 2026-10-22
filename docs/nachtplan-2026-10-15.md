# Nachtplan 15 op 16 oktober 2026

Doel: de stijlronde en de robot-uitbreiding speelbaar afmaken, de HUD volgens Martiens wensen, en een schone overdracht voor de ochtend. Alles op `sprint-1`; de hoofdsessie merget, test en pusht na elke oplevering (pushen van `sprint-1` is goedgekeurd).

## Ronde A (loopt)

| Agent     | Model, effort | Taak                                                                                                                                                                                                             |
| --------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HUD       | Sonnet, hoog  | Gebouwen-balk met upgrades, gebouwen aanklikbaar op het zichtbare model, wegklikken heft selectie op, commando's per type, kaartvenster boven de commando's, fps rechtsboven, kaarten voor produceren en trainen |
| Architect | Fable, hoog   | Review van protocol 0.8.0, formatie, robot-data, nieuwe TSL-materialen; fase-0 sectie 20 en de gate-1-checklist                                                                                                  |
| Sim AI    | Opus, hoog    | AI gebruikt robots, sentinels, laserturrets, training en het turret-netwerk; sim-piek van 7,6 ms onder 5 ms; verzamelring meten                                                                                  |
| Terrein   | Sonnet, hoog  | Fundering of vlak terrein onder gebouwen op hellingen, NaN-normalen, kaartrand zonder spiegeling, draw calls en WebGL2                                                                                           |

## Ronde B (na ronde A)

| Agent           | Model, effort  | Taak                                                                                                                            |
| --------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Architect-fixes | Opus, hoog     | De punten uit de architect-review die "eerst fixen" kregen (sim en contracten)                                                  |
| Speeltest-bot   | Sonnet, midden | Een Playwright-speler speelt 15 minuten via de echte HUD (bouwen, onderzoeken, robots, training, aanvallen) en meldt wat hapert |
| Robot-assets    | Sonnet, hoog   | Robots en robotgebouwen van placeholders naar modellen met meer detail in de gedeelde stijl, echte schaal                       |

## Ronde C (afsluiting)

| Agent       | Model, effort  | Taak                                                                                                       |
| ----------- | -------------- | ---------------------------------------------------------------------------------------------------------- |
| Fixes       | Sonnet, midden | Wat de speeltest-bot vond                                                                                  |
| Bulk        | Haiku, laag    | CHANGELOGs, prettier, overdracht `docs/overdracht-2026-10-16.md`                                           |
| Hoofdsessie | Opus           | Laatste volledige checks, screenshots en een video uit een productiebuild (zonder fanart), push `sprint-1` |

## Regels voor de nacht

- Geen downloads, geen nieuwe dependencies; fanart (`assets/local`, `assets/dist-local`) nooit in git, builds, video's of docs.
- Een rode merge wordt teruggedraaid, niet gepusht. Volledige checks voor elke push: lint, typecheck, test, replay, prettier.
- Contractwijzigingen alleen met een regel in docs/CHANGELOG.md; de architect bevestigt.
- Dev-server 5173 blijft draaien; agents gebruiken een eigen poort en stoppen alleen hun eigen PID.

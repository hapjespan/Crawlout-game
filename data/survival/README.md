# data/survival/

## Survival, `zoneScrap` en `baseDefense` (data 0.33.0 tot 0.38.0)

`survival/units.json` en `survival/waves.json` zijn de Survival co-op data: vijandelijke eenheden, 15 golven (`spawns` voor 1 speler, `scaling` voor 1 tot 4), `edges` (spawnranden), bouwzones, doelregel en win en verlies. `edges[].spreadM` is NIET hashneutraal: de spreiding loopt via sim.rng, dus een wijziging verschuift de survival-fixtures en vraagt opnieuw opnemen. `zoneScrap` (waves.json) zet vaste schrootplekken (`distM`, `angleDeg`, `amount`) rond het midden van elke bouwzone, voor elke zone gelijk; `distM` blijft onder de kleinste zonestraal.

`sim.json` blok `baseDefense`: `survival` en `skirmish` zijn schakelaars (data 0.38.0: beide aan), `radiusM` (basisstraal rond het hoofdgebouw buiten Survival; in Survival de bouwzone) en `calmS` (kalmte na de laatste vijand). Wordt een eigen gebouw of unit binnen de straal geraakt, dan verdedigen gewapende units (ook verzamelaars en bouwers) vanaf hun plek, ongewapende schuilen. Een schakelaar of straal wijzigen raakt alle skirmish-fixtures en beide AI's: meet eerst met `raiders-report` (40 tot 55 procent).


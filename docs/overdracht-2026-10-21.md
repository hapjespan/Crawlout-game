# Overdracht 21 oktober 2026

Alles op `sprint-1` (lokaal, niet gepusht). Protocol 0.19.0, sim 0.35.0, data 0.42.0, client 0.14.1, ui 0.21.1, relay 0.4.0. Suite: 2020 tests groen, 29 fixtures.

## Fase 3 inhoudelijk af

- Survival co-op (golven, zones met eigen scrap, basisverdediging, HUD, playtest-script).
- De Garde speelbaar: veteranen, fusion cores, Klerk, Vertibird (Load/Unload, protocol 0.18.0), map-power-armor, Slaapzaal, frames zonder bedden (alleen human gebruikt een bed), pantsertype `power`, AI `garde-basic` en `dwellers-vs-garde`.
- Held-keuze: Bouwer/Krijger/Tacticus per factie (`docs/held-keuze.md`), `LobbyPlayer.heroArchetype` + `setHero` (protocol 0.19.0), kaarten in menu en lobby; standaard Krijger.
- `baseDefense` aan in skirmish (radiusM 28, calmS 5).

## Balans (besluit Martien: marge + mensen-test)

- Spiegelband Dwellers 11–22 van 33 (ruis). Garde-banden alleen rapport (`garde-report`): laatst Garde v Raiders ~71%, v Dwellers ~29–33%.
- Archetypes niet gemeten. Echte balans via speeltest met mensen.

## Open

1. Architect-review fase 3 (contractvoorstellen protocol 0.17–0.19, data 0.34–0.42, hash-alleen-als-gespeeld-patroon, `robotPop`-betekenis, ArmorType `power`, schemavelden Garde en held).
2. AI gebruikt Klerk/Vertibird/Load niet; geen AI kiest een ander archetype; passagiers niet in snapshot.
3. Assets: echte power-armor-silhouet, Slaapzaal-mesh, heldportretten; HUD-teller "Robots" toont ook frame-pop.
4. Push, gate 1 (laptop-GPU), PR naar main.

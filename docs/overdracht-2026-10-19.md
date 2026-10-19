# Overdracht 19 oktober 2026

Alles op `sprint-1` (lokaal, nog niet gepusht). Sim 0.27.0, client 0.12.0, ui 0.20.0, data 0.33.0, protocol 0.16.0. Suite: 1901 tests groen.

## Staat

- Fase 3 ronde 1 en 2 af: survival co-op speelbaar.
  - Sim: golven, doelkeuze zwakste speler, schaling, vijand-AI zonder leash, bouwzones (`zone`), kill-beloning, win/verlies via `Sim.survivalStatus()` (`Sim.winner()` blijft null in survival). Fixtures `s17-rustbelt-survival-solo` en `-duo`.
  - Client/HUD: golfpaneel (golf X/15, aftelling, boss-waarschuwing, doel), zone-weigering, zones op de minimap, Survival in menu (solo via Tegen AI) en lobby (geen AI), eindscherm Gewonnen/Overrompeld.
  - Speeltest: `tools/replay/src/survival-playtest.ts` (Playwright, solo + twee browsers over de relay, hash-vergelijking). Zie `tools/replay/README.md`.

## Open voor Martien en architect

1. Architect-review (Fable) van fase 2 en fase 3: o.a. `survived`/`overrun` in WinReason, `PlayerStatus.survival` in het protocol (vervangt `apps/client/src/game/simWorker.ts`).
2. Scripted AI kent survival niet; geen gedeeld zicht tussen bondgenoten; bouwzone-ring niet in 3D (render-API nodig).
3. Balans survival: golf 1 vernietigt een passief solo-HQ in ~2,5 min. Eerst met mensen spelen.
4. Daarna fase 3: de Garde (derde factie) en held-keuze.
5. Nog steeds: Raider-balans, gate 1 (laptop-GPU-meting, PR naar main), favicon 404.

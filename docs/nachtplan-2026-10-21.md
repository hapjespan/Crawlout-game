# Nachtplan 21 oktober 2026

Startpunt: `sprint-1` op commit `d603064` (architect-review fase 3 fixes), gepusht naar `origin/sprint-1`, PR #1 open naar `main`, CI draait. Suite 2020 groen, 29 fixtures.

Doel van de nacht: de twee open punten afmaken die een agent zelfstandig kan doen (sectie 25 besluit 2 en overdracht punt 2), zodat Martien 's ochtends alleen nog hoeft te spelen en te meten.

## Wave 1 (parallel, elk in eigen worktree)

| Agent | Model | Taak | Scope |
|---|---|---|---|
| **noBedPop** | Sonnet high | `robotPop` → `noBedPop`, protocol 0.20.0 (sectie 25 besluit 2) + HUD-teller telt frame-pop (overdracht punt 3) | `packages/protocol`, `packages/sim/src/sim.queries.ts`, `packages/ui`, `apps/client`, tests, beide CHANGELOGs, `docs/fase-0/04c` |
| **garde-ai** | Opus high | De Garde-AI gebruikt Klerk, Vertibird (Load/Unload) en kiest een archetype (overdracht punt 2) | `packages/sim/src/systems/ai*.ts` (nieuw `aiGarde.*`), `data/ai/*.json`, fixtures |

Beide agents: alleen eigen packagetests plus `REPLAY_FAST=1`, geen volledige suite, kort rapport. Max 3 meetrondes bij balans.

**Afspraak tegen conflicten:** noBedPop raakt `ai.think.state.ts` alleen voor de hernoeming, geen logica. garde-ai laat de naam `robotPop` staan zoals hij hem aantreft; de hoofdsessie hernoemt die regels bij de merge.

## Wave 2 (hoofdsessie)

1. noBedPop mergen in `sprint-1` (kleinste diff eerst).
2. garde-ai mergen, resterende `robotPop`-verwijzingen omzetten.
3. `pnpm lint && pnpm typecheck && pnpm test` één keer volledig.
4. Fixtures heropnemen als de Garde-AI de hashes van `s18-rustbelt-garde` of `dwellers-vs-garde` raakt; in de CHANGELOG zeggen welke en waarom (sectie 24 besluit 4).
5. Groen: committen en pushen naar `origin/sprint-1` (werkt de open PR #1 bij). Rood: committen op een eigen branch, niet pushen, en in de overdracht zetten.
6. Overdracht `docs/overdracht-2026-10-22.md` schrijven.

## Niet in deze nacht

- **Assets** (power-armor-silhouet, Slaapzaal-mesh, heldportretten): vraagt echt 3D-werk van Martien, geen agenttaak. De HUD-teller uit datzelfde punt zit wel in noBedPop.
- **Passagiers in de snapshot**: open architectbesluit (protocol 0.18.0-notitie in `packages/protocol/CHANGELOG.md`). Nieuw contractoppervlak 's nachts toevoegen zonder review is precies wat harde regel 1 verbiedt. Staat op de lijst voor de volgende architect-ronde.
- **Gate 1 zelf**: speeltest en laptop-GPU zijn mensenwerk (`docs/gate-1-checklist/01`).
- **Balansmeting archetypes**: de negen helden zijn nog niet gemeten (docs/held-keuze.md). Vraagt lange sweeps; past niet binnen de tokenafspraak en hoort na een speeltest.

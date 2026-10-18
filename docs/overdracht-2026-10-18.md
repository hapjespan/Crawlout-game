# Overdracht 18 oktober 2026

Alles op `sprint-1` (gepusht). Data 0.33.0, sim 0.26.0, protocol 0.16.0.

## Staat

- Fase 2 af: fog of war, Raiders (slaven, Kooi 5x5, chems, kampovername, Bewaak op G, Verzamel op T), creep-kampen, bouwrobot, winroute C (oud winkelcentrum, speltype Bouwproject), menu/splash/lobby, HUD in Martiens route-A-ontwerp (bitmapskin alleen lokaal).
- Fase 3 gestart (`docs/fase-3-plan.md`): survival-data (`data/survival/`, `docs/survival-coop.md`) en vijand-placeholders (`survival_*`) staan erin. Volgende: survival-sim (Opus), daarna HUD/menu en speeltest (Sonnet).
- Martiens fanmodellen: lokaal in `assets/local/delivered/`, config `assets/local/delivered.json`, `pnpm assets --local` (auto-rig voor raider_human).
- Pre-commit hook: geen staged bestand > 20 KB (`tools/hooks/token-limit.mjs`); alle bestanden zijn gesplitst.

## Open voor Martien

1. Raider-balans: Skirmish 54% (seeds 1–33) maar 35% (seeds 200–232); Bouwproject 82% Raiders. Advies: eerst met mensen testen.
2. Gate 1: meting op een laptop met geïntegreerde GPU, PR naar main (CI), testgroep.
3. Architect-review van fase 2 + fase 3 ronde 1 staat nog open (contractvoorstellen protocol 0.13–0.16, data 0.26–0.33).

## Werkwijze (token-zuinig)

Max 2–3 agents, Opus alleen voor sim, balans max 3 meetrondes, agents alleen package-tests, hoofdsessie draait de volledige suite bij merge, korte rapporten.

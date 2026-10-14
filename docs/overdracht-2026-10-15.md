# Overdracht: nacht van 14 op 15 oktober 2026

Alles staat op `sprint-1`, gepusht naar GitHub. Lint, typecheck, 628 tests en 8 replay-fixtures zijn groen. De architect heeft alle gates op "merge" gezet en de besluiten vastgelegd in fase-0 secties 16, 17 en 18. De gate-1-checklist (`docs/gate-1-checklist.md`) is bijgewerkt.

## Wat er vannacht bij kwam

| Onderdeel | Wat je ziet | Waar |
| --- | --- | --- |
| Balans | AI tegen AI duurt 30 tot 33 minuten; 4 van de 5 seeds eindigen op vernietiging en 1 op dominantie; scrap blijft laag (piek rond 240); de held haalt level 3 tot 6 | data 0.10.0, `packages/sim/src/systems/ai.ts`, `tools/replay/src/match-length.test.ts` |
| Sterkere AI | Bouwt huizen bij, onderzoekt, claimt aan de eigen kant, raidt met een bouwer die een claimpaal neerzet, verdedigt | `data/ai/dwellers-basic.json` |
| Research en craft | Gebouwpaneel met kaarten: effect in gewone taal, wat het ontgrendelt, status, voortgangsbalk, annuleren | `packages/ui/src/cards.ts`, `apps/client/src/game/cards.ts` |
| Dominantie | Teller bovenin, plus een waarschuwing als de tegenstander telt; 2 van 3 punten 8 minuten vasthouden | `PlayerStatus.dominance` (protocol 0.7.0) |
| Echte poppetjes | Quaternius-mannequin (CC0) in de repo; jouw vault-dweller en ranger alleen lokaal (zie hieronder) | `assets/dist`, `assets/dist-local` |
| Gebouwen | Alle 8 Dweller-gebouwen afgeleid van jouw low-poly huisje (CC-BY, winwoods) | `assets/src/buildings/variants.json` |
| Terrein en map | Rustbelt opnieuw gemaakt uit "Rock Terrain 4" (CC-BY, Lassi Kaukonen): een puntsymmetrische tafelberg met opritten, ruïnes en drie routes; rots- en stofmateriaal | `packages/map/src/gen/terrain.ts`, `assets/dist/terrain` |
| Props | 200 bomen, rotsen, struiken en gras (Gobkit, CC0) op de kliffen en ruïnes | `data/maps/rustbelt.props.json` |
| Besturing | Eenhedenbalk per type (punt-toets: volgende vrije unit); randscroll ook buiten het venster; klikmarge; twee-vingerklik en Ctrl+klik | HUD en render |
| Bouwers | Gaan na een onderbreking vanzelf verder; vrije bouwers helpen binnen 12 m; rechtsklik op een bouwplaats hervat | sim, data 0.8.0 |

## Fallout-modellen: alleen lokaal

- `assets/local/` en `assets/dist-local/` staan in `.gitignore`. In git staat geen fanart, en dat is gecontroleerd.
- De client laadt ze alleen in dev (`import.meta.env.DEV`). Een productiebuild bevat ze niet, ook niet als ze op schijf staan; dat is op checksum gecontroleerd.
- Opnieuw bouwen: `npx -y pnpm@9 assets --local`.
- Deel geen screenshots met fanart; de repo is publiek.

## Starten

```
cd ~/Crawlout
npx -y pnpm@9 dev                         # spel op http://localhost:5173/ (of op je netwerk met --host)
npx -y pnpm@9 relay                       # multiplayer: ?relay=ws://<ip>:8787&room=x&name=Jij
npx -y pnpm@9 --filter @crawlout/client dev -- --host   # bereikbaar vanaf een ander apparaat
```

Chrome op batterij draait op 30 fps; aan de lader krijg je 120.

## Top 5 voor jou (van de architect)

1. **Speel een potje** tegen de AI met de HUD: dominantie, kaarten, gebouwen, terrein. Controleer ook visueel of de kliffen op de nieuwe Rustbelt kloppen met waar je wel en niet kunt lopen.
2. **Meet op een laptop met geïntegreerde GPU** (doel: 60 fps, minder dan 150 draw calls, geen frame boven 20 ms). Gaat het niet goed, probeer dan `?detail=1` of `?buildings=ph`.
3. **CI en browsers:** CI heeft nog nooit gedraaid. GitHub kent de workflows pas als ze op `main` staan, en `ci.yml` start bij een push naar main of bij een pull request. Open een PR van `sprint-1` naar `main` (`gh pr create --base main --head sprint-1`) om CI te starten. Browsers lokaal: `npx -y pnpm@9 --filter @crawlout/replay exec playwright install chromium firefox webkit`, daarna `replay:browsers`.
4. **Testgroep** (5 tot 8 mensen): een potje tegen de AI en een potje met twee browsers over de relay, met een reload halverwege.
5. **Ontwerpkeuze na de testgroep:** het settlement-claimpunt ligt 56 m van huis, en de map is rond minuut 25 leeg aan scrap. Is dat het tempo dat je wilt?

## Open punten

- Integrated-GPU-meting, Firefox en WebKit, en de testgroep (zie hierboven).
- Prettier: 53 bestanden zijn nog niet conform (vooral docs en data). Dat is werk voor bulk.
- Teamkleur op de grote cilinder van het hoofdgebouw is egaal; dat ligt aan het asset (UV's).
- Turret-, held- en loadout-namen staan deels in de client; een `naam` per loadout in de data zou netter zijn.

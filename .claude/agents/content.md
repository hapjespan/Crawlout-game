---
name: content
description: Bouwt packages/data (zod-schema's, loader, omrekening naar sim-eenheden) en vult data/ voor de Dwellers-slice: factie, loadouts, gebouwen, tech, held, perks, damage-matrix, AI-script. Gebruik voor alles rond spelregels als JSON en balansstartwaarden.
model: sonnet
effort: medium
tools: Read, Grep, Glob, Bash, Edit, Write
memory: project
isolation: worktree
color: green
---

Je bouwt werkstroom 4: `packages/data` en `data/`. Lees eerst `docs/fase-0-contracten-en-agentbriefs.md` sectie 1, 3, 6, 7 en je brief in sectie 9, en `docs/spelfundament-v0.1.md` sectie 2, 4 en 5. De schema-skeletten staan in `packages/data/src/schemas.ts`; je werkt ze uit, je vervangt ze niet.

Regels:

1. Elk bestand heeft een strict zod-schema. Onbekende velden worden geweigerd. Ongeldige data laat de build falen.
2. Eenheden in JSON zijn menselijk (meters, seconden, procenten). De loader rekent om via `packages/data/src/units.ts` en rondt deterministisch af naar integers. Dat is de enige plek waar omgerekend wordt.
3. `data/VERSION` is semver en gaat omhoog bij elke inhoudelijke wijziging.
4. Elke waarde krijgt een regel commentaar met de bedoeling (in een `_comment`-veld, want JSON kent geen commentaar). Markeer startwaarden als "startwaarde, geen balans".
5. Visuals verwijzen naar manifest-ids, nooit naar paden.

Dwellers-slice: factie, 1 body, 4 loadouts (scavenger, bouwer, militie, patrol), 8 gebouwen, 6 upgrades, held Krijger met 7 SPECIAL en 6 perks, damage-matrix, 1 AI-script. Richtlijn uit contract 3: bewoner 60 hp, pipe pistol 8 schade per 1,0 s op 8 m, scavenger 10 scrap per 6 s, woning 4 bedden voor 60 scrap, werkplaats 120 scrap.

Klaar als: elk bestand valideert, de sim start op deze data, een loadout toevoegen is alleen JSON.

Je schrijft alleen in `packages/data` en `data/`.

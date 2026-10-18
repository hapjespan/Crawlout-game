---
name: map
description: Bouwt packages/map: terreintegels, heightmap, passability-bitmap, scrap-nodes, claimpunten, spawns, creep-kampen, en de slice-map Rustbelt in data/maps. Gebruik voor alles rond terrein en mapdata.
model: sonnet
effort: medium
tools: Read, Grep, Glob, Bash, Edit, Write
memory: project
isolation: worktree
color: pink
---

Je bouwt werkstroom 7: `packages/map` en `data/maps`. Lees eerst `docs/fase-0/01-doel-en-gebruik.md`, `docs/fase-0/03-repo-structuur-en-stack.md`, `docs/fase-0/06d-contract-3-dataschema.md` (maps/*.json), `docs/fase-0/07-determinisme-regels.md` en je brief in `docs/fase-0/09-briefs-per-werkstroom.md`.

`packages/map` valt onder de determinisme-regels: de passability-bitmap en alle mapdata die de sim leest zijn integers in cellen van 1 meter. Terreinhoogte voor de renderer mag apart als float-heightmap, maar de sim leest alleen de bitmap.

Slice-map Rustbelt: 128 bij 128 meter, 2 spelers, 6 scrap-nodes, 3 claimpunten, spawns, 2 creep-kampen. Startpunt voor terrein: Procedural Terrains (open source), daarna handmatig afwerken. Props verspreiden met Three Scatter.

Klaar als: de map laadt in sim en render, passability klopt met wat je ziet, een tweede map toevoegen is alleen data.

Je schrijft alleen in `packages/map` en `data/maps`.

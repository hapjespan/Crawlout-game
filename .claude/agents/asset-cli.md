---
name: asset-cli
description: Bouwt tools/asset-cli, de buis van GLB naar meshopt, KTX2, LODs, animatietextures en manifest, met validatie tegen de artist-brief. Gebruik voor alles rond assetconversie en het manifest in assets/dist.
model: sonnet
effort: medium
tools: Read, Grep, Glob, Bash, Edit, Write
memory: project
isolation: worktree
color: orange
---

Je bouwt werkstroom 3: `tools/asset-cli` en de uitvoer in `assets/dist`. Lees eerst `docs/fase-0-contracten-en-agentbriefs.md` sectie 1, 3 en je brief in sectie 9, plus de technische brief in `docs/spelfundament-v0.1.md` sectie 9.

De buis, in één commando `pnpm assets`:

1. GLB uit `assets/src` in.
2. Validatie tegen de brief: tris per LOD, maximaal 28 bones, texturemaat, Mixamo-botnamen, schaal en oriëntatie, één UV-set. Een schending faalt met een leesbare reden.
3. gltfpack voor meshopt-compressie en 3 LODs.
4. Textures naar KTX2.
5. Animatieclips gebakken naar bone-matrix textures, formaat afgestemd met render-pipeline.
6. `manifest.json` met ids, boundingboxes, socketposities, LOD-paden, animatie-index.

Placeholders die er als eerste doorheen moeten: Quaternius Universal Animation Library plus basiskarakters, 10 props uit de Gobkit Nature Kit.

Klaar als: alle placeholders en 10 props door de buis lopen met één commando, de uitvoer laadt in `packages/render` zonder handwerk, en een asset dat de norm schendt faalt met een duidelijke melding.

Je schrijft alleen in `tools/asset-cli` en `assets/dist`. Het manifest-formaat spreek je af met render-pipeline via een issue.

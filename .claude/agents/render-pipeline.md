---
name: render-pipeline
description: Bouwt de three.js WebGPU-renderer in packages/render en het render-deel van apps/client. Gebruik voor TSL-materialen, instanced skinning via bone-matrix textures, LOD, camera, snapshot-interpolatie, blob-schaduwen en de NixieFX-koppeling.
model: opus
effort: high
tools: Read, Grep, Glob, Bash, Edit, Write
memory: project
isolation: worktree
color: blue
---

Je bouwt werkstroom 2: `packages/render` en het render-deel van `apps/client`. Lees eerst `docs/fase-0-contracten-en-agentbriefs.md` sectie 1, 3, 4 (snapshot sim naar render) en je brief in sectie 9, plus `docs/spelfundament-v0.1.md` sectie 8 en 9.

Pijlers:

1. three.js WebGPURenderer met WebGL2-fallback. Pin de versie exact in `packages/render/package.json` bij je eerste commit en noteer hem in `packages/render/CHANGELOG.md`.
2. De renderer leest alleen snapshots (transferable ArrayBuffer volgens `packages/protocol/src/snapshot.ts`) en interpoleert tussen de laatste twee. Nooit sim-state, nooit spelregels.
3. Eigen TSL toon-ramp-materiaal (2 tot 3 lichtstappen plus rimlight) met teammasker uit het alfakanaal van de diffuse. Geen PBR.
4. Instanced skinning: animaties gebakken in bone-matrix textures (uit de asset-cli), per instance alleen animatie-index, tijdoffset en teamkleur. Eén draw call per factie per LOD.
5. Drie LODs, blob-schaduwen onder units, echte schaduw alleen op gebouwen. three.ez/instanced-mesh voor gebouwen en props.
6. RTS-camera: pan, zoom, rotatie, randscroll. Selectie-highlight. Vier NixieFX-effecten: mondingsvuur, inslag, bouwstof, dood.

Placeholders: Quaternius Universal Animation Library en basiskarakters (CC0) voor humanoids, Gobkit Nature Kit (CC0) voor props. Assets komen uit `assets/dist` via het manifest; een asset vervangen kost nul regels code.

Klaar als: 200 geanimeerde units plus 40 gebouwen op 60 fps op een laptop met geïntegreerde GPU, onder 150 draw calls, geen frame boven 20 ms bij een camera-draai. Stats.js in elke build.

Je schrijft alleen in `packages/render` en het render-deel van `apps/client`. Het instanced-skinning-materiaal is een reviewgate: vraag architect-review voor je merged.

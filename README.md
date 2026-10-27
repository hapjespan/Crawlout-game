# Crawlout

Browser-RTS in three.js. Werktitel. Zie `CLAUDE.md` voor de werkafspraken en `docs/` voor het ontwerp en de contracten.

## Starten

1. Node 22 LTS en pnpm installeren.
2. `pnpm install`
3. `pnpm dev`

## Structuur

- `packages/protocol`: gedeelde types en zod-schema's (contract 1, 2 en 3 als code)
- `packages/sim`: deterministische lockstep-simulatie, draait in een worker en in Node
- `packages/data`: JSON-schema's en loader; de inhoud staat in `data/`
- `packages/render`: three.js WebGPU-renderer
- `packages/ui`: HUD als Preact-overlay
- `packages/relay`: Node-relay voor lobby en frame-bundeling
- `packages/map`: terrein, passability, maps
- `apps/client`: Vite-app die alles samenbrengt
- `tools/asset-cli`: GLB naar meshopt, KTX2, LODs, animatietextures, manifest
- `tools/blender`: headless Blender-stappen vóór de asset-buis (een statisch beeld op een bestaand skelet binden)
- `tools/replay`: headless replay-runner voor determinisme-tests
- `docs/`: Spelfundament en fase-0-contracten

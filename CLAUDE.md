# Crawlout (werktitel: Wasteland RTS)

Browser-RTS in three.js met eigen IP: settlement-logica van Fallout 4, toon en SPECIAL-laag van Fallout 1 en 2, stylized kwaliteit van League of Legends. Deterministische lockstep-simulatie, volledig gescheiden van de renderer.

## Bronnen van waarheid

1. `docs/spelfundament-v0.1.md`: het ontwerp. Alle spelregels, facties, winroutes, assetbudgetten.
2. `docs/fase-0-contracten-en-agentbriefs.md`: de drie contracten (sim en snapshot, commandoprotocol, dataschema), determinisme-regels, agentbriefs, sprintplan.
3. `packages/protocol/src/`: de contracten als TypeScript-types en zod-schema's. Code en doc horen gelijk te lopen; bij verschil wint het doc en wordt de code gefixt.

Lees voor je begint: fase-0 sectie 1, 3, 7 en de brief van je eigen werkstroom in sectie 9.

## Harde regels

1. De contracten zijn bevroren. Een wijziging is een PR op `docs/fase-0-contracten-en-agentbriefs.md` plus `packages/protocol`, met review door de architect. Nooit stil in code aanpassen.
2. Elke werkstroom schrijft alleen in zijn eigen packages (zie tabel in fase-0 sectie 8). Iets nodig uit een ander package: maak een issue met de gewenste interface.
3. `packages/sim`, `packages/map` en de loader in `packages/data` volgen de determinisme-regels uit fase-0 sectie 7. De lint-regelset `sim-determinism` in `eslint.config.js` dwingt ze af. Nooit uitschakelen met eslint-disable.
4. Alle spelregels die getallen zijn, staan in `data/` als JSON. Nooit in code.
5. `main` is altijd groen en speelbaar. Een branch per werkstroom, kleine PR's, één onderwerp per PR, met tests en een regel in de CHANGELOG van het package.
6. Elke PR op de sim levert een replay-fixture met verwachte hashes mee. Een afwijkende hash blokkeert de merge.
7. Geen secrets in code. Geen netwerkcalls buiten package-installs.

## Commando's

```
pnpm install            # eerste keer; de lockfile pint alle versies
pnpm dev                # client met loopback-relay
pnpm relay              # Node-relay op ws
pnpm lint               # ESLint inclusief sim-determinism
pnpm typecheck          # tsc over alle packages
pnpm test               # vitest over alle packages
pnpm replay             # headless replay-set, vergelijkt hashes
pnpm bench              # sim-benchmark: 200 units, 10.000 ticks
pnpm assets             # asset-cli over assets/src naar assets/dist
```

## Stack

Node 22 LTS, pnpm, TypeScript strict, ESM. three.js met WebGPURenderer en WebGL2-fallback (versie wordt gepind door render-pipeline bij de eerste commit). Preact voor de HUD. ws voor de relay. zod voor schema's. vitest voor tests, Playwright vanaf sprint 2. CI op GitHub Actions met GitHub-hosted runners (ubuntu-latest), geen eigen server nodig.

## Eenheden

Sim: 1 meter = 256 eenheden, tijd in ticks van 50 ms (20 Hz), hoeken 0 tot 65535. Data-bestanden in meters, seconden en procenten; de loader rekent om op één plek. Nooit meters of seconden in de sim.

## Agents

Subagents staan in `.claude/agents/`. Model en effort per agent staan in de frontmatter en volgen fase-0 sectie 8: architect op Fable, sim-core en render-pipeline op Opus met effort high, de overige werkstromen op Sonnet, bulk op Haiku.

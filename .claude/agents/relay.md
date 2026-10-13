---
name: relay
description: Bouwt packages/relay (Node, ws): lobby, rooms, frame-bundeling met DELAY, hash-vergelijking, desyncEvent, resync, en de loopback-relay in apps/client voor lokaal spelen. Gebruik voor alles rond netcode en lockstep-transport.
model: sonnet
effort: medium
tools: Read, Grep, Glob, Bash, Edit, Write
memory: project
isolation: worktree
color: yellow
---

Je bouwt werkstroom 6: `packages/relay` en het netwerk-deel van `apps/client`. Lees eerst `docs/fase-0-contracten-en-agentbriefs.md` sectie 1, 3, 5 en je brief in sectie 9, en `packages/protocol/src/frames.ts`, `lobby.ts`, `replay.ts`.

De relay simuleert niets. Hij ordent commando's in frame-bundels, stuurt elke bundel (ook lege) naar alle spelers, vergelijkt hashes elke 20 frames en stuurt een desyncEvent bij afwijking. DELAY start op 4 frames en wordt later adaptief tussen 2 en 8.

De loopback-relay in de client gebruikt exact hetzelfde protocol in het geheugen, zodat lokaal skirmish dezelfde hashes geeft als via de relay.

Klaar als: twee browsers op één machine spelen een potje via de relay zonder desync; loopback en relay geven dezelfde hashes; een client die 10 seconden wegvalt komt terug via resync; 300 ms gesimuleerde latency blijft speelbaar met adaptieve DELAY.

Je schrijft alleen in `packages/relay` en het netwerk-deel van `apps/client`. Netcode is een reviewgate: vraag architect-review voor je merged.

---
name: hud
description: Bouwt de HUD als Preact-overlay in packages/ui en het ui-deel van apps/client: tellers, minimap, selectiepaneel, commandokaart, bouwmenu, held-paneel, waarschuwingen. Gebruik voor alles wat de speler ziet en aanklikt buiten de 3D-scene.
model: sonnet
effort: medium
tools: Read, Grep, Glob, Bash, Edit, Write
memory: project
isolation: worktree
color: cyan
---

Je bouwt werkstroom 5: `packages/ui` en het ui-deel van `apps/client`. Lees eerst `docs/fase-0-contracten-en-agentbriefs.md` sectie 1, 3, 4 (queryMessage), 5 (commando-types) en je brief in sectie 9.

De HUD praat alleen via twee kanalen: commando's uit `packages/protocol/src/commands.ts` naar het netwerk, en spelerstatus via de queryMessage uit de sim-worker. Nooit direct sim-state.

Onderdelen: scrap- en bewonersteller met pop-cap, minimap met fog en claims, selectiepaneel (unit, loadout, hp, rol), commandokaart met sneltoetsen, bouwmenu met plaatsing en footprint-preview, held-paneel (7 SPECIAL, level, perk-keuze), waarschuwingen (aanval, bewoner verloren, claim verloren), opgeven, desync-melding, pauze-indicator als een speler wegvalt.

Klaar als: een potje tegen de AI is volledig speelbaar zonder console, elke actie heeft een sneltoets, de HUD rendert onder 2 ms per frame. Stijl neutraal tot de stijlbijbel er is.

Je schrijft alleen in `packages/ui` en het ui-deel van `apps/client`.

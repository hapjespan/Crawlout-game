# Overdracht 22 oktober, avond

Branch `sprint-1`, laatste commit `b37ea51`, **niet gepusht**. `origin/sprint-1` staat nog op `293e15b`.

Suite: **2073 geslaagd, 1 gefaald**. Lint en typecheck schoon.

## Wat er vandaag bij kwam

Drie agents parallel, allemaal gecommit en geïntegreerd.

1. **Moeilijkheidsgraad** (`765561b`, protocol 0.21.0, sim 0.37.0, data 0.45.0). `MatchSettings.difficulty` met easy 1,5 · normal 1,0 · hard 0,75 als vermenigvuldiger op de reactietijd. Eén trekking uit `sim.rng` in `start()` binnen de band van het niveau, dus elk potje voelt anders en elke client rekent dezelfde tegenstander uit. De trekking is state, zodat een resync hem laadt. **Zonder niveau verandert er niets** — geen trekking, dezelfde envHash. Besluit staat in `docs/fase-0/26-moeilijkheidsgraad.md`.
2. **Besturingsgroepen** (`ebc8332`, ui 0.23.0). Ctrl+1…9 opslaan, 1…9 oproepen, zichtbaar in de HUD. Groepen leven in de HUD, niet in de sim: een groep is een bewaarde selectie en selectie is clientzaak. Generatie in het entity-id maakt dat een nieuwe unit op een hergebruikte index niet in een oude groep opduikt.
3. **Factievaardigheden** (`d10bc9a`, ui 0.22.0). Claim staat nu op de commandokaart bij elke bouwer van elke factie.

## Twee bugs die eruit kwamen

**De eenhedenbalk.** Jouw waarneming dat niet alle Garde-units terugkwamen, klopte. In `apps/client/src/game/roster.ts` sloeg een filter elk loadout over dat als lichaam van een held dient. De Kwartiermeester en de Archivaris hebben `baseLoadout: initiate_wacht` — een echte, bouwbare unit — dus **elke Initiate-wacht verdween**, en bij de Dwellers elke Patrouille. De regel geldt nu alleen nog voor een lege groep. De balk breekt ook naar een tweede rij in plaats van tegels tot 24 px te knijpen, en de zeven Garde-loadouts hebben eindelijk Nederlandse namen.

**Bewaak bij de Garde.** Niet weggehaald, met argumenten. Het is de enige order met een leiband; Stop maakt passief en Val aan dwaalt af. Raider-only was niet de knop maar het **doel**: de code accepteerde alleen een eigen Kooi of een scrapbron, en de Garde heeft geen Kooi, dus elke andere klik werd stil geweigerd. De knop zegt nu per factie wat het doel is.

**Claimen met een bouwer was geen bug.** De sim kon het al voor alle drie de facties; het ontbrak op de commandokaart.

## Wat ik daarna moest rechtzetten

- `sim.factory.ts` zat niet in git terwijl HEAD hem al importeerde (racende commits van twee agents).
- De drie nieuwe gebouwen misten hun Nederlandse naam, wat een clienttest rood zette.
- De 29 fixtures stonden rood sinds data 0.44.0: een nieuw gebouwtype verandert `hashBuildingTypes` en dus de envHash. Opnieuw opgenomen. Beide agents hadden dit gezien en terecht laten liggen.
- `docs/CHANGELOG.md` liep over de 5000-tokengrens; de drie oudste regels staan nu in archief 3.

## De enige rode test

`s18-rustbelt-garde`: de Garde-AI promoveert geen veteraan meer. Bekend sinds de AI-ronde, reproduceerbaar, en dezelfde oorzaak als de balansdaling tegen Dwellers (42 → 29 procent): ze geeft uit aan ondersteuning en een landingsplatform ten koste van vechtkracht. **Martien test dit zelf.** Het werk staat ook apart op branch `garde-ai`.

## Open, met documenten die klaarliggen

- **Artwork**: `docs/rollen-per-factie.md` (welke units welk lichaam delen) en `docs/iconen-gevraagd.md` (de rechtermuisknop-beslisboom en welke iconen ontbreken). In dat laatste staan twee vragen aan Martien: moet repareren een echte order worden, en moet de plus bij de held altijd staan of alleen als de ability klaar is.
- **Menu past niet op het scherm.** Gemeten: het paneel is 1377 px bij een venster van 1000, en de START-knop valt eronder. De portretten kleiner maken helpt onvoldoende; de heldkaarten zijn 428 px en de rechterhelft van het scherm is vrijwel leeg. Dit is een lay-outvraag, nog niet opgepakt.
- **Karakters**: Klerk en krachtpantser lopen (20 bones, geretarget). Het frame en de Warlord blijven star, met reden — zie `docs/overdracht-assets-2026-10-22.md`.
- **Teammasker** ontbreekt nog op de twee nieuwe lopende karakters, dus geen spelerskleur.
- **PR #1** staat open naar `main` en is nog niet bijgewerkt met al dit werk.

## Eerstvolgende stap

Pushen kan zodra Martien over `s18` beslist. Daarna het menu, en de iconen zodra hij ze aanlevert.

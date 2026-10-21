# Overdracht 22 oktober 2026 (nachtrun van 21 op 22 oktober)

Branch `sprint-1`, laatste commit `5c9c187`. Protocol **0.20.0**, sim 0.35.0, data 0.42.0, client 0.14.1, ui 0.21.1, relay 0.4.0. Plan van de nacht: `docs/nachtplan-2026-10-21.md`.

## Gedaan

1. **Architect-review fase 3** (`docs/architect-review-fase-3-2026-10-21.md`, oordeel merge na fixes). Alle vier blokkerende en zeven moet-punten verwerkt: 04b entries 8–10 (STATE_FORMAT_VERSION 16, TECH_WORDS, PERK_WORDS, GardeState achter `g.active`), 05 Besluit Garde-ronde B (Load/Unload), 06a–06d Garde-velden en claim-kinds, 09 content-brief, CHANGELOG-regels per protocolbump. Nieuwe **sectie 25** met het scope-besluit: fase 3 verlaat de slice van sectie 12, nieuwe bodem is 3 facties, 9 helden, 3 winroutes en Survival.
2. **04b en 05 gesplitst** in 04b/04c en 05/05b; beide zaten tegen de 5000-token-grens van de pre-commit-hook. Geen inhoudelijke wijziging, index bijgewerkt.
3. **`robotPop` → `noBedPop`, protocol 0.20.0** (sectie 25 besluit 2, agent in worktree). 34 bestanden, zuivere hernoeming. `census.robotPop` en `census.noBedPop` in de sim blijven zoals ze heten: dat zijn interne tellers. Het veld zit niet in de hash, dus geen fixture opnieuw opgenomen. De HUD-teller bleek al te kloppen (`noBedPop` bevatte frames en de Vertibird al), dus daar was geen logicafix nodig; **het label blijft "Robots" terwijl het ook frames, vehicles en beasts telt** — een woordkeuze voor content.
4. **PR #1 naar `main` geopend**: de eerste sinds gate 1, 436 commits, 1446 bestanden. https://github.com/hapjespan/Crawlout-game/pull/1
5. **CI gesplitst** (`.github/workflows/ci.yml`). De eerste run ooit werd na 30 minuten afgekapt: lint en typecheck haalden het, `pnpm test` niet, en replay, de clientbuild en de bench kwamen niet aan de beurt. Nu drie parallelle jobs — verify (lint, typecheck, build, bench), test (alle packages behalve replay) en replay (fixtures, spiegel, balansbanden, `pnpm replay`) — elk met een eigen budget. Dekking ongewijzigd: de zware tests draaien nog steeds en `REPLAY_FAST` blijft in CI uit.

## Loopt nog

- **Agent garde-ai** (Opus, eigen worktree): de Garde-AI bouwt en gebruikt de Klerk, laadt golven in de Vertibird met Load en Unload, en een AI-script kiest een ander archetype dan de Krijger. Dat is punt 2 van de overdracht van 21 oktober. Levert een eigen branch `worktree-agent-*`; mergen, resterende `robotPop`-verwijzingen omzetten naar `noBedPop`, dan de volle suite.
- **CI** draait opnieuw zodra de volgende push de PR bijwerkt.

## Wat de eerste echte CI-run opleverde

De split werkt: `lint, typecheck, build` is nu klaar in **1 minuut** in plaats van verstopt in een job die na 30 minuten omviel. Twee bevindingen, allebei nieuw omdat CI nooit eerder gedraaid heeft.

**Groen en belangrijk:** alle **29 replay-fixtures kloppen op Linux**, inclusief serialize/deserialize halverwege, en inclusief de Garde- en held-fixtures. De lockstep-sim is dus óók reproduceerbaar buiten Martiens Mac. Dat is precies wat regel 6 moet bewijzen en het was nooit eerder aangetoond.

**Rood 1 (opgelost):** de balansband van 33 Raider-potjes liep tegen de limiet van 300 s per test. Lokaal duurt hij een minuut op veel cores; de runner heeft er veel minder. Limiet naar 20 minuten, geen enkele assertie gewijzigd (`613e3aa`).

**Rood 2 (vraagt een besluit van Martien, bewust niet 's nachts gefixt):** `tools/asset-cli` vergelijkt een verse build **byte voor byte** met wat in `assets/dist` is gecommit. Op Linux vallen **5 van de 132 assets** anders uit: `dweller_armor_composite`, `garde_body_vertibird`, `raider_armor_steel`, `site_garage_restored`, `survival_behemoth`. Oorzaak: de assetbuild rekent met `Math.sin`, `Math.cos`, `Math.pow` en die zijn niet bit-identiek tussen macOS en glibc. Vandaar dat het er maar vijf zijn — alleen waar een waarde net over een afrondgrens valt. Dit is **geen regressie van deze PR**; het is een eigenschap die er altijd al was en die niemand kon zien omdat CI nooit liep. Vier mogelijkheden:

1. De assetbuild net zo deterministisch maken als de sim (fase-0 sectie 7-discipline, eigen wiskunde in plaats van `Math.*`). Correct en het meeste werk.
2. Vergelijken met een kleine marge op floats in plaats van op bytes. Houdt het doel van de test (niemand heeft met de hand in een `.glb` zitten knoeien, de fragmenten zijn de bron) en laat het platformverschil los.
3. De byte-vergelijking alleen draaien op het platform waarop `assets/dist` gebouwd is. Houdt de strengheid lokaal, verliest de dekking in CI.
4. Niets doen en deze job rood laten tot de assetronde. Dan blokkeert hij wel de merge.

Ik heb nagegaan of het aan één vormsoort ligt: nee. `segments` (en dus `sin`/`cos`) zit in **40 van de 54 bronfragmenten**, 759 keer in totaal, en de vijf falende assets gebruiken het juist mínder dan gemiddeld. Het is dus geen kapot onderdeel maar statistiek: bij genoeg radiale onderdelen landt af en toe een waarde net op een afrondgrens waar de twee libm-implementaties uiteenlopen, en dan verschuift één byte in de `.glb`.

Dat pleit tegen optie 1 — die betekent de trigonometrie in de hele assetpijplijn vervangen, niet één bug zoeken. Mijn voorkeur is **2**: het doel van de test (de fragmenten zijn de bron, niemand heeft met de hand in een `.glb` geknoeid) blijft volledig overeind, terwijl het platformverschil eruit valt. Optie 3 is de goedkope noodoplossing als het snel moet. Maar dit is werkstroom 3 plus de architect, niet iets om half twee 's nachts eenzijdig te beslissen.

## Open

1. **Gate 1 is mensenwerk.** Speeltest met 5 tot 8 mensen en een potje op een laptop met geïntegreerde GPU (60 fps, onder 150 draw calls, geen frame boven 20 ms). Zie `docs/gate-1-checklist/01-samenvatting-is-dit-een-gate-1-kandidaat.md`.
2. **Assets**: power-armor-silhouet, Slaapzaal-mesh, heldportretten. Echt 3D-werk, geen agenttaak.
3. **Passagiers in de snapshot**: open architectbesluit (zie `packages/protocol/CHANGELOG.md` bij 0.18.0). Bewust niet 's nachts toegevoegd; nieuw contractoppervlak zonder review is precies wat harde regel 1 verbiedt.
4. **Balansmeting archetypes**: de negen helden zijn nooit gemeten (`docs/held-keuze.md`). Hoort na een speeltest, niet ervoor.
5. **Label "Robots"** in de HUD dekt zijn inhoud niet meer (punt 3 hierboven).

## Eerstvolgende stap

Agent garde-ai mergen, dan `pnpm lint && pnpm typecheck && pnpm test` volledig, fixtures heropnemen als de Garde-AI hashes raakt (met een regel in `docs/CHANGELOG.md` welke en waarom, fase-0 sectie 24 besluit 4), en bij groen pushen naar `origin/sprint-1` zodat PR #1 bijwerkt. Bij rood: committen op een eigen branch en `sprint-1` met rust laten.

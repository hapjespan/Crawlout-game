# Overdracht 22 oktober 2026 (nachtrun van 21 op 22 oktober)

Gepushte stand `origin/sprint-1` = `537a2dc`. Protocol **0.20.0**, sim 0.35.0, data 0.42.0, client 0.14.1, ui 0.21.1, relay 0.4.0. Plan van de nacht: `docs/nachtplan-2026-10-21.md`. Lees ook "Waar de branches staan" onderaan — lokale `sprint-1` loopt voor en mag niet zomaar gepusht worden.

## Gedaan

1. **Architect-review fase 3** (`docs/architect-review-fase-3-2026-10-21.md`, oordeel merge na fixes). Alle vier blokkerende en zeven moet-punten verwerkt: 04b entries 8–10 (STATE_FORMAT_VERSION 16, TECH_WORDS, PERK_WORDS, GardeState achter `g.active`), 05 Besluit Garde-ronde B (Load/Unload), 06a–06d Garde-velden en claim-kinds, 09 content-brief, CHANGELOG-regels per protocolbump. Nieuwe **sectie 25** met het scope-besluit: fase 3 verlaat de slice van sectie 12, nieuwe bodem is 3 facties, 9 helden, 3 winroutes en Survival.
2. **04b en 05 gesplitst** in 04b/04c en 05/05b; beide zaten tegen de 5000-token-grens van de pre-commit-hook. Geen inhoudelijke wijziging, index bijgewerkt.
3. **`robotPop` → `noBedPop`, protocol 0.20.0** (sectie 25 besluit 2, agent in worktree). 34 bestanden, zuivere hernoeming. `census.robotPop` en `census.noBedPop` in de sim blijven zoals ze heten: dat zijn interne tellers. Het veld zit niet in de hash, dus geen fixture opnieuw opgenomen. De HUD-teller bleek al te kloppen (`noBedPop` bevatte frames en de Vertibird al), dus daar was geen logicafix nodig; **het label blijft "Robots" terwijl het ook frames, vehicles en beasts telt** — een woordkeuze voor content.
4. **PR #1 naar `main` geopend**: de eerste sinds gate 1, 436 commits, 1446 bestanden. https://github.com/hapjespan/Crawlout-game/pull/1
5. **CI gesplitst** (`.github/workflows/ci.yml`). De eerste run ooit werd na 30 minuten afgekapt: lint en typecheck haalden het, `pnpm test` niet, en replay, de clientbuild en de bench kwamen niet aan de beurt. Nu drie parallelle jobs — verify (lint, typecheck, build, bench), test (alle packages behalve replay) en replay (fixtures, spiegel, balansbanden, `pnpm replay`) — elk met een eigen budget. Dekking ongewijzigd: de zware tests draaien nog steeds en `REPLAY_FAST` blijft in CI uit.

## De Garde-AI: gebouwd, gemeten, bewust niet gemerged

De agent heeft punt 2 van de vorige overdracht gebouwd en het werkt: de Klerk gaat mee met elke golf en repareert bij de verdediging, de Vertibird laadt tot vier vechters van een golf en zet ze af waar het leger heen marcheert (afzetpunt elke tick afgeleid uit het leger, dus geen nieuwe state), en `dwellers-vs-garde` kiest als eerste script een archetype (de Controleur). Twee optionele datavelden in `raidPlan`: `support` en `airlift`, data 0.43.0.

**Maar het staat niet op `sprint-1` en is niet gepusht.** De volledige suite gaf 2024 geslaagd en **1 gefaald**: in de heropgenomen `s18-rustbelt-garde` haalt geen enkele Garde-eenheid nog veteranenrang 1. Ik heb het apart herhaald — reproduceerbaar, geen flake. Dat is dezelfde oorzaak als de balanscijfers die de agent zelf meldde: tegen de Raiders ging het van 71 naar 75 procent, maar **tegen de Dwellers van 42 naar 29**. De Garde geeft nu uit aan ondersteuning en een landingsplatform ten koste van vechtkracht, krijgt daardoor minder kills, en promoveert binnen de 17,5 minuten van die fixture niemand meer. De fixture bewijst de veteranenmechaniek dus niet langer, terwijl hij daar juist voor bestaat.

Dat is geen testartefact maar een afstemvraag, en de agent zat al op zijn drie meetrondes. Het werk staat compleet op branch **`garde-ai`** (merge `fd7ebe4`). Wil je het alsnog op `sprint-1`: `git merge garde-ai`. Wil je `sprint-1` eerst gelijk aan de gepushte groene stand: `git reset --hard origin/sprint-1` — dat gooit niets weg, alles zit in `garde-ai`.

Mijn inschatting: één afstemronde op `airlift.minArmy`, `support.max` en het moment van het landingsplatform brengt de Dweller-band waarschijnlijk terug, maar dat hoort bij daglicht en bij jouw keuze om balans via een speeltest met mensen te doen in plaats van via nog meer AI-tuning.

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

## Besluiten van Martien, uitgevoerd (22 oktober, overdag)

1. **Assetvergelijking: optie 2 gekozen.** De vijf vergelijkingen "verse build tegen gecommitte dist" gaan nu via `tools/asset-cli/test/glbMatch.ts`: structuur, accessor-headers en alle integerdata (indices, joints) blijven exact, alleen floats krijgen marge. `glbMatch.test.ts` bewijst dat de test niet leeg geworden is — 1 mm verplaatsing faalt, een ander asset faalt, 1e-9 gaat door. De drie "tweede build geeft dezelfde bytes"-tests blijven byte-exact; zelfde proces en platform, dus daar hoort die lat. Onderweg bleek een kale `NodeIO` de LOD's niet te kunnen lezen (meshopt-compressie); nu gebruikt de vergelijker dezelfde `createIO()` als de buis.
2. **HUD-label** is `Zonder bed` geworden; het dekt robots, Garde-frames, de Vertibird en beasts.
3. **Passagiers in de snapshot** staat als sectie 25 besluit 4, met drie opties en de aanbeveling `PlayerStatus.transports` als eigen kennis — dezelfde weg die `slaveGroups` en `camps` al namen, zonder snapshot- of hashwijziging.
4. **Assetlijstje** voor Martien: `docs/assets-gevraagd.md`.

**Eronder vandaan gekomen: de HUD-tijdtests.** Zodra de assetfix werkte, liep dezelfde job stuk op "onder 2 ms per refresh": een GitHub-runner doet er 4,2 tot 10,3 ms over. Sectie 20 besluit 10 had dit al gesignaleerd en twee uitwegen toegestaan; het stond als "mag" en was nooit gedaan. De letterlijke optie (een drempel die zich aan de machine ijkt) is geprobeerd en **verworpen**: na opwarming optimaliseert de JIT de ijkloop weg, zodat hij JIT-kwaliteit meet in plaats van machinesnelheid, met 50 procent spreiding tussen twee runs op dezelfde machine. In plaats daarvan is de grens gesplitst naar waar het getal voor is (`packages/ui/src/perfBudget.ts`): op een ontwikkelmachine de harde 2 ms uit de brief, in CI een ruime bovengrens die een regressie van een orde van grootte vangt maar niet pretendeert de brief te bewijzen. Dat laatste kunnen alleen Martiens machine en de speeltest. **Dit gaat verder dan besluit 10 letterlijk toestond** — de eerlijke alternatieven zijn een eigen runner of deze tests helemaal uit CI halen.

**Stand van CI op commit `1f637bc`:** `lint, typecheck, build` groen (1m09s), `unit tests` groen (2m15s), `replay` rood op **precies één test** — `s18-rustbelt-garde`, de veteraan van de Garde-AI. De 29 fixtures en de balansbanden zijn groen.

## Open

1. **Gate 1 is mensenwerk.** Speeltest met 5 tot 8 mensen en een potje op een laptop met geïntegreerde GPU (60 fps, onder 150 draw calls, geen frame boven 20 ms). Zie `docs/gate-1-checklist/01-samenvatting-is-dit-een-gate-1-kandidaat.md`.
2. **Assets**: power-armor-silhouet, Slaapzaal-mesh, heldportretten. Echt 3D-werk, geen agenttaak.
3. **Passagiers in de snapshot**: open architectbesluit (zie `packages/protocol/CHANGELOG.md` bij 0.18.0). Bewust niet 's nachts toegevoegd; nieuw contractoppervlak zonder review is precies wat harde regel 1 verbiedt.
4. **Balansmeting archetypes**: de negen helden zijn nooit gemeten (`docs/held-keuze.md`). Hoort na een speeltest, niet ervoor.
5. **Label "Robots"** in de HUD dekt zijn inhoud niet meer (punt 3 hierboven).

## Waar de branches staan

Op verzoek van Martien (22 oktober: "ik wil al je werk behouden, niets weggooien") is de Garde-AI **niet** teruggedraaid maar meegenomen.

- **`sprint-1` = `1f637bc`**, lokaal en op origin gelijk. Dit is wat PR #1 toont.
- **`garde-ai` = `fd7ebe4`**: dezelfde Garde-AI-merge, apart bewaard als tweede exemplaar.
- Lokaal 2028 tests groen, 1 rood (`s18`). Dat ene rode vinkje staat dus ook op de PR, bewust: Martien test de Garde-AI zelf.

## Eerstvolgende stap

**De Garde-AI is nu het enige dat CI rood houdt.** Zolang dat ene vinkje rood staat, valt een nieuwe regressie op de PR niet op. Dus: testen (Martien) en dan afstemmen of laten liggen.

Daarna ligt alles bij de mens: assets aanleveren (`docs/assets-gevraagd.md`), de speeltest en de laptop met geïntegreerde GPU. Klaar om op te pakken zodra er iemand op zet: `PlayerStatus.transports` uit sectie 25 besluit 4, en de MAG-opruimpunten uit besluit 5.

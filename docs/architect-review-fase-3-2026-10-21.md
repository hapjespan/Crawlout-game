# Architect-review fase 3 — 21 oktober 2026

Scope: `c38b6d9..HEAD` — alleen contract-bestanden (`packages/protocol/src/**`, `docs/fase-0/**`).
Protocol 0.17 → 0.19, data 0.34 → 0.42.

## Oordeel

**merge na fixes.**

Code is op zich in orde: hash-als-gespeeld-patroon correct toegepast (Garde-state achter `g.active`, perk-woord 1 alleen bij >32 perks), determinisme-regels gerespecteerd (geen nieuwe floats, geen nieuwe Math, geen nieuwe async), zod-schema's consistent met data, tests dekken de nieuwe velden. Maar doc loopt op meerdere fronten achter op code (schending van harde regel #1), één semantiek is stilletjes verbreed, en de versienummers lopen niet gelijk.

## Blokkerend

1. **`docs/fase-0/04b-contract-1-state-hash-en-snapshot.md:12`** — geen entry voor STATE_FORMAT_VERSION 16 of voor de bij sim 0.31.0–0.35.0 toegevoegde state. Ontbrekend: `tx`/`ty` verwijderd, TECH_WORDS=2 (MAX_TECHS 64, PlayerState.tech 2 woorden), PERK_WORDS=2 (MAX_PERKS 64, PlayerState.heroPerks 2 woorden, woord 1 alleen bij >32 perks), de volledige GardeState (`kills`, `rank`, `cores`, `coreWork`, `stunUntil`, `overloadAt`, `quality`, `cargoN`, `paHolder`, `paTimer`, `paFrame`, `cargoType`/`Hp`/`Rank`/`Kills`, allen alleen gehashed als `garde.active`).
   **Fix:** nieuwe genummerde punten 8, 9 en 10 in 04b die elk veld, zijn gate en zijn envHash-scoping noemen, net als punt 3–7 doen voor fog, Raiders en kampen.

2. **`docs/fase-0/05-contract-2-commandoprotocol.md`** — geen entry voor Load en Unload (protocol 0.18.0, Vertibird). De commando's staan alleen als lange docstring in `packages/protocol/src/commands.ts:52-58`; het contract-doc kent ze niet.
   **Fix:** nieuwe alinea "Besluit Garde-ronde B (protocol 0.18.0)" met Load (ids = passagiers, transportId; alleen eigen mens, geen held, geen slaaf), Unload (ids = eigen transports; met x,y vliegt hij eerst), passagier-is-geen-entity, dood-met-transport, nieuwe entity-ids bij lossen, pop-regel.

3. **`docs/fase-0/06a-contract-3-dataschema.md:8`** — loadouts-rij noemt niet `transport { capacity, loadRangeM }`, `flying`, `overload { typeIds, stunS, cooldownS }`, `fusionCores`, en noemt niet dat `repair` ook op role technician mag (Klerk, data 0.39.0). Buildings-rij noemt niet `armorType=power` (data 0.40.0). Factions-rij noemt niet `fusionCores { … }`, `mapPowerArmor { heroId? / loadoutId, respawnS, otherQualityPct }`, `veterancy`.
   **Fix:** één nieuwe aantekening "Besluit Garde-ronde (data 0.38.0 t/m 0.42.0)" per rij.

4. **`packages/protocol/src/snapshot.part2.ts:41-48` (`robotPop`)** — veldbetekenis stilletjes verbreed. Doc zegt "pop van de levende eigen robots"; sim 0.34.0 (sim.queries.ts:85-87) vult hem met `census.robotPop + census.noBedPop` (frames, Vertibird, beasts). Dit is een contractwijziging in de interpretatie van een bestaand veld zonder docupdate.
   **Fix (één van drie):** (a) hernoem naar `noBedPop` in protocol 0.20.0 met migratienota; (b) splits naar `robotPop` en `noBedPop`; (c) doc expliciet "pop van elke eigen levende unit die geen bed gebruikt (robots, en sinds protocol 0.18.0 ook vehicles en beasts)". **Voorkeur: (a)** — de naam liegt nu. In alle gevallen docs/CHANGELOG.md regel + aanpassing.

## Moet

5. **`docs/fase-0/05...md:55 en :61`, en `docs/CHANGELOG.md:5`** — zeggen setHero is "protocol 0.18.0", maar `packages/protocol/package.json` staat op 0.19.0 en `lobby.ts:43,71` noemt 0.19.0. Oorzaak: Load/Unload heeft 0.18.0 van hero-choice overgenomen.
   **Fix:** in doc 05 en CHANGELOG-regel 0.18.0 → 0.19.0 voor setHero/heroArchetype; aparte CHANGELOG-regel voor 0.18.0 Load/Unload.

6. **`docs/CHANGELOG.md`** — ontbrekende regels voor protocol 0.17.0 (`PlayerStatus.survival`) en 0.18.0 (Load/Unload, Vertibird transport). Sectie-24-regel noemt 0.17.0 samen met de review maar niet als zelfstandige contractwijziging; 0.18.0 Load/Unload nergens gelogd.
   **Fix:** twee aparte regels toevoegen zodat elke protocolbump één regel krijgt.

7. **`docs/fase-0/06c-contract-3-dataschema.md:6` (damage-matrix)** — rij noemt armorType-kolommen "none, light, medium, heavy, robot"; data/damage-matrix.json en `ArmorType` in schemas.part1.ts:20 bevatten ook `power`.
   **Fix:** `power` achteraan toevoegen in de doc-tekst.

8. **`docs/fase-0/06d-contract-3-dataschema.md` (maps/\*.json)** — claimPoints `{ x, y, kind }` noemt de kinds niet; de schema staat `['scrap', 'settlement', 'powerArmor']` toe (schemas.part2.ts:349).
   **Fix:** kinds expliciet opsommen, met de regel dat `powerArmor` alleen in een potje met de Garde zinvol is (en in de envHash gegate'd via `mapPowerArmor`).

9. **`docs/fase-0/06b-contract-3-dataschema.md:6` (heroes.json)** — noemt `archetype` maar niet de held-keuze-koppeling (data 0.42.0: `idGroup`, `defaultHeroId` per factie, LobbyPlayer.heroArchetype → de held van dat archetype van de factie). Zonder deze regel kan content niet weten dat een nieuwe archetype-held achteraan in idGroup 1 moet.
   **Fix:** aantekening data 0.39.0/0.42.0 (hero-choice).

10. **`docs/fase-0/09-briefs-per-werkstroom.md`** — content-brief noemt alleen 1 held (Krijger). Sinds fase 3 bouwt content 3 archetypes per factie (Bouwer, Krijger, Tacticus).
    **Fix:** breidt de content-brief uit of maak expliciet dat de Garde + 3 archetypes een fase-3-uitbreiding is op de slice.

11. **Scope-besluit expliciet loggen (verplicht).** De originele slice was Dwellers + Krijger + Rustbelt + 2 winroutes vs AI (Spelfundament sectie 12, architect.md laatste alinea). Fase 3 heeft toegevoegd: Raiders (fase 2) + Garde (fase 3) = 3 facties; 3 archetypes per factie = 9 helden; winroute C (Bouwproject); Survival co-op. Drievoudige scope-uitbreiding. **Verdedigbaar binnen de contracten** omdat (a) elke uitbreiding additief is (geen bestaand veld van vorm veranderd), (b) hash-als-gespeeld-scoping (`garde.active`, `PlayerState.perkWords`, `survival.active`, `defense.active`) houdt oude fixtures identiek, (c) alle data staat in `data/`, geen hardcoded getallen in sim gevonden. **Niet blokkerend voor merge** maar moet in doc 24 of nieuwe sectie 25 als expliciet scope-besluit gelogd met reden ("fase 3 is de verbreding, de slice-regel uit sectie 12 gaat terug in als er een gate 1 afgewezen wordt").
    **Fix:** één alinea in 24a of nieuwe sectie 25.

## Mag

12. **`packages/protocol/src/commands.ts:52-58`** — groot comment-blok (Load/Unload) in de code is Engels; rest van het bestand mixt. Hoort primair in `docs/fase-0/05` (zie BLOKKEREND 2); laat na verhuizing alleen korte verwijzing staan.

13. **`packages/protocol/src/snapshot.part1.ts:1`** — top-comment "Holds: … +30 more" verzwakt bij elke splitsing. Overweeg letterlijke export-lijst (zoals `snapshot.ts` al heeft) i.p.v. "+30 more".

14. **`packages/protocol/src/lobby.ts:43`** — "originally 0.18.0 on its own branch" is archeologisch handig, maar hoort in CHANGELOG, niet in contract-code. Opruimen in volgende protocol-bump.

15. **`packages/protocol/src/snapshot.part3.ts:25`** — `target: number` met "-1 zonder doel" is magisch getal. Niet blokkerend want playerId, geen owner-byte. Overweeg expliciete constante `SURVIVAL_NO_TARGET = -1` in protocol.

16. **`docs/fase-0/24a-contractbesluiten-na-fase-3-ronde-1-en-2.md:3`** — zeer lange openingszin met twaalf commits. Beter als bulletlijst. Puur stijl.

## Antwoorden op de zes overdrachtsvragen

1. **Protocol 0.17→0.18→0.19:** code is 0.19.0, doc en CHANGELOG spreken op twee plekken van 0.18.0 voor setHero. Niet gelijk. Zie 5 en 6.
2. **Dataschema 0.34→0.42:** zod-schema's en loader consistent met data/\*.json, geen hardcoded getallen gevonden. MAAR docs 06a, 06c, 06d, 06e missen velden. Zie 3, 7, 8, 9.
3. **Hash-alleen-als-gespeeld:** correct toegepast in `state.ts:146-170` (`g.active`, `d.active`, `p.survival.active`); `PlayerState.perkWords` conditioneert woord 1 alleen bij >32 perks. Patroon klopt. Doc beschrijft het patroon niet voor Garde — zie 1.
4. **`robotPop`:** betekenis is in de sim verbreed naar "pop zonder bed". Stille contractwijziging. BLOKKEREND, zie 4. Frame-pop meetellen is onvermijdelijk (anders klopt popCapMax niet) maar moet via herbenoeming of expliciete docwijziging.
5. **ArmorType `power`:** nette additieve extensie (achteraan de enum, bestaande indices stabiel). Damage-matrix hanteert hem consequent in data. Lekt niet door determinisme-grenzen: `power` is string-index in lookup-tabel, geen float. Alleen de doc moet mee — zie 7.
6. **Garde-schemavelden + held:** zod-schema's compleet en strict; `superRefine` dwingt koppelingen af (bodyType-robot⇔role-robot, slave-restricties, canBuild-alleen-robot). Snapshot-serialisatie deterministisch (alle Garde-arrays in state.ts via `bytesOf` met vaste volgorde en vaste lengte, achter `g.active`). Gap: contract-doc 04b, 05, 06a, 06d lopen achter. Zie 1, 2, 3, 8.

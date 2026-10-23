## 27. Bewaak-doellijst en `normal` gelijk aan géén niveau (22 oktober, twee besluiten van Martien)

Genomen op 22 oktober 2026 door Martien, naar aanleiding van de overdracht van die avond (`docs/overdracht-2026-10-22-avond.md`). Twee losse besluiten die samen in één ronde zijn uitgevoerd omdat beide de sim raken en de replay-set dan één keer opnieuw hoeft. Uitgevoerd in sim 0.38.0, data 0.46.0, ui 0.25.0; protocol 0.21.0 **ongewijzigd**. Verwerkt in sectie 5 (Guard), sectie 26 besluit 5, `docs/CHANGELOG.md`, `packages/sim/CHANGELOG.md`, `packages/data/CHANGELOG.md` en `packages/ui/CHANGELOG.md`.

**Oordeel in één regel:** beide zijn gedragswijzigingen op bevroren tekst, geen van beide verandert een veld van vorm; de eerste verbreedt een doelcontrole, de tweede haalt een vierde stand weg die niemand wilde.

**Besluiten**

1. **Bewaak richt ook op een eigen claimpaal, wachtpost of geschutstoren (uitgevoerd).** Martien, 22 oktober: Bewaak was in de praktijk Raider-only, niet door de knop maar door het **doel** — `applyGuard` accepteerde alleen een eigen voltooide Kooi of een scrapbron met scrap, en alleen de Raiders hebben een Kooi. Elke andere klik werd stil geweigerd. Dat is nu verbreed. Het doel van `Guard { ids, targetId }` is voortaan:

   | doel | voorwaarde |
   |---|---|
   | scrapbron | `amount > 0` (ongewijzigd) |
   | eigen gebouw | voltooid, hp boven 0, en `provides` bevat **kooi**, **claim** of **turret** |

   In data betekent dat: Kooi en Raiderkamp (de oude regel, beide `provides kooi`), claimpaal, plunderpost en wachtpost (`provides claim`), het hoofdgebouw van elke factie (dat `provides claim` óók heeft, dus hoofdgebouw, Raiderkamp en Bastion zijn posten) en elke toren (turret, lasertoren, mitrailleursnest, geschutstoren). Elke factie heeft daarmee diepte in de enige order met een leiband.

   Waarom `provides` en geen lijst met gebouw-ids: de regel staat dan in `data/buildings/*.json` waar hij hoort, een nieuw gebouw van een bestaande soort krijgt hem vanzelf, en de sim houdt één bitmaskertest (`isGuardPost` in `systems/slaves.part2.ts`, naast `isOwnKooi`, dat het generaliseert). Dat het hoofdgebouw erbij komt is geen bijvangst maar het wegnemen van een scheefheid: het Raiderkamp was al bewaakbaar omdat het `provides kooi` heeft, en de Bastion en het Dweller-hoofdgebouw niet.

   De controle draait op twee plekken en moet op allebei gelijk lopen: `applyGuard` (accepteert het commando) en `guardPost` in `systems/orders.part1.ts` (houdt de order geldig). Een post die van eigenaar wisselt, gesloopt wordt of een bouwplaats blijft, beëindigt de order — dat is de oude regel, nu over de bredere lijst. Wat **niet** verandert: wie de order mag krijgen (alleen vechters, rol militia of robot, met een wapen, geen held, geen slaaf), de leiband, de slaven-bewaakregel van de Raiders (`guardGroups` kijkt nog steeds naar een Kooi) en de Raider-AI, die uit zichzelf alleen zijn Kooien en nodes bezet.

   HUD (ui 0.25.0): `targetingHint` in `packages/ui/src/controller.actions.ts` zei "alleen de Raiders hebben een Kooi, dus voor de Garde is een scrapbron het enige doel". Die tekst klopt niet meer. De selectie verraadt niet fijner dan Raiders-of-niet, dus er zijn twee regels: Raiders lezen Kooi, plunderpost, Raiderkamp of mitrailleursnest, de andere twee lezen claimpaal of wachtpost, hoofdgebouw of toren — beide plus de scrapbron. De tabel boven `ACTIONS` in hetzelfde bestand legt de nieuwe regel per factie vast.

   Fixtures: `s15-rustbelt-raiders-guard` geeft Guard op een Kooi en op een node; beide blijven geldig, dus geen hash verschuift door dit besluit.

2. **`normal` is precies hetzelfde als géén niveau (uitgevoerd).** Sectie 26 besluit 5 liet vier standen bestaan: easy, normal, hard en afwezig, waarbij `normal` ook lootte (binnen 92 tot 108 procent) en afwezig niet. De architectvraag daarover stond open; Martien beslist: **`normal` wordt afwezig**. Geen trekking, vermenigvuldiger exact 1,0, dus elk `normal`-potje speelt de scripts precies zoals ze in `data/ai` staan. Easy en hard loten wél — daar zit de variatie die hij wilde.

   Uitvoering op één plek: `difficultyOn` in `packages/sim/src/difficulty.ts` geeft `false` voor `DIFFICULTY_NORMAL`. Alles wat die functie leest volgt vanzelf — geen `rng.nextInt` in `start()`, `sim.aiScripts === config.aiScripts` (dezelfde objecten, geen kopie), geen extra state-chunk in de serialisatie, en geen bijdrage aan de envHash. Een `normal`-potje en een potje zonder `difficulty` hebben dus **dezelfde envHash en dezelfde hashes**; easy en hard houden hun eigen hash. Twee clients die van elkaar verschillen in easy-tegen-hard vallen nog steeds op tick 0 uit elkaar, wat de reden was om het niveau in de envHash te zetten (sectie 26 besluit 4).

   Data (`data/sim.json`): `difficulty.levels.normal` staat op `reactionPct: 100, spreadPct: 0`. De twee getallen blijven staan omdat de sim drie niveaus verwacht (`DIFFICULTY_COUNT`) en omdat ze vastleggen wat normal betekent; de sim loot er niet voor, dus `spreadPct: 0` is beschrijving, geen knop.

   Wat **niet** verandert: het protocol (`Difficulty` houdt zijn drie waarden en `MatchSettings.difficulty` blijft optioneel — het menu moet een "Normaal" kunnen tonen, ook al is dat onder water de stand zonder niveau), en `validateEnv`, dat een niveau blijft weigeren als de data geen `difficulty`-blok kent. Dat laatste is bewust het enige verschil tussen `normal` en afwezig dat overblijft: een niveau noemen dat de data niet kent is een programmeerfout en moet hard vallen, niet stil goed gaan.

   Fixtures: `s21-rustbelt-difficulty-easy` en `-hard` loten nog steeds en houden hun hashes; er is geen `normal`-fixture, en die hoeft er ook niet te komen — elke andere fixture (zonder niveau) is er nu het bewijs van. `packages/sim/test/difficulty.test.ts` legt vast dat `normal` en afwezig dezelfde rng-stand, dezelfde state-lengte, dezelfde hash en 60 gelijke ticks geven.

**Niet in dit besluit**

De Garde-AI van dezelfde ronde (`data/ai/garde-basic.json` 0.46.0: `raidPlan.support` vanaf minuut 15 en per 10 vechters, `creeps` tier 1 vanaf 4 vechters) is **balans, geen contract**: alleen getallen in `data/`, geen schema en geen veld. Die staat in `packages/data/CHANGELOG.md` 0.46.0 met de meting erbij, niet hier.

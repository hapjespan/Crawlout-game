# Survival co-op (data 0.33.0; voorstel, ter bevestiging door de architect)

Bron: Spelfundament 7.2. Alleen data: `data/survival/units.json` en `data/survival/waves.json`, schema in `packages/data/src/schemas.part5.ts`, loader `loader.survival.ts` (`GameData.survival`, `null` zonder map). De sim leest het nog niet. Alle getallen zijn startwaarden, niet gemeten.

**Spel.** 1 tot 4 spelers, een gedeelde map, per speler een eigen bouwzone (slot 0 tot 3, straal 45 m rond de HQ-plek, op 25 en 75 procent van de kaart; claimposten mogen overal). Golf 1 op 120 s, daarna elke 115 s; golf 15 op 1730 s, de run duurt zo 32 tot 35 min. Golf 8 brengt het Klauwbeest (mini-boss), golf 15 de Behemoth. Held-XP telt mee: elke vijand heeft `heroXp` voor de held van de killer, `lootScrap` gaat naar de killer.

**Winst:** golf 15 is gespawnd en alle vijanden van golf 15 (de Behemoth erbij) zijn dood terwijl minstens een HQ staat. **Verlies:** elk HQ van elke speler is vernietigd.

**Golf.** `spawns` geldt voor 1 speler en wordt per speleraantal geschaald (`scaling`: aantal 100, 170, 240, 300 procent; hp 100 tot 130; damage 100 tot 110; miniboss en boss blijven 1 stuk). Een golf spawnt `batches` groepen om de `batchIntervalS` s, gelijk verdeeld over `edges` randen (noord, oost, zuid, west; binnen 24 m van het randpunt), te beginnen met de rand het dichtst bij de zone van het doel en dan met de klok mee. Vijanden zijn neutraal-vijandig (zoals creeps), maar vallen gebouwen aan en hebben geen leash: ze lopen aanvalsgericht naar het HQ van het doel en slaan alles wat ze blokkeert of raakt.

**Doelkeuze "zwakste speler".** Bij de start van elke golf, en opnieuw zodra het doel zijn HQ verliest, krijgt elke speler met een HQ de score S = som(`scrapCost` van zijn levende vechters en robots, geen bouwers of slaven) + som(`scrapCost` van zijn voltooide turrets) + 300 als zijn held leeft. De laagste S is het doel van de hele golf; gelijk: laagste HQ-hp-percentage, dan laagste slot. Solo is het doel altijd jezelf.

**Wat de sim moet bouwen:** golf-spawner op `atS` met batches en randen; doelkeuze zoals boven; schaling op aantal, hp en damage; een vijandig AI-gedrag (neutraal, gebouwen aanvallen, geen leash, hertarget bij HQ-verlies); win- en verliesvoorwaarde; per-speler bouwzone-controle bij plaatsing; kill-beloning (loot en held-XP); `MatchSettings.mode` `survival`.

## 24. Contractbesluiten na fase 2 ronde 3 en fase 3 ronde 1 en 2 (deel b, open punten)

**Open na deze ronde, per werkstroom (moet, tenzij anders vermeld)**

1. sim-core: (a) `PlayerStatus.survival` vullen in Sim.status uit survivalStatusOf, met `rank` als string (besluit 3), sim-test op de literal; (b) `DefenseState.mark` wissen waar een entity vrijkomt, met test (besluit 6); (c) de versiestring uit envHash (config.hash.ts, besluit 4), in één PR met replay en de heropname; (d) mag: `tx` en `ty` uit de verdedigingsstate bij de volgende bump van STATE_FORMAT_VERSION; (e) mag: `attackerOf` in de bench zodra er een survival-bench is.
2. replay: replay.test.ts vergelijkt alleen hashes, `dataVersion` in de fixture is informatief (besluit 4); de heropname in dezelfde PR als sim-core (c) en content 3.
3. content: `baseDefense.skirmish` op true in een eigen balansronde (besluit 5: hoogstens 3 meetrondes, raiders-balance.test.ts 40 tot 55 procent, Bouwproject erbij; meet radiusM 40 en calmS 8), in de PR van de heropname; een regel bij `spread` in waves.json dat hij niet hashneutraal is (besluit 6); data/README.md kent Survival, `zoneScrap` en `baseDefense` nog niet (sectie 23 open punt 6 staat ook nog).
4. client: simWorker.ts en de wrapper-typen in survivalStatus.ts weg, `PlayerStatus.survival` lezen (besluit 3), na sim-core (a); de favicon 404 (overdracht 19 oktober) staat nog.
5. hud met architect: protocol 0.18.0, `chems`, `camps`, `slaveGroups`, `project` en `survival` in één PR verplicht zodra alle PlayerStatus-literals ze dragen (besluit 1); `identifyYou` weg (besluit 1); mag: de bouwzone-ring in 3D vraagt een render-API (overdracht 19 oktober punt 2).
6. relay en ui: ongewijzigd voor de contracten. Gedeeld zicht tussen bondgenoten in Survival (overdracht 19 oktober punt 2) is een contractvraag voor de Garde-ronde: `visTo` draagt één bit per speler, dus een team-OR in vision.ts is klein, maar het hoort in sectie 4 vóór iemand het bouwt.

**Wat Martien moet doen (niet door agents te doen)**

1. Survival solo en met twee browsers spelen na sim-core (a) en client 4: golf 1 op 2 minuten tegen een passief HQ is de maat van overdracht 19 oktober punt 3; zeggen of de verdedigingshouding (vanaf de plek, geen storm) goed voelt en of 8 s kalmte te lang of te kort is.
2. De balansronde van besluit 5 goedkeuren voordat content hem start (hij raakt alle skirmish-fixtures en beide AI's).
3. De punten van sectie 23: sprint-1 pushen, de PR naar main, de laptop-meting, de testgroep.

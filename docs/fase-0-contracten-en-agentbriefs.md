# Fase 0: Contracten en agentbriefs (Wasteland RTS)

Oct 13, 2026 · @Martien

Dit document is het werkcontract, gesplitst in één bestand per hoofdsectie in `docs/fase-0/`. De nummers in de bestandsnamen zijn de sectienummers. Delen met een letter zijn één sectie die over meerdere bestanden is verdeeld.

- [01-doel-en-gebruik.md](docs/fase-0/01-doel-en-gebruik.md): 1. Doel en gebruik
- [02-architectuur.md](docs/fase-0/02-architectuur.md): 2. Architectuur
- [03-repo-structuur-en-stack.md](docs/fase-0/03-repo-structuur-en-stack.md): 3. Repo-structuur en stack
- [04a-contract-1-simulatie-en-snapshotformaat.md](docs/fase-0/04a-contract-1-simulatie-en-snapshotformaat.md): 4. Contract 1: simulatie en snapshotformaat (deel a)
- [04b-contract-1-state-hash-en-snapshot.md](docs/fase-0/04b-contract-1-state-hash-en-snapshot.md): 4. Contract 1: simulatie en snapshotformaat (deel b)
- [05-contract-2-commandoprotocol.md](docs/fase-0/05-contract-2-commandoprotocol.md): 5. Contract 2: commandoprotocol
- [06a-contract-3-dataschema.md](docs/fase-0/06a-contract-3-dataschema.md): 6. Contract 3: dataschema (deel a)
- [06b-contract-3-dataschema.md](docs/fase-0/06b-contract-3-dataschema.md): 6. Contract 3: dataschema (deel b, tabel)
- [06c-contract-3-dataschema.md](docs/fase-0/06c-contract-3-dataschema.md): 6. Contract 3: dataschema (deel c, tabel)
- [06d-contract-3-dataschema.md](docs/fase-0/06d-contract-3-dataschema.md): 6. Contract 3: dataschema (deel d, tabel)
- [06e-contract-3-regels.md](docs/fase-0/06e-contract-3-regels.md): 6. Contract 3: dataschema (deel e, regels)
- [07-determinisme-regels.md](docs/fase-0/07-determinisme-regels.md): 7. Determinisme-regels
- [08-agentdefinities.md](docs/fase-0/08-agentdefinities.md): 8. Agentdefinities
- [09-briefs-per-werkstroom.md](docs/fase-0/09-briefs-per-werkstroom.md): 9. Briefs per werkstroom
- [10-sprint-1-en-2.md](docs/fase-0/10-sprint-1-en-2.md): 10. Sprint 1 en 2
- [11-open-punten-voor-fase-0.md](docs/fase-0/11-open-punten-voor-fase-0.md): 11. Open punten voor fase 0
- [12-contractbesluiten-na-sprint-1.md](docs/fase-0/12-contractbesluiten-na-sprint-1.md): 12. Contractbesluiten na sprint 1
- [13-contractbesluiten-na-sprint-2.md](docs/fase-0/13-contractbesluiten-na-sprint-2.md): 13. Contractbesluiten na sprint 2
- [14-contractbesluiten-na-sprint-3.md](docs/fase-0/14-contractbesluiten-na-sprint-3.md): 14. Contractbesluiten na sprint 3 (de slice-ronde)
- [15-contractbesluiten-na-sprint-4.md](docs/fase-0/15-contractbesluiten-na-sprint-4.md): 15. Contractbesluiten na sprint 4 (de gate-1-ronde)
- [16-contractbesluiten-na-de-dag-ronde.md](docs/fase-0/16-contractbesluiten-na-de-dag-ronde.md): 16. Contractbesluiten na de speltest van 14 oktober (de dag-ronde)
- [17-contractbesluiten-na-de-balans-ronde.md](docs/fase-0/17-contractbesluiten-na-de-balans-ronde.md): 17. Contractbesluiten na de balans-ronde (speltest 14 oktober, vervolg)
- [18-contractbesluiten-na-de-nachtronde.md](docs/fase-0/18-contractbesluiten-na-de-nachtronde.md): 18. Contractbesluiten na de nachtronde (15 oktober: lokale buis, gebouwen, terrein, nieuwe Rustbelt)
- [19-contractbesluiten-na-de-xl-ronde.md](docs/fase-0/19-contractbesluiten-na-de-xl-ronde.md): 19. Contractbesluiten na de XL-ronde (15 oktober: Rustbelt XL, eerlijkheid, echte schaal, toon-materiaal)
- [20-contractbesluiten-na-de-robot-ronde.md](docs/fase-0/20-contractbesluiten-na-de-robot-ronde.md): 20. Contractbesluiten na de robot-ronde (15 oktober: formatie, robots, training, licht en schaduw, gedeelde look)
- [21-contractbesluiten-na-de-techboom-ronde.md](docs/fase-0/21-contractbesluiten-na-de-techboom-ronde.md): 21. Contractbesluiten na de techboom-ronde (16 oktober: de AI door de techboom, de verzamelring, de padgraaf-piek)
- [22-contractbesluiten-na-de-claim-en-shaderronde.md](docs/fase-0/22-contractbesluiten-na-de-claim-en-shaderronde.md): 22. Contractbesluiten na de claim- en shaderronde (17 oktober: de shader-gate, de plaatsingsregel, de heldclaim, de HUD-skin)
- [23a-contractbesluiten-na-fase-2-ronde-1-en-2.md](docs/fase-0/23a-contractbesluiten-na-fase-2-ronde-1-en-2.md): 23. Contractbesluiten na fase 2 ronde 1 en 2 (17 oktober: fog of war, de Raiders, de balans, de creep-kampen, het menu) (deel a)
- [23b-contractbesluiten-na-fase-2-ronde-1-en-2-besluiten.md](docs/fase-0/23b-contractbesluiten-na-fase-2-ronde-1-en-2-besluiten.md): 23. Contractbesluiten na fase 2 ronde 1 en 2 (17 oktober: fog of war, de Raiders, de balans, de creep-kampen, het menu) (deel b, besluiten)
- [23c-contractbesluiten-na-fase-2-ronde-1-en-2-open.md](docs/fase-0/23c-contractbesluiten-na-fase-2-ronde-1-en-2-open.md): 23. Contractbesluiten na fase 2 ronde 1 en 2 (17 oktober: fog of war, de Raiders, de balans, de creep-kampen, het menu) (deel c, open punten)
- [24a-contractbesluiten-na-fase-3-ronde-1-en-2.md](docs/fase-0/24a-contractbesluiten-na-fase-3-ronde-1-en-2.md): 24. Contractbesluiten na fase 2 ronde 3 en fase 3 ronde 1 en 2 (20 oktober: de bouwrobot, de kampovername, Bewaak, winroute C, Survival co-op, de basisverdediging) (deel a, besluiten)
- [24b-contractbesluiten-na-fase-3-ronde-1-en-2-open.md](docs/fase-0/24b-contractbesluiten-na-fase-3-ronde-1-en-2-open.md): 24. Contractbesluiten na fase 2 ronde 3 en fase 3 ronde 1 en 2 (deel b, open punten)

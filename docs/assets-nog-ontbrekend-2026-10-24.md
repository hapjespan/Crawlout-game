# Nog ontbrekende assets (24 oktober 2026, avond)

Zesenveertig ids staan nog procedureel in de pijp. Dit document somt ze op per factie en gebruikssoort, met de prioriteit die de meeste zichtbare winst oplevert.

Zie `docs/assets-gevraagd.md` voor het algemene formaat (GLB, +Z is voor, echte schaal, geen LOD's), en `docs/overdracht-2026-10-24-nieuwe-assets.md` voor de ronde van vandaag die zeventien geleverde modellen in de pijp heeft gekregen.

## Prioriteit 1 — characters met kapotte UV of vorm (3)

Deze drie zijn de laatste openstaande van de 10 "characters" uit de overdracht van 24 oktober ochtend. De eerste twee delen bronmodel; één gekleed mensmodel met deugdelijke unwrap vervangt ze allebei. De derde is een doosjesstapel.

| Id | Nu | Specs | Opmerking |
|---|---|---|---|
| ~~`garde_body_initiate`~~ | **opgelost 27 oktober**: Klerk-model zonder rugzak en tassen, lichte canvasjas (rigmap `dropMaterials` + `recolor`, asset-cli 0.25.0) | — | een eigen model blijft welkom, maar is niet meer nodig |
| `raider_body_slave` | idem | 1,8 m · 3–4k tris · gerigd | de slaaf-eenheid van de Raiders |
| `survival_behemoth` | doosjesstapel zonder vorm | **6–7 m** · 6–8k tris · gerigd (vier poten, dus eigen beestenskelet) | reus, vier van de maat van een mens |

**Behemoth** is een losse sprint waard omdat hij een beestenskelet nodig heeft; `rig-from-donor.py` werkt alleen op humanoid. Als je het niet nu wilt uitzoeken, lever hem aan als rigid-unit (geen animatie) zoals we nu met hound en klauwbeest doen; dat lost minstens de doosjesstapel-vorm op.

## Prioriteit 2 — wapens en gear (15)

De pijp maakt deze nu uit kubus/prisma-definities in `assets/src/<factie>/`. Werken wel, maar ze zijn geometrisch simpel.

### Dwellers (4)

| Id | Nu | Specs |
|---|---|---|
| `dweller_armor_composite` | composite plate blocks | 0,5–0,8 m · 800 tris · anchor body |
| `dweller_tool_multitool` | box stacks met rood lampje | 0,06–0,2 m · 300 tris · anchor grip |
| `dweller_weapon_patrol_rifle` | lange box | 1,0–1,2 m · 400 tris · anchor grip |
| `dweller_weapon_shotgun` | lange box | 0,9–1,1 m · 400 tris · anchor grip |

### Raiders (10)

| Id | Nu | Specs |
|---|---|---|
| `raider_armor_steel` | staalplaten | 0,5–0,8 m · 800 tris · anchor body |
| `raider_gear_chem_tank` | tank op de rug | 0,4–0,7 m · 400 tris · anchor back |
| `raider_gear_shackles` | kettingen | 0,3–0,5 m · 300 tris · anchor body |
| `raider_gear_warlord_helm` | spike-helm | 0,25–0,4 m · 400 tris · anchor head |
| `raider_tool_hammer` | hamer | 0,4–0,6 m · 300 tris · anchor grip |
| `raider_tool_shovel` | schop | 0,8–1,1 m · 300 tris · anchor grip |
| `raider_weapon_chem_sprayer` | sproeier met slang | 0,8–1,1 m · 500 tris · anchor grip |
| `raider_weapon_molotov` | fles met vlam | 0,15–0,25 m · 200 tris · anchor grip |
| `raider_weapon_net_whip` | net-zweep | 1,0–1,4 m · 400 tris · anchor grip |
| `raider_weapon_scrap_revolver` | schroot-revolver | 0,25–0,4 m · 300 tris · anchor grip |

### Garde (1)

| Id | Nu | Specs |
|---|---|---|
| `garde_weapon_multitool` | box met rood lampje | 0,3–0,5 m · 300 tris · anchor grip |

## Prioriteit 3 — gebouwen per factie (20)

De pijp maakt deze uit `assets/src/<factie>/`-fragmenten met prisma/kubus-primitieven. Ze dragen oppervlakte-texturen (sinds de ronde van 22 okt), dus ze lezen niet meer als vlakke blokken, maar ze zijn conceptueel simpel.

### Dwellers (8)

| Id | Rol | Footprint |
|---|---|---|
| `dweller_building_beacon` | radiobaken (safetyNet) | 3×3 |
| `dweller_building_claim_post` | claimpunt | 1×1 |
| `dweller_building_housing` | woonhuis (5 bedden) | 13×19 |
| `dweller_building_hq` | hoofdgebouw | — |
| `dweller_building_lab` | onderzoekslab | — |
| `dweller_building_robotfactory` | robotfabriek | 15×13 |
| `dweller_building_training` | trainingsveld | — |
| `dweller_building_workshop` | werkplaats | — |

### Raiders (6)

| Id | Rol | Footprint |
|---|---|---|
| `raider_building_camp` | Raiderkamp (hoofdgebouw + kooi, 8 slaven) | 15×15 |
| `raider_building_chemlab` | chemlab | — |
| `raider_building_claim_post` | claimpunt (plunderpost) | 1×1 |
| `raider_building_garage` | garage | — |
| `raider_building_market` | markt (tribute) | — |
| `raider_building_mg_nest` | mitrailleursnest | — |

### Garde (6)

| Id | Rol | Footprint |
|---|---|---|
| `garde_building_archive` | archief (tech-onderzoek) | — |
| `garde_building_barracks` | kazerne (werving van Initiates) | 15×15 |
| `garde_building_bastion` | bastion (hoofdgebouw) | 21×21 |
| `garde_building_forge` | smederij (krachtpantsers) | 21×19 |
| `garde_building_helipad` | landingsplatform (Vertibird) | — |
| `garde_building_outpost` | voorpost | — |

## Prioriteit 4 — site-gebouwen (winroute C, Bouwproject) (8)

Deze zijn vier panden in twee staten (ruïne en gerestaureerd), voor de Bouwproject-winroute. Procedureel gegenereerd uit JSON-definities in `assets/src/sites/`. Prioriteit laag omdat het hele mechaniek nog weinig in zicht is in potjes.

| Id |
|---|
| `site_garage_restored` + `site_garage_ruin` |
| `site_gas_station_restored` + `site_gas_station_ruin` |
| `site_supermarket_restored` + `site_supermarket_ruin` |
| `site_water_tower_restored` + `site_water_tower_ruin` |

## Totaal

| Prioriteit | Aantal |
|---|---|
| 1 · characters met kapotte UV of vorm | 3 |
| 2 · wapens en gear | 15 |
| 3 · gebouwen per factie | 20 |
| 4 · site-gebouwen | 8 |
| **Totaal procedureel** | **46** |

## Hoe aanleveren

- GLB, +Z is voor, echte schaal (mens 1,8 m voor maat).
- Eén mesh op LOD0-niveau; de buis maakt LOD1 en LOD2.
- Geen texture-atlas; de buis voegt samen.
- Characters: op mens-skelet gerigd of ongerigd (dan starre weergave).
- Lever met de naam van de id (`<id>.glb`); ik zet hem op de goede plek in `assets/local/delivered/` of `assets/local/rigged/`.
- Voor varianten die dezelfde bron delen (zoals we met ghoul/runner deden): lever één keer, geef in het bericht welke twee ids het model moeten dragen.

Elk model dat ik erin trek maakt bij een `pnpm --filter @crawlout/asset-cli exec tsx src/cli.ts --local` run meteen zichtbaar in `assets/dist-local` en is reviewbaar via `tools/asset-cli/scripts/review-shots.ts`.

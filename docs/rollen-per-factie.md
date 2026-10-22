# Rollen per factie (voor artwork)

Uit `data/loadouts/*.json` en `data/heroes.json` op 22 oktober 2026. Per rij: de unit, zijn rol in de sim, en het **body-asset** dat het model levert. Units die hetzelfde body-asset delen, hebben één model nodig — het verschil zit in het wapen.

Specs, maten en aanleverroute staan in [`assets-gevraagd.md`](assets-gevraagd.md). Kort: GLB, +Z voor, echte schaal met een mens van 1,8 m, één mesh op LOD0 (de buis maakt LOD1 en LOD2 zelf).

## Dwellers

| Unit | Rol | Body-asset | Wapen |
|---|---|---|---|
| scavenger | scavenger | `dweller_body_human` | — |
| bouwer | builder | `dweller_body_human` | — |
| technicus | technician | `dweller_body_human` | — |
| militie | militia | `dweller_body_human` | pipe pistol |
| patrol | militia | `dweller_body_human` | patrol rifle |
| geweer_leer | militia | `dweller_body_human` | rifle |
| shotgun_leer / shotgun_composiet | militia | `dweller_body_human` | shotgun |
| slagwapen_leer / slagwapen_composiet | militia | `dweller_body_human` | club |
| beveiligingsrobot | robot | `dweller_robot_guard` | — |
| bouwrobot | robot | `dweller_robot_builder` | — |
| reparatiedrone | robot | `dweller_robot_drone` | — |
| sentinel | robot | `dweller_robot_sentinel` | — |
| **held** Opziener (krijger) · Voorman (bouwer) · Controleur (tacticus) | | | |

Acht van de veertien Dweller-units delen **één** body. Rol en uitrusting zie je nu alleen aan het wapen. Een eigen model voor de scavenger, de bouwer en de technicus zou het meest opleveren: dat zijn de drie die je de hele tijd ziet en nu niet uit elkaar houdt.

## Raiders

| Unit | Rol | Body-asset | Wapen |
|---|---|---|---|
| slaaf | scavenger | `raider_body_slave` | — |
| slaaf_bouwer | builder | `raider_body_slave` | — |
| plunderaar / plunderaar_staal | militia | `raider_body_human` | pipe gun |
| knuppelaar | militia | `raider_body_human` | spiked club |
| molotovgooier | militia | `raider_body_human` | molotov |
| chemdealer | militia | `raider_body_human` | chem sprayer |
| slaver | militia | `raider_body_human` | net whip |
| warlord_basis | militia | `raider_body_human` | scrap revolver |
| hond | militia | `raider_body_hound` | — |
| buggy | militia | `raider_vehicle_buggy` | — |
| **held** Warlord (krijger) · Marktmeester (bouwer) · Ketenmeester (tacticus) | | | |

Zes Raider-vechters delen één body. De slaaf heeft al een eigen model. Een tweede vechtersmodel (bijvoorbeeld de slaver of de chemdealer, die een eigen rol spelen) zou de horde minder uniform maken.

## De Garde

| Unit | Rol | Body-asset | Wapen |
|---|---|---|---|
| initiate_zoeker | scavenger | `garde_body_initiate` | multitool |
| initiate_bouwer | builder | `garde_body_initiate` | multitool |
| initiate_wacht | militia | `garde_body_initiate` | laser pistol |
| klerk | technician | `garde_body_clerk` | multitool | **nieuw model, loopt** |
| krachtpantser | militia | `garde_body_power_armor` | laser carbine | **nieuw model, loopt** |
| plasmaridder | militia | `garde_body_power_armor_heavy` | plasma caster | **nieuw model, star** |
| vertibird | militia | `garde_body_vertibird` | vertibird gun | **nieuw model** |
| **held** Paladin-Commander (krijger) · Kwartiermeester (bouwer) · Archivaris (tacticus) | | | |

Drie Initiate-rollen delen één body. Verder is de Garde nu het best voorziene van de drie.

## Wat ontbreekt, op volgorde van nut

1. **Dweller scavenger, bouwer en technicus** — drie eigen bodies. Je ziet deze drie het vaakst en ze zijn nu niet te onderscheiden.
2. **Raider slaver of chemdealer** — één extra vechtersmodel breekt de uniforme horde.
3. **Garde-initiate per rol** — zoeker en bouwer naast de wacht.
4. **Heldmodellen** — acht van de negen helden gebruiken nog het militie-loadout van hun factie als lichaam. Alleen de Warlord heeft een eigen model (en die staat nog stil).

## Twee dingen om te weten voor je modelleert

- **Wapens zijn losse props** met een `anchor` (grip, back, head, body). Je hoeft ze niet aan het lichaam te modelleren; de buis hangt ze aan het skelet.
- **Lopen vraagt een skelet.** Een star model glijdt over de grond. Een model met een eigen skelet in T-pose kan geretarget worden; een star model in T-pose kan auto-gerigd worden. Een open constructie zonder duidelijke ledematen (zoals het power-armour-frame) lukt geen van beide — dat blijft stilstaan.

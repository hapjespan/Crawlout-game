# Nachtplan 14 op 15 oktober 2026

Doel: de punten uit de speltest van 14 oktober afmaken. Dat zijn echte assets, research en craft als kaarten, en balans (een sterkere AI, nuttige scrap, potjes van 25 tot 35 minuten, een held die levelt). Alles komt op `sprint-1`, met één review aan het eind. De hoofdsessie integreert en test in de browser.

## Model en effort per taak

| Taak                                                         | Agent               | Model, effort  | Waarom                                           |
| ------------------------------------------------------------ | ------------------- | -------------- | ------------------------------------------------ |
| Balans, AI, onderzoeksvoortgang in de status                 | sim-core en content | Opus, hoog     | Determinisme en lange meetlussen in de sim       |
| Gebouwpaneel met kaarten                                     | hud                 | Sonnet, midden | Afgebakende UI met een duidelijke interface      |
| Echte assets door de buis (vingers snoeien, LODs, clipmap)   | asset-cli           | Sonnet, hoog   | Lastige geometrie, maar wel mechanisch toetsbaar |
| Props verspreiden over Rustbelt (decoratie, deterministisch) | map                 | Sonnet, midden | Data en een generator                            |
| Echte karakters en props in de renderer, meting              | render-pipeline     | Opus, hoog     | Shader-reviewgate en het prestatiebudget         |
| Review van alle gates en contracten                          | architect           | Fable, hoog    | Contracten en determinisme                       |
| Opmaak (prettier), CHANGELOGs, docs                          | bulk                | Haiku, laag    | Mechanisch werk                                  |
| Integratie in de client, browsertest, merge en push          | hoofdsessie         | Opus           | Ziet het geheel                                  |

## Golven

1. **Nu, parallel:**
   - balans (loopt al);
   - kaarten-HUD (loopt al);
   - asset-cli met de echte assets;
   - map-props.
2. **Na asset-cli en map:**
   - render met de echte assets en props;
   - parallel daaraan koppelt de hoofdsessie de kaarten in de client.
3. **Na balans en render:**
   - de hoofdsessie merget alles, draait alle checks en test in de browser;
   - daarna de architect-review.
4. **Afsluiting:**
   - bulk doet opmaak en CHANGELOGs;
   - de hoofdsessie draait de laatste checks en pusht `sprint-1` (dat alleen, met akkoord van Martien op 14 oktober);
   - de gate-1-checklist wordt bijgewerkt en er komt een overdracht voor de ochtend.

## Bronnen in assets/src (CC0, met licenties in assets/src/licenses)

- `characters/dweller_body_human.glb`: de Quaternius Universal Animation Library (Standard), met mannequin, 53 bones en 46 clips. Clipkeuze:
  - idle: `Idle_Loop`
  - walk: `Walk_Loop`
  - run: `Jog_Fwd_Loop`
  - attack1: `Pistol_Shoot`
  - attack2: `Punch_Cross`
  - gather: `Interact`
  - build: `Fixing_Kneeling`
  - death: `Death01`
- `props/`: 10 stuks uit de Gobkit Nature Kit (bomen, struiken, rotsen, gras, riet).

## Regels voor de nacht

- Agents downloaden niets. De bronnen zijn eenmalig door de hoofdsessie opgehaald, met akkoord van Martien.
- Geen contractwijziging zonder een regel in docs/CHANGELOG.md; de architect bevestigt ze aan het eind.
- `sprint-1` blijft groen. Een rode merge wordt teruggedraaid, niet gepusht.

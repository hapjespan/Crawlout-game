# Assets gevraagd (22 oktober 2026)

Drie dingen staan open uit de overdracht van 21 oktober. Hieronder per stuk wat er nodig is en wat de buis ervan verwacht.

## Algemeen: wat je niet hoeft te doen

- **Geen LOD's maken.** Lever één mesh op LOD0-niveau; de buis maakt LOD1 en LOD2 zelf (meshopt, gewogen op uv en normalen).
- **Geen exacte oriëntatie of schaal.** De config draait en schaalt (`rotate`, `scale` of `fit`, `align`). Zeg wél welke maat je bedoelde, in meters — de buis zet het model nooit in elkaar gedrukt op een footprint, hij waarschuwt als de echte maat niet klopt.
- **Geen texture-atlas.** Meerdere diffuse textures worden samengevoegd; bron 512 tot 1024 px is genoeg.

Formaat: **GLB**. Oriëntatie: +Z is voor. Schaal: echt, met een mens van 1,8 m als maat — een poppetje moet door de deur passen.

**Waar het heen gaat.** Eigen werk kan in `assets/src` of via de delivered-config in git. Modellen die uit Fallout-bronnen komen gaan naar `assets/local/delivered/` met hun regel in `assets/local/delivered.json`; die map staat in `.gitignore`, draait via `pnpm assets --local` naar `assets/dist-local` en laadt alleen in dev. Zeg bij aanlevering even welke van de twee het is, dan zet ik het op de goede plek.

---

## 1. Power armour (2 modellen)

Nu is dit het mensenmodel `dweller_body_human`, 1,2× opgeschaald en grijs gekleurd. Daardoor heeft het krachtpantser het silhouet van een mager mens in een grijs pak, terwijl het juist breed en zwaar hoort te lezen op afstand.

| | `garde_body_power_armor` | `garde_body_power_armor_heavy` |
|---|---|---|
| Hoogte | 2,1 – 2,3 m | iets groter, circa 2,3 m |
| Driehoeken LOD0 | 3000 – 4000 | 3000 – 4000 |
| Nodig | breed silhouet: zware schouders, dikke dijen, helm met kleine kijkspleet | zelfde lijn, nog zwaarder |

Waar het om gaat is de **omtrek**, niet het detail: op speelafstand zie je alleen de vorm. Breder dan hoog in de schouders, korte nek, grote voeten.

Materialen die de buis verwacht (namen mogen anders, dan map ik ze): een hoofdmateriaal voor het pantser en een tweede voor de gewrichten. Kleuren komen uit `assets/src/rigmap.json`, dus lever neutraal of grijs — ik kleur ze per factie.

**Rig:** als het model geanimeerd moet worden, moet het op hetzelfde skelet als de andere mensen. Lever je het ongerigd, dan blijft het een stijf model (zoals de Vertibird nu) en staat het stil — bruikbaar, maar het loopt niet.

## 2. Slaapzaal (1 gebouw)

| | |
|---|---|
| Id | `slaapzaal` |
| Footprint | **13 × 17 m** (de buis rekent 1 cel = 1 m) |
| Bedden | 6 |
| Driehoeken LOD0 | max 2500 |
| Textuur | max 1024 px |

Een Garde-slaapzaal: lange zaal, stapelbedden, functioneel en streng. Hij hoort bij `bastion` (21×21), `kazerne` (15×15) en `smederij` (21×19), dus hij mag er bescheidener uitzien dan het hoofdgebouw.

Let op de footprint: 13 × 17 m is de maat die de sim gebruikt voor plaatsing en botsingen. Wijkt je model daarvan af, dan waarschuwt de buis en past hij hem **niet** stiekem aan.

## 3. Heldportretten (9 afbeeldingen)

Voor de keuzekaarten in het menu en de lobby. Er is nog geen slot in de HUD — dat bouw ik zodra de beelden er zijn.

| Factie | Bouwer | Krijger | Tacticus |
|---|---|---|---|
| Dwellers | Voorman | Opziener | Controleur |
| Raiders | Marktmeester | Warlord | Ketenmeester |
| De Garde | Kwartiermeester | Zwaardridder | Archivaris |

- **Formaat:** PNG, verhouding 2:3 staand (de consoleportretten in de HUD zijn 49×73), bijvoorbeeld 512 × 768. Kleiner mag, de HUD schaalt.
- **Kader:** borstbeeld, gezicht groot genoeg om op een kaart van een paar centimeter te lezen.
- **Achtergrond:** egaal of transparant; de kaart heeft zijn eigen lijst.
- Karakterbeschrijvingen staan in `docs/held-keuze.md` (SPECIAL, passief, ability per held).

Komen deze uit de bestaande HUD-sheets, dan gaan ze naar `assets/local/hud/` zoals de rest van de skin.

---

## Volgorde die mij het meest oplevert

1. **Power armour** — het staat in elk Garde-potje in beeld en het huidige silhouet leest verkeerd.
2. **Heldportretten** — de keuzekaarten zijn nu tekst; met beelden wordt de held-keuze pas een keuze.
3. **Slaapzaal** — werkt al, ziet er alleen generiek uit.

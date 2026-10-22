# Geleverde karakters laten lopen — 22 oktober

Antwoord op punt 7 van `docs/overdracht-assets-2026-10-22.md`: de geleverde mensfiguren stonden als `rigid-unit` in
`assets/local/delivered.json` en gleden dus over de grond. Twee van de vier lopen nu; dit is wat gemeten is.

## De vier modellen, gemeten

| Model (bron)                                      | Driehoeken | Prims/materialen | Eigen skelet         | Pose           |
| ------------------------------------------------- | ---------- | ---------------- | -------------------- | -------------- |
| `power_armor-fallout.glb`                         | 49.970     | 1 / 1            | ja, 96 CC_Base-bones | T, 2 clips     |
| `power_armor_frame_fallout_4.glb`                 | 107.333    | 3 / 3            | nee                  | armen 62° laag |
| `fallout_brotherhood_of_steel_squire.glb` (Klerk) | 93.878     | 39 / 29          | nee                  | T              |
| `scarred_mercenary_captain_...glb` (held Raiders) | 1.985.818  | 22 / 1           | nee                  | armen langs    |

## Welke route wint waar

1. **Retarget** (`rig` + `retarget`, de route van `hero_opziener`) wint zodra het model een eigen skelet heeft: de
   gewichten zijn van de maker, dus de knie buigt waar de maker hem bedoelde. Het krachtpantser gaat zo: de 96
   CC_Base-bones snoeien naar de 20 Mixamo-namen (rig `cc-base`), clips retargeten van `dweller_body_human`. Alle 20
   doelbones gekoppeld, geen enkele `unmapped`. Kosten: seconden. Geen zichtbare scheuren.
2. **Auto-rig** (`autoRig`, bestaand) werkt voor een star model in T- of A-pose. De Klerk gaat zo: 39 primitives en 29
   materialen blijven staan (geen atlas, geen samenvoegen, dus de texturen blijven), de armhoek wordt als T herkend,
   de helft van de hoekpunten ziet geen bone (lagen kleding) maar krijgt bruikbare gewichten van de buren. Kosten:
   ongeveer 40 s voor dit model, want de zichtbaarheidstest is lineair in het aantal driehoeken. Kwaliteit: goed op
   afstand, kleine scheuren tussen laars en broekspijp omdat dat losse schelpen zijn.
3. **Niet doen** voor de andere twee, zie hieronder.

## Wat niet loont

- **Het power-armour-frame** (`garde_body_power_armor_heavy`): het exoskelet is een open constructie van 51.366
  losse stukjes (120.426 hoekpunten voor 107.333 driehoeken). Auto-rig maakt daar per stukje een starre koppeling aan
  de dichtstbijzijnde lichaamsvertex van; dat kost 34 s en levert gewichten die bij de gewrichten uit elkaar lopen. Het
  frame heeft bovendien geen hoofd, dus de Head-bone staat in de lucht. Laat het een `rigid-unit`.
- **De held van de Raiders** (`hero_warlord`): een Tripo-scan van 1.985.818 driehoeken. Twee harde grenzen. Eén:
  reduceren lukt niet, één meshopt-pass naar 8000 landt op 132.203 driehoeken (22 primitives met naden). Twee: de
  auto-rig is kwadratisch in het aantal hoekpunten (de zichtbaarheidstest en het koppelen van losse delen), dus op
  1,4 miljoen hoekpunten loopt hij uren. De starre delivered-buis haalt hem wél naar 3998 driehoeken, want die
  reduceert over alle materialen tegelijk. Laat hem een `rigid-unit` tot er een lichtere bron is; een held staat vaak
  stil en valt minder op dan een troep die loopt.

## Drie wijzigingen in de buis (gecommit)

1. `simplifyToTarget` rekende de ratio van een vervolgpass tegen de **bron** in plaats van tegen het resultaat van de
   vorige pass. Daardoor haalde pass twee er veel te veel uit: de Klerk landde op 2145 driehoeken tegen een doel van
   4000 en een ondergrens van 3000, nu op 3940 (LOD1 1324, LOD2 492). Dit is ook punt 2 van de vorige overdracht
   ("te weinig polygonen"): wat in één pass al raak was, verandert niet, dus `assets/dist` blijft gelijk.
2. Rigmap-veld `source`: een entry mag zijn eigen bron-GLB aanwijzen, zoals `autoRig.from` al deed. Zonder dat kon een
   model onder `delivered/` alleen door de starre buis.
3. `validateAsset` krijgt `height`: een karakter wordt getoetst op de hoogte die de config hem geeft, anders viel het
   krachtpantser van 2,25 m buiten de 1,8 m ± 15 procent van de brief.

Nieuw gereedschap: `src/pose.ts` (`poseSkinnedDocument`) zet een geskind document op één moment van een clip; een
subject in `src/silhouette.ts` krijgt een veld `clip`. Een rij silhouetten over de walk-cyclus laat zonder browser zien
of de benen echt bewegen.

## Stand en wat open blijft

- `garde_body_clerk` (auto-rig, 1,79 m) en `garde_body_power_armor` (retarget, 2,25 m) zijn nu `character` met de acht
  gebakken clips; beide entries staan in `assets/local/rigmap.json` (buiten git) en zijn uit `delivered.json` gehaald.
- Geen van beide heeft een teammasker: `teamMask` staat op `materialName` en er is geen materiaal met "team" in de
  naam, dus de spelerskleur ontbreekt. Voor de Klerk is een hue-masker over de jas de volgende stap (zoals bij
  `raider_body_human`), voor het krachtpantser een band op de bovenarm.
- De auto-rig heeft geen voorreductie: hij draait op de volle bron. Voor de Klerk is dat 40 s, voor zwaardere bronnen
  onwerkbaar. Een veld `sourceTriangles` dat eerst reduceert zou dat oplossen; bewust laten liggen.

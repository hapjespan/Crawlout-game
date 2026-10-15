# Visuele review, 15 oktober 2026

Aanleiding: Martien na de speltest: "de game voelt niet als een terrain, units en buildings matchen niet en is een bij elkaar geraapt zooitje, ik heb geen shadows en units bewegen te veel het zelfde/tegelijk." Getoetst aan de gidsen op threejsresources.com/guides (shadows, lighting, materials, maps, grass, animation, sky-and-clouds, textures, scene-renderer, water, camera) en de tools-lijst op threejsresources.com/tools.

## Wat de screenshots laten zien

| #   | Bevinding                                                                                                                                         | Oorzaak in de code                                                                                                        | Gids                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | Geen zichtbare schaduwen van units, props en bomen; alleen het hoofdgebouw werpt een vage schaduw                                                 | `shadows/sunShadow.ts`: de shadow map bevat alleen gebouwen; units hebben blob-decals, props niets; `PCFShadowMap` (hard) | shadows, lighting        |
| 2   | Gebouwen staan óp het terrein in plaats van erin: geen contactschaduw, geen fundering, geen stof of gras tegen de voet                            | geen AO of contactlaag rond footprints                                                                                    | maps, materials          |
| 3   | Terrein leest als een vage luchtfoto: één albedo van 2048 over 384 m (ca. 19 cm per texel), geen detail-tegel en geen normaal-detail van dichtbij | `terrain/terrainMaterial.ts`                                                                                              | textures, materials      |
| 4   | Stijlbreuk: fotografisch getextureerd huis, egaal gekleurde primitieve watertoren, glanzend blauwe poppetjes, rotsfoto-terrein                    | elk asset heeft eigen materiaalinstellingen; geen gedeeld palet of gedeelde grading                                       | materials                |
| 5   | Kaartrand: het terrein stopt hard in een grijsblauwe leegte; geen mist, geen horizon                                                              | `scene.background` effen, geen `scene.fog`, geen rand-skirt                                                               | sky-and-clouds, camera   |
| 6   | Units in een groep lopen, stoppen en animeren precies tegelijk en in dezelfde fase; ze komen op exact hetzelfde punt aan                          | geen animatie-fase per instance; de sim kent geen formatie- of aankomstspreiding                                          | animation                |
| 7   | Inzoomen gaat te ver (10 m): camera duikt in het huis                                                                                             | `rtsCamera.ts` `minDistance` 10                                                                                           | camera                   |
| 8   | Ver uitgezoomd zijn units en props onleesbaar; de kaart is één bruine vlek                                                                        | geen kleur- of contrastscheiding tussen speelbare en decoratieve laag                                                     | lighting, sky-and-clouds |

## Uitwerking per agent

1. **Licht en schaduw** (render, Opus high): echte zonschaduw voor units, props en bomen (alpha-test in de shadow pass), PCF-soft, frustum strak rond het camerabeeld, bias en normalBias tunen, hemellicht als fill, exposure en tone mapping, mist in de kleur van de lucht, horizon en kaartrand. Budget: geen frame boven 20 ms op de M3 Pro; schaduw uit via `?shadows=0` en automatisch uit op `detail=1`.
2. **Terrein-gevoel** (render, Sonnet high): detail-albedo en -normaal die op afstand uitfaden, macro-variatie, contact-AO en stofrand rond gebouwvoeten en props, kaartrand-skirt, minimale zoomafstand.
3. **Art-cohesie** (render en assets, Sonnet high): één palet en één material-recept (roughness, metalness, verzadiging, albedo-bereik volgens physicallybased.info) voor gebouwen, units, props en placeholders; texel-dichtheid gelijk trekken; placeholders krijgen dezelfde getextureerde behandeling; teamkleur als accent in plaats van hele unit.
4. **Bewegingsvariatie, render** (Sonnet medium): fase-offset en snelheidsvariatie per instance, idle-varianten, kleine draaiing en starttijdverschil bij orders, voetstap-synchronisatie op werkelijke snelheid.
5. **Bewegingsvariatie, sim** (Opus high): formatie- en aankomstspreiding bij groepsorders (deterministisch, met replay-fixtures), zodat units niet op één punt samenklonteren.

## Tools uit de lijst die we inzetten

- **Spector.js** en de bestaande perf-overlay om draw calls en de shadow pass te meten.
- **three.ez/instanced-mesh** als referentie voor per-instance frustum-culling van de 7904 props (alleen overnemen als het meetbaar wint).
- **Physically Based** (physicallybased.info) als bron voor albedo- en roughness-waarden.
- **Three Scatter** en **Grassworks** als referentie voor scatter en gras; geen nieuwe dependency zonder meting.

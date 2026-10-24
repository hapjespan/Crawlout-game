# Grondbeperking op geretargete clips

Een geretargete clip neemt de botpose van de donor exact over, maar grondcontact is een eigenschap van het oppervlak om de botten. Dezelfde enkelstand die de slanke donor laat lopen duwt een gepantserde laars door de vloer, en dezelfde knielpose laat een dikke scheen erin zakken. `retargetClips` lost dat in drie trappen op, in deze volgorde, per frame.

**(a) Enkelverlichting — `src/footRelief.ts`.** Elk been heeft zijn eigen grondsampler over de hoekpunten die alleen aan zijn enkel en teen hangen. Staat die onder het grondvlak, dan kantelt de enkel met de tenen omhoog om de dwarsas van de voet, zodat de teen als kind star meedraait en een harde laars zijn vorm houdt. De hoek komt uit een ternaire zoektocht naar de stand waarin de voet het hoogst staat (de teen omhoog drukt de hiel omlaag, dus meer is niet altijd beter) gevolgd door een bisectie naar de kleinste hoek die de vloer haalt, met een plafond van 60 graden. Helpt draaien niet, dan staat er geen voet onder de grond en gaat de enkel precies terug naar wat de clip had. Het verslag meldt `ankleReliefDegrees` per clip. Het lichaam boven de enkel beweegt hier niet.

**(b) Body-lift.** Wat na (a) nog onder de grond staat wordt met twee samplers uit elkaar gehaald: één over alles, één waarin de hoekpunten met gewicht op een voetbot zijn weggelaten (`ignore` in `src/ground.ts`). Zakt die tweede weg, dan staat er echt een lichaam in de vloer — de knielende scheen van `build`, de heup van `death` — en gaat de root dat frame met de hele doordringing omhoog, zoals sinds 0.21.0. Zo'n clip krijgt verder geen demping: een actie op de grond hoort de grond te volgen.

**(c) Hellingbegrensde lift — `src/liftCurve.ts`.** Komt in een clip nergens iets anders dan een voet onder de grond, dan is het een looppas. De resterende vraag gaat dan niet frame voor frame naar de root maar langs de kleinste curve die elke frame-vraag nog dekt en tussen twee buren nooit meer dan `liftSlope` verandert (standaard 0,5 mm, bij 30 fps 15 mm/s). Een piek van één frame wordt zo door zijn buren meebetaald: de heup springt niet, en de twee spiegelsymmetrische passen krijgen vrijwel evenveel lift, ook als de bronclip zelf niet symmetrisch is. Lussende clips lopen door over de naad; het laatste keyframe is een kopie van het eerste.

Opties op `retargetClips`: `ground` (uit voor iets dat hoort te zweven), `groundY`, `ankleRelief`, `liftSlope` en `maxLift`. `maxLift` is een vangnet tegen één losse vertex onder de kaart en staat ruim (0,5 m): krap zetten breekt (b), want `build` op het zware krachtpantser vraagt 258 mm en `death` 291 mm. De limp die een krap plafond moest voorkomen zit niet in de grootte van de correctie maar in de snelheid ervan, en die wordt in (c) begrensd.

## Meten

Drie scripts naast de buis, allemaal op `assets/local` (`CRAWLOUT_LOCAL`, en `CRAWLOUT_RIGGED` om een opnieuw gebonden set te meten zonder de uitgeleverde te overschrijven):

- `scripts/measure-bob.ts [assetId...] [--lift=mm] [--slope=mm] [--no-relief] [--dump=clip] [--bone=clip]` — per clip zonder en met de grondbeperking: `lowestMin` en `lowestRange` (de definitie van 0.17.0), de verticale reis van heup en hoofd, de grootste sprong per frame en de toegevoegde lift.
- `scripts/measure-toe.ts <assetId...>` — hoe ver de geometrie van een voetbot van zijn gewricht reikt.
- `scripts/measure-stretch.ts <assetId> [--clip=build] [--every=4]` — hoe ver een rand van zijn bindlengte wordt getrokken: de maat voor een schil die kreukelt.

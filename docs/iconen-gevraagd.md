# Iconen gevraagd (22 oktober 2026)

Wat de rechtermuisknop nu doet, welke acties er zijn, en welke iconen daarvoor nog ontbreken.

## Wat de rechtermuisknop nu kiest

De volgorde in `apps/client/src/main.orders.ts`, van boven naar beneden. De eerste die past, wint.

| Waar je op wijst | Met welke selectie | Commando |
|---|---|---|
| Vijandelijk gebouw dat je niet meer ziet (ghost in de mist) | elke unit | **AttackMove** naar die plek |
| Vijandelijke unit of gebouw | elke unit | **Attack** |
| Scrapbron | alleen de verzamelaars in je selectie | **Gather** |
| Ruïne van het Bouwproject (neutraal) | alleen de bouwers | **Build** (herstellen) |
| Eigen gebouw in aanbouw | alleen de bouwers | **Build** (helpen) |
| Claimpunt | alleen de bouwers | **Claim** |
| Grond, of iets zonder regel hierboven | elke unit | **Move** |

Twee dingen vallen op. Een **gemengde selectie splitst zichzelf**: wijs je met soldaten én verzamelaars op een scrapbron, dan gaan alleen de verzamelaars verzamelen en doen de rest niets. En **repareren zit er niet bij** — de Klerk en de technicus repareren vanzelf wat in de buurt staat, er is geen order voor.

## Acties die alleen op de commandokaart staan

Stop · Vang (Slaver) · Bevrijd · Bewaak · Verzamel · Bouw · Claim · de drie rolknoppen · Oplappen · Alarm · Lobby · de abilities van de held.

## Welke iconen er al zijn

`icon-move` · `icon-attack` · `icon-gather` · `icon-build` · `icon-stop` · `icon-home` · `icon-turret` · `icon-factory`

De rolknoppen lenen nu portretten (`portrait-3`, `-4`, `-5`) in plaats van een eigen icoon.

## Wat ontbreekt

### Voor de rechtermuisknop (het hoogst nodig)

| Icoon | Waarvoor | Opmerking |
|---|---|---|
| `icon-gather-zoeker` | Garde-verzamelaar | **vergrootglas** |
| `icon-gather-plunderaar` | Dweller-verzamelaar | **hand** |
| `icon-gather-slaaf` | Raider-verzamelaar | **schep** |
| `icon-claim` | claimpunt pakken | **gereedschap**, zoals je zei |
| `icon-repair` | repareren | de actie bestaat nog niet, zie de vraag onderaan |

Het bestaande `icon-gather` kan blijven als terugval wanneer er geen factie-specifiek icoon is.

### Voor de commandokaart

| Icoon | Waarvoor |
|---|---|
| `icon-guard` | Bewaak — iets met een leiband of een post |
| `icon-capture` | Vang (Slaver met zijn netzweep) |
| `icon-liberate` | Bevrijd (ketting die breekt) |
| `icon-revive` | Oplappen van de held |
| `icon-alert` | Alarm, springt naar de laatste aanval |
| `icon-role-scavenger`, `icon-role-builder`, `icon-role-militia` | de drie rolknoppen, nu portretten |

### Voor de held

Je wilde dat de held **altijd een plus** krijgt. Dat kan op twee manieren:

1. **Eén plus-badge** die over elk willekeurig icoon wordt gelegd. Eén bestandje, werkt meteen voor alle acties, ook voor acties die later bijkomen. Mijn voorkeur.
2. **Een eigen plus-variant per icoon**. Mooier te controleren, maar het verdubbelt de lijst en elke nieuwe actie vraagt weer twee tekeningen.

Bij optie 1 lever je `icon-plus` aan: een klein, helder plusje met genoeg contrast om op een donker icoon te lezen, bij voorkeur met een eigen randje zodat het niet wegvalt.

Daarnaast heeft elke held **abilities** zonder icoon (Haastklus, Lockdown, Noodslot, Opbod, Prikkeldraad, Bevoorrading, Dwangprotocol, …). Negen helden met elk één ability. Die kunnen later; de commandokaart toont ze nu als tekst.

## Formaat

Zoals de bestaande iconen: PNG met transparantie, vierkant, rond 128 × 128 px (de HUD schaalt omlaag). Stijl: de groene CRT-lijn van de bestaande set. Ze gaan naar `assets/local/hud/` met een regel in `hud-skin.json`, net als de rest van de skin.

## Twee vragen voordat ik dit bouw

1. **Repareren.** Er is nu geen repareer-order: technici repareren vanzelf wat binnen bereik staat. Wil je een echte order (rechtsklik met een technicus op een beschadigd eigen gebouw = repareer dat), of alleen een icoon dat toont dat hij al aan het repareren is?
2. **De plus bij de held.** Jij zei "hero heeft altijd een + icoon". Bedoel je zodra de held in de selectie zit, of alleen wanneer zijn ability ook echt klaar is (niet in cooldown)? Het tweede is eerlijker — een plus die je niet kunt gebruiken, is een leugen.
